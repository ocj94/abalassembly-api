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
      mode:   { type: 'string', enum: ['ai', 'local', 'tournament', 'online'] },
      // Couleur tenue par le joueur : conditionne l'affichage POV de
      // l'historique et l'attribution des statistiques. Optionnelle, un
      // client ancien n'en enverra pas — mieux vaut un trou honnete
      // qu'une valeur par defaut inventee.
      color:  { type: 'string', enum: ['black', 'white'] },
      variant:{ type: 'string', enum: ['standard', 'belgian', 'german', 'dutch', 'swiss'] },
      plies:  { type: 'integer', minimum: 0 },
      /* Code ABAL1 : la partie entiere depuis le premier coup, sous une
         forme rejouable et verifiable contre le moteur. Le motif reprend
         la contrainte CHECK de migrations/006 — les deux doivent rester
         identiques, sans quoi une entree acceptee ici serait rejetee par
         la base. */
      game_code: { type: 'string', maxLength: 20000, pattern: '^ABAL1:[a-z_]+:[a-i0-9]*$' }
    }
  }
};

export default async function (app) {
  app.addHook('preHandler', requireAuth);

  // Enregistre le résultat d'une partie tout juste terminée.
  app.post('/result', { schema: resultSchema }, async (req, reply) => {
    const { result, mode, color = null, variant = 'standard', plies = null, game_code = null } = req.body;
    const { rows } = await db.query(
      `INSERT INTO game_results (user_id, result, mode, color, variant, plies, game_code, played_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id, result, mode, color, variant, plies, played_at`,
      [req.user.sub, result, mode, color, variant, plies, game_code]
    );
    reply.code(201);
    return { ok: true, game: rows[0] };
  });

  // Historique personnel, le plus récent d'abord. Volontairement plafonné :
  // ce n'est pas fait pour paginer des années d'historique dans un seul appel.
  app.get('/history', async (req) => {
    const { rows } = await db.query(
      `SELECT id, result, mode, color, variant, plies, game_code, played_at
         FROM game_results
        WHERE user_id = $1 ORDER BY played_at DESC LIMIT 200`,
      [req.user.sub]
    );
    return { games: rows };
  });
}
