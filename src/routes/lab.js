import { requireAuth, requireRole, requireMfa, hashIp } from '../auth.js';
import { db } from '../db.js';
import { createEngine } from '../engine.js';
import { sprtLLR, sprtBounds, SPRT_DEFAULTS } from '../sprt.js';
import { LAYOUTS, LAYOUT_KEYS, layoutToStart } from '../layouts.js';

// Miroir du EVAL_W par défaut côté client (index.html, AI_WORKER_CODE).
// chain/fortress ajoutés en v1.54 côté client (Abalassembly) — mis à jour ici
// en même temps, sinon un client à jour ne peut plus soumettre son champion
// réel : additionalProperties:false + required rejetterait ses 2 clés en trop.
const DEFAULT_WEIGHTS = { center: 6, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14, chain: 10, fortress: 20 };
const WEIGHT_KEYS = ['center', 'cohesion', 'edge', 'mob', 'iso', 'dng', 'chain', 'fortress'];

/* Bornes de chaque poids : celles du Labo du jeu (SPSA_MIN / SPSA_MAX, dans
   index.html). Avant, -100..100 : un candidat aux poids tous négatifs (une IA qui
   cherche à perdre) était accepté — et, faute d'autre garde-fou, promu. */
const WEIGHT_MAX = { center: 40, cohesion: 40, edge: 40, mob: 20, iso: 60, dng: 60, chain: 40, fortress: 60 };

/* Ce que le serveur compte, et rien d'autre (audit de novembre 2026).
   Avant, un envoi annonçait un lot (« 200 victoires du candidat ») et une seule
   partie témoin le justifiait ; une partie témoin d'UN coup légal suffisait
   (« échantillon partiel accepté ») : un compte neuf faisait promouvoir n'importe
   quels poids, champion public compris, en un seul envoi. Désormais :
   - un envoi = une partie, entière, rejouée par le serveur ; c'est le rejeu qui
     dit qui a gagné, et seule cette partie compte ;
   - une partie compte si elle est conclue, selon les règles du Labo du jeu :
     6 billes sorties, 3 billes d'avance (le Labo arrête la partie là), ou la limite
     de LAB_PLIES_LIMITE demi-coups (alors celui qui mène gagne, égalité = nulle) ;
     un coup joué après la fin, ou au-delà de la limite, fait refuser la partie ;
   - le SPRT ne conclut qu'avec au moins LAB_MIN_CONTRIBUTEURS comptes différents ;
   - un candidat confirmé passe « pending » : il ne devient le champion public
     qu'après validation par un administrateur dont la MFA est active. Le rejeu
     prouve qu'une partie est légale, pas qu'elle a été jouée par l'IA avec ces
     poids : des comptes complices pourraient fabriquer des parties légales.
     Un humain tranche avant que des poids partent chez tous les joueurs. */
export const LAB_PLIES_LIMITE = 80;
export const LAB_MIN_CONTRIBUTEURS = 3;

const weightsSchema = {
  type: 'object',
  required: WEIGHT_KEYS,
  additionalProperties: false,
  properties: Object.fromEntries(WEIGHT_KEYS.map(k => [k, { type: 'number', minimum: 0, maximum: WEIGHT_MAX[k] }]))
};

const jobSchema = {
  body: {
    type: 'object',
    required: ['candidateWeights'],
    additionalProperties: false,
    properties: { candidateWeights: weightsSchema }
  }
};

const resultSchema = {
  body: {
    type: 'object',
    required: ['jobId', 'layout', 'sampleStart', 'sampleSeq', 'sampleWinner'],
    additionalProperties: false,
    properties: {
      jobId:          { type: 'integer', minimum: 1 },
      layout:         { type: 'string', enum: LAYOUT_KEYS },
      sampleStart:    { type: 'string', minLength: 3, maxLength: 400 },
      // Quel camp JOUE LE CANDIDAT dans la partie témoin — pas "qui commence"
      // (aux échecs comme à l'Abalone, Noir commence TOUJOURS ; le candidat
      // peut néanmoins jouer Noir ou Blanc selon la partie, exactement comme
      // le Labo local qui alterne colorA d'une partie à l'autre pour éviter
      // un biais premier-joueur — voir suggestColor/byColorStats plus bas).
      candidateColor: { type: 'string', enum: ['black', 'white'] },
      sampleSeq:      { type: 'string', minLength: 1, maxLength: 8000 },
      sampleWinner:   { type: 'string', enum: ['candidate', 'baseline', 'draw'] }
    }
  }
};

// Rejoue la partie avec le VRAI moteur (src/engine.js) : suite de coups légaux,
// partie conclue, et c'est le rejeu qui donne le vainqueur (champ winner du
// verdict). Ne rejoue pas la réflexion de l'IA (trop coûteux en masse) — mais
// une partie qui ne peut même pas être rejouée légalement est un signal de
// fraude ou de bug sans ambiguïté, et un résultat annoncé qui ne correspond
// pas à l'état final du plateau l'est tout autant.
//
// Vérifie AUSSI que la position de départ annoncée correspond réellement à
// la disposition officielle revendiquée (layout) — sans ça, un client pourrait
// prétendre tester "standard" tout en jouant depuis une position truquée.
function verifySampleGame({ layout, sampleStart, candidateColor, sampleSeq, sampleWinner }) {
  try {
    const E = createEngine();

    const canonicalStart = layoutToStart(E, layout);
    if (!canonicalStart) return { ok: false, note: 'disposition de départ inconnue : ' + layout };
    if (String(sampleStart) !== canonicalStart) {
      return { ok: false, note: `position de départ ne correspond pas à la disposition "${layout}" annoncée` };
    }

    const parts = canonicalStart.split(',');
    const board = {};
    parts.forEach((part, side) => {
      const cells = part.slice(1).match(/[a-i][1-9]/g) || [];
      const color = side === 0 ? 'black' : 'white';
      cells.forEach(cc => { const p = E.abaproToRc(cc); if (p) board[p.r + ',' + p.c] = color; });
    });
    E.setBoard(board);

    // Noir commence TOUJOURS (règle du jeu, jamais un choix) — indépendant
    // de candidateColor, qui ne sert qu'à interpréter le résultat final.
    let color = 'black';
    const tokens = String(sampleSeq).replace(/\d+\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { ok: false, note: 'séquence de coups vide' };
    if (tokens.length > LAB_PLIES_LIMITE) return { ok: false, note: `partie plus longue que la limite du Labo (${LAB_PLIES_LIMITE} demi-coups)` };

    // la partie est finie : 6 billes sorties, ou 3 billes d'avance (règle du Labo)
    const finie = () => E.capturedByBlack >= 6 || E.capturedByWhite >= 6 || Math.abs(E.capturedByBlack - E.capturedByWhite) >= 3;
    for (let i = 0; i < tokens.length; i++) {
      if (finie()) return { ok: false, note: `coups joués après la fin de la partie (demi-coup ${i + 1})` };
      const tok = tokens[i];
      const mv = E.resolveAbaProToken(tok.toLowerCase(), color);
      if (!mv) return { ok: false, note: `coup illégal ou non résolu : "${tok}" (${color})` };
      E.applyMove(mv, color);
      color = color === 'black' ? 'white' : 'black';
    }

    const ecart = E.capturedByBlack - E.capturedByWhite;   // billes sorties par Noir, moins par Blanc
    if (!finie() && tokens.length < LAB_PLIES_LIMITE) {
      return { ok: false, note: 'partie non conclue : elle ne compte pas (ni 6 billes, ni 3 d\'avance, ni la limite de ' + LAB_PLIES_LIMITE + ' demi-coups)' };
    }
    // vainqueur selon le plateau : celui qui a sorti le plus de billes (égalité : nulle)
    const candColor = candidateColor || 'black';
    const actualWinner = ecart === 0 ? 'draw' : ((ecart > 0) === (candColor === 'black') ? 'candidate' : 'baseline');
    if (actualWinner !== sampleWinner) {
      return { ok: false, note: `résultat annoncé (${sampleWinner}) incohérent avec la partie rejouée (${actualWinner})` };
    }
    return { ok: true, winner: actualWinner, note: 'partie légale, conclue, résultat confirmé' };
  } catch (e) {
    return { ok: false, note: 'erreur de rejeu : ' + e.message };
  }
}

async function currentChampion() {
  const { rows } = await db.query(
    `SELECT candidate_weights FROM lab_jobs WHERE status = 'promoted' ORDER BY closed_at DESC LIMIT 1`);
  return rows[0] ? rows[0].candidate_weights : DEFAULT_WEIGHTS;
}

// Suggère la disposition la MOINS utilisée jusqu'ici pour ce job (équilibrage
// glouton) : quel que soit l'ordre dans lequel les contributeurs se
// connectent, la couverture des 5 ouvertures reste naturellement équilibrée.
async function suggestLayout(jobId) {
  const { rows } = await db.query(
    `SELECT layout, COUNT(*) AS n FROM lab_results
     WHERE job_id = $1 AND verified = true AND layout IS NOT NULL
     GROUP BY layout`, [jobId]);
  const counts = Object.fromEntries(LAYOUT_KEYS.map(k => [k, 0]));
  rows.forEach(r => { counts[r.layout] = Number(r.n); });
  return LAYOUT_KEYS.reduce((least, k) => counts[k] < counts[least] ? k : least, LAYOUT_KEYS[0]);
}

// Même principe que suggestLayout, mais pour équilibrer la couleur jouée par
// le CANDIDAT (sample_start_color) — pendant du colorA qui alterne déjà côté
// Labo local, adapté ici en suggestion plutôt qu'en alternance forcée : le
// serveur ne peut pas imposer une couleur à une partie déjà jouée localement,
// seulement orienter la prochaine contribution vers la couleur sous-représentée.
async function suggestColor(jobId) {
  const { rows } = await db.query(
    `SELECT candidate_color AS color, COUNT(*) AS n FROM lab_results
     WHERE job_id = $1 AND verified = true GROUP BY candidate_color`, [jobId]);
  const counts = { black: 0, white: 0 };
  rows.forEach(r => { if (counts[r.color] !== undefined) counts[r.color] = Number(r.n); });
  return counts.black <= counts.white ? 'black' : 'white';
}

// Répartition des résultats agrégés par couleur jouée par le candidat —
// équivalent serveur de byColorAn/byColorAwin déjà présents dans le Labo
// local, pour repérer un éventuel biais premier-joueur dans les données
// collectives (voir le commentaire "Biais premier joueur (colorA)" côté client).
async function byColorStats(jobId) {
  const { rows } = await db.query(
    `SELECT candidate_color AS color,
            COALESCE(SUM(candidate_wins),0) AS w, COALESCE(SUM(draws),0) AS d, COALESCE(SUM(baseline_wins),0) AS l
     FROM lab_results WHERE job_id = $1 AND verified = true GROUP BY candidate_color`, [jobId]);
  const out = { black: { candidateWins: 0, draws: 0, baselineWins: 0 }, white: { candidateWins: 0, draws: 0, baselineWins: 0 } };
  rows.forEach(r => { if (out[r.color]) out[r.color] = { candidateWins: Number(r.w), draws: Number(r.d), baselineWins: Number(r.l) }; });
  return out;
}

export default async function (app) {
  // Public : n'importe quel client (connecté ou non) peut lire le champion actuel.
  app.get('/champion', async () => {
    const { rows } = await db.query(
      `SELECT id, candidate_weights, closed_at,
              (SELECT COALESCE(SUM(candidate_wins+draws+baseline_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS games
       FROM lab_jobs WHERE status = 'promoted' ORDER BY closed_at DESC LIMIT 1`);
    if (!rows[0]) return { weights: DEFAULT_WEIGHTS, promoted: false };
    return { weights: rows[0].candidate_weights, promoted: true, promotedAt: rows[0].closed_at,
      gamesConfirmed: Number(rows[0].games), byColor: await byColorStats(rows[0].id) };
  });

  // Public : classement des contributeurs (parties vérifiées / soumises).
  // Sert à la fois de reconnaissance et de signal de confiance discret — un
  // contributeur avec un long historique de soumissions vérifiées est plus
  // fiable qu'un compte flambant neuf (idée reprise d'OpenBench).
  app.get('/contributors', async () => {
    const { rows } = await db.query(
      `SELECT u.username,
              COUNT(*) FILTER (WHERE r.verified) AS verified,
              COUNT(*) AS total
       FROM lab_results r
       JOIN users u ON u.id = r.user_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.username
       ORDER BY verified DESC, total DESC
       LIMIT 50`);
    return { contributors: rows.map(r => ({
      username: r.username, verified: Number(r.verified), total: Number(r.total),
      reliability: Number(r.total) ? Math.round(1000 * Number(r.verified) / Number(r.total)) / 10 : 0
    })) };
  });

  // Un addHook('preHandler', ...) s'applique à TOUT le contexte d'encapsulation
  // du plugin, pas seulement "à partir de cette ligne" — le sous-contexte via
  // register() est la vraie façon d'isoler les routes protégées de /champion
  // (sinon /champion se retrouve protégée aussi, silencieusement).
  app.register(async function (protectedRoutes) {
    protectedRoutes.addHook('preHandler', requireAuth);

    // Récupère le job ouvert actuel (à quoi contribuer), ou null s'il n'y en a pas.
    // Inclut une disposition suggérée (équilibrage des 5 ouvertures) et la
    // répartition déjà couverte, pour transparence.
    protectedRoutes.get('/job', async () => {
      const { rows } = await db.query(
        `SELECT id, baseline_weights, candidate_weights, created_at,
                (SELECT COALESCE(SUM(candidate_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS cw,
                (SELECT COALESCE(SUM(draws),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS d,
                (SELECT COALESCE(SUM(baseline_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS bw
         FROM lab_jobs WHERE status = 'open' ORDER BY created_at ASC LIMIT 1`);
      if (!rows[0]) return { job: null };
      const r = rows[0];
      const { rows: layoutRows } = await db.query(
        `SELECT layout, COUNT(*) AS n FROM lab_results
         WHERE job_id = $1 AND verified = true AND layout IS NOT NULL GROUP BY layout`, [r.id]);
      const byLayout = Object.fromEntries(LAYOUT_KEYS.map(k => [k, 0]));
      layoutRows.forEach(lr => { byLayout[lr.layout] = Number(lr.n); });
      return { job: { id: r.id, baselineWeights: r.baseline_weights, candidateWeights: r.candidate_weights,
        createdAt: r.created_at, pooled: { candidateWins: Number(r.cw), draws: Number(r.d), baselineWins: Number(r.bw) },
        suggestedLayout: await suggestLayout(r.id), byLayout,
        suggestedColor: await suggestColor(r.id), byColor: await byColorStats(r.id) } };
    });

    // Propose un nouveau candidat — seulement s'il n'y a pas déjà un job ouvert
    // (un seul test collectif à la fois : évite de fragmenter l'effort de tous
    // les Labos connectés sur des dizaines de candidats jamais confirmés).
    protectedRoutes.post('/job', { schema: jobSchema }, async (req, reply) => {
      // un candidat en attente de validation bloque aussi : le prochain job doit
      // partir du champion qui sortira de cette décision
      const { rows: openRows } = await db.query(`SELECT id, status FROM lab_jobs WHERE status IN ('open','pending') LIMIT 1`);
      if (openRows[0]) return reply.code(409).send({ error: openRows[0].status === 'open' ? 'un job est déjà ouvert' : 'un candidat attend la validation d\'un administrateur', jobId: openRows[0].id });
      const baseline = await currentChampion();
      const { rows } = await db.query(
        `INSERT INTO lab_jobs (baseline_weights, candidate_weights, created_by) VALUES ($1,$2,$3) RETURNING id, created_at`,
        [JSON.stringify(baseline), JSON.stringify(req.body.candidateWeights), req.user.sub]);
      reply.code(201);
      return { ok: true, job: { id: rows[0].id, baselineWeights: baseline, candidateWeights: req.body.candidateWeights, createdAt: rows[0].created_at } };
    });

    // Soumet UNE partie pour le job en cours. Elle est rejouée avant de compter
    // quoi que ce soit dans l'agrégat SPRT (légalité, disposition de départ
    // authentique, partie conclue) et c'est le rejeu qui donne le résultat
    // compté (voir verifySampleGame).
    protectedRoutes.post('/result', { schema: resultSchema }, async (req, reply) => {
      const b = req.body;

      const { rows: jobRows } = await db.query(`SELECT id, status FROM lab_jobs WHERE id = $1`, [b.jobId]);
      const job = jobRows[0];
      if (!job) return reply.code(404).send({ error: 'job introuvable' });
      if (job.status !== 'open') return reply.code(409).send({ error: 'ce job est déjà clos (' + job.status + ')' });

      const verdict = verifySampleGame({
        layout: b.layout, sampleStart: b.sampleStart, candidateColor: b.candidateColor || 'black',
        sampleSeq: b.sampleSeq, sampleWinner: b.sampleWinner
      });

      const ipHash = hashIp(req.ip);
      // une partie vérifiée compte pour une, dans la colonne que le rejeu désigne
      const w = verdict.ok ? verdict.winner : null;
      await db.query(
        `INSERT INTO lab_results (job_id, user_id, candidate_wins, draws, baseline_wins,
          sample_start, candidate_color, sample_seq, sample_winner, layout, verified, verify_note, ip_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [b.jobId, req.user.sub, w === 'candidate' ? 1 : 0, w === 'draw' ? 1 : 0, w === 'baseline' ? 1 : 0,
         b.sampleStart, b.candidateColor || 'black', b.sampleSeq, b.sampleWinner, b.layout,
         verdict.ok, verdict.note, ipHash]);

      if (!verdict.ok) {
        return { ok: true, counted: false, reason: verdict.note };
      }

      const { rows: pooledRows } = await db.query(
        `SELECT COALESCE(SUM(candidate_wins),0) AS w, COALESCE(SUM(draws),0) AS d, COALESCE(SUM(baseline_wins),0) AS l
         FROM lab_results WHERE job_id = $1 AND verified = true`, [b.jobId]);
      const W = Number(pooledRows[0].w), D = Number(pooledRows[0].d), L = Number(pooledRows[0].l);
      const llr = sprtLLR(W, D, L);
      const { up, lo } = sprtBounds();

      const { rows: cRows } = await db.query(
        `SELECT COUNT(DISTINCT user_id) AS n FROM lab_results WHERE job_id = $1 AND verified = true`, [b.jobId]);
      const contributeurs = Number(cRows[0].n);

      let outcome = 'open';
      if (llr >= up && contributeurs >= LAB_MIN_CONTRIBUTEURS) {
        // confirmé : en attente de validation humaine, PAS encore champion
        outcome = 'pending';
        await db.query(`UPDATE lab_jobs SET status='pending' WHERE id=$1 AND status='open'`, [b.jobId]);
      } else if (llr <= lo && contributeurs >= LAB_MIN_CONTRIBUTEURS) {
        outcome = 'rejected';
        await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE id=$1 AND status='open'`, [b.jobId]);
      }

      return { ok: true, counted: true, game: verdict.winner, pooled: { candidateWins: W, draws: D, baselineWins: L },
        contributors: contributeurs, llr, outcome };
    });
  });

  // ─── Administration : la décision humaine sur un candidat confirmé ───
  // Rôle admin (relu en base) ET MFA active sur ce compte.
  app.register(async function (adminRoutes) {
    adminRoutes.addHook('preHandler', requireAuth);
    adminRoutes.addHook('preHandler', requireRole('admin'));
    adminRoutes.addHook('preHandler', requireMfa);

    adminRoutes.get('/pending', async () => {
      const { rows } = await db.query(
        `SELECT j.id, j.baseline_weights, j.candidate_weights, j.created_at,
                COALESCE(SUM(r.candidate_wins),0) AS w, COALESCE(SUM(r.draws),0) AS d, COALESCE(SUM(r.baseline_wins),0) AS l,
                COUNT(DISTINCT r.user_id) AS contributeurs
           FROM lab_jobs j LEFT JOIN lab_results r ON r.job_id = j.id AND r.verified = true
          WHERE j.status = 'pending' GROUP BY j.id ORDER BY j.created_at`);
      return { jobs: rows.map(r => ({ id: r.id, baselineWeights: r.baseline_weights, candidateWeights: r.candidate_weights,
        createdAt: r.created_at, pooled: { candidateWins: Number(r.w), draws: Number(r.d), baselineWins: Number(r.l) },
        contributors: Number(r.contributeurs) })) };
    });

    const decider = (statut) => async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'identifiant invalide' });
      const { rows } = await db.query(
        `UPDATE lab_jobs SET status = $2, decided_by = $3, decided_at = now(), closed_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING id`, [id, statut, req.user.sub]);
      if (!rows[0]) return reply.code(409).send({ error: 'aucun candidat en attente de validation avec cet identifiant' });
      try { await db.query(`INSERT INTO audit_log (user_id, action, ip_hash) VALUES ($1, $2, $3)`,
        [req.user.sub, statut === 'promoted' ? 'lab_approve' : 'lab_reject', hashIp(req.ip)]); } catch (e) {}
      return { ok: true, id, status: statut };
    };
    adminRoutes.post('/job/:id/approve', decider('promoted'));
    adminRoutes.post('/job/:id/reject', decider('rejected'));
  });
}
