import { db } from './db.js';
import { redis } from './redis.js';
import { totpStep } from './totp.js';

/* Vérification d'un code MFA par les routes (connexion, activation, désactivation).
   Trois protections, absentes avant :
   - un code ne sert qu'une fois : la fenêtre de 30 s acceptée est retenue
     (users.totp_last_step), un code de cette fenêtre ou d'une plus ancienne est
     refusé — même deux requêtes simultanées avec le même code : la mise à jour
     est conditionnelle, une seule passe ;
   - 5 codes faux de suite bloquent le compte 15 minutes pour la MFA. Avant, seule
     la limite de débit par adresse freinait l'essai des 10^6 codes, et elle se
     contournait (voir trustProxy dans src/server.js) ;
   - un code juste remet le compteur à zéro.
   Renvoie { ok: true } ou { ok: false, code: 401 | 429, error }. */
export const MFA_ESSAIS_MAX = 5;
export const MFA_BLOCAGE_S = 15 * 60;
const cle = (uid) => 'mfa:echecs:' + uid;

async function echecs(uid) {
  try { return Number(await redis.get(cle(uid))) || 0; } catch (e) { return 0; }
}
async function noterEchec(uid) {
  try { const n = await redis.incr(cle(uid)); if (n === 1) await redis.expire(cle(uid), MFA_BLOCAGE_S); } catch (e) {}
}

export async function verifierCodeMfa(uid, secret, otp) {
  if ((await echecs(uid)) >= MFA_ESSAIS_MAX) {
    return { ok: false, code: 429, error: 'trop de codes MFA faux : réessayer dans 15 minutes' };
  }
  const step = totpStep(secret, otp);
  if (step === null) {
    await noterEchec(uid);
    return { ok: false, code: 401, error: 'code MFA invalide' };
  }
  const { rowCount } = await db.query(
    `UPDATE users SET totp_last_step = $2
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [uid, step]);
  if (!rowCount) {
    await noterEchec(uid);
    return { ok: false, code: 401, error: 'code MFA déjà utilisé : attendre le suivant' };
  }
  try { await redis.del(cle(uid)); } catch (e) {}
  return { ok: true };
}
