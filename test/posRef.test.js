// Tests du module posRef (position de référence via les 12 symétries du
// plateau hexagonal — rotation 60° et miroir, idée reprise de KAA/Saab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posRef, TRANSFORMS, transformBoard, rcToAx, axToRc } from '../src/posRef.js';

test('les 6 rotations à 60° referment le plateau (les 61 cases restent valides)', () => {
  const ROWS = [5,6,7,8,9,8,7,6,5];
  let allValid = true;
  for (let r = 0; r < 9; r++) for (let c = 0; c < ROWS[r]; c++) {
    for (const t of TRANSFORMS) {
      const ax = rcToAx(r, c);
      const rc2 = axToRc(t(ax).q, t(ax).r);
      if (!rc2) allValid = false;
    }
  }
  assert.ok(allValid, 'les 12 transformations doivent rester dans les 61 cases du plateau');
});

test('les 12 transformations sont deux à deux distinctes (pas de doublon)', () => {
  const samples = [{r:0,c:0},{r:4,c:4},{r:8,c:2}];
  const sigs = TRANSFORMS.map(t => samples.map(p => { const a = t(rcToAx(p.r,p.c)); return a.q+','+a.r; }).join(';'));
  assert.equal(new Set(sigs).size, 12);
});

test('posRef est invariant sous les 12 symétries d\'une même position', () => {
  const board = { '0,0':'black', '0,1':'black', '8,4':'white' };
  const ref0 = posRef(board);
  for (const t of TRANSFORMS) {
    const rotated = transformBoard(board, t);
    assert.equal(posRef(rotated), ref0);
  }
});

test('deux positions réellement différentes ont des posRef différents', () => {
  const a = { '0,0':'black', '0,1':'white', '8,4':'white' };
  const b = { '0,0':'black', '0,1':'black', '8,4':'white' };
  assert.notEqual(posRef(a), posRef(b));
});

test('le plateau vide a un posRef stable et déterministe', () => {
  assert.equal(posRef({}), posRef({}));
});
