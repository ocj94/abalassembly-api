#!/usr/bin/env node
/**
 * Vérifie que le moteur de règles reste synchronisé entre les deux copies :
 * - src/engine.js (ce dépôt, utilisé par la vérification du Labo distribué)
 * - AI_WORKER_CODE dans index.html (dépôt Abalassembly, utilisé en jeu réel)
 *
 * Ne copie RIEN automatiquement — les deux fichiers ont des formats
 * différents (module ES exporté vs texte de Web Worker) et une copie
 * aveugle casserait l'un ou l'autre. Ce script COMPARE le corps de chaque
 * fonction partagée et signale clairement toute divergence, pour qu'un
 * humain (ou une session Claude suivante) la corrige consciemment plutôt
 * que de la découvrir des mois plus tard via un bug silencieux — exactement
 * le genre d'écart qui a causé le bug OPP_DIR de la session du 19/07/2026.
 *
 * Usage :
 *   node scripts/check-engine-sync.js                 (compare avec la version en ligne du jeu)
 *   node scripts/check-engine-sync.js --local <path>   (compare avec un fichier local, ex. pour tester avant de pousser)
 */
import fs from 'node:fs';
import https from 'node:https';

const GAME_URL = 'https://raw.githubusercontent.com/ocj94/Abalassembly/main/index.html';
const ENGINE_PATH = new URL('../src/engine.js', import.meta.url).pathname;

// Fonctions du moteur SERVEUR à vérifier contre leur équivalent côté jeu.
// Volontairement centré sur les règles/géométrie — pas les fonctions propres
// au serveur (playDuelGame, replayFromMoves, _duelSetup...) qui n'ont pas
// d'équivalent direct côté client, ni celles propres à la recherche IA
// (search, quiescence...) dont une divergence mineure ne casse aucune règle.
const CRITICAL_FNS = [
  'rcToAxial', 'axialToRc', 'selectionLine', 'validateMove', 'abApplyMove',
  'getAllMovesForColor', 'applyMove', 'undoMove',
  'abaproToRc', 'coordToABAPRO', 'moveToABAPRO', 'resolveAbaProToken', 'abaproOfficialLabels',
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Extrait le corps d'une fonction nommée depuis un texte source, en comptant
// les accolades — la même technique utilisée pour tous les tests de cette
// session (grabFn), donc déjà éprouvée sur ces deux fichiers précis.
function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) return null;
  const braceStart = src.indexOf('{', idx);
  if (braceStart < 0) return null;
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(idx, i + 1);
}

// Trouve TOUTES les occurrences d'une fonction dans un texte — certaines
// fonctions existent volontairement en double côté jeu (thread principal +
// Worker), d'autres n'existent que d'un seul côté. On ne présuppose rien.
function extractAllFn(src, name) {
  const results = [];
  const needle = 'function ' + name + '(';
  let searchFrom = 0;
  while (true) {
    const idx = src.indexOf(needle, searchFrom);
    if (idx < 0) break;
    const braceStart = src.indexOf('{', idx);
    if (braceStart < 0) break;
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    results.push(src.slice(idx, i + 1));
    searchFrom = i + 1;
  }
  return results;
}

// Normalise avant comparaison : espaces/retours à la ligne réduits, pour ne
// pas signaler une différence purement cosmétique (indentation, etc.) comme
// une vraie divergence de règle.
function normalize(fnBody) {
  return fnBody.replace(/\s+/g, ' ').trim();
}

async function main() {
  const useLocal = process.argv.includes('--local');
  const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf-8');

  let gameSrc;
  if (useLocal) {
    const localPath = process.argv[process.argv.indexOf('--local') + 1];
    gameSrc = fs.readFileSync(localPath, 'utf-8');
    console.log('Comparaison avec le fichier local :', localPath);
  } else {
    console.log('Récupération de la dernière version en ligne du jeu…');
    gameSrc = await fetchUrl(GAME_URL);
  }

  console.log('\nVérification de', CRITICAL_FNS.length, 'fonctions critiques…\n');
  console.log('(chaque fonction est cherchée dans TOUT le fichier du jeu — certaines');
  console.log(' comme les fonctions de notation ne vivent que côté thread principal,');
  console.log(' d\'autres comme les règles de déplacement ne vivent que dans le Worker)\n');

  let inSync = 0, drifted = 0, missing = 0;
  const driftedNames = [];

  for (const name of CRITICAL_FNS) {
    const serverFn = extractFn(engineSrc, name);
    const clientOccurrences = extractAllFn(gameSrc, name);

    if (!serverFn) {
      console.log('⚠️ ', name.padEnd(24), 'absente du serveur (src/engine.js)');
      missing++;
      continue;
    }
    if (!clientOccurrences.length) {
      console.log('⚠️ ', name.padEnd(24), 'absente du jeu (index.html)');
      missing++;
      continue;
    }

    const serverNorm = normalize(serverFn);
    const matchIdx = clientOccurrences.findIndex(fn => normalize(fn) === serverNorm);

    if (matchIdx !== -1) {
      const note = clientOccurrences.length > 1 ? ` (${clientOccurrences.length} copies côté jeu, au moins une correspond)` : '';
      console.log('✅', name.padEnd(24), 'synchronisée' + note);
      inSync++;
    } else {
      console.log('❌', name.padEnd(24), 'DIVERGENTE (' + clientOccurrences.length + ' copie(s) côté jeu, aucune ne correspond au serveur)');
      drifted++;
      driftedNames.push(name);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`${inSync} synchronisées · ${drifted} divergentes · ${missing} introuvables`);

  if (drifted > 0) {
    console.log('\n🛑 DIVERGENCE DÉTECTÉE dans :', driftedNames.join(', '));
    console.log('   Ne pas ignorer — c\'est exactement le genre d\'écart qui a causé');
    console.log('   le bug OPP_DIR de la session du 19/07/2026. Comparer les deux');
    console.log('   copies à la main et corriger consciemment laquelle a raison.');
    process.exit(1);
  }
  if (missing > 0) {
    console.log('\n⚠️  Certaines fonctions n\'ont pas pu être comparées (voir ci-dessus).');
    process.exit(1);
  }
  console.log('\n✅ Les deux copies du moteur sont synchronisées.');
}

main().catch(err => { console.error('Erreur :', err.message); process.exit(2); });
