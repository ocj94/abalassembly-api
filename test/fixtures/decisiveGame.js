// Génère une partie COMPLÈTE et LÉGALE (jusqu'à 6 captures) via le vrai
// moteur, pour servir de fixture aux tests du Labo distribué — plutôt que
// de taper une séquence à la main (source d'erreurs, peu représentatif).
//
// Position contrôlée : 6 amas indépendants « 2 Noirs contre 1 Blanc » aux
// 6 coins du plateau — chaque Blanc est isolé exactement sur la case-coin,
// avec 2 Noirs alignés juste derrière lui dans l'axe radial sortant : une
// seule poussée l'éjecte, sans dépendre de l'ordre de résolution des coups.
import { createEngine } from '../../src/engine.js';

const CORNERS = [{r:0,c:0},{r:0,c:4},{r:4,c:8},{r:8,c:4},{r:8,c:0},{r:4,c:0}];

function buildStart(E) {
  const board = {};
  CORNERS.forEach(corner => {
    const axC = E.rcToAxial(corner.r, corner.c);
    // direction radiale sortante = le point de compas le plus proche du vecteur centre→coin
    let best = null, bestDot = -Infinity;
    E.AX_DIRS.forEach(d => {
      const dot = d.q * axC.q + d.r * axC.r;
      if (dot > bestDot) { bestDot = dot; best = d; }
    });
    board[corner.r + ',' + corner.c] = 'white'; // la cible, exactement sur le coin
    // 2 Noirs, en reculant depuis le coin le long de l'axe radial opposé (vers le centre)
    for (const k of [1, 2]) {
      const ax = { q: axC.q - best.q * k, r: axC.r - best.r * k };
      const rc = E.axialToRc(ax.q, ax.r);
      if (!rc) throw new Error('coordonnée hors plateau pour le coin ' + JSON.stringify(corner));
      board[rc.r + ',' + rc.c] = 'black';
    }
  });
  board['4,4'] = 'white'; // bille sacrificielle au centre : Blancs la déplace toujours en priorité,
                           // ne touche donc jamais aux 6 cibles avant leur capture
  E.setBoard(board);
  return board;
}

export function playDecisiveGame() {
  const E = createEngine();
  buildStart(E);

  const CORNER_KEYS = new Set(CORNERS.map(c => c.r + ',' + c.c));
  const labels = [];
  let color = 'black';
  for (let ply = 0; ply < 20; ply++) {
    const moves = E.getAllMovesForColor(color);
    let mv;
    if (color === 'black') {
      mv = moves.find(m => m.eject);
      if (!mv) break;
    } else {
      // la bille sacrificielle est celle qui n'est PLUS sur une case-coin (sa position
      // change à chaque déplacement) — recalculée depuis le plateau courant, jamais figée
      const boardNow = E.getBoard();
      const sacrificeKeys = Object.keys(boardNow).filter(k => boardNow[k] === 'white' && !CORNER_KEYS.has(k));
      mv = moves.find(m => m.cells.length === 1 && sacrificeKeys.includes(m.cells[0].r + ',' + m.cells[0].c)) || moves[0];
      if (!mv) break;
    }
    const lab = E.abaproOfficialLabels(mv)[0];
    if (!lab) throw new Error('aucune étiquette officielle pour le coup: ' + JSON.stringify(mv));
    E.applyMove(mv, color);
    labels.push({ lab, color });
    if (E.capturedByBlack >= 6 || E.capturedByWhite >= 6) break;
    color = color === 'black' ? 'white' : 'black';
  }

  const blackWon = E.capturedByBlack >= 6, whiteWon = E.capturedByWhite >= 6;
  if (!blackWon && !whiteWon) {
    throw new Error('partie non conclue — coups joués: ' + labels.map(l => l.lab).join(' '));
  }

  // Position de départ ré-encodée au format AO (0<cases noires>,0<cases blanches>)
  const boardStart = buildStart(createEngine());
  const blackCells = Object.keys(boardStart).filter(k => boardStart[k] === 'black')
    .map(k => { const [r, c] = k.split(',').map(Number); return E.coordToABAPRO(r, c).toLowerCase(); }).sort().join('');
  const whiteCells = Object.keys(boardStart).filter(k => boardStart[k] === 'white')
    .map(k => { const [r, c] = k.split(',').map(Number); return E.coordToABAPRO(r, c).toLowerCase(); }).sort().join('');
  const start = '0' + blackCells + ',0' + whiteCells;

  let seq = '', n = 1;
  for (let i = 0; i < labels.length; i++) {
    if (i % 2 === 0) seq += (i ? ' ' : '') + n + '.' + labels[i].lab;
    else { seq += ' ' + labels[i].lab; n++; }
  }
  return { start, startColor: 'black', seq, winner: blackWon ? 'candidate' : 'baseline' };
}

export function findDecisiveGame() { return playDecisiveGame(); }
