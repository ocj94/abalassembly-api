// Les 5 dispositions de départ officielles — module partagé entre les routes
// (src/routes/lab.js) et les tests, pour ne jamais avoir deux copies qui
// pourraient diverger. Miroir exact de LAYOUTS côté client (index.html).
export const LAYOUTS = {
  standard: { black: [[8,0],[8,1],[8,2],[8,3],[8,4],[7,0],[7,1],[7,2],[7,3],[7,4],[7,5],[6,2],[6,3],[6,4]],
              white: [[0,0],[0,1],[0,2],[0,3],[0,4],[1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[2,2],[2,3],[2,4]] },
  belgian:  { black: [[8,0],[8,1],[7,0],[7,1],[7,2],[6,1],[6,2],[0,3],[0,4],[1,3],[1,4],[1,5],[2,4],[2,5]],
              white: [[8,3],[8,4],[7,3],[7,4],[7,5],[6,4],[6,5],[0,0],[0,1],[1,0],[1,1],[1,2],[2,1],[2,2]] },
  german:   { black: [[7,0],[7,1],[6,0],[6,1],[6,2],[5,1],[5,2],[3,5],[3,6],[2,4],[2,5],[2,6],[1,4],[1,5]],
              white: [[7,4],[7,5],[6,4],[6,5],[6,6],[5,5],[5,6],[3,1],[3,2],[2,0],[2,1],[2,2],[1,0],[1,1]] },
  dutch:    { black: [[8,0],[8,1],[7,0],[7,2],[7,4],[6,1],[6,2],[2,4],[2,5],[1,1],[1,3],[1,5],[0,3],[0,4]],
              white: [[8,3],[8,4],[7,1],[7,3],[7,5],[6,4],[6,5],[2,1],[2,2],[1,0],[1,2],[1,4],[0,0],[0,1]] },
  swiss:    { black: [[7,0],[7,1],[6,0],[6,2],[6,5],[5,1],[5,2],[3,5],[3,6],[2,1],[2,4],[2,6],[1,4],[1,5]],
              white: [[7,4],[7,5],[6,1],[6,4],[6,6],[5,5],[5,6],[3,1],[3,2],[2,0],[2,2],[2,5],[1,0],[1,1]] },
};
export const LAYOUT_KEYS = Object.keys(LAYOUTS);

export function layoutToStart(E, key) {
  const L = LAYOUTS[key];
  if (!L) return null;
  const cells = arr => arr.map(rc => E.coordToABAPRO(rc[0], rc[1]).toLowerCase()).sort().join('');
  return '0' + cells(L.black) + ',0' + cells(L.white);
}
