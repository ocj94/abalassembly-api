import { requireAuth } from '../auth.js';
import { db } from '../db.js';

// Valeurs alignées sur la contrainte CHECK de la table (migrations/001_init.sql)
// pour 'result', et sur les modes de jeu réels du frontend pour 'mode'
// (gameMode 'ai' / 'local', 'tournament' pour le tournoi mensuel, 'online'
// réservé à l'étape 4 du blueprint backend — WebSocket, pas encore construite).
const resultSchema = {
  body: {
    type: 'object',
    required: ['result', 'mode'],
    additionalProperties: false,
    properties: {
      result: { type: 'string', enum: ['win', 'loss', 'draw'] },
      mode:   { type: 'string', enum: ['ai', 'local', 'tournament', 'online'] }
    }
  }
};

export default async function (app) {
  app.addHook('preHandler', requireAuth);

  // Enregistre le résultat d'une partie tout juste terminée.
  app.post('/result', { schema: resultSchema }, async (req, reply) => {
    const { result, mode } = req.body;
    const { rows } = await db.query(
      `INSERT INTO game_results (user_id, result, mode, played_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, result, mode, played_at`,
      [req.user.sub, result, mode]
    );
    reply.code(201);
    return { ok: true, game: rows[0] };
  });

  // Historique personnel, le plus récent d'abord. Volontairement plafonné :
  // ce n'est pas fait pour paginer des années d'historique dans un seul appel.
  app.get('/history', async (req) => {
    const { rows } = await db.query(
      `SELECT id, result, mode, played_at FROM game_results
       WHERE user_id = $1 ORDER BY played_at DESC LIMIT 200`,
      [req.user.sub]
    );
    return { games: rows };
  });
}
