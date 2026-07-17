/**
 * EXPÉRIENCE ISOLÉE — jamais utilisée en production. Alternative au moteur
 * réel (src/engine.js) : plateau en tableau plat (Int8Array, 61 cases) avec
 * table de voisins précalculée, au lieu d'un objet à clés texte reconstruites
 * à chaque accès. Pas de BigInt — les bitboards purs en JS ont un coût
 * d'allocation qui peut annuler le gain ; ceci teste l'optimisation la plus
 * simple et la plus sûre en JS avant d'aller plus loin.
 *
 * Doit produire EXACTEMENT les mêmes coups légaux que src/engine.js — voir
 * src/experiments/benchmark.js pour la vérification de correction ET la
 * mesure de vitesse, l'une ne va jamais sans l'autre.
 */
import { createEngine } from '../engine.js';

const ROWS = [5,6,7,8,9,8,7,6,5];
const AX_DIRS = [{q:1,r:0},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1},{q:0,r:1},{q:-1,r:1}];

// Index linéaire 0..60 pour chaque case (r,c) — calculé une seule fois, au
// chargement du module, jamais recalculé pendant la recherche.
const RC_TO_IDX = {};
const IDX_TO_RC = [];
{
  let idx = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < ROWS[r]; c++) { RC_TO_IDX[r+','+c] = idx; IDX_TO_RC.push({r,c}); idx++; }
}
const N = IDX_TO_RC.length; // 61

// Table de voisins précalculée : NEIGH[idx][dirIndex] = index voisin ou -1.
// Dérivée des VRAIES fonctions axiales du moteur réel (source de vérité
// unique) — jamais réinventée à la main, pour garantir l'alignement.
function buildNeighborTable() {
  const E = createEngine();
  const table = [];
  for (let idx = 0; idx < N; idx++) {
    const { r, c } = IDX_TO_RC[idx];
    const row = [];
    for (const d of AX_DIRS) {
      const ax = E.rcToAxial ? E.rcToAxial(r, c) : rcToAxialLocal(r, c);
      const nb = E.axialToRc ? E.axialToRc(ax.q + d.q, ax.r + d.r) : axialToRcLocal(ax.q + d.q, ax.r + d.r);
      row.push(nb ? RC_TO_IDX[nb.r+','+nb.c] : -1);
    }
    table.push(row);
  }
  return table;
}
// Repli local (identique à src/engine.js) si jamais rcToAxial/axialToRc ne
// sont pas exposés par une version antérieure du moteur.
function rcToAxialLocal(row, col) { return { q: row<=4?col-row:col-4, r: row-4 }; }
function axialToRcLocal(q, rAx) {
  const row = rAx + 4; if (row < 0 || row > 8) return null;
  const col = row<=4 ? q+row : q+4; if (col < 0 || col >= ROWS[row]) return null;
  return { r: row, c: col };
}
const NEIGH = buildNeighborTable();

export function boardObjToFlat(boardObj) {
  const flat = new Int8Array(N); // 0=vide, 1=noir, 2=blanc
  for (const key in boardObj) {
    const idx = RC_TO_IDX[key];
    if (idx === undefined) continue;
    flat[idx] = boardObj[key] === 'black' ? 1 : 2;
  }
  return flat;
}
export function flatToBoardObj(flat) {
  const obj = {};
  for (let i = 0; i < N; i++) {
    if (flat[i] === 1) obj[IDX_TO_RC[i].r+','+IDX_TO_RC[i].c] = 'black';
    else if (flat[i] === 2) obj[IDX_TO_RC[i].r+','+IDX_TO_RC[i].c] = 'white';
  }
  return obj;
}

// Génère tous les coups légaux — MÊMES RÈGLES que getAllMovesForColor du
// moteur réel (colonnes de 1-3, sumito, poussée en ligne et en éventail),
// mais toute case testée passe par un INDEX DE TABLEAU, jamais une chaîne.
export function fastGetAllMovesForColor(flat, colorCode) {
  const oppCode = colorCode === 1 ? 2 : 1;
  const pieces = [];
  for (let i = 0; i < N; i++) if (flat[i] === colorCode) pieces.push(i);

  const groups = [];
  pieces.forEach(idx => groups.push([idx]));
  pieces.forEach(idx => {
    for (let d = 0; d < 6; d++) {
      const n1 = NEIGH[idx][d];
      if (n1 >= 0 && flat[n1] === colorCode) {
        groups.push([idx, n1]);
        const n2 = NEIGH[n1][d];
        if (n2 >= 0 && flat[n2] === colorCode) groups.push([idx, n1, n2]);
      }
    }
  });

  const moves = [];
  const seen = new Set();
  for (const cells of groups) {
    for (let d = 0; d < 6; d++) {
      const info = validateMoveFast(flat, cells, d, colorCode, oppCode);
      if (!info.valid) continue;
      const ck = cells.slice().sort((a,b)=>a-b).join('|') + '>' + d;
      if (seen.has(ck)) continue;
      seen.add(ck);
      moves.push({ cells: cells.slice(), dirIdx: d, info, eject: !!(info.type==='push' && info.ejection) });
    }
  }
  return moves;
}

// Aligné une-à-une sur validateMove du moteur réel (src/engine.js) — même
// séquence de conditions, juste des index de tableau au lieu de clés texte.
function validateMoveFast(flat, cells, dirIdx, me, opp) {
  // colonne : cells doivent être alignées le long d'UNE direction (parmi les 6)
  let lineDir = null;
  if (cells.length > 1) {
    for (let dd = 0; dd < 6; dd++) {
      const sorted = orderAlong(cells, dd);
      if (!sorted) continue;
      let ok = true;
      for (let i = 1; i < sorted.length; i++) if (NEIGH[sorted[i-1]][dd] !== sorted[i]) { ok = false; break; }
      if (ok) { lineDir = dd; break; }
    }
    if (lineDir === null) return { valid: false };
  }
  const isInline = cells.length === 1 || dirIdx === lineDir || isOpposite(dirIdx, lineDir);

  if (isInline) {
    const sorted = orderAlong(cells, dirIdx);
    const head = sorted[sorted.length - 1];
    const front = NEIGH[head][dirIdx];
    if (front < 0) return { valid: false };
    const frontVal = flat[front];
    if (!frontVal) return { valid: true, type: 'move', frontChain: [] };
    if (frontVal === me) return { valid: false };
    let oppCount = 0, cur = front;
    const chain = [];
    while (cur >= 0 && flat[cur] === opp) { chain.push(cur); oppCount++; cur = NEIGH[cur][dirIdx]; }
    if (oppCount >= cells.length) return { valid: false };
    const ejection = cur < 0; // poussé hors plateau = capture
    if (!ejection && flat[cur] !== 0) return { valid: false }; // case d'atterrissage occupée (ma propre couleur) → poussée bloquée
    return { valid: true, type: 'push', ejection, push: oppCount, chain, dirIdx, headAfterIdx: cur };
  } else {
    // coup latéral (broadside) : chaque case de la colonne doit avoir sa case
    // cible (même direction) libre — jamais de poussée en éventail.
    for (const c of cells) {
      const t = NEIGH[c][dirIdx];
      if (t < 0 || flat[t]) return { valid: false };
    }
    return { valid: true, type: 'broadside' };
  }
}
function orderAlong(cells, dirIdx) {
  // trie les cases dans l'ordre de la ligne, en repartant de celle qui n'a
  // pas de voisin "amont" dans cells selon dirIdx (direction opposée).
  // Vérifie à CHAQUE étape que le voisin suivant appartient bien à l'ensemble
  // d'origine — sinon la direction candidate n'est pas la bonne, ce qui
  // arrive normalement (validateMoveFast teste les 6 directions).
  const oppDir = OPP_DIR[dirIdx];
  const set = new Set(cells);
  const starts = cells.filter(c => !set.has(NEIGH[c][oppDir]));
  if (starts.length !== 1) return null; // pas une ligne valide dans cette direction
  const ordered = [starts[0]];
  let cur = starts[0];
  while (ordered.length < cells.length) {
    cur = NEIGH[cur][dirIdx];
    if (cur < 0 || !set.has(cur)) return null; // sorti du plateau OU hors de l'ensemble d'origine
    ordered.push(cur);
  }
  return ordered;
}
// Calculé PROGRAMMATIQUEMENT depuis AX_DIRS (jamais à la main — une
// constante géométrique mal recopiée est exactement le genre d'erreur que
// cette vérification est censée éviter).
const OPP_DIR = AX_DIRS.map(d => AX_DIRS.findIndex(d2 => d2.q === -d.q && d2.r === -d.r));
function isOpposite(a, b) { return OPP_DIR[a] === b; }

export function fastApplyMove(flat, move, colorCode) {
  const oppCode = colorCode === 1 ? 2 : 1;
  const undo = [];
  const rec = (idx) => undo.push([idx, flat[idx]]);
  if (move.info.type === 'push') {
    move.info.chain.forEach(idx => rec(idx));
    for (let i = move.info.chain.length - 1; i >= 0; i--) {
      const dest = NEIGH[move.info.chain[i]][move.dirIdx];
      if (dest >= 0) { rec(dest); flat[dest] = oppCode; }
    }
  }
  const sorted = orderAlong(move.cells, move.dirIdx).reverse(); // tête d'abord pour ne pas s'écraser
  sorted.forEach(idx => rec(idx));
  sorted.forEach(idx => { flat[idx] = 0; });
  sorted.forEach(idx => { const d = NEIGH[idx][move.dirIdx]; if (d >= 0) flat[d] = colorCode; });
  return { undo, ejected: move.info.type==='push' && move.info.ejection };
}
export function fastUndoMove(flat, undo) {
  for (const [idx, val] of undo.undo) flat[idx] = val;
}

export { N, RC_TO_IDX, IDX_TO_RC, NEIGH };
