import { hashPassword, verifyPassword, issueToken, hashIp, requireAuth, tokenTtlSeconds } from '../auth.js';
import { verifyTotp } from '../totp.js';
import { revokeToken } from '../redis.js';
import { db } from '../db.js';

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email:    { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
      username: { type: 'string', minLength: 3, maxLength: 24 },
      otp:      { type: 'string', maxLength: 10 }
    }
  }
};

async function audit(userId, action, req) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, ip_hash) VALUES ($1, $2, $3)`,
      [userId, action, hashIp(req.ip)]
    );
  } catch (e) { /* l'audit ne doit jamais casser la requête */ }
}

export default async function (app) {
  // ─── Inscription ───
  app.post('/signup', { schema: credentialsSchema }, async (req, reply) => {
    const { email, password, username } = req.body;
    const hash = await hashPassword(password);
    // Le tout premier compte (ou l'email bootstrap) reçoit le rôle admin
    const bootstrap = process.env.BOOTSTRAP_ADMIN_EMAIL || '';
    const role = (bootstrap && email.toLowerCase() === bootstrap.toLowerCase()) ? 'admin' : 'player';
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, username, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, country, role`,
        [email.toLowerCase(), hash, username || email.split('@')[0], role]
      );
      const user = rows[0];
      await audit(user.id, 'signup', req);
      return { user, token: issueToken(user) };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'email déjà utilisé' });
      throw e;
    }
  });

  // ─── Connexion ───
  app.post('/login', { schema: credentialsSchema }, async (req, reply) => {
    const { email, password } = req.body;
    const { rows } = await db.query(
      `SELECT id, username, email, password_hash, country, role, totp_secret, totp_enabled
       FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );
    const u = rows[0];
    // Message identique que l'email existe ou non → aucune fuite d'information
    if (!u || !(await verifyPassword(u.password_hash, password))) {
      return reply.code(401).send({ error: 'identifiants invalides' });
    }
    // MFA : si activée, un code TOTP valide est requis
    if (u.totp_enabled) {
      const otp = req.body.otp;
      if (!otp) return reply.code(401).send({ error: 'code MFA requis', mfaRequired: true });
      if (!verifyTotp(u.totp_secret, otp)) {
        await audit(u.id, 'login_mfa_fail', req);
        return reply.code(401).send({ error: 'code MFA invalide', mfaRequired: true });
      }
    }
    delete u.password_hash; delete u.totp_secret;
    await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [u.id]);
    await audit(u.id, 'login', req);
    return { user: u, token: issueToken(u) };
  });

  // ─── Déconnexion : révoque le jeton courant ───
  app.post('/logout', { preHandler: requireAuth }, async (req) => {
    if (req.user.jti) await revokeToken(req.user.jti, tokenTtlSeconds());
    await audit(req.user.sub, 'logout', req);
    return { ok: true };
  });
}
