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

// ─── Audit de novembre 2026 : l'adresse annoncée par le client (X-Forwarded-For) ───
// Avant, trustProxy: true croyait n'importe quel en-tête : une adresse inventée
// par requête, et la limite ne limitait plus rien (7 requêtes, 7 fois 200).

test('🛡️ X-Forwarded-For inventé à chaque requête : la limite tient (aucun relais déclaré)', async () => {
  await redis.flushall();
  const results = [];
  for (let i = 0; i < 7; i++) {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '5.6.7.' + i } });
    results.push(res.statusCode);
  }
  assert.deepEqual(results, [200, 200, 200, 200, 200, 429, 429]);
});

test('🛡️ TRUST_PROXY=true est refusé au démarrage (ce serait croire n\'importe qui)', async () => {
  const avant = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = 'true';
  try { await assert.rejects(build(), /TRUST_PROXY/); }
  finally { if (avant === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = avant; }
});

test('derrière un relais déclaré (TRUST_PROXY=127.0.0.1) : l\'adresse qu\'il transmet compte, celle d\'un inconnu non', async () => {
  const avant = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '127.0.0.1';
  const app2 = await build(); await app2.ready();
  try {
    await redis.flushall();
    // le relais (127.0.0.1) transmet des clients différents : chacun a son compteur
    const viaRelais = [];
    for (let i = 0; i < 7; i++) viaRelais.push((await app2.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '203.0.113.' + i } })).statusCode);
    assert.deepEqual(viaRelais, [200, 200, 200, 200, 200, 200, 200]);
    // une machine qui n'est pas le relais et annonce une adresse inventée : l'en-tête est ignoré
    await redis.flushall();
    const intrus = [];
    for (let i = 0; i < 7; i++) intrus.push((await app2.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': '9.9.9.' + i } })).statusCode);
    assert.deepEqual(intrus, [200, 200, 200, 200, 200, 429, 429]);
  } finally {
    await app2.close();
    if (avant === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = avant;
  }
});
