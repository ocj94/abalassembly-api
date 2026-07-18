/**
 * Position de référence (posRef) — forme canonique d'une position parmi ses
 * 12 symétries du plateau hexagonal (6 rotations × 2 avec/sans miroir),
 * idée reprise de KAA (Saab). Deux positions qui semblent différentes mais
 * qui sont des rotations/reflets l'une de l'autre partagent le même posRef.
 *
 * Les deux transformations de base (rotation 60°, miroir) sont vérifiées par
 * calcul dans test/posRef.test.js — jamais des formules recopiées à la main
 * sans preuve de fermeture sur les 61 cases réelles du plateau.
 */
const ROWS = [5,6,7,8,9,8,7,6,5];

function rcToAx(r, c) { return { q: r<=4?c-r:c-4, r: r-4 }; }
function axToRc(q, rAx) {
  const row = rAx + 4; if (row < 0 || row > 8) return null;
  const col = row<=4 ? q+row : q+4; if (col < 0 || col >= ROWS[row]) return null;
  return { r: row, c: col };
}
function rot60(ax) { return { q: -ax.r, r: ax.q + ax.r }; }
function mirror(ax) { return { q: ax.r, r: ax.q }; }

// Les 12 transformations : identité, 5 rotations, miroir, 5 rotations-du-miroir.
function buildTransforms() {
  const transforms = [];
  let cur = ax => ax;
  for (let i = 0; i < 6; i++) {
    const rotations = i;
    transforms.push(ax => { let a = ax; for (let k = 0; k < rotations; k++) a = rot60(a); return a; });
  }
  for (let i = 0; i < 6; i++) {
    const rotations = i;
    transforms.push(ax => { let a = mirror(ax); for (let k = 0; k < rotations; k++) a = rot60(a); return a; });
  }
  return transforms;
}
const TRANSFORMS = buildTransforms();

// Applique une transformation à un plateau entier ({'r,c':'black'|'white'})
// et renvoie null si une case sort du plateau (ne devrait jamais arriver —
// vérifié par clôture dans les tests — mais gardé par sécurité).
function transformBoard(board, transformFn) {
  const out = {};
  for (const key in board) {
    const [r, c] = key.split(',').map(Number);
    const ax = rcToAx(r, c);
    const ax2 = transformFn(ax);
    const rc2 = axToRc(ax2.q, ax2.r);
    if (!rc2) return null;
    out[rc2.r + ',' + rc2.c] = board[key];
  }
  return out;
}

function encodeBoard(board) {
  return Object.keys(board).sort().map(k => k + ':' + board[k][0]).join('|');
}

// Position de référence : parmi les 12 formes, la plus petite au tri
// lexicographique de son encodage — forme canonique unique et déterministe.
export function posRef(board) {
  let best = null;
  for (const t of TRANSFORMS) {
    const transformed = transformBoard(board, t);
    if (!transformed) continue; // ne devrait jamais arriver, cf. tests de clôture
    const enc = encodeBoard(transformed);
    if (best === null || enc < best) best = enc;
  }
  return best;
}

export { TRANSFORMS, transformBoard, rcToAx, axToRc };
