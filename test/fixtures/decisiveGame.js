// Génère des parties LÉGALES via le vrai moteur, pour servir de fixtures aux
// tests du Labo distribué — plutôt que de taper une séquence à la main.
//
// Depuis l'ajout de la vérification stricte de la disposition de départ
// (verifySampleGame compare sampleStart à la position OFFICIELLE exacte de
// la disposition revendiquée), les fixtures partent désormais de la VRAIE
// position complète (14 billes/camp), pas d'un plateau réduit personnalisé.
import { createEngine } from '../../src/engine.js';
import { LAYOUTS, LAYOUT_KEYS, layoutToStart } from '../../src/layouts.js';

function boardFromStart(E, start) {
  const [b, w] = start.split(',');
  const board = {};
  (b.slice(1).match(/[a-i][1-9]/g) || []).forEach(cc => { const p = E.abaproToRc(cc); board[p.r+','+p.c] = 'black'; });
  (w.slice(1).match(/[a-i][1-9]/g) || []).forEach(cc => { const p = E.abaproToRc(cc); board[p.r+','+p.c] = 'white'; });
  return board;
}

// Partie DÉCISIVE (jusqu'à 6 captures) depuis la vraie position complète —
// auto-jeu qui préfère les coups d'éjection ; converge naturellement en
// 30-60 coups (~100ms). Seed pour reproductibilité entre exécutions.
export function playDecisiveGame(layoutKey = 'belgian', seed = 1, maxPlies = 500) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };

  const E = createEngine();
  const start = layoutToStart(E, layoutKey);
  E.setBoard(boardFromStart(E, start));

  const labels = [];
  let color = 'black';
  for (let ply = 0; ply < maxPlies; ply++) {
    const moves = E.getAllMovesForColor(color);
    if (!moves.length) break;
    const ejects = moves.filter(m => m.eject);
    const pool = ejects.length ? ejects : moves;
    const mv = pool[Math.floor(rand() * pool.length)];
    const lab = E.abaproOfficialLabels(mv)[0];
    E.applyMove(mv, color);
    labels.push({ lab, color });
    if (E.capturedByBlack >= 6 || E.capturedByWhite >= 6) break;
    color = color === 'black' ? 'white' : 'black';
  }

  const blackWon = E.capturedByBlack >= 6, whiteWon = E.capturedByWhite >= 6;
  if (!blackWon && !whiteWon) return null; // pas conclu — l'appelant réessaiera avec un autre seed

  let seq = '', n = 1;
  for (let i = 0; i < labels.length; i++) {
    if (i % 2 === 0) seq += (i ? ' ' : '') + n + '.' + labels[i].lab;
    else { seq += ' ' + labels[i].lab; n++; }
  }
  return { layout: layoutKey, start, startColor: 'black', seq, winner: blackWon ? 'candidate' : 'baseline' };
}

export function findDecisiveGame(layoutKey = 'belgian') {
  for (let seed = 1; seed < 50; seed++) {
    const g = playDecisiveGame(layoutKey, seed);
    if (g) return g;
  }
  throw new Error('aucune partie décisive générée après 50 essais (' + layoutKey + ')');
}

// Courte séquence légale (quelques coups, PAS forcément conclue) depuis
// N'IMPORTE LAQUELLE des 5 dispositions — pour les tests qui n'ont pas
// besoin d'une partie complète, seulement d'un échantillon légal authentique.
export function shortLegalSequence(layoutKey, plies = 4) {
  const E = createEngine();
  const start = layoutToStart(E, layoutKey);
  E.setBoard(boardFromStart(E, start));

  const labels = [];
  let color = 'black';
  for (let i = 0; i < plies; i++) {
    const moves = E.getAllMovesForColor(color);
    if (!moves.length) break;
    const mv = moves[0];
    const lab = E.abaproOfficialLabels(mv)[0];
    E.applyMove(mv, color);
    labels.push({ lab, color });
    color = color === 'black' ? 'white' : 'black';
  }
  let seq = '', n = 1;
  for (let i = 0; i < labels.length; i++) {
    if (i % 2 === 0) seq += (i ? ' ' : '') + n + '.' + labels[i].lab;
    else { seq += ' ' + labels[i].lab; n++; }
  }
  return { layout: layoutKey, start, startColor: 'black', seq };
}
