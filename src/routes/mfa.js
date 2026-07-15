import { requireAuth } from '../auth.js';
import { generateSecret, otpauthUri, verifyTotp } from '../totp.js';
import { db } from '../db.js';

// Gestion du MFA (TOTP). Toutes les routes exigent d'être authentifié.
// Recommandé pour tous les comptes, obligatoire en pratique pour les admins.
export default async function (app) {
  app.addHook('preHandler', requireAuth);

  // Étape 1 : générer un secret et l'URI otpauth (à scanner dans l'app d'authentification).
  // Le secret est stocké mais MFA reste désactivée tant que /enable n'a pas validé un code.
  app.post('/setup', async (req) => {
    const secret = generateSecret();
    await db.query(`UPDATE users SET totp_secret = $2, totp_enabled = false WHERE id = $1`,
      [req.user.sub, secret]);
    const { rows } = await db.query(`SELECT email FROM users WHERE id = $1`, [req.user.sub]);
    const account = (rows[0] && rows[0].email) || req.user.name || 'compte';
    return { secret, otpauth: otpauthUri(secret, account) };
  });

  // Étape 2 : confirmer avec un premier code → active la MFA.
  app.post('/enable', {
    schema: { body: { type: 'object', required: ['otp'], properties: { otp: { type: 'string', maxLength: 10 } } } }
  }, async (req, reply) => {
    const { rows } = await db.query(`SELECT totp_secret FROM users WHERE id = $1`, [req.user.sub]);
    const secret = rows[0] && rows[0].totp_secret;
    if (!secret) return reply.code(400).send({ error: 'aucun secret : appeler /mfa/setup d\'abord' });
    if (!verifyTotp(secret, req.body.otp)) return reply.code(401).send({ error: 'code invalide' });
    await db.query(`UPDATE users SET totp_enabled = true WHERE id = $1`, [req.user.sub]);
    return { ok: true, enabled: true };
  });

  // Désactiver la MFA (exige un code valide pour éviter un désactivation abusive).
  app.post('/disable', {
    schema: { body: { type: 'object', required: ['otp'], properties: { otp: { type: 'string', maxLength: 10 } } } }
  }, async (req, reply) => {
    const { rows } = await db.query(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [req.user.sub]);
    const u = rows[0];
    if (!u || !u.totp_enabled) return { ok: true, enabled: false };
    if (!verifyTotp(u.totp_secret, req.body.otp)) return reply.code(401).send({ error: 'code invalide' });
    await db.query(`UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1`, [req.user.sub]);
    return { ok: true, enabled: false };
  });

  // État MFA du compte courant
  app.get('/status', async (req) => {
    const { rows } = await db.query(`SELECT totp_enabled FROM users WHERE id = $1`, [req.user.sub]);
    return { enabled: !!(rows[0] && rows[0].totp_enabled) };
  });
}
