// Importer le moteur de l'IA d'une version du jeu dans le registre du serveur.
//
//   node scripts/importer-moteur.js <index.html du jeu>
//
// L'ordonnanceur ne donne une mission qu'a un executant qui a EXACTEMENT le meme
// moteur que celui que le serveur sait rejouer : meme texte du fil de calcul
// (AI_WORKER_CODE), donc meme empreinte SHA-256. Ce script extrait ce texte de
// index.html (sans l'executer : le gabarit est evalue seul, dans un bac a sable
// vide), l'ecrit dans moteur/fil-<version>.js et l'inscrit dans moteur/registre.json.
// A refaire a chaque version du jeu qui change le fil de calcul.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER = path.join(ici, '..', 'moteur');

export function extraire(html) {
  const debut = 'const AI_WORKER_CODE = `';
  const i = html.indexOf(debut);
  if (i < 0) throw new Error('AI_WORKER_CODE introuvable dans ce fichier');
  const j = html.indexOf('\n`;', i);
  if (j < 0) throw new Error('fin de AI_WORKER_CODE introuvable');
  const brut = html.slice(i + debut.length, j + 1);
  if (brut.includes('${')) throw new Error('le gabarit contient une interpolation : extraction refusee');
  const code = vm.runInNewContext('`' + brut + '`', Object.create(null), { timeout: 2000 });
  const m = html.match(/const APP_VERSION = '([^']+)'/);
  return { code, version: m ? m[1] : 'inconnue', sha256: crypto.createHash('sha256').update(code).digest('hex') };
}

export function inscrire(html) {
  const { code, version, sha256 } = extraire(html);
  const fichier = 'fil-' + version.replace(/[^\w.-]/g, '_') + '.js';
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(path.join(DOSSIER, fichier), code);
  const reg = path.join(DOSSIER, 'registre.json');
  const R = fs.existsSync(reg) ? JSON.parse(fs.readFileSync(reg, 'utf8')) : { moteurs: {} };
  R.moteurs[sha256] = { version, fichier };
  R.defaut = sha256;
  fs.writeFileSync(reg, JSON.stringify(R, null, 2) + '\n');
  return { version, sha256, fichier };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2];
  if (!src) { console.error('usage : node scripts/importer-moteur.js <index.html du jeu>'); process.exit(2); }
  const r = inscrire(fs.readFileSync(src, 'utf8'));
  console.log('moteur ' + r.version + ' inscrit : ' + r.sha256 + ' (' + r.fichier + ')');
}
