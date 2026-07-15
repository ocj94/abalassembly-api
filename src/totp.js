import crypto from 'node:crypto';

// TOTP (RFC 6238) implémenté avec la crypto native de Node — aucune dépendance externe.
// Base32 pour la compatibilité avec Google Authenticator / Aegis / etc.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s) {
  s = s.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const c of s) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Code TOTP à un instant donné (par défaut : maintenant), fenêtre de 30 s, 6 chiffres.
export function totpCode(secret, forTime = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(forTime / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Vérifie un code en tolérant ±1 fenêtre (décalage d'horloge). Comparaison à temps constant.
export function verifyTotp(secret, token, step = 30, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, '');
  for (let w = -window; w <= window; w++) {
    const expected = totpCode(secret, Date.now() + w * step * 1000, step);
    if (expected.length === clean.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

// URI otpauth:// pour le QR code (à afficher côté admin lors de l'activation).
export function otpauthUri(secret, account, issuer = 'Abalassembly') {
  const label = encodeURIComponent(issuer + ':' + account);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
