import crypto from 'node:crypto';
import { redis } from './redis.js';
import { jwtSecret } from './auth.js';
import { bitsNuls, resoudreDefi } from './preuveClient.js';
export { bitsNuls, resoudreDefi };

/* Preuve de travail : le « captcha » d'Abalassembly, sans tiers ni cookie.

   Le serveur donne un défi signé (GET /auth/defi) ; le navigateur cherche un
   nombre `nonce` tel que SHA-256(sel + ':' + nonce) commence par `bits` bits nuls
   (2^bits essais en moyenne ; 17 bits par défaut, PREUVE_BITS : 0,3 s sur un
   ordinateur, une seconde environ sur un téléphone), puis le joint à sa requête. Rien à cliquer, rien à charger d'un autre site : le calcul tient dans le
   fichier du jeu, qui reste utilisable hors ligne.

   Ce que ça arrête : la création de comptes en masse et les essais de mots de passe
   en rafale, qui coûtent désormais une seconde de calcul chacun au lieu de rien.
   Ce que ça n'arrête pas : quelqu'un de déterminé qui y met le temps. C'est un
   complément des limites de débit (src/protection.js), pas un remplaçant.

   Demandée à l'inscription toujours, et à la connexion seulement après quelques
   mots de passe faux pour ce compte : un joueur normal ne la voit jamais.

   Le défi : base64url(JSON {s: sel, e: expiration ms, b: bits}) + '.' + HMAC.
   - signé (clé dérivée de JWT_SECRET) : on ne peut ni l'inventer ni baisser `b` ;
   - valable 5 minutes ;
   - à usage unique : son sel est retenu dans Redis jusqu'à expiration. */

export const PREUVE_DUREE_MS = 5 * 60 * 1000;
export const preuveBits = () => Math.max(1, Math.min(26, Number(process.env.PREUVE_BITS) || 17));

const cle = () => crypto.createHmac('sha256', jwtSecret()).update('abalassembly:preuve-de-travail').digest();
const signer = (charge) => crypto.createHmac('sha256', cle()).update(charge).digest('base64url');

export function nouveauDefi() {
  const bits = preuveBits();
  const charge = Buffer.from(JSON.stringify({ s: crypto.randomBytes(16).toString('hex'), e: Date.now() + PREUVE_DUREE_MS, b: bits })).toString('base64url');
  return { defi: charge + '.' + signer(charge), bits, algorithme: 'SHA-256', expireDansS: PREUVE_DUREE_MS / 1000 };
}

// { ok: true } ou { ok: false, error } — consomme le défi s'il est bon
export async function verifierPreuve(preuve) {
  if (!preuve || typeof preuve.defi !== 'string' || !Number.isSafeInteger(preuve.nonce) || preuve.nonce < 0)
    return { ok: false, error: 'preuve anti-robot manquante' };
  const [charge, sig] = preuve.defi.split('.');
  if (!charge || !sig) return { ok: false, error: 'preuve anti-robot invalide' };
  const attendu = Buffer.from(signer(charge)), recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) return { ok: false, error: 'preuve anti-robot invalide' };
  let d; try { d = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')); } catch (e) { return { ok: false, error: 'preuve anti-robot invalide' }; }
  if (!d || typeof d.s !== 'string' || !(d.e > Date.now())) return { ok: false, error: 'preuve anti-robot expirée : recommencer' };
  // un défi signé avant un relèvement de PREUVE_BITS reste valable jusqu'à son expiration (5 min)
  const condense = crypto.createHash('sha256').update(d.s + ':' + preuve.nonce).digest();
  if (bitsNuls(condense) < d.b) return { ok: false, error: 'preuve anti-robot invalide' };
  // usage unique ; si Redis est injoignable, on refuse plutôt que d'accepter un rejeu
  try {
    const neuf = await redis.set('preuve:' + d.s, '1', 'PX', Math.max(1000, d.e - Date.now()), 'NX');
    if (neuf !== 'OK') return { ok: false, error: 'preuve anti-robot déjà utilisée : recommencer' };
  } catch (e) { return { ok: false, error: 'vérification anti-robot indisponible, réessayer' }; }
  return { ok: true };
}

export const schemaPreuve = {
  type: 'object', required: ['defi', 'nonce'], additionalProperties: false,
  properties: { defi: { type: 'string', maxLength: 400 }, nonce: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }
};
