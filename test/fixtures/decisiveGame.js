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

function seqDe(labels) {
  let seq = '', n = 1;
  for (let i = 0; i < labels.length; i++) {
    if (i % 2 === 0) seq += (i ? ' ' : '') + n + '.' + labels[i].lab;
    else { seq += ' ' + labels[i].lab; n++; }
  }
  return seq;
}

// Partie DÉCISIVE depuis la vraie position complète, arrêtée comme le Labo du jeu
// l'arrête (et comme le serveur l'exige depuis l'audit de novembre 2026) : à 6
// billes sorties ou à 3 billes d'avance, dans la limite de 80 demi-coups. Auto-jeu
// qui préfère les coups d'éjection. Seed pour reproductibilité entre exécutions.
export function playDecisiveGame(layoutKey = 'belgian', seed = 1, maxPlies = 80) {
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
    const ecart = E.capturedByBlack - E.capturedByWhite;
    if (E.capturedByBlack >= 6 || E.capturedByWhite >= 6 || Math.abs(ecart) >= 3) break;
    color = color === 'black' ? 'white' : 'black';
  }

  const ecart = E.capturedByBlack - E.capturedByWhite;
  const finie = E.capturedByBlack >= 6 || E.capturedByWhite >= 6 || Math.abs(ecart) >= 3;
  if (!finie || ecart === 0) return null; // pas conclu — l'appelant réessaiera avec un autre seed
  // 'candidate' = Noir a gagné (le candidat joue Noir par défaut)
  return { layout: layoutKey, start, startColor: 'black', seq: seqDe(labels), plies: labels.length, winner: ecart > 0 ? 'candidate' : 'baseline' };
}

// Partie qui va jusqu'à la limite du Labo (80 demi-coups) sans qu'aucune bille ne
// sorte : une nulle conclue, que le serveur compte. Coups sans éjection, pris dans
// un ordre qui dépend de seed (des parties différentes pour des tests différents).
export function playLimitDraw(layoutKey = 'belgian', seed = 0, plies = 80) {
  const E = createEngine();
  const start = layoutToStart(E, layoutKey);
  E.setBoard(boardFromStart(E, start));
  const labels = [];
  let color = 'black';
  for (let i = 0; i < plies; i++) {
    const moves = E.getAllMovesForColor(color).filter(m => !m.eject);
    if (!moves.length) return null;
    const mv = moves[(seed + i * 7) % moves.length];
    labels.push({ lab: E.abaproOfficialLabels(mv)[0], color });
    E.applyMove(mv, color);
    if (E.capturedByBlack || E.capturedByWhite) return null;
    color = color === 'black' ? 'white' : 'black';
  }
  return { layout: layoutKey, start, startColor: 'black', seq: seqDe(labels), plies: labels.length, winner: 'draw' };
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
  return { layout: layoutKey, start, startColor: 'black', seq: seqDe(labels) };
}

// La même partie, plus UN coup légal joué après sa fin — que le serveur doit refuser.
export function withExtraMove(game) {
  const E = createEngine();
  E.setBoard(boardFromStart(E, game.start));
  const tokens = game.seq.replace(/\d+\./g, ' ').trim().split(/\s+/);
  let color = 'black';
  for (const tok of tokens) { E.applyMove(E.resolveAbaProToken(tok, color), color); color = color === 'black' ? 'white' : 'black'; }
  const mv = E.getAllMovesForColor(color)[0];
  return { ...game, seq: game.seq + ' ' + E.abaproOfficialLabels(mv)[0] };
}
