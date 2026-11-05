// Tests du Labo distribué (/lab/*) : cycle de vie d'un job, agrégation SPRT
// entre PLUSIEURS contributeurs, diversité des ouvertures (5 dispositions,
// idée reprise d'OpenBench/Fishtest), classement des contributeurs, et —
// le plus important — la détection de résultats fabriqués (coup illégal,
// résultat incohérent, position de départ mensongère, partie non conclue).
// Depuis l'audit de novembre 2026 : un envoi = une partie, rejouée, et seule
// cette partie compte ; un candidat confirmé attend la validation d'un admin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';
import { db } from '../src/db.js';
import { totpCode } from '../src/totp.js';
import { changerRole } from '../scripts/admin.js';
import { findDecisiveGame, playLimitDraw, shortLegalSequence, withExtraMove } from './fixtures/decisiveGame.js';
import { sprtLLR, sprtBounds } from '../src/sprt.js';
import { LAYOUT_KEYS } from '../src/layouts.js';
import { LAB_MIN_CONTRIBUTEURS } from '../src/routes/lab.js';

let app, NULLE, DECISIVE;
before(async () => {
  app = await makeApp();
  NULLE = playLimitDraw('belgian');           // nulle conclue à la limite des 80 demi-coups — pour la majorité des tests
  DECISIVE = findDecisiveGame('belgian');     // partie décisive (6 billes ou 3 d'avance)
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status IN ('open','pending')`);
});
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }
const CANDIDATE = { center: 7, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14, chain: 10, fortress: 20 };
const fermerJobs = () => db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status IN ('open','pending')`);

async function openJob(token, weights = CANDIDATE) {
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: weights } });
  return res.json().job;
}
function basePayload(jobId, overrides = {}) {
  return { jobId, layout: 'belgian', sampleStart: NULLE.start, candidateColor: 'black',
    sampleSeq: NULLE.seq, sampleWinner: 'draw', ...overrides };
}
// la partie décisive, rapportée du côté qui fait gagner le candidat
function victoireCandidat(jobId) {
  return basePayload(jobId, { sampleStart: DECISIVE.start, sampleSeq: DECISIVE.seq,
    candidateColor: DECISIVE.winner === 'candidate' ? 'black' : 'white', sampleWinner: 'candidate' });
}
const envoyer = (token, payload) => app.inject({ method: 'POST', url: '/lab/result', headers: authed(token), payload });
const victoiresPourConclure = () => { const { up } = sprtBounds(); let n = 0; while (sprtLLR(n, 0, 0) < up) n++; return n; };

// un administrateur, MFA active (nommé sur le serveur : scripts/admin.js)
async function adminAvecMfa() {
  const a = await signupUser(app);
  await changerRole(a.email, 'admin');
  const s = (await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(a.token) })).json();
  const r = await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(a.token), payload: { otp: totpCode(s.secret) } });
  assert.equal(r.statusCode, 200);
  return a;
}

test('GET /lab/champion : public (sans jeton), poids par défaut tant que rien n\'est promu', async () => {
  const res = await app.inject({ method: 'GET', url: '/lab/champion' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  if (!body.promoted) assert.equal(body.weights.center, 6); // EVAL_W par défaut du client
});

test('POST /lab/job : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/lab/job', payload: { candidateWeights: CANDIDATE } });
  assert.equal(res.statusCode, 401);
});

test('POST /lab/job : crée un job avec le champion actuel comme référence', async () => {
  const { token } = await signupUser(app);
  const champion = (await app.inject({ method: 'GET', url: '/lab/champion' })).json().weights;
  const job = await openJob(token);
  assert.ok(job.id);
  assert.deepEqual(job.candidateWeights, CANDIDATE);
  assert.deepEqual(job.baselineWeights, champion);
});

test('POST /lab/job : un seul job ouvert à la fois → 409 si on en propose un second', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: CANDIDATE } });
  assert.equal(res.statusCode, 409, 'un job est déjà ouvert depuis le test précédent');
});

test('🛡️ ATTAQUE : des poids absurdes (tous négatifs, une IA qui cherche à perdre) sont refusés → 400', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const mauvais = Object.fromEntries(Object.keys(CANDIDATE).map(k => [k, -100]));
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token), payload: { candidateWeights: mauvais } });
  assert.equal(res.statusCode, 400);
  const trop = { ...CANDIDATE, mob: 21 }; // au-delà de la borne du Labo du jeu (SPSA_MAX.mob = 20)
  assert.equal((await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token), payload: { candidateWeights: trop } })).statusCode, 400);
});

test('POST /lab/result : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/lab/result', payload: basePayload(1) });
  assert.equal(res.statusCode, 401);
});

test('POST /lab/result : le champ "layout" est obligatoire → 400 si absent', async () => {
  const { token } = await signupUser(app);
  const p = basePayload(1); delete p.layout;
  const res = await envoyer(token, p);
  assert.equal(res.statusCode, 400);
});

test('🛡️ ATTAQUE REJOUÉE : un seul coup légal et « 200 victoires » annoncées ne comptent plus pour rien', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const court = shortLegalSequence('belgian', 1);
  // l'envoi de l'attaque d'origine : le lot annoncé (candidateWins: 200) est retiré par la
  // validation ; la partie d'un coup n'est pas conclue → rien n'est compté
  const res = await envoyer(token, { ...basePayload(job.id, { sampleSeq: court.seq, sampleWinner: 'candidate' }), candidateWins: 200, draws: 0, baselineWins: 0 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().counted, false);
  assert.match(res.json().reason, /non conclue/);
  const { rows } = await db.query(`SELECT COALESCE(SUM(candidate_wins),0)::int AS w FROM lab_results WHERE job_id=$1 AND verified=true`, [job.id]);
  assert.equal(rows[0].w, 0);
});

test('🛡️ ANTI-FRAUDE : coup illégal dans la partie → rejeté, ne compte pas dans l\'agrégat', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const res = await envoyer(token, basePayload(job.id, { sampleSeq: '1.z9z9 a1a2' })); // "z9z9" n'existe pas
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false, 'un coup illégal ne doit jamais être compté');
  assert.match(body.reason, /illégal|ne correspond pas/);
  const { rows: results } = await db.query(`SELECT verified, candidate_wins, draws, baseline_wins FROM lab_results WHERE job_id=$1`, [job.id]);
  assert.equal(results.length, 1);
  assert.equal(results[0].verified, false);
  assert.equal(results[0].candidate_wins + results[0].draws + results[0].baseline_wins, 0);
});

test('🛡️ ANTI-FRAUDE : position de départ ne correspond pas à la disposition annoncée → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const standardGame = playLimitDraw('standard');
  const res = await envoyer(token, basePayload(rows[0].id, { layout: 'belgian', sampleStart: standardGame.start, sampleSeq: standardGame.seq }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().counted, false);
  assert.match(res.json().reason, /ne correspond pas à la disposition/);
});

test('🛡️ ANTI-FRAUDE : résultat annoncé incohérent avec la partie rejouée → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const wrongWinner = DECISIVE.winner === 'candidate' ? 'baseline' : 'candidate';
  const res = await envoyer(token, basePayload(rows[0].id, { sampleStart: DECISIVE.start, sampleSeq: DECISIVE.seq, sampleWinner: wrongWinner }));
  assert.equal(res.json().counted, false);
  assert.match(res.json().reason, /incohérent/);
  // une nulle annoncée comme victoire, pareil
  const r2 = await envoyer(token, basePayload(rows[0].id, { sampleWinner: 'candidate' }));
  assert.equal(r2.json().counted, false);
});

test('🛡️ ANTI-FRAUDE : un coup joué après la fin de la partie (3 billes d\'avance ou 6 sorties) → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const g = withExtraMove(DECISIVE);
  const res = await envoyer(token, basePayload(rows[0].id, { sampleStart: g.start, sampleSeq: g.seq, sampleWinner: DECISIVE.winner }));
  assert.equal(res.json().counted, false);
  assert.match(res.json().reason, /après la fin/);
});

test('🛡️ ANTI-FRAUDE : une partie plus longue que la limite du Labo (80 demi-coups) → rejetée', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const g = playLimitDraw('belgian', 0, 81);
  assert.ok(g, 'fixture de 81 demi-coups');
  const res = await envoyer(token, basePayload(rows[0].id, { sampleStart: g.start, sampleSeq: g.seq }));
  assert.equal(res.json().counted, false);
  assert.match(res.json().reason, /limite/);
});

test('✅ une partie décisive avec le VRAI vainqueur annoncé compte pour une, dans la bonne colonne', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const res = await envoyer(token, basePayload(job.id, { sampleStart: DECISIVE.start, sampleSeq: DECISIVE.seq, sampleWinner: DECISIVE.winner }));
  const body = res.json();
  assert.equal(body.counted, true, 'une partie décisive correctement rapportée doit compter : ' + JSON.stringify(body));
  assert.equal(body.game, DECISIVE.winner);
  const attendu = { candidateWins: DECISIVE.winner === 'candidate' ? 1 : 0, draws: 0, baselineWins: DECISIVE.winner === 'baseline' ? 1 : 0 };
  assert.deepEqual(body.pooled, attendu);
});

test('✅ une nulle conclue à la limite des 80 demi-coups compte pour une nulle', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const body = (await envoyer(token, basePayload(job.id))).json();
  assert.equal(body.counted, true, JSON.stringify(body));
  assert.deepEqual(body.pooled, { candidateWins: 0, draws: 1, baselineWins: 0 });
});

test('✅ CANDIDAT JOUE BLANC : Noir commence toujours la partie rejouée, mais le résultat s\'interprète bien du point de vue de Blanc', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  // DECISIVE.winner est calculé du point de vue de Noir ('candidate' = Noir a gagné).
  const winnerFromWhite = DECISIVE.winner === 'candidate' ? 'baseline' : 'candidate';
  const res = await envoyer(token, basePayload(job.id, { sampleStart: DECISIVE.start, sampleSeq: DECISIVE.seq,
    candidateColor: 'white', sampleWinner: winnerFromWhite }));
  assert.equal(res.json().counted, true, 'un résultat correctement interprété pour un candidat Blanc doit être accepté: ' + JSON.stringify(res.json()));
});

test('🛡️ ANTI-FRAUDE : candidat Blanc avec un résultat non inversé (calculé comme si c\'était Noir) est détecté', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const res = await envoyer(token, basePayload(job.id, { sampleStart: DECISIVE.start, sampleSeq: DECISIVE.seq,
    candidateColor: 'white', sampleWinner: DECISIVE.winner }));
  assert.equal(res.json().counted, false, 'un résultat non inversé pour un candidat Blanc doit être rejeté');
});

test('⚖️ ÉQUILIBRAGE COULEUR : GET /lab/job suggère la couleur la moins jouée par le candidat', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const j1 = await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) });
  const firstSuggestion = j1.json().job.suggestedColor;
  assert.ok(['black', 'white'].includes(firstSuggestion));
  for (let i = 0; i < 3; i++) {
    const g = playLimitDraw('belgian', i);
    await envoyer(token, basePayload(job.id, { candidateColor: firstSuggestion, sampleStart: g.start, sampleSeq: g.seq }));
  }
  const body2 = (await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) })).json().job;
  assert.notEqual(body2.suggestedColor, firstSuggestion, 'après 3 parties dans une couleur, l\'autre doit être suggérée');
  assert.equal(body2.byColor[firstSuggestion].draws, 3, 'la répartition par couleur doit refléter les 3 parties');
  assert.equal(body2.byColor[firstSuggestion === 'black' ? 'white' : 'black'].draws, 0);
});

test('🌍 DIVERSITÉ DES OUVERTURES : GET /lab/job suggère la disposition la moins utilisée', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const firstSuggestion = (await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) })).json().job.suggestedLayout;
  assert.ok(LAYOUT_KEYS.includes(firstSuggestion), 'la suggestion initiale doit être une disposition valide');
  for (let i = 0; i < 3; i++) {
    const g = playLimitDraw(firstSuggestion, i);
    await envoyer(token, basePayload(job.id, { layout: firstSuggestion, sampleStart: g.start, sampleSeq: g.seq }));
  }
  const body2 = (await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) })).json().job;
  assert.notEqual(body2.suggestedLayout, firstSuggestion, 'après 3 parties sur une ouverture, une autre doit être suggérée');
  assert.equal(body2.byLayout[firstSuggestion], 3, 'la répartition par disposition doit refléter les 3 parties');
});

test('🌍 DIVERSITÉ : les 5 dispositions officielles sont toutes acceptées', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  for (const key of LAYOUT_KEYS) {
    const g = playLimitDraw(key);
    const res = await envoyer(token, basePayload(job.id, { layout: key, sampleStart: g.start, sampleSeq: g.seq }));
    assert.equal(res.json().counted, true, 'disposition ' + key + ' devrait être acceptée : ' + JSON.stringify(res.json()));
  }
});

test('🌐 PLUSIEURS CONTRIBUTEURS : les parties de contributeurs différents se cumulent dans le même agrégat', async () => {
  await fermerJobs();
  const alice = await signupUser(app), bob = await signupUser(app), carol = await signupUser(app);
  const job = await openJob(alice.token);
  for (const user of [alice, bob, carol]) {
    const res = await envoyer(user.token, basePayload(job.id));
    assert.equal(res.json().counted, true);
  }
  const { rows } = await db.query(`SELECT COALESCE(SUM(draws),0)::int AS d FROM lab_results WHERE job_id=$1 AND verified=true`, [job.id]);
  assert.equal(rows[0].d, 3, 'les 3 contributions indépendantes doivent s\'additionner');
});

test('👤 CONTRIBUTEURS : GET /lab/contributors reflète les envois vérifiés vs totaux', async () => {
  const dave = await signupUser(app);
  await fermerJobs();
  const job = await openJob(dave.token);
  await envoyer(dave.token, basePayload(job.id));
  await envoyer(dave.token, basePayload(job.id, { sampleSeq: '1.z9z9 a1a2' }));
  const res = await app.inject({ method: 'GET', url: '/lab/contributors' });
  assert.equal(res.statusCode, 200, 'route publique, sans authentification');
  const entry = res.json().contributors.find(c => c.username === dave.user.username);
  assert.ok(entry, 'le contributeur doit apparaître dans le classement');
  assert.equal(entry.total, 2);
  assert.equal(entry.verified, 1);
  assert.equal(entry.reliability, 50, 'ratio de fiabilité attendu : 50%');
});

test('🛡️ ATTAQUE REJOUÉE : un seul compte, des victoires légales à la chaîne → le SPRT ne conclut pas', async () => {
  await fermerJobs();
  const { token } = await signupUser(app);
  const job = await openJob(token);
  const n = victoiresPourConclure();
  let dernier;
  for (let i = 0; i < n + 3; i++) dernier = (await envoyer(token, victoireCandidat(job.id))).json();
  assert.equal(dernier.counted, true);
  assert.ok(dernier.llr >= sprtBounds().up, 'le SPRT seul aurait conclu');
  assert.equal(dernier.outcome, 'open', 'mais un seul contributeur ne suffit pas (' + LAB_MIN_CONTRIBUTEURS + ' requis)');
  const { rows } = await db.query(`SELECT status FROM lab_jobs WHERE id=$1`, [job.id]);
  assert.equal(rows[0].status, 'open');
});

test('🏆 PROMOTION : SPRT confirmé par plusieurs contributeurs → en attente ; seul un admin avec MFA en fait le champion', async () => {
  await fermerJobs();
  const champion0 = (await app.inject({ method: 'GET', url: '/lab/champion' })).json();
  const comptes = [];
  for (let i = 0; i < LAB_MIN_CONTRIBUTEURS; i++) comptes.push(await signupUser(app));
  const job = await openJob(comptes[0].token);
  const n = victoiresPourConclure();
  let fin = null;
  for (let i = 0; i < n + LAB_MIN_CONTRIBUTEURS && !fin; i++) {
    const b = (await envoyer(comptes[i % comptes.length].token, victoireCandidat(job.id))).json();
    if (b.outcome === 'pending') fin = b;
  }
  assert.ok(fin, 'le job doit passer en attente de validation');
  // en attente : plus aucun envoi n'est compté, aucun nouveau job, et le champion public n'a PAS changé
  assert.equal((await envoyer(comptes[0].token, victoireCandidat(job.id))).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/lab/job', headers: authed(comptes[1].token), payload: { candidateWeights: { ...CANDIDATE, center: 9 } } })).statusCode, 409);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/lab/champion' })).json().weights, champion0.weights);

  // un joueur ne peut pas valider ; un admin sans MFA non plus
  assert.equal((await app.inject({ method: 'POST', url: `/lab/job/${job.id}/approve`, headers: authed(comptes[0].token) })).statusCode, 403);
  const sansMfa = await signupUser(app); await changerRole(sansMfa.email, 'admin');
  const r403 = await app.inject({ method: 'POST', url: `/lab/job/${job.id}/approve`, headers: authed(sansMfa.token) });
  assert.equal(r403.statusCode, 403);
  assert.match(r403.json().error, /MFA/);

  const admin = await adminAvecMfa();
  const attente = (await app.inject({ method: 'GET', url: '/lab/pending', headers: authed(admin.token) })).json().jobs;
  const j = attente.find(x => String(x.id) === String(job.id));
  assert.ok(j, 'le candidat figure dans la liste d\'attente de l\'admin');
  assert.equal(j.contributors, LAB_MIN_CONTRIBUTEURS);
  const ok = await app.inject({ method: 'POST', url: `/lab/job/${job.id}/approve`, headers: authed(admin.token) });
  assert.equal(ok.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/lab/job/${job.id}/approve`, headers: authed(admin.token) })).statusCode, 409, 'une seule décision');

  const body = (await app.inject({ method: 'GET', url: '/lab/champion' })).json();
  assert.equal(body.promoted, true);
  assert.deepEqual(body.weights, CANDIDATE);
  assert.equal(body.gamesConfirmed, fin.pooled.candidateWins, 'les envois après la clôture du job ne sont plus comptés');
  const nextJob = await openJob(comptes[1].token, { ...CANDIDATE, center: 9 });
  assert.deepEqual(nextJob.baselineWeights, CANDIDATE);
});

test('🗑️ un admin peut aussi écarter un candidat en attente', async () => {
  await fermerJobs();
  const comptes = [];
  for (let i = 0; i < LAB_MIN_CONTRIBUTEURS; i++) comptes.push(await signupUser(app));
  const job = await openJob(comptes[0].token, { ...CANDIDATE, center: 11 });
  const n = victoiresPourConclure();
  for (let i = 0; i < n + LAB_MIN_CONTRIBUTEURS; i++) await envoyer(comptes[i % comptes.length].token, victoireCandidat(job.id));
  const admin = await adminAvecMfa();
  const res = await app.inject({ method: 'POST', url: `/lab/job/${job.id}/reject`, headers: authed(admin.token) });
  assert.equal(res.statusCode, 200);
  const { rows } = await db.query(`SELECT status, decided_by FROM lab_jobs WHERE id=$1`, [job.id]);
  assert.equal(rows[0].status, 'rejected');
  assert.equal(rows[0].decided_by, admin.user.id);
  assert.notEqual((await app.inject({ method: 'GET', url: '/lab/champion' })).json().weights.center, 11);
});

test('POST /lab/job : schéma de poids invalide (clé manquante) → 400', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: { center: 6, cohesion: 4 } } });
  assert.equal(res.statusCode, 400);
});
