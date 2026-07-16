// Tests de /game/result et /game/history — la table game_results existait
// depuis le début (migrations/001_init.sql) mais n'était jamais alimentable
// via l'API ; seuls les tests RGPD y insérrivaient directement en base pour
// vérifier la cascade de suppression. Cette route la rend réellement utilisable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';

let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }

test('POST /game/result : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/game/result',
    payload: { result: 'win', mode: 'ai' } });
  assert.equal(res.statusCode, 401);
});

test('POST /game/result : enregistre une victoire, renvoie la ligne créée', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'win', mode: 'ai' } });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.game.result, 'win');
  assert.equal(body.game.mode, 'ai');
  assert.ok(body.game.id);
  assert.ok(!Number.isNaN(Date.parse(body.game.played_at)));
});

test('POST /game/result : résultat ou mode hors énumération → 400', async () => {
  const { token } = await signupUser(app);
  const badResult = await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'victoire-ecrasante', mode: 'ai' } });
  assert.equal(badResult.statusCode, 400);

  const badMode = await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'win', mode: 'triche' } });
  assert.equal(badMode.statusCode, 400);

  const missing = await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'win' } });
  assert.equal(missing.statusCode, 400, 'mode est requis');
});

test('GET /game/history : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/game/history' });
  assert.equal(res.statusCode, 401);
});

test('GET /game/history : vide pour un compte tout juste créé', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'GET', url: '/game/history', headers: authed(token) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().games, []);
});

test('GET /game/history : reflète les parties enregistrées, plus récentes en premier', async () => {
  const { token } = await signupUser(app);
  await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'loss', mode: 'ai' } });
  await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'win', mode: 'tournament' } });
  await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'draw', mode: 'local' } });

  const res = await app.inject({ method: 'GET', url: '/game/history', headers: authed(token) });
  const games = res.json().games;
  assert.equal(games.length, 3);
  // la plus récente insérée (draw/local) doit arriver en premier
  assert.equal(games[0].result, 'draw');
  assert.equal(games[0].mode, 'local');
  assert.equal(games[2].result, 'loss');
});

test('GET /game/history : n\'expose jamais les parties d\'un autre compte', async () => {
  const alice = await signupUser(app);
  const bob = await signupUser(app);
  await app.inject({ method: 'POST', url: '/game/result', headers: authed(alice.token),
    payload: { result: 'win', mode: 'ai' } });

  const bobHistory = await app.inject({ method: 'GET', url: '/game/history', headers: authed(bob.token) });
  assert.deepEqual(bobHistory.json().games, [], 'Bob ne doit voir aucune partie d\'Alice');

  const aliceHistory = await app.inject({ method: 'GET', url: '/game/history', headers: authed(alice.token) });
  assert.equal(aliceHistory.json().games.length, 1);
});

test('un résultat enregistré via l\'API apparaît dans l\'export RGPD', async () => {
  const { token } = await signupUser(app);
  await app.inject({ method: 'POST', url: '/game/result', headers: authed(token),
    payload: { result: 'win', mode: 'ai' } });

  const exp = await app.inject({ method: 'GET', url: '/account/export', headers: authed(token) });
  assert.equal(exp.json().gameResults.length, 1);
  assert.equal(exp.json().gameResults[0].result, 'win');
});
