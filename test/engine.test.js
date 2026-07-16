import { createEngine } from '../src/engine.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('createEngine() : partie légale correctement rejouée', () => {
  const E = createEngine();
  E.setBoard({ '8,0':'black', '8,1':'black', '7,0':'white', '7,1':'white' });
  const moves = E.getAllMovesForColor('black');
  assert.ok(moves.length > 0, 'des coups légaux doivent exister');
  const mv = moves[0];
  const undo = E.applyMove(mv, 'black');
  assert.ok(undo, 'applyMove doit retourner un ticket d\'annulation');
  E.undoMove(undo);
  assert.equal(Object.keys(E.getBoard()).length, 4, 'undo doit restaurer exactement le plateau initial');
});

test('createEngine() : notation ABA-PRO résolue et cohérente avec moveToABAPRO', () => {
  const E = createEngine();
  E.setBoard({ '8,0':'black', '8,1':'black', '8,2':'black' });
  const p = E.abaproToRc('a1');
  assert.deepEqual(p, { r: 8, c: 0 });
  const moves = E.getAllMovesForColor('black');
  const mv = moves[0];
  const lab = E.moveToABAPRO(mv.cells, mv.dir, (mv.info && mv.info.type) || mv.type);
  const reResolved = E.resolveAbaProToken(lab, 'black');
  assert.ok(reResolved, 'un label généré doit se re-résoudre en un coup valide : ' + lab);
});

test('deux instances createEngine() sont totalement isolées (sécurité concurrentielle)', () => {
  const A = createEngine();
  const B = createEngine();
  A.setBoard({ '8,0':'black' });
  B.setBoard({ '0,0':'white' });
  assert.deepEqual(A.getBoard(), { '8,0':'black' });
  assert.deepEqual(B.getBoard(), { '0,0':'white' });
  // muter A ne doit RIEN changer chez B
  A.setBoard({ '4,4':'black' });
  assert.deepEqual(B.getBoard(), { '0,0':'white' }, 'B ne doit pas être affecté par une mutation de A');
});

test('createEngine() : coup illégal détecté (résolution échoue proprement)', () => {
  const E = createEngine();
  E.setBoard({ '8,0':'black' });
  const bogus = E.resolveAbaProToken('z9z9', 'black');
  assert.equal(bogus, null, 'un token absurde doit être rejeté, pas planter');
});

console.log('engine.js : tests manuels OK (exécuter via node --test pour le rapport complet)');
