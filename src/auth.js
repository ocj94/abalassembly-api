import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { isTokenRevoked } from './redis.js';
import { db } from './db.js';

const TOKEN_TTL = '7d';
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

// ─── Secret de signature des jetons : obligatoire ───
// Avant, un serveur lancé sans JWT_SECRET démarrait quand même, avec un secret
// écrit en clair dans ce dépôt public : n'importe qui pouvait fabriquer un jeton
// valide pour n'importe quel compte, admin compris. Désormais, pas de secret
// (ou un secret d'exemple, ou trop court) = pas de démarrage.
const SECRETS_CONNUS = [
  'dev-only-insecure-secret-change-me',   // l'ancien secret par défaut, public
  'CHANGE_ME_32_bytes_hex_minimum'        // la valeur d'exemple de .env.example
];
export const JWT_SECRET_MIN = 32;
export function jwtSecret() {
  const s = process.env.JWT_SECRET || '';
  if (s.length < JWT_SECRET_MIN || SECRETS_CONNUS.includes(s)) {
    throw new Error('JWT_SECRET absent, trop court (moins de ' + JWT_SECRET_MIN +
      ' caractères) ou laissé à sa valeur d\'exemple : le serveur refuse de démarrer. ' +
      'Générer un secret avec : openssl rand -hex 32');
  }
  return s;
}

// ─── Mots de passe : argon2id (recommandation OWASP) ───
export function hashPassword(plain) {
  return argon2.hash(plain, { type: argon2.argon2id });
}
export function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain).catch(() => false);
}

// ─── Jetons JWT signés, avec identifiant unique (jti) pour la révocation ───
export function issueToken(user) {
  const jti = crypto.randomUUID();
  return jwt.sign(
    { sub: user.id, name: user.username, role: user.role || 'player', jti },
    jwtSecret(),
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' }
  );
}
export function tokenTtlSeconds() { return TOKEN_TTL_SECONDS; }

// ─── Hachage d'IP pour l'audit (jamais d'IP en clair) ───
export function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '') + jwtSecret()).digest('hex').slice(0, 32);
}

// ─── Middleware : exige un jeton valide, non révoqué, d'un compte qui existe ───
// Le compte est relu en base à chaque requête : un compte supprimé (RGPD) ne
// garde aucune session ouverte, sur aucun appareil, et un rôle retiré prend
// effet tout de suite — le rôle écrit dans le jeton n'est jamais cru tel quel.
export async function requireAuth(req, reply) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'non authentifié' });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  } catch {
    return reply.code(401).send({ error: 'jeton invalide ou expiré' });
  }
  if (!payload.jti || (await isTokenRevoked(payload.jti))) {
    return reply.code(401).send({ error: 'session révoquée' });
  }
  const { rows } = await db.query(
    `SELECT role, totp_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`, [payload.sub]);
  if (!rows[0]) return reply.code(401).send({ error: 'compte supprimé' });
  req.user = { ...payload, role: rows[0].role, mfa: !!rows[0].totp_enabled }; // { sub, name, role, jti, mfa }
}

// ─── Middleware RBAC : exige un rôle précis (ex. 'admin') ───
export function requireRole(role) {
  return async function (req, reply) {
    if (!req.user) return reply.code(401).send({ error: 'non authentifié' });
    if (req.user.role !== role) return reply.code(403).send({ error: 'accès refusé (rôle insuffisant)' });
  };
}

// ─── Middleware : une action d'administration exige la MFA activée ───
export async function requireMfa(req, reply) {
  if (!req.user) return reply.code(401).send({ error: 'non authentifié' });
  if (!req.user.mfa) return reply.code(403).send({ error: 'MFA obligatoire pour cette action : l\'activer d\'abord (/mfa/setup puis /mfa/enable)' });
}
