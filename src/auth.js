import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { isTokenRevoked } from './redis.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const TOKEN_TTL = '7d';
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

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
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}
export function tokenTtlSeconds() { return TOKEN_TTL_SECONDS; }

// ─── Hachage d'IP pour l'audit (jamais d'IP en clair) ───
export function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '') + SECRET).digest('hex').slice(0, 32);
}

// ─── Middleware : exige un jeton valide et non révoqué ───
export async function requireAuth(req, reply) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'non authentifié' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return reply.code(401).send({ error: 'jeton invalide ou expiré' });
  }
  if (payload.jti && (await isTokenRevoked(payload.jti))) {
    return reply.code(401).send({ error: 'session révoquée' });
  }
  req.user = payload; // { sub, name, role, jti }
}

// ─── Middleware RBAC : exige un rôle précis (ex. 'admin') ───
export function requireRole(role) {
  return async function (req, reply) {
    if (!req.user) return reply.code(401).send({ error: 'non authentifié' });
    if (req.user.role !== role) return reply.code(403).send({ error: 'accès refusé (rôle insuffisant)' });
  };
}
