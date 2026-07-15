// Utilitaires communs aux fichiers de test.
// Chaque fichier de test construit sa PROPRE instance Fastify (build() n'a pas
// d'état global côté app), mais db/redis sont des singletons partagés par
// processus : chaque fichier de test tourne dans son propre processus enfant
// (test-concurrency contrôlé par npm test), donc pas de collision de pool.
import { build } from '../src/server.js';
import { db } from '../src/db.js';
import { redis } from '../src/redis.js';
import crypto from 'node:crypto';

// Les tests envoient des dizaines de requêtes en quelques secondes depuis la même
// IP (127.0.0.1) — le rate-limit (100 req/min, une vraie protection utile en
// production) se déclencherait à tort et ferait échouer des tests sans rapport
// avec lui. On le désactive pour la durée de la suite ; son comportement (429
// après le seuil) est un détail de @fastify/rate-limit, pas notre code métier.
process.env.RATE_LIMIT_MAX_TEST_OVERRIDE = '100000';

export async function makeApp() {
  const app = await build();
  await app.ready();
  return app;
}

// Ferme proprement l'app + le pool PG + la connexion Redis à la fin d'un fichier de test.
export async function teardown(app) {
  await app.close();
  await db.end().catch(() => {});
  redis.disconnect();
}

// Email unique par appel (les tests tournent sur une vraie base partagée : pas de collision).
export function uniqueEmail(prefix = 'test') {
  return `${prefix}.${crypto.randomBytes(6).toString('hex')}@test.abalassembly.local`;
}

export const STRONG_PASSWORD = 'CorrectHorseBatteryStaple1';

// Crée un compte via /auth/signup et renvoie { app, user, token, email }.
export async function signupUser(app, overrides = {}) {
  const email = overrides.email || uniqueEmail();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: overrides.password || STRONG_PASSWORD, username: overrides.username }
  });
  const body = res.json();
  return { email, password: overrides.password || STRONG_PASSWORD, user: body.user, token: body.token, res };
}
