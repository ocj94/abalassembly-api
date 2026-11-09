// L'ordonnanceur (/ordo) : des missions de calcul pour des exécutants branchables.
// Chaque coupure possible est jouée ici : exécutant débranché en pleine mission,
// bail expiré, retour trop tard, famille ou exécutant coupé par l'admin, et
// résultats truqués (coup illégal, partie jouée avec d'autres poids, vainqueur faux).
// Les parties sont de vraies parties du moteur du jeu (moteur/fil-*.js), courtes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';
import { db } from '../src/db.js';
import { totpCode } from '../src/totp.js';
import { changerRole } from '../scripts/admin.js';
import { registre, creerFil, jouerMission } from '../src/moteurIA.js';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let app, admin, fil;
const authed = (t) => ({ authorization: 'Bearer ' + t });
const MOTEUR = registre().defaut;
const P = { center: 6, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14, chain: 10, fortress: 20 };
const CAMP = { nom: 'essai', poidsA: { ...P, center: 20 }, poidsB: P, profondeur: 1, paires: 2, maxPlies: 12, ouverture: 2 };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const avecEnv = async (k, v, f) => { const avant = process.env[k]; process.env[k] = v; try { return await f(); } finally { if (avant === undefined) delete process.env[k]; else process.env[k] = avant; } };

before(async () => {
  app = await makeApp();
  fil = creerFil(MOTEUR);
  await db.query(`UPDATE ordo_campagnes SET etat = 'finie'`);
  await db.query(`UPDATE ordo_familles SET actif = true`);
  admin = await signupUser(app);
  await changerRole(admin.email, 'admin');
  const s = (await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(admin.token) })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(admin.token), payload: { otp: totpCode(s.secret) } })).statusCode, 200);
});
after(async () => { await teardown(app); });

async function campagne(extra = {}) {
  await db.query(`UPDATE ordo_campagnes SET etat = 'finie' WHERE etat <> 'finie'`);
  const r = await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(admin.token), payload: { ...CAMP, ...extra } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().campagne;
}
async function executant(famille = 'node', coeurs = 1, compte) {
  const u = compte || await signupUser(app);
  const r = await app.inject({ method: 'POST', url: '/ordo/executants', headers: authed(u.token), payload: { famille, coeurs, moteur: MOTEUR } });
  assert.equal(r.statusCode, 200, r.body);
  return { u, id: r.json().executant.id, h: authed(u.token) };
}
const reclamer = (e) => app.inject({ method: 'POST', url: '/ordo/missions/reclamer', headers: e.h, payload: { executant: e.id } });
const rendre = (e, t, res) => app.inject({ method: 'POST', url: `/ordo/tentatives/${t.id}/resultat`, headers: e.h, payload: { jeton: t.jeton, ...res } });

test('un exécutant dont le moteur est inconnu du serveur ne se branche pas', async () => {
  const u = await signupUser(app);
  const r = await app.inject({ method: 'POST', url: '/ordo/executants', headers: authed(u.token), payload: { famille: 'node', coeurs: 2, moteur: 'a'.repeat(64) } });
  assert.equal(r.statusCode, 409);
  assert.ok(r.json().moteurs.includes(MOTEUR));
  assert.equal((await app.inject({ method: 'POST', url: '/ordo/executants', headers: authed(u.token), payload: { famille: 'grille-pain', coeurs: 2, moteur: MOTEUR } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/ordo/executants', payload: { famille: 'node', coeurs: 2, moteur: MOTEUR } })).statusCode, 401);
});

test('une campagne ne se crée que par un admin avec MFA', async () => {
  const j = await signupUser(app);
  assert.equal((await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(j.token), payload: CAMP })).statusCode, 403);
  await changerRole(j.email, 'admin');
  const r = await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(j.token), payload: CAMP });
  assert.equal(r.statusCode, 403); assert.match(r.json().error, /MFA/);
});

test('cycle complet : campagne → mission → partie du vrai moteur → résultat vérifié et compté', async () => {
  const cid = await campagne();
  const etat = (await app.inject({ method: 'GET', url: '/ordo/etat' })).json();
  assert.equal(etat.missions.en_file, 4);
  const e = await executant('node', 1);
  const r = (await reclamer(e)).json();
  assert.ok(r.mission && r.tentative, JSON.stringify(r));
  assert.equal(r.mission.moteur, MOTEUR); assert.equal(r.mission.profondeur, 1); assert.equal(r.mission.campagne, cid);
  assert.equal(r.tentative.jeton.length, 48);
  const plein = (await reclamer(e)).json();
  assert.equal(plein.mission, null, 'un cœur : une mission à la fois'); assert.match(plein.raison, /1 cœur/);
  const res = jouerMission(fil, r.mission);
  const ok = await rendre(e, r.tentative, res);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().compte, true);
  assert.equal(ok.json().verifies, 3, 'trois demi-coups recherchés par le serveur');
  const { rows } = await db.query(`SELECT etat, vainqueur FROM ordo_missions WHERE id = $1`, [r.mission.id]);
  assert.deepEqual(rows[0], { etat: 'faite', vainqueur: res.vainqueur });
  const { rows: ex } = await db.query(`SELECT faites, ms_par_coup, prof_mesure FROM ordo_executants WHERE id = $1`, [e.id]);
  assert.equal(ex[0].faites, 1); assert.ok(ex[0].ms_par_coup > 0); assert.equal(ex[0].prof_mesure, 1);
  // rendre deux fois la même tentative : refusé
  assert.equal((await rendre(e, r.tentative, res)).statusCode, 409);
  // la paire se termine : le bilan compte une paire (pentanomial)
  const r2 = (await reclamer(e)).json();
  assert.equal(r2.mission.graine, r.mission.graine, 'la deuxième partie de la paire, mêmes ouverture et graine');
  assert.notEqual(r2.mission.couleurA, r.mission.couleurA, 'couleurs échangées');
  const b = (await rendre(e, r2.tentative, jouerMission(fil, r2.mission))).json();
  assert.equal(b.bilan.paires, 1); assert.equal(b.bilan.parties, 2);
  assert.equal(b.bilan.penta.reduce((x, y) => x + y, 0), 1);
});

test('🔌 débranché en pleine mission : la mission repart dans la file, un autre la fait, le premier ne peut plus la rendre', async () => {
  await campagne();
  const x = await executant('navigateur', 1), y = await executant('node', 1);
  const rx = (await reclamer(x)).json();
  const res = jouerMission(fil, rx.mission);
  const d = await app.inject({ method: 'POST', url: `/ordo/executants/${x.id}/debrancher`, headers: x.h });
  assert.equal(d.json().missionsRendues, 1);
  const ry = (await reclamer(y)).json();
  assert.equal(ry.mission.id, rx.mission.id, 'la même mission, rendue à la file');
  assert.equal((await rendre(x, rx.tentative, res)).statusCode, 409, 'l\'exécutant débranché ne fait plus compter son résultat');
  assert.equal((await rendre(y, ry.tentative, res)).json().compte, true);
  // débranché, il ne reçoit plus rien ; rebranché, si
  assert.equal((await reclamer(x)).statusCode, 409);
  await app.inject({ method: 'POST', url: `/ordo/executants/${x.id}/rebrancher`, headers: x.h });
  assert.ok((await reclamer(x)).json().mission);
});

test('⏱️ bail expiré (exécutant perdu sans prévenir) : la mission repart, le retour tardif est refusé', async () => {
  await campagne();
  await avecEnv('ORDO_BAIL_S', '1', async () => {
    const x = await executant('navigateur', 1), y = await executant('node', 1);
    const rx = (await reclamer(x)).json();
    await dormir(1300);
    const ry = (await reclamer(y)).json();
    assert.equal(ry.mission.id, rx.mission.id);
    const res = jouerMission(fil, rx.mission);
    const tard = await rendre(x, rx.tentative, res);
    assert.equal(tard.statusCode, 409); assert.match(tard.json().error, /expiré|close/);
    const { rows } = await db.query(`SELECT expirees FROM ordo_executants WHERE id = $1`, [x.id]);
    assert.equal(rows[0].expirees, 1);
  });
});

test('💓 le signe de vie renouvelle le bail : une mission plus longue que le bail est acceptée', async () => {
  await campagne();
  await avecEnv('ORDO_BAIL_S', '3', async () => {
    const x = await executant('node', 1);
    const rx = (await reclamer(x)).json();
    const t0 = Date.now();
    const res = jouerMission(fil, rx.mission);
    const bat = (await app.inject({ method: 'POST', url: `/ordo/executants/${x.id}/battement`, headers: x.h })).json();
    assert.equal(bat.missionsEnCours, 1); assert.equal(bat.continuer, true);
    await dormir(Math.max(0, 3500 - (Date.now() - t0)));
    assert.equal((await rendre(x, rx.tentative, res)).json().compte, true);
  });
});

test('🛡️ résultats truqués : coup illégal, partie jouée avec d\'autres poids, vainqueur faux → refusés ; trois refus coupent l\'exécutant', async () => {
  await campagne({ paires: 3 });
  const x = await executant('node', 1);
  await avecEnv('ORDO_VERIF_COUPS', '1000', async () => {   // ici, le serveur recherche tous les demi-coups
    // 1. un coup illégal
    let r = (await reclamer(x)).json(); let res = jouerMission(fil, r.mission);
    const faux = JSON.parse(JSON.stringify(res)); faux.coups[4] = { cells: [{ r: 4, c: 4 }], dir: { q: 1, r: 0 } };
    let k = await rendre(x, r.tentative, faux);
    assert.equal(k.statusCode, 422); assert.match(k.json().error, /illegal|ouverture|different/);
    // 2. une partie légale, mais jouée avec les poids échangés : pas les coups du moteur avec ces poids
    r = (await reclamer(x)).json();
    const autre = jouerMission(fil, { ...r.mission, poidsA: r.mission.poidsB, poidsB: r.mission.poidsA });
    k = await rendre(x, r.tentative, autre);
    assert.equal(k.statusCode, 422); assert.match(k.json().error, /moteur au demi-coup|different du rejeu/);
    // 3. la vraie partie, avec un vainqueur annoncé faux
    r = (await reclamer(x)).json(); res = jouerMission(fil, r.mission);
    k = await rendre(x, r.tentative, { ...res, vainqueur: res.vainqueur === 'A' ? 'B' : 'A' });
    assert.equal(k.statusCode, 422); assert.match(k.json().error, /different du rejeu/);
  });
  const { rows } = await db.query(`SELECT actif, rejetees FROM ordo_executants WHERE id = $1`, [x.id]);
  assert.deepEqual(rows[0], { actif: false, rejetees: 3 }, 'coupé automatiquement après trois refus');
  assert.equal((await reclamer(x)).statusCode, 403);
  const { rows: m } = await db.query(`SELECT COUNT(*)::int AS n FROM ordo_missions m JOIN ordo_campagnes c ON c.id = m.campagne_id WHERE c.etat = 'active' AND m.etat = 'faite'`);
  assert.equal(m[0].n, 0, 'aucun résultat truqué n\'a été compté');
});

test('🔘 interrupteurs de l\'admin : une famille entière, puis un exécutant', async () => {
  await campagne();
  const n = await executant('node', 2), nav = await executant('navigateur', 1);
  const off = (f, actif) => app.inject({ method: 'POST', url: '/ordo/familles/' + f, headers: authed(admin.token), payload: { actif } });
  assert.equal((await off('node', false)).statusCode, 200);
  const r = (await reclamer(n)).json();
  assert.equal(r.mission, null); assert.match(r.raison, /débranchée/);
  assert.equal((await app.inject({ method: 'POST', url: `/ordo/executants/${n.id}/battement`, headers: n.h })).json().continuer, false);
  assert.ok((await reclamer(nav)).json().mission, 'les navigateurs, eux, continuent');
  const etat = (await app.inject({ method: 'GET', url: '/ordo/etat' })).json();
  assert.equal(etat.familles.find(f => f.famille === 'node').actif, false);
  await off('node', true);
  const rn = (await reclamer(n)).json(); assert.ok(rn.mission);
  // l'exécutant coupé : sa mission en cours repart, son résultat ne compte plus
  const c = await app.inject({ method: 'POST', url: `/ordo/executants/${n.id}/actif`, headers: authed(admin.token), payload: { actif: false } });
  assert.equal(c.json().missionsRendues, 1);
  assert.equal((await rendre(n, rn.tentative, jouerMission(fil, rn.mission))).statusCode, 403);
  // un joueur n'a pas ces interrupteurs
  assert.equal((await app.inject({ method: 'POST', url: '/ordo/familles/node', headers: n.h, payload: { actif: false } })).statusCode, 403);
});

test('📏 choix selon la vitesse mesurée : une mission trop longue pour un téléphone va à un PC', async () => {
  await campagne({ profondeur: 3, maxPlies: 80 });
  const lent = await executant('navigateur', 1), pc = await executant('node', 1);
  await db.query(`UPDATE ordo_executants SET ms_par_coup = 400, prof_mesure = 1 WHERE id = ANY($1::uuid[])`, [[lent.id, pc.id]]);
  // 400 ms par demi-coup à la profondeur 1 → environ 400 × 6² × 86 / 1000 ≈ 1 240 s à la profondeur 3
  const r = (await reclamer(lent)).json();
  assert.equal(r.mission, null); assert.match(r.raison, /convienne/);
  assert.ok((await reclamer(pc)).json().mission, 'le PC (jusqu\'à une heure) la prend');
});

test('un exécutant ne voit et ne pilote que les siens', async () => {
  const a = await executant('node', 1), b = await executant('node', 1);
  assert.equal((await app.inject({ method: 'POST', url: `/ordo/executants/${a.id}/debrancher`, headers: b.h })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/ordo/missions/reclamer', headers: b.h, payload: { executant: a.id } })).statusCode, 404);
  const mes = (await app.inject({ method: 'GET', url: '/ordo/mes-executants', headers: a.h })).json().executants;
  assert.deepEqual(mes.map(x => x.id), [a.id]);
});

// ─── v3.18 bis : la famille « serveur » (conteneurs Docker de l'opérateur) et l'exécutant Node ───
const CLI = fileURLToPath(new URL('../scripts/executant.js', import.meta.url));

test('🐳 la famille « serveur » est réservée au compte de calcul (et à l\'admin) ; le rôle se retire', async () => {
  const brancher = (u) => app.inject({ method: 'POST', url: '/ordo/executants', headers: authed(u.token), payload: { famille: 'serveur', coeurs: 2, moteur: MOTEUR } });
  const joueur = await signupUser(app);
  const r = await brancher(joueur);
  assert.equal(r.statusCode, 403); assert.match(r.json().error, /compte de calcul/);
  assert.equal((await changerRole(joueur.email, 'calcul')).ok, true);
  assert.equal((await brancher(joueur)).statusCode, 200, 'le même jeton suffit : le rôle est relu en base');
  assert.equal((await brancher(admin)).statusCode, 200);
  await changerRole(joueur.email, 'player');
  assert.equal((await brancher(joueur)).statusCode, 403, 'rôle retiré : effet immédiat');
  await assert.rejects(changerRole(joueur.email, 'root'), /rôle inconnu/);
});

test('🔌 un appareil éteint sans se débrancher ne bloque pas son compte ; le compte de calcul en branche davantage', async () => {
  const u = await signupUser(app);
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push((await executant('node', 1, u)).id);
  const trop = await app.inject({ method: 'POST', url: '/ordo/executants', headers: authed(u.token), payload: { famille: 'node', coeurs: 1, moteur: MOTEUR } });
  assert.equal(trop.statusCode, 429);
  // huit conteneurs tués (ou onglets fermés) sans débranchement : plus de signe de vie depuis une heure
  await db.query(`UPDATE ordo_executants SET vu_at = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`, [ids]);
  await executant('node', 1, u);
  const calcul = await signupUser(app);
  await changerRole(calcul.email, 'calcul');
  for (let i = 0; i < 10; i++) await executant('serveur', 1, calcul);
});

test('🖥️ scripts/executant.js : --aide, famille inconnue, puis branché il joue, se reconnecte (preuve de travail comprise), suit l\'interrupteur, et SIGTERM le débranche', { timeout: 120000 }, async () => {
  const aide = spawnSync(process.execPath, [CLI, '--aide'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(aide.status, 0); assert.match(aide.stdout, /ABA_FAMILLE/);
  const faux = spawnSync(process.execPath, [CLI, '--famille', 'boinc'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(faux.status, 1); assert.match(faux.stderr, /famille inconnue/);

  await avecEnv('ORDO_BAIL_S', '3', async () => {      // signe de vie chaque seconde
    await campagne({ paires: 2 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;
    const calcul = await signupUser(app);
    await changerRole(calcul.email, 'calcul');
    // un jeton révoqué au départ : l'exécutant doit se reconnecter seul avec son mot de passe
    const perime = calcul.token;
    await app.inject({ method: 'POST', url: '/auth/logout', headers: authed(perime) });
    // et trois mots de passe faux tapés pour ce compte : sa reconnexion devra joindre une preuve de travail
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/auth/login', payload: { email: calcul.email, password: 'MauvaisMotDePasse1' } });
    const p = spawn(process.execPath, [CLI], { env: { PATH: process.env.PATH, ABA_API: 'http://127.0.0.1:' + port, ABA_FAMILLE: 'serveur',
      ABA_EMAIL: calcul.email, ABA_MDP: calcul.password, ABA_JETON: perime, ABA_COEURS: '1', ABA_NOM: 'essai-cli', ABA_ATTENTE_MS: '300' } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const fin = new Promise((res) => p.on('exit', (code, signal) => res({ code, signal })));
    const attendre = async (re, ms = 60000) => {
      const t0 = Date.now();
      while (!re.test(out)) { if (Date.now() - t0 > ms) throw new Error('attendu ' + re + ', sortie :\n' + out); await dormir(100); }
    };
    const famille = (actif) => app.inject({ method: 'POST', url: '/ordo/familles/serveur', headers: authed(admin.token), payload: { actif } });
    try {
      await attendre(/🔑 session renouvelée/);
      await attendre(/🔌 branché .* famille serveur, 1 cœur/);
      await attendre(/✓ mission \d+ .* vérifiée, comptée/);
      assert.equal((await famille(false)).statusCode, 200);
      await attendre(/⏸ en attente : la famille « serveur » est débranchée/);
      await famille(true);
      await attendre(/▶ reprise/);
      p.kill('SIGTERM');
      const { code } = await fin;
      assert.equal(code, 0, out);
      assert.match(out, /SIGTERM : débranchement/);
      assert.match(out, /  débranché(\n| :)/);
      const { rows } = await db.query(
        `SELECT e.branche, e.faites, (SELECT COUNT(*)::int FROM ordo_tentatives t WHERE t.executant_id = e.id AND t.etat = 'en_cours') AS en_cours
           FROM ordo_executants e JOIN users u ON u.id = e.user_id WHERE u.email = $1 AND e.nom = 'essai-cli'`, [calcul.email]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].branche, false, 'débranché par SIGTERM');
      assert.ok(rows[0].faites >= 1);
      assert.equal(rows[0].en_cours, 0, 'aucune mission gardée');
    } finally { p.kill('SIGKILL'); await famille(true); }
  });
});

// ─── v3.24 : campagnes « auto-jeu » et base de positions (scripts/exporter-positions.js) ───
test('🧠 auto-jeu : un seul jeu de poids, une graine par partie, résultat vérifié, bilan en positions', async () => {
  // un duel exige toujours poidsB et paires ; l'autojeu exige parties
  const sansB = await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(admin.token), payload: { nom: 'x', poidsA: P, profondeur: 1, paires: 2 } });
  assert.equal(sansB.statusCode, 400);
  const sansN = await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(admin.token), payload: { type: 'autojeu', nom: 'x', poidsA: P, profondeur: 1 } });
  assert.equal(sansN.statusCode, 400);
  await db.query(`UPDATE ordo_campagnes SET etat = 'finie' WHERE etat <> 'finie'`);
  const c = await app.inject({ method: 'POST', url: '/ordo/campagnes', headers: authed(admin.token),
    payload: { type: 'autojeu', nom: 'base 1', poidsA: P, profondeur: 1, parties: 3, maxPlies: 14, ouverture: 4 } });
  assert.equal(c.statusCode, 200, c.body);
  assert.equal(c.json().missions, 3, 'une mission par partie (pas de paires : mêmes poids des deux côtés)');
  const cid = c.json().campagne;
  const { rows } = await db.query(`SELECT couleur_a, graine FROM ordo_missions WHERE campagne_id = $1`, [cid]);
  assert.deepEqual([...new Set(rows.map(r => r.couleur_a))], ['black']);
  assert.equal(new Set(rows.map(r => String(r.graine))).size, 3, 'graines distinctes : parties distinctes');
  const camp = (await app.inject({ method: 'GET', url: '/ordo/campagnes/' + cid, headers: authed(admin.token) })).json();
  assert.equal(camp.campagne.type, 'autojeu');
  assert.deepEqual(camp.campagne.poids_b, camp.campagne.poids_a);

  const e = await executant('node', 1);
  let plies = 0;
  for (let i = 0; i < 3; i++) {
    const r = (await reclamer(e)).json();
    assert.deepEqual(r.mission.poidsB, r.mission.poidsA);
    const res = jouerMission(fil, r.mission); plies += res.plies;
    const v = await rendre(e, r.tentative, res);
    assert.equal(v.statusCode, 200, v.body);
    assert.equal(v.json().compte, true, 'vérifiée par recalcul comme une partie de duel');
  }
  const etat = (await app.inject({ method: 'GET', url: '/ordo/etat' })).json();
  const b = etat.campagnes.find(x => x.id === cid);
  assert.equal(b.type, 'autojeu');
  assert.equal(b.bilan.parties, 3);
  assert.equal(b.bilan.positions, plies);
  assert.equal(b.bilan.noir + b.bilan.blanc + b.bilan.nulles, 3);
  assert.equal(b.bilan.elo, undefined, 'ni Elo ni SPRT sans adversaire');

  // la base : une ligne par position (départ, chaque coup, position finale), étiquetée par la fin de la partie
  const { exporter } = await import('../scripts/exporter-positions.js');
  let texte = '';
  const r = await exporter(cid, async (s) => { texte += s; }, {});
  assert.equal(r.parties, 3);
  const lignes = texte.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lignes.length, plies + 3, 'chaque demi-coup + la position finale de chaque partie');
  const parMission = {};
  for (const l of lignes) (parMission[l.m] = parMission[l.m] || []).push(l);
  const { rows: ms } = await db.query(`SELECT id, vainqueur, plies FROM ordo_missions WHERE campagne_id = $1`, [cid]);
  for (const m of ms) {
    const L = parMission[m.id];
    assert.equal(L.length, m.plies + 1);
    assert.equal(L[0].plateau, 'wwwwwwwwwww..www.............................bbb..bbbbbbbbbbb', 'départ standard');
    assert.ok(L.every(l => l.plateau.length === 61 && /^[bw.]+$/.test(l.plateau)));
    assert.ok(L.every((l, i) => l.trait === (i % 2 === 0 ? 'b' : 'w')), 'les camps alternent');
    assert.ok(L.every(l => l.ouv === (l.p < 4)), 'les 4 demi-coups d\'ouverture tirée au hasard sont marqués');
    // le résultat est vu du camp au trait : opposé d'une ligne à l'autre, sauf nulle
    const attendu = (l) => m.vainqueur === 'D' ? 0 : ((m.vainqueur === 'A') === (l.trait === 'b') ? 1 : -1);
    assert.ok(L.every(l => l.resultat === attendu(l)));
    assert.ok(L.every(l => Number.isInteger(l.eval)));
  }
  let csv = '';
  const r2 = await exporter(cid, async (s) => { csv += s; }, { csv: true, sansOuverture: true });
  const lc = csv.trim().split('\n');
  assert.equal(lc[0], 'c,m,p,trait,plateau,pb,pw,eval,resultat,fin,ouv');
  assert.equal(lc.length - 1, r2.positions);
  assert.equal(r2.positions, plies + 3 - 3 * 4, 'sans les positions d\'ouverture');
});
