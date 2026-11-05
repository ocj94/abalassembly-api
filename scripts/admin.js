// Nommer ou retirer un administrateur — sur le serveur, jamais par une requête HTTP.
//
//   node --env-file=.env scripts/admin.js nommer  <email>
//   node --env-file=.env scripts/admin.js retirer <email>
//
// Remplace BOOTSTRAP_ADMIN_EMAIL : avant, l'inscription avec cette adresse donnait
// le rôle admin à la première personne qui la tapait, sans rien vérifier. Ici, il
// faut un accès à la base du serveur, et le compte doit déjà exister (le futur
// admin s'inscrit normalement, puis on le nomme). Les actions d'administration
// exigent en plus la MFA activée sur ce compte (requireMfa, src/auth.js).
// Le changement prend effet à la requête suivante : le rôle est relu en base à
// chaque requête, celui écrit dans le jeton n'est jamais cru.
import { db } from '../src/db.js';

export async function changerRole(email, role) {
  if (!['admin', 'player'].includes(role)) throw new Error('rôle inconnu : ' + role);
  const { rows } = await db.query(
    `UPDATE users SET role = $2 WHERE email = $1 AND deleted_at IS NULL RETURNING id, totp_enabled`,
    [String(email || '').toLowerCase(), role]);
  if (!rows[0]) return { ok: false, error: 'aucun compte actif avec cette adresse' };
  try {
    await db.query(`INSERT INTO audit_log (user_id, action) VALUES ($1, $2)`,
      [rows[0].id, role === 'admin' ? 'role_admin' : 'role_player']);
  } catch (e) {}
  return { ok: true, id: rows[0].id, mfa: !!rows[0].totp_enabled };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, email] = process.argv.slice(2);
  const role = action === 'nommer' ? 'admin' : action === 'retirer' ? 'player' : null;
  if (!role || !email) {
    console.error('usage : node --env-file=.env scripts/admin.js nommer|retirer <email>');
    process.exit(2);
  }
  changerRole(email, role).then((r) => {
    if (!r.ok) { console.error(r.error); process.exit(1); }
    console.log(role === 'admin'
      ? 'Compte nommé administrateur.' + (r.mfa ? '' : ' Il doit activer la MFA avant toute action d\'administration.')
      : 'Rôle administrateur retiré.');
    return db.end();
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
