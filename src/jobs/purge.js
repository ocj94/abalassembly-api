import { db } from '../db.js';

// Applique les durées de conservation. À lancer chaque nuit (cron / scheduler UE).
export async function runPurge() {
  const results = {};

  // Historique de parties : 12 mois glissants
  const g = await db.query(`DELETE FROM game_results WHERE played_at < now() - interval '12 months'`);
  results.gameResults = g.rowCount;

  // Logs d'audit : 6 mois
  const a = await db.query(`DELETE FROM audit_log WHERE at < now() - interval '6 months'`);
  results.auditLog = a.rowCount;

  // Comptes soft-supprimés : purge définitive 30 jours après la demande
  const u = await db.query(
    `DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'`
  );
  results.deletedUsers = u.rowCount;

  console.log('[purge]', new Date().toISOString(), results);
  return results;
}
