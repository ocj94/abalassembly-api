import net from 'node:net';
import crypto from 'node:crypto';
import { redis } from './redis.js';

/* Protections contre les robots : limites de débit et mots de passe faux.

   1. La clé d'une adresse (cleIp). Une connexion IPv6 reçoit en général tout un
      bloc /64, soit 2^64 adresses : compter adresse par adresse laissait un seul
      abonné en changer à chaque requête et ne jamais atteindre la limite. On
      compte donc par bloc /64 en IPv6, par adresse en IPv4 (y compris une IPv4
      écrite à la manière IPv6, ::ffff:1.2.3.4).

   2. Des limites propres aux routes sensibles, en plus de la limite générale
      (100 requêtes par minute) : connexion 10 par minute, inscription 5 par heure.
      Un mot de passe essayé coûte un calcul argon2 au serveur : sans limite propre,
      quelques adresses suffisaient à l'occuper entièrement.

   3. Les mots de passe faux par compte (compteur Redis, 15 minutes) : la limite
      par adresse ne freine pas une attaque répartie sur beaucoup d'adresses contre
      un seul compte. Après 3 échecs, la connexion à ce compte exige une preuve de
      travail (src/preuve.js) ; après 10, elle est refusée 15 minutes, même avec le
      bon mot de passe. Le compteur porte sur l'adresse email tapée, que le compte
      existe ou non (rien à apprendre en le regardant), et Redis n'en garde qu'un
      condensé. Une connexion réussie le remet à zéro.

   Les sessions déjà ouvertes ne sont pas touchées : un joueur dont quelqu'un
   essaie le mot de passe continue de jouer sur ses appareils. */

export function cleIp(ip) {
  let a = String(ip || '');
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (m) a = m[1];
  if (!net.isIPv6(a)) return a;
  // développer l'adresse (les « :: ») pour garder ses 4 premiers groupes
  const [tete, queue = ''] = a.split('::');
  const g1 = tete ? tete.split(':') : [], g2 = queue ? queue.split(':') : [];
  const groupes = a.includes('::') ? [...g1, ...Array(8 - g1.length - g2.length).fill('0'), ...g2] : g1;
  return groupes.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

// limite d'une route sensible (les tests, qui envoient tout depuis 127.0.0.1, la relèvent)
export function limiteRoute(max, fenetre) {
  return { max: Number(process.env.RATE_LIMIT_AUTH_MAX_TEST_OVERRIDE) || max, timeWindow: fenetre, keyGenerator: (req) => cleIp(req.ip) };
}
export const LIMITE_CONNEXION = 10;    // par minute et par adresse (ou bloc /64)
export const LIMITE_INSCRIPTION = 5;   // par heure et par adresse

export const ECHECS_AVANT_PREUVE = 3;
export const ECHECS_AVANT_BLOCAGE = 10;
export const ECHECS_DUREE_S = 15 * 60;
const cleEchecs = (email) => 'connexion:echecs:' + crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 32);

export async function echecsConnexion(email) {
  try { return Number(await redis.get(cleEchecs(email))) || 0; } catch (e) { return 0; }
}
export async function noterEchecConnexion(email) {
  try {
    const k = cleEchecs(email), n = await redis.incr(k);
    if (n === 1) await redis.expire(k, ECHECS_DUREE_S);
    return n;
  } catch (e) { return 0; }
}
export async function effacerEchecsConnexion(email) {
  try { await redis.del(cleEchecs(email)); } catch (e) {}
}
