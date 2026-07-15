// Vérifie que le rate-limit protège réellement — dans un processus dédié où
// on fixe un seuil bas plutôt que de désactiver la protection (test/helpers.js
// la désactive pour les AUTRES fichiers afin qu'ils ne la déclenchent pas par
// accident ; ici on veut au contraire la voir se déclencher).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.RATE_LIMIT_MAX_TEST_OVERRIDE = '5'; // seuil artificiellement bas pour ce test

const { build } = await import('../src/server.js');
const { db } = await import('../src/db.js');
const { redis } = await import('../src/redis.js');

const app = await build();
await app.ready();
after(async () => { await app.close(); await db.end().catch(() => {}); redis.disconnect(); });

test('rate-limit : la 6e requête en moins d\'une minute depuis la même IP est bloquée (429)', async () => {
  // Redis est partagé avec les fichiers de test précédents (même serveur) : on
  // repart d'un compteur propre pour cette IP avant de mesurer le seuil.
  await redis.flushall();
  const results = [];
  for (let i = 0; i < 7; i++) {
    const res = await app.inject({ method: 'GET', url: '/health' });
    results.push(res.statusCode);
  }
  assert.deepEqual(results.slice(0, 5), [200, 200, 200, 200, 200], 'les 5 premières requêtes passent (seuil = 5)');
  assert.equal(results[5], 429, 'la 6e requête doit être bloquée');
  assert.equal(results[6], 429, 'et les suivantes tant que la fenêtre n\'est pas écoulée');
});
