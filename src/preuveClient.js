import crypto from 'node:crypto';

// La partie « client » de la preuve de travail (src/preuve.js), sans rien du serveur
// (ni Redis, ni base, ni secret) : l'exécutant et l'essai Docker l'importent seule.
// Le jeu en a sa propre copie en JavaScript de navigateur (src/main/01-backend-api-layer.js).

// nombre de bits nuls en tête d'un condensé
export function bitsNuls(buf) {
  let n = 0;
  for (const o of buf) { if (o === 0) { n += 8; continue; } return n + Math.clz32(o) - 24; }
  return n;
}

// trouve le nonce d'un défi : SHA-256(sel + ':' + nonce) commence par `b` bits nuls
export function resoudreDefi(defi) {
  const d = JSON.parse(Buffer.from(defi.split('.')[0], 'base64url').toString('utf8'));
  for (let nonce = 0; ; nonce++) {
    if (bitsNuls(crypto.createHash('sha256').update(d.s + ':' + nonce).digest()) >= d.b) return { defi, nonce };
  }
}
