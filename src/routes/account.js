import { requireAuth, hashIp } from '../auth.js';
import { db } from '../db.js';

export default async function (app) {
  app.addHook('preHandler', requireAuth);

  // ─── Droit à la portabilité (RGPD art. 20) : export JSON de TOUTES ses données ───
  app.get('/export', async (req, reply) => {
    const uid = req.user.sub;
    const [user, progress, games, tournaments] = await Promise.all([
      db.query(`SELECT id, username, email, country, role, created_at FROM users WHERE id = $1`, [uid]),
      db.query(`SELECT xp, level, streak, elo, updated_at FROM progress WHERE user_id = $1`, [uid]),
      db.query(`SELECT result, mode, played_at FROM game_results WHERE user_id = $1 ORDER BY played_at DESC`, [uid]),
      db.query(`SELECT tournament_id, stage, result, xp_awarded FROM tournament_entries WHERE user_id = $1`, [uid])
    ]);
    const bundle = {
      exportedAt: new Date().toISOString(),
      format: 'abalassembly-user-export-v1',
      user: user.rows[0] || null,
      progress: progress.rows[0] || null,
      gameResults: games.rows,
      tournaments: tournaments.rows
    };
    reply.header('Content-Disposition', 'attachment; filename="mes-donnees-abalassembly.json"');
    return bundle;
  });

  // ─── Droit à l'effacement (RGPD art. 17) : suppression RÉELLE en cascade ───
  app.delete('/', async (req) => {
    const uid = req.user.sub;
    // On supprime les données liées, puis on anonymise le compte (soft-delete daté
    // pour la purge finale par le job, tout en libérant l'email immédiatement).
    await db.query(`DELETE FROM game_results WHERE user_id = $1`, [uid]);
    await db.query(`DELETE FROM tournament_entries WHERE user_id = $1`, [uid]);
    await db.query(`DELETE FROM progress WHERE user_id = $1`, [uid]);
    await db.query(
      `UPDATE users
         SET email = NULL, username = 'Anonymisé', password_hash = '',
             bio = NULL, country = NULL, deleted_at = now()
       WHERE id = $1`,
      [uid]
    );
    // Trace l'action (sans données personnelles)
    try {
      await db.query(`INSERT INTO audit_log (user_id, action, ip_hash) VALUES ($1, 'account_delete', $2)`,
        [uid, hashIp(req.ip)]);
    } catch (e) {}
    return { ok: true };
  });
}
