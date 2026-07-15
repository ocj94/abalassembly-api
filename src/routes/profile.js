import { requireAuth } from '../auth.js';
import { db } from '../db.js';

export default async function (app) {
  app.addHook('preHandler', requireAuth);

  // Lire son profil
  app.get('/', async (req) => {
    const { rows } = await db.query(
      `SELECT id, username, email, country, role, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.sub]
    );
    return rows[0] || {};
  });

  // Mettre à jour son profil (champs limités, anti sur-écriture)
  const schema = {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        username: { type: 'string', minLength: 3, maxLength: 24 },
        country:  { type: 'string', maxLength: 2 },
        bio:      { type: 'string', maxLength: 300 }
      }
    }
  };
  app.put('/', { schema }, async (req) => {
    const { username, country, bio } = req.body;
    await db.query(
      `UPDATE users SET
         username = COALESCE($2, username),
         country  = COALESCE($3, country),
         bio      = COALESCE($4, bio)
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.sub, username ?? null, country ?? null, bio ?? null]
    );
    return { ok: true };
  });
}
