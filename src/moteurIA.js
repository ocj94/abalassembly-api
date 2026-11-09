// Le moteur de l'IA du jeu, tel quel, cote serveur : le meme texte que le fil de calcul
// du navigateur (moteur/fil-<version>.js, importe par scripts/importer-moteur.js),
// execute dans un bac a sable node:vm. Il sert a deux choses :
//   - verifier une mission rendue par un executant (ordonnanceur, src/routes/ordo.js) :
//     la partie est rejouee coup pour coup, et le moteur recherche lui-meme quelques
//     demi-coups tires au hasard, qui doivent etre exactement ceux de la partie ;
//   - jouer une mission (l'executant Node, scripts/executant.js).
// Depuis la v3.18 du jeu, une partie du Labo a profondeur fixe se refait a l'identique :
// cles de hachage tirees d'une graine fixe, plateau remis dans l'ordre des cases avant
// chaque recherche. Le recalcul d'un demi-coup isole redonne donc le coup joue.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DOSSIER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'moteur');

export function registre() {
  try { return JSON.parse(fs.readFileSync(path.join(DOSSIER, 'registre.json'), 'utf8')); }
  catch (e) { return { moteurs: {}, defaut: null }; }
}
export function moteurConnu(sha) { return !!registre().moteurs[sha]; }

const _codes = new Map();
export function codeMoteur(sha) {
  if (_codes.has(sha)) return _codes.get(sha);
  const m = registre().moteurs[sha];
  if (!m) throw new Error('moteur inconnu du serveur : ' + sha);
  const code = fs.readFileSync(path.join(DOSSIER, path.basename(m.fichier)), 'utf8');
  const vrai = crypto.createHash('sha256').update(code).digest('hex');
  if (vrai !== sha) throw new Error('fichier du moteur altere : empreinte ' + vrai + ' au lieu de ' + sha);
  _codes.set(sha, code);
  return code;
}

// un fil de calcul : le code du navigateur dans un bac a sable, avec seulement ce qu'un Worker lui donne
export function creerFil(sha) {
  const bac = {
    console: { log() {}, warn() {}, error() {} },
    navigator: { deviceMemory: 4, hardwareConcurrency: 1 },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64')
  };
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(codeMoteur(sha), bac, { filename: 'fil-de-calcul.js' });
  return {
    // appelle une fonction écrite pour le moteur (src : une expression de fonction) avec ces arguments
    evaluer(src, args) {
      bac.__a = args;
      try { return vm.runInContext('(' + src + ').apply(null, __a)', bac); } finally { bac.__a = null; }
    },
    message(d) {
      let rendu = null;
      bac.postMessage = (m) => { rendu = m; };
      bac.__d = d;
      vm.runInContext('self.onmessage({ data: __d })', bac);
      bac.__d = null;
      return rendu;
    }
  };
}

// une mission (protocole v1, voir docs) en message pour le fil de calcul
export function messagePartie(mi, extra) {
  const cfg = { depth: mi.profondeur, ms: 1e9 };
  return Object.assign({
    duelGame: true, id: mi.id || 0, wA: mi.poidsA, wB: mi.poidsB, colorA: mi.couleurA, seed: mi.graine,
    msPerMove: 1e9, maxPlies: mi.maxPlies, drawWin: mi.drawWin, ouverture: mi.ouverture, equilibre: mi.equilibre,
    cfgA: cfg, cfgB: cfg, arbitrage: mi.arbitrage, depart: mi.depart || null
  }, extra || {});
}

/* Les positions d'une partie rendue, pour la base d'apprentissage (scripts/exporter-positions.js) :
   la partie est rejouée coup par coup dans le moteur, depuis le départ standard (ou la
   position de départ de la mission). Pour chaque position avant un coup : le plateau en
   61 caractères dans l'ordre des cases ('b' noir, 'w' blanc, '.' vide : le format même du
   moteur pour une position de départ), le camp au trait, les billes sorties, et le score
   du juge actuel (evaluateBoard avec les poids de la campagne), vu du camp au trait. */
export function positionsDePartie(fil, mi, coups) {
  return fil.evaluer(`(function (coups, w, depart) {
    if (depart) { _duelDepart(depart); } else { _duelSetup(); }
    var col = depart && depart.t ? depart.t : 'black', out = [], i, r, c;
    var cle = function (x) { return x.cells.map(function (k) { return k.r + ',' + k.c; }).sort().join('|') + '>' + x.dir.q + ',' + x.dir.r; };
    EVAL_W = w;
    for (i = 0; i < coups.length; i++) {
      var s = '';
      for (r = 0; r < 9; r++) for (c = 0; c < ROWS[r]; c++) { var v = board[r + ',' + c]; s += v === 'black' ? 'b' : v === 'white' ? 'w' : '.'; }
      out.push({ p: i, trait: col === 'black' ? 'b' : 'w', plateau: s, pb: capturedByBlack, pw: capturedByWhite, eval: Math.round(evaluateBoard(col)) });
      var k = cle(coups[i]), m = getAllMovesForColor(col).find(function (x) { return cle(x) === k; });
      if (!m) throw new Error('coup illegal au demi-coup ' + (i + 1));
      applyMove(m, col); col = col === 'black' ? 'white' : 'black';
    }
    var f = '';      // et la position finale, après le dernier coup
    for (r = 0; r < 9; r++) for (c = 0; c < ROWS[r]; c++) { var v2 = board[r + ',' + c]; f += v2 === 'black' ? 'b' : v2 === 'white' ? 'w' : '.'; }
    out.push({ p: coups.length, trait: col === 'black' ? 'b' : 'w', plateau: f, pb: capturedByBlack, pw: capturedByWhite, eval: Math.round(evaluateBoard(col)) });
    return out;
  })`, [coups, mi.poidsA, mi.depart || null]);
}

const coupCompact = (x) => ({ cells: x.cells.map((c) => ({ r: c.r, c: c.c })), dir: { q: x.dir.q, r: x.dir.r } });

export function jouerMission(fil, mi) {
  const t0 = Date.now();
  const r = fil.message(messagePartie(mi));
  if (!r || r.error) throw new Error('le fil de calcul a echoue : ' + (r && r.error));
  return { coups: (r.moves || []).map(coupCompact), vainqueur: r.result.winner, pourquoi: r.result.why,
    plies: r.result.plies, cb: r.result.cb, cw: r.result.cw, ms: Date.now() - t0 };
}

// la verification d'un resultat rendu : partie rejouee avec les coups annonces, recherche du
// moteur aux demi-coups `indices` ; tout ecart, coup illegal, partie inachevee ou fin differente : refus
export function verifierMission(fil, mi, res, indices) {
  const r = fil.message(messagePartie(mi, { forces: res.coups, verifier: indices }));
  if (!r || r.error) return { ok: false, raison: 'le fil de calcul a echoue' };
  const x = r.result;
  if (x.why === 'illegal') return { ok: false, raison: 'coup illegal au demi-coup ' + (x.forces + 1) };
  if (x.why === 'ouverture') return { ok: false, raison: 'ouverture differente de celle que donne la graine' };
  if (x.why === 'inacheve') return { ok: false, raison: 'partie inachevee' };
  if (x.why === 'apresLaFin') return { ok: false, raison: 'coups joues apres la fin de la partie' };
  if (x.ecarts && x.ecarts.length) return { ok: false, raison: 'coup different de celui du moteur au demi-coup ' + (x.ecarts[0] + 1), ecarts: x.ecarts };
  if (x.winner !== res.vainqueur || x.why !== res.pourquoi) return { ok: false, raison: 'resultat annonce (' + res.vainqueur + ', ' + res.pourquoi + ') different du rejeu (' + x.winner + ', ' + x.why + ')' };
  return { ok: true, vainqueur: x.winner, pourquoi: x.why, plies: x.plies };
}
