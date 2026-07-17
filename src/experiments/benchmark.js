/**
 * Vérifie la CORRECTION du moteur expérimental (fastEngine.js) contre le
 * vrai moteur (engine.js) sur des positions diverses, PUIS mesure la vitesse
 * — jamais l'inverse : un moteur plus rapide mais faux ne sert à rien.
 * Expérience isolée, ne touche à aucun fichier de production.
 */
import { createEngine } from '../engine.js';
import { LAYOUTS, LAYOUT_KEYS, layoutToStart } from '../layouts.js';
import { boardObjToFlat, fastGetAllMovesForColor, fastApplyMove, fastUndoMove, IDX_TO_RC } from './fastEngine.js';

const AX_DIRS = [{q:1,r:0},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1},{q:0,r:1},{q:-1,r:1}];

function boardFromStart(E, start) {
  const [b, w] = start.split(',');
  const board = {};
  (b.slice(1).match(/[a-i][1-9]/g)||[]).forEach(cc=>{const p=E.abaproToRc(cc); board[p.r+','+p.c]='black';});
  (w.slice(1).match(/[a-i][1-9]/g)||[]).forEach(cc=>{const p=E.abaproToRc(cc); board[p.r+','+p.c]='white';});
  return board;
}

// Convertit un coup du moteur RÉEL en étiquette canonique (source de vérité).
function realLabel(E, mv) { return E.abaproOfficialLabels(mv)[0]; }
// Convertit un coup du moteur RAPIDE en le MÊME format que le moteur réel
// attend, puis demande au moteur réel LUI-MÊME de l'étiqueter — pas de
// deuxième système d'étiquetage inventé qui pourrait cacher un désaccord.
function fastToRealMoveShape(mv) {
  const cells = mv.cells.map(idx => IDX_TO_RC[idx]);
  const dir = AX_DIRS[mv.dirIdx];
  return { cells, dir, info: { type: mv.info.type } };
}

function generatePositions(seedCount = 30) {
  const E = createEngine();
  const positions = [];
  for (const layout of LAYOUT_KEYS) {
    const start = layoutToStart(E, layout);
    positions.push({ label: layout + ' (départ)', board: boardFromStart(E, start), color: 'black' });
  }
  // positions de milieu/fin de partie par auto-jeu aléatoire (déterministe via seed)
  for (let seed = 1; seed <= seedCount; seed++) {
    let s = seed >>> 0;
    const rand = () => { s = (s*1103515245+12345)>>>0; return s/4294967296; };
    const layout = LAYOUT_KEYS[seed % LAYOUT_KEYS.length];
    const E2 = createEngine();
    E2.setBoard(boardFromStart(E2, layoutToStart(E2, layout)));
    let color = 'black';
    const stopAt = 5 + Math.floor(rand() * 60); // positions variées : ouverture → fin de partie
    for (let ply = 0; ply < stopAt; ply++) {
      const moves = E2.getAllMovesForColor(color);
      if (!moves.length) break;
      const mv = moves[Math.floor(rand() * moves.length)];
      E2.applyMove(mv, color);
      if (E2.capturedByBlack >= 6 || E2.capturedByWhite >= 6) break;
      color = color === 'black' ? 'white' : 'black';
    }
    positions.push({ label: layout + ' +' + stopAt + ' coups (seed ' + seed + ')', board: E2.getBoard(), color });
  }
  return positions;
}

function verifyCorrectness(positions) {
  const E = createEngine();
  let allMatch = true, totalPositions = 0, totalMoveMismatches = 0;

  for (const pos of positions) {
    totalPositions++;
    E.setBoard(JSON.parse(JSON.stringify(pos.board)));
    const colorCode = pos.color === 'black' ? 1 : 2;
    const flat = boardObjToFlat(pos.board);

    const realMoves = E.getAllMovesForColor(pos.color);
    const realLabels = new Set(realMoves.map(mv => realLabel(E, mv)));

    const fastMoves = fastGetAllMovesForColor(flat, colorCode);
    const fastLabels = new Set(fastMoves.map(mv => realLabel(E, fastToRealMoveShape(mv))));

    const onlyReal = [...realLabels].filter(l => !fastLabels.has(l));
    const onlyFast = [...fastLabels].filter(l => !realLabels.has(l));
    if (onlyReal.length || onlyFast.length) {
      allMatch = false;
      totalMoveMismatches += onlyReal.length + onlyFast.length;
      console.log('❌', pos.label, '— manquants dans rapide:', onlyReal.slice(0,5), '| en trop dans rapide:', onlyFast.slice(0,5));
    }
  }
  console.log(allMatch
    ? `✅ CORRECTION : ${totalPositions}/${totalPositions} positions, coups identiques au moteur réel`
    : `❌ CORRECTION ÉCHOUÉE : ${totalMoveMismatches} désaccords sur ${totalPositions} positions`);
  return allMatch;
}

function benchmark(positions, iterations = 2000) {
  const E = createEngine();
  let realTotal = 0, fastTotal = 0;

  for (const pos of positions) {
    const colorCode = pos.color === 'black' ? 1 : 2;
    const flat = boardObjToFlat(pos.board);

    E.setBoard(JSON.parse(JSON.stringify(pos.board)));
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) E.getAllMovesForColor(pos.color);
    const t1 = process.hrtime.bigint();
    realTotal += Number(t1 - t0);

    const t2 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fastGetAllMovesForColor(flat, colorCode);
    const t3 = process.hrtime.bigint();
    fastTotal += Number(t3 - t2);
  }

  const realMs = realTotal / 1e6, fastMs = fastTotal / 1e6;
  console.log(`\nMoteur actuel (objet + clés texte)   : ${realMs.toFixed(1)} ms`);
  console.log(`Moteur expérimental (tableau plat)   : ${fastMs.toFixed(1)} ms`);
  console.log(`Facteur : ${(realMs/fastMs).toFixed(2)}×`);
}

const positions = generatePositions(30);
console.log('positions de test générées :', positions.length, '(5 ouvertures officielles + 30 milieux/fins de partie variés)\n');
const ok = verifyCorrectness(positions);
if (ok) {
  benchmark(positions, 2000);
} else {
  console.log('\n⚠️  Benchmark ANNULÉ — le moteur expérimental ne produit pas les mêmes coups, mesurer sa vitesse serait trompeur.');
  process.exit(1);
}
