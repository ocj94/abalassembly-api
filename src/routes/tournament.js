import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { redis } from '../redis.js';

export default async function (app) {
  // Soumettre un résultat de tournoi (protégé)
  app.post('/result', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['tournamentId', 'result'],
        additionalProperties: false,
        properties: {
          tournamentId: { type: 'string', maxLength: 16 },
          stage:        { type: 'integer', minimum: 0, maximum: 10 },
          result:       { type: 'string', enum: ['champion', 'finaliste', 'participant'] },
          xpAwarded:    { type: 'integer', minimum: 0, maximum: 100000 }
        }
      }
    }
  }, async (req) => {
    const { tournamentId, stage = 0, result, xpAwarded = 0 } = req.body;
    await db.query(
      `INSERT INTO tournament_entries (user_id, tournament_id, stage, result, xp_awarded)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, tournament_id) DO UPDATE
       SET stage = EXCLUDED.stage, result = EXCLUDED.result, xp_awarded = EXCLUDED.xp_awarded`,
      [req.user.sub, tournamentId, stage, result, xpAwarded]
    );
    return { ok: true };
  });

  // Leaderboard mondial (lecture publique, servi depuis Redis pour la rapidité)
  app.get('/leaderboard', async () => {
    // ZREVRANGE : top 100 par elo. Alimenté à chaque mise à jour de progression.
    let top = [];
    try {
      const raw = await redis.zrevrange('leaderboard:elo', 0, 99, 'WITHSCORES');
      for (let i = 0; i < raw.length; i += 2) top.push({ user: raw[i], elo: Number(raw[i + 1]) });
    } catch (e) { /* si Redis indisponible, on renvoie une liste vide plutôt qu'une erreur */ }
    return { top };
  });
}
