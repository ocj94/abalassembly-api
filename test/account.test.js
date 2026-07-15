// Tests des routes RGPD : export (portabilité, art. 20) et suppression réelle
// en cascade (droit à l'oubli, art. 17). C'est le point le plus sensible du
// backend — une régression ici est un manquement légal, pas juste un bug.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, signupUser } from './helpers.js';
import { db } from '../src/db.js';

let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }

test('export : sans authentification → 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/account/export' });
  assert.equal(res.statusCode, 401);
});

test('export : structure complète et exacte pour un compte tout juste créé', async () => {
  const { token, email } = await signupUser(app);
  const res = await app.inject({ method: 'GET', url: '/account/export', headers: authed(token) });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-disposition'] || '', /attachment/, 'doit se télécharger, pas s\'afficher inline');

  const body = res.json();
  assert.equal(body.format, 'abalassembly-user-export-v1');
  assert.equal(body.user.email, email.toLowerCase());
  assert.equal(body.progress, null, 'aucune progression enregistrée pour l\'instant');
  assert.deepEqual(body.gameResults, []);
  assert.deepEqual(body.tournaments, []);
  assert.ok(!Number.isNaN(Date.parse(body.exportedAt)));
});

test('export : reflète la progression et les tournois réellement enregistrés', async () => {
  const { token } = await signupUser(app);
  await app.inject({ method: 'PUT', url: '/progress', headers: authed(token),
    payload: { xp: 4200, level: 7, streak: 3, elo: 1550 } });
  await app.inject({ method: 'POST', url: '/tournament/result', headers: authed(token),
    payload: { tournamentId: '2026-07', result: 'finaliste', xpAwarded: 300 } });

  const res = await app.inject({ method: 'GET', url: '/account/export', headers: authed(token) });
  const body = res.json();
  assert.equal(body.progress.xp, 4200);
  assert.equal(body.progress.elo, 1550);
  assert.equal(body.tournaments.length, 1);
  assert.equal(body.tournaments[0].tournament_id, '2026-07');
  assert.equal(body.tournaments[0].result, 'finaliste');
});

test('export : n\'expose jamais le hash de mot de passe ni le secret TOTP', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'GET', url: '/account/export', headers: authed(token) });
  const flat = JSON.stringify(res.json());
  assert.ok(!flat.includes('password_hash'));
  assert.ok(!flat.includes('totp_secret'));
});

test('suppression : sans authentification → 401, aucune donnée touchée', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/account' });
  assert.equal(res.statusCode, 401);
});

test('suppression : purge réellement en cascade (progress, tournois, parties) et anonymise le compte', async () => {
  const { token, user } = await signupUser(app);
  const uid = user.id;

  // Fixture : une partie jouée, une progression, une entrée de tournoi.
  // (game_results n'a pas encore de route de création — on simule la donnée
  // telle qu'un futur endpoint /game/result l'insérerait, pour vérifier que
  // la cascade de suppression fonctionne dès aujourd'hui sur le schéma réel.)
  await db.query(`INSERT INTO game_results (user_id, result, mode) VALUES ($1,'win','ai')`, [uid]);
  await app.inject({ method: 'PUT', url: '/progress', headers: authed(token), payload: { xp: 100 } });
  await app.inject({ method: 'POST', url: '/tournament/result', headers: authed(token),
    payload: { tournamentId: '2026-07', result: 'participant' } });

  const del = await app.inject({ method: 'DELETE', url: '/account', headers: authed(token) });
  assert.equal(del.statusCode, 200);
  assert.equal(del.json().ok, true);

  // Vérification en base directe (pas seulement via l'API) : la suppression est réelle.
  const games = await db.query(`SELECT * FROM game_results WHERE user_id=$1`, [uid]);
  const progress = await db.query(`SELECT * FROM progress WHERE user_id=$1`, [uid]);
  const tourneys = await db.query(`SELECT * FROM tournament_entries WHERE user_id=$1`, [uid]);
  const acct = await db.query(`SELECT * FROM users WHERE id=$1`, [uid]);
  assert.equal(games.rowCount, 0, 'game_results doit être vidé (droit à l\'oubli)');
  assert.equal(progress.rowCount, 0, 'progress doit être vidé');
  assert.equal(tourneys.rowCount, 0, 'tournament_entries doit être vidé');
  assert.equal(acct.rowCount, 1, 'la ligne users subsiste (soft-delete pour purge différée par le cron)');
  assert.equal(acct.rows[0].email, null, 'email anonymisé immédiatement');
  assert.equal(acct.rows[0].username, 'compte supprimé');
  assert.equal(acct.rows[0].password_hash, '', 'le hash est effacé, pas juste le username');
  assert.ok(acct.rows[0].deleted_at, 'deleted_at doit être daté (déclenche la purge finale à J+30)');

  // Une trace d'audit existe, mais sans donnée personnelle
  const audit = await db.query(
    `SELECT * FROM audit_log WHERE user_id=$1 AND action='account_delete'`, [uid]);
  assert.equal(audit.rowCount, 1);
  assert.ok(audit.rows[0].ip_hash, 'IP hachée, jamais en clair');
});

test('suppression : le job de purge respecte le délai de 30 jours (ne purge pas un compte tout juste supprimé)', async () => {
  const { token, user } = await signupUser(app);
  await app.inject({ method: 'DELETE', url: '/account', headers: authed(token) });

  const { runPurge } = await import('../src/jobs/purge.js');
  await runPurge();

  const still = await db.query(`SELECT id FROM users WHERE id=$1`, [user.id]);
  assert.equal(still.rowCount, 1, 'la ligne doit survivre : deleted_at a moins de 30 jours');
});

test('purge : un compte soft-supprimé depuis plus de 30 jours est réellement effacé', async () => {
  const { token, user } = await signupUser(app);
  await app.inject({ method: 'DELETE', url: '/account', headers: authed(token) });
  // Recule artificiellement la date de suppression (le job compare à `now()`)
  await db.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id=$1`, [user.id]);

  const { runPurge } = await import('../src/jobs/purge.js');
  const result = await runPurge();
  assert.ok(result.deletedUsers >= 1);

  const gone = await db.query(`SELECT id FROM users WHERE id=$1`, [user.id]);
  assert.equal(gone.rowCount, 0, 'purge définitive après le délai légal');
});
