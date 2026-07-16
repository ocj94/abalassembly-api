// Tests du Labo distribué (/lab/*) : cycle de vie d'un job, agrégation SPRT
// entre PLUSIEURS contributeurs, et — le plus important — la détection de
// résultats fabriqués (coup illégal, résultat annoncé incohérent avec la
// partie rejouée). Un lot non vérifié ne doit JAMAIS compter dans l'agrégat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';
import { db } from '../src/db.js';
import { findDecisiveGame } from './fixtures/decisiveGame.js';
import { sprtLLR, sprtBounds } from '../src/sprt.js';

let app, GAME;
before(async () => { app = await makeApp(); GAME = findDecisiveGame(); });
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }
const CANDIDATE = { center: 7, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14 };

async function openJob(token) {
  const res = await app.inject({ method: 'POST', url: '/lab/job', headers: authed(token),
    payload: { candidateWeights: CANDIDATE } });
  return res.json().job;
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
  const res = await app.inject({ method: 'POST', url: '/lab/result',
    payload: { jobId: 1, candidateWins: 1, draws: 0, baselineWins: 0,
      sampleStart: GAME.start, sampleSeq: GAME.seq, sampleWinner: 'candidate' } });
  assert.equal(res.statusCode, 401);
});

test('🛡️ ANTI-FRAUDE : coup illégal dans la partie témoin → rejeté, ne compte pas dans l\'agrégat', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: { jobId, candidateWins: 50, draws: 0, baselineWins: 0,
      sampleStart: GAME.start, sampleStartColor: 'black',
      sampleSeq: '1.z9z9 a1a2', sampleWinner: 'candidate' } });   // "z9z9" n'existe pas
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false, 'un coup illégal ne doit jamais être compté');
  assert.match(body.reason, /illégal/);

  // Vérification en base : la ligne existe (traçabilité) mais verified=false,
  // et surtout le job reste 'open' malgré les 50 "victoires" annoncées.
  const { rows: results } = await db.query(`SELECT verified FROM lab_results WHERE job_id=$1`, [jobId]);
  assert.equal(results.length, 1);
  assert.equal(results[0].verified, false);
  const { rows: jobRows } = await db.query(`SELECT status FROM lab_jobs WHERE id=$1`, [jobId]);
  assert.equal(jobRows[0].status, 'open', '50 fausses victoires ne doivent jamais promouvoir un candidat');
});

test('🛡️ ANTI-FRAUDE : résultat annoncé incohérent avec la partie rejouée → rejeté', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;

  // GAME est une vraie partie légale où le CANDIDAT (Noirs) gagne — on ment sur le vainqueur.
  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: { jobId, candidateWins: 0, draws: 0, baselineWins: 1,
      sampleStart: GAME.start, sampleStartColor: GAME.startColor,
      sampleSeq: GAME.seq, sampleWinner: 'baseline' } });   // faux : c'est 'candidate' qui gagne vraiment
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, false);
  assert.match(body.reason, /incohérent/);
});

test('🛡️ ANTI-FRAUDE : lot invraisemblablement volumineux → 400, rien n\'est inséré', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;
  const before = (await db.query(`SELECT count(*) FROM lab_results WHERE job_id=$1`, [jobId])).rows[0].count;

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: { jobId, candidateWins: 5000, draws: 0, baselineWins: 0,
      sampleStart: GAME.start, sampleStartColor: GAME.startColor, sampleSeq: GAME.seq, sampleWinner: 'candidate' } });
  assert.equal(res.statusCode, 400);
  const after = (await db.query(`SELECT count(*) FROM lab_results WHERE job_id=$1`, [jobId])).rows[0].count;
  assert.equal(before, after, 'une soumission rejetée par le garde-fou ne doit même pas être stockée');
});

test('✅ un résultat légitime et vérifié compte réellement dans l\'agrégat', async () => {
  const { token } = await signupUser(app);
  const { rows } = await db.query(`SELECT id FROM lab_jobs WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  const jobId = rows[0].id;

  const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
    payload: { jobId, candidateWins: 1, draws: 0, baselineWins: 0,
      sampleStart: GAME.start, sampleStartColor: GAME.startColor, sampleSeq: GAME.seq, sampleWinner: 'candidate' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.counted, true);
  assert.equal(body.pooled.candidateWins, 1);
});

test('🌐 PLUSIEURS CONTRIBUTEURS : les résultats de contributeurs différents se cumulent dans le même agrégat', async () => {
  // Ferme tout job resté ouvert des scénarios précédents (ils ne soumettaient
  // volontairement pas assez de résultats pour déclencher promotion/rejet).
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);

  const alice = await signupUser(app);
  const bob = await signupUser(app);
  const carol = await signupUser(app);
  const job = await openJob(alice.token);

  for (const user of [alice, bob, carol]) {
    const res = await app.inject({ method: 'POST', url: '/lab/result', headers: authed(user.token),
      payload: { jobId: job.id, candidateWins: 1, draws: 1, baselineWins: 1,
        sampleStart: GAME.start, sampleStartColor: GAME.startColor, sampleSeq: GAME.seq, sampleWinner: 'candidate' } });
    assert.equal(res.json().counted, true);
  }
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(candidate_wins),0) AS w FROM lab_results WHERE job_id=$1 AND verified=true`, [job.id]);
  assert.equal(Number(rows[0].w), 3, 'les 3 contributions indépendantes doivent s\'additionner');
});

test('🏆 PROMOTION : quand le SPRT confirme le candidat, le job se ferme et /lab/champion reflète les nouveaux poids', async () => {
  await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE status='open'`);

  const { token } = await signupUser(app);
  const job = await openJob(token);

  // Calcule dynamiquement (via la VRAIE formule) combien de victoires nettes
  // suffisent à franchir le seuil haut du SPRT, plutôt qu'un nombre magique.
  const { up } = sprtBounds();
  let minW = 0;
  while (sprtLLR(minW, 0, 0) < up) minW++;

  // On soumet quelques coups de marge : dès que le seuil est franchi (à la
  // minW-ième soumission), le job se ferme et toute soumission suivante est
  // refusée (409, job clos) — gamesConfirmed s'arrêtera donc pile à minW.
  for (let i = 0; i < minW + 3; i++) {
    await app.inject({ method: 'POST', url: '/lab/result', headers: authed(token),
      payload: { jobId: job.id, candidateWins: 1, draws: 0, baselineWins: 0,
        sampleStart: GAME.start, sampleStartColor: GAME.startColor, sampleSeq: GAME.seq, sampleWinner: 'candidate' } });
  }

  const { rows } = await db.query(`SELECT status FROM lab_jobs WHERE id=$1`, [job.id]);
  assert.equal(rows[0].status, 'promoted');

  const champ = await app.inject({ method: 'GET', url: '/lab/champion' });
  const body = champ.json();
  assert.equal(body.promoted, true);
  assert.deepEqual(body.weights, CANDIDATE);
  assert.equal(body.gamesConfirmed, minW, 'les soumissions après la clôture du job ne doivent plus être comptées');

  // Un nouveau job doit maintenant partir de CE champion comme référence.
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
