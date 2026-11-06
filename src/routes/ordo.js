import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole, requireMfa, hashIp } from '../auth.js';
import { registre, moteurConnu } from '../moteurIA.js';
import { verifier } from '../verificateur.js';
import { sprtLLR, sprtBounds } from '../sprt.js';

/* ═══════════════════════════════════════════════════════════════════════
   ORDONNANCEUR — des missions de calcul pour des exécutants branchables
   ───────────────────────────────────────────────────────────────────────
   Le Labo décide QUOI calculer (une campagne : deux jeux de poids à
   départager). L'ordonnanceur décide OÙ et QUAND (quelle mission pour quel
   exécutant). Les exécutants font le travail. La vérification décide si le
   résultat compte. L'ordonnanceur ne connaît aucune technologie : seulement
   le contrat ci-dessous, que tout exécutant respecte (un navigateur, le
   programme Node scripts/executant.js, plus tard d'autres familles).

     POST /ordo/executants                 se brancher (famille, cœurs, moteur)
     POST /ordo/executants/:id/battement   signe de vie : renouvelle ses baux
     POST /ordo/missions/reclamer          demander une mission (le serveur choisit)
     POST /ordo/tentatives/:id/resultat    rendre le résultat (vérifié avant d'être compté)
     POST /ordo/tentatives/:id/abandon     rendre la mission sans résultat
     POST /ordo/executants/:id/debrancher  se débrancher (ses missions repartent dans la file)

   Débrancher n'importe quand ne perd rien : une mission dont le bail expire
   repart dans la file ; chaque tentative a son jeton, un exécutant revenu
   trop tard ne peut pas faire compter un résultat. Rien de ce que dit un
   exécutant n'est cru : la partie est rejouée et le moteur du serveur
   recherche lui-même quelques demi-coups tirés au hasard (src/moteurIA.js).
   ═══════════════════════════════════════════════════════════════════════ */

export const FAMILLES = ['navigateur', 'node', 'natif', 'serveur', 'boinc'];
// durée qu'on accepte de confier d'un coup à chaque famille (un téléphone peut se mettre en veille)
const DUREE_MAX_S = { navigateur: 300, node: 3600, natif: 3600, serveur: 3600, boinc: 86400 };
const CROISSANCE = 6;            // une profondeur de plus coûte environ six fois plus (mesure prudente du Labo)
const EXECUTANTS_PAR_COMPTE = 8;
export const bailS = () => Number(process.env.ORDO_BAIL_S) || 60;
const coupsVerifies = () => Math.max(1, Number(process.env.ORDO_VERIF_COUPS) || 3);
const REJETS_AVANT_COUPURE = 3;
export const SPRT_PARTIES_MIN = 30;

const poidsSchema = {
  type: 'object', minProperties: 8, maxProperties: 40, additionalProperties: false,
  patternProperties: { '^[A-Za-z]{1,20}$': { type: 'number', minimum: -10000, maximum: 10000 } },
  required: ['center', 'cohesion', 'edge', 'mob', 'iso', 'dng', 'chain', 'fortress']
};
const coupSchema = {
  type: 'object', required: ['cells', 'dir'], additionalProperties: false,
  properties: {
    cells: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', required: ['r', 'c'], additionalProperties: false,
      properties: { r: { type: 'integer', minimum: 0, maximum: 8 }, c: { type: 'integer', minimum: 0, maximum: 8 } } } },
    dir: { type: 'object', required: ['q', 'r'], additionalProperties: false,
      properties: { q: { type: 'integer', minimum: -1, maximum: 1 }, r: { type: 'integer', minimum: -1, maximum: 1 } } }
  }
};

// la mission telle qu'un exécutant la reçoit (protocole v1)
function missionPour(m, c) {
  const R = c.reglages;
  return { v: 1, id: Number(m.id), campagne: Number(c.id), moteur: c.moteur, poidsA: c.poids_a, poidsB: c.poids_b,
    couleurA: m.couleur_a, graine: Number(m.graine), profondeur: R.profondeur, maxPlies: R.maxPlies, ouverture: R.ouverture,
    equilibre: R.equilibre, drawWin: R.drawWin, arbitrage: R.arbitrage, depart: null };
}

// baux expirés : la mission repart dans la file, l'exécutant perd un point de fiabilité
export async function expirerBaux() {
  const { rows } = await db.query(
    `UPDATE ordo_tentatives SET etat = 'expiree', fin = now()
      WHERE etat = 'en_cours' AND bail_jusqu_a < now() RETURNING mission_id, executant_id`);
  if (!rows.length) return 0;
  await db.query(`UPDATE ordo_missions SET etat = 'en_file' WHERE id = ANY($1::bigint[]) AND etat = 'attribuee'`, [rows.map(r => r.mission_id)]);
  for (const r of rows) await db.query(`UPDATE ordo_executants SET expirees = expirees + 1 WHERE id = $1`, [r.executant_id]);
  return rows.length;
}

// ses tentatives en cours repartent dans la file (débranchement, coupure par l'admin)
async function rendreSesMissions(executantId, etat) {
  const { rows } = await db.query(
    `UPDATE ordo_tentatives SET etat = $2, fin = now() WHERE executant_id = $1 AND etat = 'en_cours' RETURNING mission_id`,
    [executantId, etat]);
  if (rows.length) await db.query(`UPDATE ordo_missions SET etat = 'en_file' WHERE id = ANY($1::bigint[]) AND etat = 'attribuee'`, [rows.map(r => r.mission_id)]);
  return rows.length;
}

// pentanomial (paires dont les deux parties sont faites), Elo et SPRT d'une campagne
export async function bilanCampagne(id) {
  const { rows } = await db.query(`SELECT paire, vainqueur FROM ordo_missions WHERE campagne_id = $1 AND etat = 'faite'`, [id]);
  let W = 0, D = 0, L = 0; const parPaire = {};
  for (const r of rows) {
    const s = r.vainqueur === 'A' ? 1 : r.vainqueur === 'D' ? 0.5 : 0;
    if (r.vainqueur === 'A') W++; else if (r.vainqueur === 'D') D++; else L++;
    (parPaire[r.paire] = parPaire[r.paire] || []).push(s);
  }
  const penta = [0, 0, 0, 0, 0]; const sc = [];
  for (const p in parPaire) if (parPaire[p].length === 2) { const x = parPaire[p][0] + parPaire[p][1]; penta[Math.round(x * 2)]++; sc.push(x / 2); }
  let elo = null, marge = null;
  if (sc.length >= 2) {
    const n = sc.length, mu = sc.reduce((a, b) => a + b, 0) / n, v = sc.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (n - 1);
    const e = (s) => { s = Math.min(0.999, Math.max(0.001, s)); return -400 * Math.log10(1 / s - 1); };
    const se = Math.sqrt(v / n);
    elo = Math.round(e(mu)); marge = Math.round((e(mu + 1.96 * se) - e(mu - 1.96 * se)) / 2);
  }
  // le SPRT trinomial (src/sprt.js) tranche des la 2e partie quand toutes vont dans le meme sens (variance nulle) :
  // pas de conclusion avant SPRT_PARTIES_MIN parties
  const llr = sprtLLR(W, D, L), { up, lo } = sprtBounds(), N = W + D + L;
  return { parties: N, W, D, L, penta, paires: sc.length, elo, marge, llr: Math.round(llr * 100) / 100,
    sprt: N < SPRT_PARTIES_MIN ? 'en cours' : llr >= up ? 'A plus fort' : llr <= lo ? 'pas plus fort' : 'en cours' };
}

export default async function (app) {
  // ─── public : l'état du réseau (aucune donnée personnelle) ───
  app.get('/etat', async () => {
    await expirerBaux();
    const fam = await db.query(
      `SELECT f.famille, f.actif,
              COUNT(e.id) FILTER (WHERE e.branche AND e.actif AND e.vu_at > now() - make_interval(secs => $1::int * 2)) AS branches
         FROM ordo_familles f LEFT JOIN ordo_executants e ON e.famille = f.famille GROUP BY f.famille, f.actif ORDER BY f.famille`, [bailS()]);
    const mis = await db.query(
      `SELECT m.etat, COUNT(*)::int AS n FROM ordo_missions m JOIN ordo_campagnes c ON c.id = m.campagne_id
        WHERE c.etat <> 'finie' GROUP BY m.etat`);
    const camp = await db.query(`SELECT id, nom, paires, etat, reglages FROM ordo_campagnes WHERE etat <> 'finie' ORDER BY priorite, created_at`);
    const campagnes = [];
    for (const c of camp.rows) campagnes.push({ id: Number(c.id), nom: c.nom, paires: c.paires, etat: c.etat, profondeur: c.reglages.profondeur, bilan: await bilanCampagne(c.id) });
    return { familles: fam.rows.map(f => ({ famille: f.famille, actif: f.actif, branches: Number(f.branches) })),
      missions: Object.fromEntries(mis.rows.map(r => [r.etat, r.n])), campagnes, moteurs: Object.keys(registre().moteurs) };
  });

  // ─── exécutants (un compte, un ou plusieurs appareils) ───
  app.register(async function (r) {
    r.addHook('preHandler', requireAuth);

    r.post('/executants', {
      schema: { body: { type: 'object', required: ['famille', 'coeurs', 'moteur'], additionalProperties: false, properties: {
        famille: { type: 'string', enum: FAMILLES }, coeurs: { type: 'integer', minimum: 1, maximum: 128 },
        moteur: { type: 'string', pattern: '^[0-9a-f]{64}$' }, nom: { type: 'string', maxLength: 40 } } } }
    }, async (req, reply) => {
      const b = req.body;
      if (!moteurConnu(b.moteur)) return reply.code(409).send({ error: 'moteur inconnu du serveur : cette version du jeu ne peut pas encore calculer pour lui', moteurs: Object.keys(registre().moteurs) });
      const { rows: n } = await db.query(`SELECT COUNT(*)::int AS n FROM ordo_executants WHERE user_id = $1 AND branche`, [req.user.sub]);
      if (n[0].n >= EXECUTANTS_PAR_COMPTE) return reply.code(429).send({ error: 'trop d\'exécutants branchés sur ce compte (' + EXECUTANTS_PAR_COMPTE + ' au plus)' });
      const { rows } = await db.query(
        `INSERT INTO ordo_executants (user_id, famille, nom, coeurs, moteur) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, famille, coeurs, branche, actif`, [req.user.sub, b.famille, b.nom || null, b.coeurs, b.moteur]);
      return { executant: rows[0], bailS: bailS(), battementS: Math.max(1, Math.floor(bailS() / 3)) };
    });

    // l'exécutant doit appartenir au compte ; renvoie la ligne, ou répond 404
    async function sien(req, reply, id) {
      const { rows } = await db.query(
        `SELECT e.*, f.actif AS famille_active FROM ordo_executants e JOIN ordo_familles f ON f.famille = e.famille
          WHERE e.id = $1 AND e.user_id = $2`, [id, req.user.sub]);
      if (!rows[0]) { reply.code(404).send({ error: 'exécutant inconnu' }); return null; }
      return rows[0];
    }
    const idSchema = { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } };

    r.get('/mes-executants', async (req) => {
      const { rows } = await db.query(
        `SELECT id, famille, nom, coeurs, branche, actif, faites, rejetees, expirees, ms_par_coup, prof_mesure, vu_at
           FROM ordo_executants WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.user.sub]);
      return { executants: rows };
    });

    r.post('/executants/:id/battement', { schema: idSchema }, async (req, reply) => {
      const e = await sien(req, reply, req.params.id); if (!e) return;
      await db.query(`UPDATE ordo_executants SET vu_at = now() WHERE id = $1`, [e.id]);
      // une mission ne se garde pas indéfiniment : au-delà de deux fois la durée permise à sa famille,
      // le bail n'est plus renouvelé et la mission repart (un exécutant ne peut pas accaparer la file)
      const { rowCount } = await db.query(
        `UPDATE ordo_tentatives SET bail_jusqu_a = now() + make_interval(secs => $2::int)
          WHERE executant_id = $1 AND etat = 'en_cours' AND bail_jusqu_a >= now()
            AND debut > now() - make_interval(secs => $3::int)`, [e.id, bailS(), 2 * DUREE_MAX_S[e.famille]]);
      return { branche: e.branche, actif: e.actif, familleActive: e.famille_active, missionsEnCours: rowCount,
        continuer: e.branche && e.actif && e.famille_active };
    });

    r.post('/executants/:id/debrancher', { schema: idSchema }, async (req, reply) => {
      const e = await sien(req, reply, req.params.id); if (!e) return;
      await db.query(`UPDATE ordo_executants SET branche = false WHERE id = $1`, [e.id]);
      return { ok: true, missionsRendues: await rendreSesMissions(e.id, 'abandonnee') };
    });
    r.post('/executants/:id/rebrancher', { schema: idSchema }, async (req, reply) => {
      const e = await sien(req, reply, req.params.id); if (!e) return;
      await db.query(`UPDATE ordo_executants SET branche = true, vu_at = now() WHERE id = $1`, [e.id]);
      return { ok: true };
    });

    // ─── la mission : c'est le serveur qui choisit, jamais l'exécutant ───
    r.post('/missions/reclamer', {
      schema: { body: { type: 'object', required: ['executant'], additionalProperties: false, properties: { executant: { type: 'string', format: 'uuid' } } } }
    }, async (req, reply) => {
      const e = await sien(req, reply, req.body.executant); if (!e) return;
      if (!e.branche) return reply.code(409).send({ error: 'exécutant débranché : le rebrancher d\'abord' });
      if (!e.actif) return reply.code(403).send({ error: 'exécutant coupé par l\'administrateur' });
      if (!e.famille_active) return { mission: null, raison: 'la famille « ' + e.famille + ' » est débranchée' };
      await expirerBaux();
      await db.query(`UPDATE ordo_executants SET vu_at = now() WHERE id = $1`, [e.id]);
      const { rows: enCours } = await db.query(`SELECT COUNT(*)::int AS n FROM ordo_tentatives WHERE executant_id = $1 AND etat IN ('en_cours','verification')`, [e.id]);
      if (enCours[0].n >= e.coeurs) return { mission: null, raison: 'déjà ' + enCours[0].n + ' mission(s) en cours pour ' + e.coeurs + ' cœur(s)' };

      // les campagnes que cet exécutant peut faire, par priorité : même moteur, durée estimée acceptable
      const { rows: camps } = await db.query(
        `SELECT * FROM ordo_campagnes WHERE etat = 'active' AND moteur = $1 ORDER BY priorite, created_at`, [e.moteur]);
      const tropLong = (c) => {
        if (!e.ms_par_coup || !e.prof_mesure) return false;   // pas encore mesuré : sa première mission le mesurera
        const s = e.ms_par_coup * Math.pow(CROISSANCE, c.reglages.profondeur - e.prof_mesure) * (c.reglages.maxPlies + c.reglages.ouverture) / 1000;
        return s > DUREE_MAX_S[e.famille];
      };
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        for (const c of camps) {
          if (tropLong(c)) continue;
          const { rows } = await client.query(
            `SELECT id, couleur_a, graine, paire FROM ordo_missions WHERE campagne_id = $1 AND etat = 'en_file'
              ORDER BY paire, couleur_a LIMIT 1 FOR UPDATE SKIP LOCKED`, [c.id]);
          if (!rows[0]) continue;
          const m = rows[0], jeton = crypto.randomBytes(24).toString('hex');
          await client.query(`UPDATE ordo_missions SET etat = 'attribuee', essais = essais + 1 WHERE id = $1`, [m.id]);
          const { rows: t } = await client.query(
            `INSERT INTO ordo_tentatives (mission_id, executant_id, jeton, bail_jusqu_a)
             VALUES ($1, $2, $3, now() + make_interval(secs => $4::int)) RETURNING id, bail_jusqu_a`, [m.id, e.id, jeton, bailS()]);
          await client.query('COMMIT');
          return { tentative: { id: Number(t[0].id), jeton, bailJusqua: t[0].bail_jusqu_a, bailS: bailS() }, mission: missionPour(m, c) };
        }
        await client.query('COMMIT');
        return { mission: null, raison: camps.length ? 'aucune mission en attente qui convienne à cet exécutant' : 'aucune campagne pour ce moteur' };
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
    });

    // tentative d'un exécutant du compte, avec son jeton ; sinon répond
    async function tentative(req, reply) {
      const { rows } = await db.query(
        `SELECT t.*, e.user_id, e.actif AS exec_actif, e.famille, e.id AS exec_id, e.faites, e.rejetees, e.ms_par_coup
           FROM ordo_tentatives t JOIN ordo_executants e ON e.id = t.executant_id WHERE t.id = $1`, [req.params.id]);
      const t = rows[0];
      const bon = t && t.user_id === req.user.sub && typeof req.body.jeton === 'string' && req.body.jeton.length === t.jeton.length &&
        crypto.timingSafeEqual(Buffer.from(req.body.jeton), Buffer.from(t.jeton));
      if (!bon) { reply.code(404).send({ error: 'tentative inconnue ou jeton faux' }); return null; }
      return t;
    }
    const jetonSchema = { type: 'string', minLength: 48, maxLength: 48 };
    const tParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } };

    r.post('/tentatives/:id/abandon', { schema: { params: tParams, body: { type: 'object', required: ['jeton'], additionalProperties: false, properties: { jeton: jetonSchema } } } }, async (req, reply) => {
      const t = await tentative(req, reply); if (!t) return;
      const { rowCount } = await db.query(`UPDATE ordo_tentatives SET etat = 'abandonnee', fin = now() WHERE id = $1 AND etat = 'en_cours'`, [t.id]);
      if (rowCount) await db.query(`UPDATE ordo_missions SET etat = 'en_file' WHERE id = $1 AND etat = 'attribuee'`, [t.mission_id]);
      return { ok: true };
    });

    const resultatSchema = { type: 'object', required: ['jeton', 'coups', 'vainqueur', 'pourquoi'], additionalProperties: false, properties: {
      jeton: jetonSchema, coups: { type: 'array', maxItems: 200, items: coupSchema }, vainqueur: { type: 'string', enum: ['A', 'B', 'D'] },
      pourquoi: { type: 'string', maxLength: 20 }, plies: { type: 'integer', minimum: 0, maximum: 400 },
      cb: { type: 'integer', minimum: 0, maximum: 14 }, cw: { type: 'integer', minimum: 0, maximum: 14 },
      ms: { type: 'number', minimum: 0, maximum: 864e5 } } };

    r.post('/tentatives/:id/resultat', { schema: { params: tParams, body: resultatSchema }, bodyLimit: 128 * 1024 }, async (req, reply) => {
      const t = await tentative(req, reply); if (!t) return;
      if (!t.exec_actif) return reply.code(403).send({ error: 'exécutant coupé : son résultat n\'est pas compté' });
      if (t.etat === 'en_cours' && new Date(t.bail_jusqu_a) < new Date()) { await expirerBaux(); t.etat = 'expiree'; }
      if (t.etat !== 'en_cours') return reply.code(409).send({ error: t.etat === 'expiree' ? 'bail expiré : la mission a été rendue à la file' : 'tentative déjà close (' + t.etat + ')' });
      // la tentative passe en vérification : son bail ne peut plus expirer pendant ce temps
      const { rowCount } = await db.query(`UPDATE ordo_tentatives SET etat = 'verification' WHERE id = $1 AND etat = 'en_cours'`, [t.id]);
      if (!rowCount) return reply.code(409).send({ error: 'tentative déjà close' });
      const { rows: mr } = await db.query(
        `SELECT m.*, c.id AS cid, c.moteur, c.poids_a, c.poids_b, c.reglages FROM ordo_missions m JOIN ordo_campagnes c ON c.id = m.campagne_id WHERE m.id = $1`, [t.mission_id]);
      const m = mr[0], mission = missionPour(m, { id: m.cid, moteur: m.moteur, poids_a: m.poids_a, poids_b: m.poids_b, reglages: m.reglages });
      const res = req.body;
      // demi-coups recherchés par le serveur : tirés au hasard ici, inconnus de l'exécutant à l'avance
      const debut = Math.min(mission.ouverture, res.coups.length), possibles = [];
      for (let i = debut; i < res.coups.length; i++) possibles.push(i);
      const indices = [];
      while (indices.length < Math.min(coupsVerifies(), possibles.length)) {
        const k = possibles.splice(crypto.randomInt(possibles.length), 1)[0]; indices.push(k);
      }
      let v;
      try { v = await verifier(mission, res, indices.sort((a, b) => a - b)); }
      catch (err) { v = { ok: false, raison: 'vérification impossible : ' + err.message, panne: true }; }

      if (v.ok) {
        const { rowCount: fait } = await db.query(
          `UPDATE ordo_missions SET etat = 'faite', vainqueur = $2, pourquoi = $3, plies = $4, coups = $5, fait_par = $6, fait_at = now()
            WHERE id = $1 AND etat = 'attribuee'`, [m.id, v.vainqueur, v.pourquoi, v.plies, JSON.stringify(res.coups), t.exec_id]);
        await db.query(`UPDATE ordo_tentatives SET etat = 'acceptee', fin = now() WHERE id = $1`, [t.id]);
        // vitesse mesurée : moyenne glissante du temps par demi-coup, à cette profondeur
        const msc = res.ms && res.coups.length ? res.ms / res.coups.length : null;
        await db.query(
          `UPDATE ordo_executants SET faites = faites + 1, vu_at = now(),
                  ms_par_coup = CASE WHEN $2::real IS NULL THEN ms_par_coup WHEN ms_par_coup IS NULL OR prof_mesure IS DISTINCT FROM $3 THEN $2 ELSE 0.7 * ms_par_coup + 0.3 * $2 END,
                  prof_mesure = CASE WHEN $2::real IS NULL THEN prof_mesure ELSE $3 END
            WHERE id = $1`, [t.exec_id, msc, mission.profondeur]);
        return { ok: true, compte: fait === 1, verifies: indices.length, bilan: await bilanCampagne(m.cid) };
      }
      // refus : la mission repart dans la file (5 essais au plus) ; une panne du serveur ne compte pas contre l'exécutant
      await db.query(`UPDATE ordo_tentatives SET etat = 'rejetee', fin = now(), note = $2 WHERE id = $1`, [t.id, String(v.raison).slice(0, 200)]);
      await db.query(`UPDATE ordo_missions SET etat = CASE WHEN essais >= 5 THEN 'rejetee' ELSE 'en_file' END WHERE id = $1 AND etat = 'attribuee'`, [m.id]);
      if (!v.panne) {
        const { rows: ex } = await db.query(`UPDATE ordo_executants SET rejetees = rejetees + 1 WHERE id = $1 RETURNING rejetees, faites`, [t.exec_id]);
        if (ex[0].rejetees >= REJETS_AVANT_COUPURE && ex[0].rejetees > ex[0].faites) {
          await db.query(`UPDATE ordo_executants SET actif = false WHERE id = $1`, [t.exec_id]);
          await rendreSesMissions(t.exec_id, 'abandonnee');
          try { await db.query(`INSERT INTO audit_log (user_id, action, ip_hash) VALUES ($1, 'ordo_coupe_auto', $2)`, [req.user.sub, hashIp(req.ip)]); } catch (e2) {}
        }
      }
      return reply.code(422).send({ ok: false, error: 'résultat refusé : ' + v.raison });
    });
  });

  // ─── administration : campagnes et interrupteurs (rôle admin + MFA) ───
  app.register(async function (a) {
    a.addHook('preHandler', requireAuth);
    a.addHook('preHandler', requireRole('admin'));
    a.addHook('preHandler', requireMfa);

    a.post('/campagnes', {
      schema: { body: { type: 'object', required: ['nom', 'poidsA', 'poidsB', 'profondeur', 'paires'], additionalProperties: false, properties: {
        nom: { type: 'string', minLength: 1, maxLength: 60 }, poidsA: poidsSchema, poidsB: poidsSchema,
        profondeur: { type: 'integer', minimum: 1, maximum: 4 }, paires: { type: 'integer', minimum: 1, maximum: 5000 },
        maxPlies: { type: 'integer', minimum: 10, maximum: 120, default: 80 }, ouverture: { type: 'integer', minimum: 0, maximum: 12, default: 6 },
        equilibre: { type: 'number', minimum: 50, maximum: 5000, default: 600 }, drawWin: { type: 'number', minimum: 0, maximum: 5000, default: 300 },
        arbitrage: { type: 'integer', enum: [1, 2], default: 2 }, priorite: { type: 'integer', minimum: 0, maximum: 3, default: 2 },
        moteur: { type: 'string', pattern: '^[0-9a-f]{64}$' } } } }
    }, async (req, reply) => {
      const b = req.body, moteur = b.moteur || registre().defaut;
      if (!moteur || !moteurConnu(moteur)) return reply.code(409).send({ error: 'moteur inconnu du serveur' });
      const reglages = { profondeur: b.profondeur, maxPlies: b.maxPlies, ouverture: b.ouverture, equilibre: b.equilibre, drawWin: b.drawWin, arbitrage: b.arbitrage };
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO ordo_campagnes (nom, moteur, poids_a, poids_b, reglages, paires, priorite, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [b.nom, moteur, JSON.stringify(b.poidsA), JSON.stringify(b.poidsB), JSON.stringify(reglages), b.paires, b.priorite, req.user.sub]);
        const id = rows[0].id;
        // une graine par paire : les deux parties partent de la même ouverture, couleurs échangées
        const vals = [], args = [id];
        for (let p = 0; p < b.paires; p++) {
          const g = crypto.randomInt(1, 2147483647);
          args.push(p, g); const i = args.length;
          vals.push(`($1, $${i - 1}, 'black', $${i})`, `($1, $${i - 1}, 'white', $${i})`);
        }
        await client.query(`INSERT INTO ordo_missions (campagne_id, paire, couleur_a, graine) VALUES ${vals.join(',')}`, args);
        await client.query('COMMIT');
        return { ok: true, campagne: Number(id), missions: 2 * b.paires };
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
    });

    const cParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } };
    a.get('/campagnes/:id', { schema: { params: cParams } }, async (req, reply) => {
      const { rows } = await db.query(`SELECT id, nom, moteur, poids_a, poids_b, reglages, paires, priorite, etat, created_at FROM ordo_campagnes WHERE id = $1`, [req.params.id]);
      if (!rows[0]) return reply.code(404).send({ error: 'campagne inconnue' });
      const { rows: et } = await db.query(`SELECT etat, COUNT(*)::int AS n FROM ordo_missions WHERE campagne_id = $1 GROUP BY etat`, [req.params.id]);
      const { rows: fam } = await db.query(
        `SELECT e.famille, COUNT(*)::int AS n FROM ordo_missions m JOIN ordo_executants e ON e.id = m.fait_par
          WHERE m.campagne_id = $1 AND m.etat = 'faite' GROUP BY e.famille`, [req.params.id]);
      return { campagne: rows[0], missions: Object.fromEntries(et.map(r => [r.etat, r.n])),
        parFamille: Object.fromEntries(fam.map(r => [r.famille, r.n])), bilan: await bilanCampagne(req.params.id) };
    });

    a.post('/campagnes/:id/etat', { schema: { params: cParams, body: { type: 'object', required: ['etat'], properties: { etat: { type: 'string', enum: ['active', 'pause', 'finie'] } } } } },
      async (req, reply) => {
        const { rowCount } = await db.query(`UPDATE ordo_campagnes SET etat = $2 WHERE id = $1`, [req.params.id, req.body.etat]);
        if (!rowCount) return reply.code(404).send({ error: 'campagne inconnue' });
        return { ok: true };
      });

    // l'interrupteur d'une famille : plus aucune mission nouvelle pour elle (celles en cours peuvent finir)
    a.post('/familles/:famille', { schema: { params: { type: 'object', properties: { famille: { type: 'string', enum: FAMILLES } } },
      body: { type: 'object', required: ['actif'], properties: { actif: { type: 'boolean' } } } } }, async (req) => {
      await db.query(`UPDATE ordo_familles SET actif = $2 WHERE famille = $1`, [req.params.famille, req.body.actif]);
      return { ok: true, famille: req.params.famille, actif: req.body.actif };
    });

    a.get('/executants', async () => {
      const { rows } = await db.query(
        `SELECT e.id, e.famille, e.nom, e.coeurs, e.branche, e.actif, e.faites, e.rejetees, e.expirees, e.ms_par_coup, e.prof_mesure, e.vu_at, u.username
           FROM ordo_executants e JOIN users u ON u.id = e.user_id ORDER BY e.vu_at DESC LIMIT 200`);
      return { executants: rows };
    });

    // l'interrupteur d'un exécutant : coupé, il ne reçoit plus rien et ses résultats ne comptent plus
    a.post('/executants/:id/actif', { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['actif'], properties: { actif: { type: 'boolean' } } } } }, async (req, reply) => {
      const { rowCount } = await db.query(`UPDATE ordo_executants SET actif = $2 WHERE id = $1`, [req.params.id, req.body.actif]);
      if (!rowCount) return reply.code(404).send({ error: 'exécutant inconnu' });
      const rendues = req.body.actif ? 0 : await rendreSesMissions(req.params.id, 'abandonnee');
      return { ok: true, missionsRendues: rendues };
    });
  });
}
