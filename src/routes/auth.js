import { hashPassword, verifyPasswordOuFactice, issueToken, hashIp, requireAuth, tokenTtlSeconds } from '../auth.js';
import { verifierCodeMfa } from '../mfaCode.js';
import { nouveauDefi, verifierPreuve, schemaPreuve } from '../preuve.js';
import { limiteRoute, LIMITE_CONNEXION, LIMITE_INSCRIPTION, echecsConnexion, noterEchecConnexion, effacerEchecsConnexion,
  ECHECS_AVANT_PREUVE, ECHECS_AVANT_BLOCAGE } from '../protection.js';
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
      otp:      { type: 'string', maxLength: 10 },
      preuve:   schemaPreuve
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
  // ─── Défi anti-robot (preuve de travail, src/preuve.js) ───
  app.get('/defi', async () => nouveauDefi());

  // ─── Inscription : preuve de travail toujours, 5 par heure et par adresse ───
  app.post('/signup', { schema: credentialsSchema, config: { rateLimit: limiteRoute(LIMITE_INSCRIPTION, '1 hour') } }, async (req, reply) => {
    const { email, password, username } = req.body;
    const p = await verifierPreuve(req.body.preuve);
    if (!p.ok) return reply.code(400).send({ error: p.error, preuveRequise: true });
    const hash = await hashPassword(password);
    // Toujours 'player'. Avant, l'inscription avec BOOTSTRAP_ADMIN_EMAIL donnait le
    // rôle admin — à quiconque s'inscrivait le premier avec cette adresse, puisque
    // rien ne vérifie qu'on possède l'adresse. Un admin se nomme désormais sur le
    // serveur lui-même : scripts/admin.js.
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, username, role)
         VALUES ($1, $2, $3, 'player')
         RETURNING id, username, email, country, role`,
        [email.toLowerCase(), hash, username || email.split('@')[0]]
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
  app.post('/login', { schema: credentialsSchema, config: { rateLimit: limiteRoute(LIMITE_CONNEXION, '1 minute') } }, async (req, reply) => {
    const { email, password } = req.body;
    // mots de passe faux pour cette adresse : preuve de travail, puis blocage (src/protection.js)
    const echecs = await echecsConnexion(email);
    if (echecs >= ECHECS_AVANT_BLOCAGE)
      return reply.code(429).send({ error: 'trop de mots de passe faux pour ce compte : réessayer dans 15 minutes' });
    if (echecs >= ECHECS_AVANT_PREUVE) {
      const p = await verifierPreuve(req.body.preuve);
      if (!p.ok) return reply.code(401).send({ error: p.error, preuveRequise: true });
    }
    const { rows } = await db.query(
      `SELECT id, username, email, password_hash, country, role, totp_secret, totp_enabled
       FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );
    const u = rows[0];
    // Message identique que l'email existe ou non → aucune fuite d'information
    if (!(await verifyPasswordOuFactice(u && u.password_hash, password))) {
      const n = await noterEchecConnexion(email);
      if (u) await audit(u.id, 'login_fail', req);
      return reply.code(401).send(Object.assign({ error: 'identifiants invalides' }, n >= ECHECS_AVANT_PREUVE ? { preuveRequise: true } : {}));
    }
    // MFA : si activée, un code TOTP valide est requis
    if (u.totp_enabled) {
      const otp = req.body.otp;
      if (!otp) return reply.code(401).send({ error: 'code MFA requis', mfaRequired: true });
      const v = await verifierCodeMfa(u.id, u.totp_secret, otp);
      if (!v.ok) {
        await audit(u.id, 'login_mfa_fail', req);
        return reply.code(v.code).send({ error: v.error, mfaRequired: true });
      }
    }
    await effacerEchecsConnexion(email);
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
