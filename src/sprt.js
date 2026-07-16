// Miroir exact de _labLLR / _labBounds côté client (voir index.html du dépôt
// Abalassembly, recherche "_labLLR") — même méthodologie que Fishtest
// (test séquentiel de Wald sur le score espéré Elo0 vs Elo1).
export const SPRT_DEFAULTS = { elo0: 0, elo1: 35, alpha: 0.05, beta: 0.05 };

export function sprtLLR(W, D, L, elo0 = SPRT_DEFAULTS.elo0, elo1 = SPRT_DEFAULTS.elo1) {
  const N = W + D + L;
  if (N < 2) return 0;
  const s = (W + 0.5 * D) / N, m2 = (W + 0.25 * D) / N;
  let v = m2 - s * s;
  if (v < 1e-6) v = 1e-6;
  const s0 = 1 / (1 + Math.pow(10, -elo0 / 400));
  const s1 = 1 / (1 + Math.pow(10, -elo1 / 400));
  return (s1 - s0) * (2 * s - s0 - s1) * N / (2 * v);
}

export function sprtBounds(alpha = SPRT_DEFAULTS.alpha, beta = SPRT_DEFAULTS.beta) {
  return { up: Math.log((1 - beta) / alpha), lo: Math.log(beta / (1 - alpha)) };
}
