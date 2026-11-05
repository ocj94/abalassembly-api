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

  /* L'Elo n'est plus accepté du client. Avant, PUT /progress { elo: 4000 } suffisait
     pour s'inscrire en tête de n'importe quel classement. Il appartient au serveur :
     il ne bougera qu'avec des parties que le serveur arbitre lui-même (le jeu en
     ligne, pas encore construit) ; d'ici là il reste à 1200. Un champ elo envoyé
     est retiré par la validation (additionalProperties: false) et sans effet.
     xp, level et streak restent déclaratifs : ils décrivent la progression du
     joueur sur son appareil et ne doivent alimenter aucun classement partagé. */
  const schema = {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        xp:     { type: 'integer', minimum: 0, maximum: 100000000 },
        level:  { type: 'integer', minimum: 1, maximum: 1000 },
        streak: { type: 'integer', minimum: 0, maximum: 100000 }
      }
    }
  };
  app.put('/', { schema }, async (req) => {
    const { xp = 0, level = 1, streak = 0 } = req.body;
    await db.query(
      `INSERT INTO progress (user_id, xp, level, streak, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE
       SET xp = EXCLUDED.xp, level = EXCLUDED.level,
           streak = EXCLUDED.streak, updated_at = now()`,
      [req.user.sub, xp, level, streak]
    );
    return { ok: true };
  });
}
