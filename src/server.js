import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { redis } from './redis.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import progressRoutes from './routes/progress.js';
import tournamentRoutes from './routes/tournament.js';
import accountRoutes from './routes/account.js';
import mfaRoutes from './routes/mfa.js';

export async function build() {
  // trustProxy: true → Fastify lit la vraie IP derrière Cloudflare
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 256 * 1024 });

  // En-têtes de sécurité HTTP
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS : uniquement les origines du jeu
  const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: origins.length ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Rate-limiting global (anti-abus / anti-bruteforce), backend Redis.
  // Seuil configurable (utile pour les tests, qui envoient beaucoup de requêtes
  // depuis une seule IP en quelques secondes) ; 100/min par défaut en production.
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX_TEST_OVERRIDE) || 100,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => req.ip
  });

  // Sonde de vie (pour le load-balancer / monitoring)
  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  // Routes métier
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(profileRoutes, { prefix: '/profile' });
  await app.register(progressRoutes, { prefix: '/progress' });
  await app.register(tournamentRoutes, { prefix: '/tournament' });
  await app.register(accountRoutes, { prefix: '/account' });
  await app.register(mfaRoutes, { prefix: '/mfa' });

  return app;
}

// Démarrage direct (node src/server.js)
if (import.meta.url === `file://${process.argv[1]}`) {
  build()
    .then((app) => app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' }))
    .catch((err) => { console.error(err); process.exit(1); });
}
