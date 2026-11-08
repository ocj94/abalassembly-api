// Rôles particuliers d'un compte — sur le serveur, jamais par une requête HTTP.
//
//   node --env-file=.env scripts/admin.js nommer  <email>   administrateur
//   node --env-file=.env scripts/admin.js calcul  <email>   compte de calcul (exécutants « serveur »)
//   node --env-file=.env scripts/admin.js retirer <email>   redevient un joueur
//
// Remplace BOOTSTRAP_ADMIN_EMAIL : avant, l'inscription avec cette adresse donnait
// le rôle admin à la première personne qui la tapait, sans rien vérifier. Ici, il
// faut un accès à la base du serveur, et le compte doit déjà exister (on s'inscrit
// normalement, puis on est nommé). Les actions d'administration exigent en plus la
// MFA activée sur ce compte (requireMfa, src/auth.js).
//
// Le compte de calcul (v3.18, ordonnanceur) : le compte qu'utilisent les exécutants
// de l'opérateur, par exemple les conteneurs Docker du service `executant` de
// docker-compose.yml. Lui seul (ou un admin) peut brancher un exécutant dans la
// famille « serveur », qui a ainsi son propre interrupteur, séparé des appareils des
// joueurs. Il n'a aucun droit d'administration : un conteneur peut donc se connecter
// par mot de passe, sans code MFA, et une fuite de ce mot de passe ne donne accès
// qu'à des missions de calcul, vérifiées comme toutes les autres.
// Le changement prend effet à la requête suivante : le rôle est relu en base à
// chaque requête, celui écrit dans le jeton n'est jamais cru.
import { db } from '../src/db.js';

export const ROLES = ['player', 'admin', 'calcul'];

export async function changerRole(email, role) {
  if (!ROLES.includes(role)) throw new Error('rôle inconnu : ' + role);
  const { rows } = await db.query(
    `UPDATE users SET role = $2 WHERE email = $1 AND deleted_at IS NULL RETURNING id, totp_enabled`,
    [String(email || '').toLowerCase(), role]);
  if (!rows[0]) return { ok: false, error: 'aucun compte actif avec cette adresse' };
  try {
    await db.query(`INSERT INTO audit_log (user_id, action) VALUES ($1, $2)`, [rows[0].id, 'role_' + role]);
  } catch (e) {}
  return { ok: true, id: rows[0].id, mfa: !!rows[0].totp_enabled };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, email] = process.argv.slice(2);
  const role = { nommer: 'admin', calcul: 'calcul', retirer: 'player' }[action] || null;
  if (!role || !email) {
    console.error('usage : node --env-file=.env scripts/admin.js nommer|calcul|retirer <email>');
    process.exit(2);
  }
  changerRole(email, role).then((r) => {
    if (!r.ok) { console.error(r.error); process.exit(1); }
    console.log({
      admin: 'Compte nommé administrateur.' + (r.mfa ? '' : ' Il doit activer la MFA avant toute action d\'administration.'),
      calcul: 'Compte de calcul : ses exécutants peuvent se brancher dans la famille « serveur ».',
      player: 'Le compte redevient un joueur.'
    }[role]);
    return db.end();
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
