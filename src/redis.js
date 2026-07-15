import Redis from 'ioredis';

// Client Redis partagé : sessions révoquées, rate-limit, leaderboard (sorted-set).
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: false
});

redis.on('error', (err) => {
  console.error('[redis] erreur', err.message);
});

// Liste de révocation des jetons (logout) : on stocke le jti jusqu'à expiration.
export async function revokeToken(jti, ttlSeconds) {
  try { await redis.set('revoked:' + jti, '1', 'EX', Math.max(1, ttlSeconds)); } catch (e) {}
}
export async function isTokenRevoked(jti) {
  try { return (await redis.exists('revoked:' + jti)) === 1; } catch (e) { return false; }
}
