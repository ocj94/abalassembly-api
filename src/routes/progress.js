import { requireAuth } from '../auth.js';
import { db } from '../db.js';

export default async function (app) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const { rows } = await db.query(
      `SELECT xp, level, streak, elo FROM progress WHERE user_id = $1`,
      [req.user.sub]
    );
    return rows[0] || { xp: 0, level: 1, streak: 0, elo: 1200 };
  });

  const schema = {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        xp:     { type: 'integer', minimum: 0, maximum: 100000000 },
        level:  { type: 'integer', minimum: 1, maximum: 1000 },
        streak: { type: 'integer', minimum: 0, maximum: 100000 },
        elo:    { type: 'integer', minimum: 0, maximum: 4000 }
      }
    }
  };
  app.put('/', { schema }, async (req) => {
    const { xp = 0, level = 1, streak = 0, elo = 1200 } = req.body;
    await db.query(
      `INSERT INTO progress (user_id, xp, level, streak, elo, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE
       SET xp = EXCLUDED.xp, level = EXCLUDED.level,
           streak = EXCLUDED.streak, elo = EXCLUDED.elo, updated_at = now()`,
      [req.user.sub, xp, level, streak, elo]
    );
    return { ok: true };
  });
}
