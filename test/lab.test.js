// Tests du Labo distribué (/lab/*) : cycle de vie d'un job, agrégation SPRT
// entre PLUSIEURS contributeurs, diversité des ouvertures (5 dispositions,
// idée reprise d'OpenBench/Fishtest), classement des contributeurs, et —
// le plus important — la détection de résultats fabriqués (coup illégal,
// résultat incohérent, position de départ mensongère). Un lot non vérifié
// ne doit JAMAIS compter dans l'agrégat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';
import { db } from '../src/db.js';
import { findDecisiveGame, shortLegalSequence } from './fixtures/decisiveGame.js';
import { sprtLLR, sprtBounds } from '../src/sprt.js';
import { LAYOUT_KEYS } from '../src/layouts.js';

let app, GAME, DECISIVE;
before(async () => {
  app = await makeApp();
  GAME = shortLegalSequence('belgian');       // échantillon court, non conclu — pour la majorité des tests
  DECISIVE = findDecisiveGame('belgian');     // partie complète (6 captures) — pour le test de résultat mensonger
});
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }
const CANDIDATE = { center: 7, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14 };

async function openJob(token) {
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: CANDIDATE } });
  return res.json().job;
}
function basePayload(jobId, overrides = {}) {
  return { jobId, candidateWins: 1, draws: 0, baselineWins: 0,
    layout: 'belgian', sampleStart: GAME.start, sampleStartColor: GAME.startColor,
    sampleSeq: GAME.seq, sampleWinner: 'candidate', ...overrides };
}

test('GET /lab/champion : public (sans jeton), poids par défaut tant que rien n\'est promu', async () => {
  const res = await app.inject({ method: 'GET', url: '/lab/champion' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.promoted, false);
  assert.equal(body.weights.center, 6); // EVAL_W par défaut du client
});

test('POST /lab/job : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/lab/job', payload: { candidateWeights: CANDIDATE } });
  assert.equal(res.statusCode, 401);
});

test('POST /lab/job : crée un job avec le champion actuel comme référence', async () => {
  const { token } = await signupUser(app);
  const job = await openJob(token);
  assert.ok(job.id);
  assert.deepEqual(job.candidateWeights, CANDIDATE);
  assert.equal(job.baselineWeights.center, 6);
});

test('POST /lab/job : un seul job ouvert à la fois → 409 si on en propose un second', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: CANDIDATE } });
  assert.equal(res.statusCode, 409, 'un job est déjà ouvert depuis le test précédent');
});

test('POST /lab/result : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/lab/result', payload: basePayload(1) });
  assert.equal(res.statusCode, 401);
});

test('POST /lab/result : le champ "layout" est désormais obligatoire → 400 si absent', async () => {
  const { token } = await signupUser(app);
  const p = basePayload(1); delete p.layout;
  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token), payload: p });
  assert.equal(res.statusCode, 400);
});

test('🛡️ ANTI-FRAUDE : coup illégal dans la partie témoin → rejeté, ne compte pas dans l\'agrégat', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: basePayload(jobId, { candidateWins: 50, sampleSeq: '1.z9z9 a1a2' }) }); // "z9z9" n'existe pas
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false, 'un coup illégal ne doit jamais être compté');
  assert.match(body.reason, /illégal|ne correspond pas/);

  const { rows: results } = await db.query(`SELECT verified FROM lab_results WHERE job_id=$1`, [jobId]);
  assert.equal(results.length, 1);
  assert.equal(results[0].verified, false);
  const { rows: jobRows } = await db.query(`SELECT status FROM lab_jobs WHERE id=$1`, [jobId]);
  assert.equal(jobRows[0].status, 'open', '50 fausses victoires ne doivent jamais promouvoir un candidat');
});

test('🛡️ ANTI-FRAUDE : position de départ ne correspond pas à la disposition annoncée → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;
  const standardGame = shortLegalSequence('standard');

  // Annonce "belgian" mais fournit en réalité une position "standard" — un
  // client malveillant pourrait sinon prétendre tester une ouverture qu'il
  // n'a jamais réellement jouée.
  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: basePayload(jobId, { layout: 'belgian', sampleStart: standardGame.start, sampleSeq: standardGame.seq }) });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false);
  assert.match(body.reason, /ne correspond pas à la disposition/);
});

test('🛡️ ANTI-FRAUDE : résultat annoncé incohérent avec la partie rejouée → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;

  // DECISIVE est une vraie partie complète et légale ; on ment sur le vainqueur.
  const wrongWinner = DECISIVE.winner === 'candidate' ? 'baseline' : 'candidate';
  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: basePayload(jobId, { layout: 'belgian', sampleStart: DECISIVE.start,
      sampleSeq: DECISIVE.seq, sampleWinner: wrongWinner }) });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false);
  assert.match(body.reason, /incohérent/);
});

test('✅ une partie décisive avec le VRAI vainqueur annoncé est comptée', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;
  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: basePayload(jobId, { layout: 'belgian', sampleStart: DECISIVE.start,
      sampleSeq: DECISIVE.seq, sampleWinner: DECISIVE.winner }) });
  assert.equal(res.json().counted, true, 'une partie décisive correctement rapportée doit compter');
});

test('🛡️ ANTI-FRAUDE : lot invraisemblablement volumineux → 400, rien n\'est inséré', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;
  const before = (await db.query(`SELECT count(*) FROM lab_results WHERE job_id=$1`, [jobId])).rows[0].count;

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: basePayload(jobId, { candidateWins: 5000 }) });
  assert.equal(res.statusCode, 400);
  const after = (await db.query(`SELECT count(*) FROM lab_results WHERE job_id=$1`, [jobId])).rows[0].count;
  assert.equal(before, after, 'une soumission rejetée par le garde-fou ne doit même pas être stockée');
});

test('✅ un résultat légitime et vérifié compte réellement dans l\'agrégat', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);
  const { token } = await signupUser(app);
  const job = await openJob(token);

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token), payload: basePayload(job.id) });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, true);
  assert.equal(body.pooled.candidateWins, 1);
});

test('🌍 DIVERSITÉ DES OUVERTURES : GET /lab/job suggère la disposition la moins utilisée', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);
  const { token } = await signupUser(app);
  const job = await openJob(token);

  const j1 = await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) });
  const firstSuggestion = j1.json().job.suggestedLayout;
  assert.ok(LAYOUT_KEYS.includes(firstSuggestion), 'la suggestion initiale doit être une disposition valide');

  // Alimente cette disposition 3 fois — la suggestion doit alors basculer ailleurs.
  for (let i = 0; i < 3; i++) {
    const g = shortLegalSequence(firstSuggestion);
    await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
      payload: basePayload(job.id, { layout: firstSuggestion, sampleStart: g.start, sampleSeq: g.seq, draws: 1, baselineWins: 1 }) });
  }
  const j2 = await app.inject({ method: 'GET', url: '/lab/job', headers: authed(token) });
  const body2 = j2.json().job;
  assert.notEqual(body2.suggestedLayout, firstSuggestion, 'après 3 soumissions sur une ouverture, une autre doit être suggérée');
  assert.equal(body2.byLayout[firstSuggestion], 3, 'la répartition par disposition doit refléter les 3 soumissions');
});

test('🌍 DIVERSITÉ : les 5 dispositions officielles sont toutes acceptées comme échantillon légitime', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);
  const { token } = await signupUser(app);
  const job = await openJob(token);
  for (const key of LAYOUT_KEYS) {
    const g = shortLegalSequence(key);
    const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
      payload: basePayload(job.id, { layout: key, sampleStart: g.start, sampleSeq: g.seq, draws: 1, baselineWins: 1 }) });
    assert.equal(res.json().counted, true, 'disposition ' + key + ' devrait être acceptée : ' + JSON.stringify(res.json()));
  }
});

test('🌐 PLUSIEURS CONTRIBUTEURS : les résultats de contributeurs différents se cumulent dans le même agrégat', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);

  const alice = await signupUser(app);
  const bob = await signupUser(app);
  const carol = await signupUser(app);
  const job = await openJob(alice.token);

  for (const user of [alice, bob, carol]) {
    const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(user.token),
      payload: basePayload(job.id, { draws: 1, baselineWins: 1 }) });
    assert.equal(res.json().counted, true);
  }
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(candidate_wins),0) AS w FROM lab_results WHERE job_id=$1 AND verified=true`, [job.id]);
  assert.equal(Number(rows[0].w), 3, 'les 3 contributions indépendantes doivent s\'additionner');
});

test('👤 CONTRIBUTEURS : GET /lab/contributors reflète les soumissions vérifiées vs totales', async () => {
  const dave = await signupUser(app);
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);
  const job = await openJob(dave.token);

  // 1 soumission valide + 1 frauduleuse (coup illégal)
  await app.inject({ method: 'POST', url: '/lab/result', headers: authed(dave.token), payload: basePayload(job.id) });
  await app.inject({ method: 'POST', url: '/lab/result', headers: authed(dave.token),
    payload: basePayload(job.id, { sampleSeq: '1.z9z9 a1a2' }) });

  const res = await app.inject({ method: 'GET', url: '/lab/contributors' });
  assert.equal(res.statusCode, 200, 'route publique, sans authentification');
  const entry = res.json().contributors.find(c => c.username === dave.user.username);
  assert.ok(entry, 'le contributeur doit apparaître dans le classement');
  assert.equal(entry.total, 2);
  assert.equal(entry.verified, 1);
  assert.equal(entry.reliability, 50, 'ratio de fiabilité attendu : 50%');
});

test('🏆 PROMOTION : quand le SPRT confirme le candidat, le job se ferme et /lab/champion reflète les nouveaux poids', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);

  const { token } = await signupUser(app);
  const job = await openJob(token);

  const { up } = sprtBounds();
  let minW = 0;
  while (sprtLLR(minW, 0, 0) < up) minW++;

  for (let i = 0; i < minW + 3; i++) {
    await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token), payload: basePayload(job.id) });
  }

  const { rows } = await db.query(`SELECT status FROM lab_jobs WHERE id=$1`, [job.id]);
  assert.equal(rows[0].status, 'promoted');

  const champ = await app.inject({ method: 'GET', url: '/lab/champion' });
  const body = champ.json();
  assert.equal(body.promoted, true);
  assert.deepEqual(body.weights, CANDIDATE);
  assert.equal(body.gamesConfirmed, minW, 'les soumissions après la clôture du job ne doivent plus être comptées');

  const { token: t2 } = await signupUser(app);
  const nextJob = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(t2),
    payload: { candidateWeights: { center: 9, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14 } } });
  assert.deepEqual(nextJob.json().job.baselineWeights, CANDIDATE);
});

test('POST /lab/job : schéma de poids invalide (clé manquante) → 400', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: { center: 6, cohesion: 4 } } }); // il manque edge/mob/iso/dng
  assert.equal(res.statusCode, 400);
});
