// File d'attente vers le fil de verification : une tache a la fois, delai maximal,
// fil relance s'il depasse le delai (une partie piegee ne bloque pas le serveur).
import { Worker } from 'node:worker_threads';

const DELAI_MS = () => Number(process.env.ORDO_VERIF_DELAI_MS) || 120000;
let fil = null, n = 0;
const attente = new Map();
let chaine = Promise.resolve();

function lancer() {
  fil = new Worker(new URL('./verificateurFil.js', import.meta.url));
  fil.unref();
  fil.on('message', (m) => { const p = attente.get(m.id); if (!p) return; attente.delete(m.id); clearTimeout(p.to); m.erreur ? p.rej(new Error(m.erreur)) : p.res(m.out); });
  fil.on('error', (e) => { for (const [, p] of attente) { clearTimeout(p.to); p.rej(e); } attente.clear(); fil = null; });
  fil.on('exit', () => { fil = null; });
}

function tache(t) {
  const execute = () => new Promise((res, rej) => {
    if (!fil) lancer();
    const id = ++n;
    const to = setTimeout(() => { attente.delete(id); if (fil) { fil.terminate(); fil = null; } rej(new Error('verification trop longue')); }, DELAI_MS());
    attente.set(id, { res, rej, to });
    fil.postMessage(Object.assign({ id }, t));
  });
  const p = chaine.then(execute, execute);
  chaine = p.catch(() => {});
  return p;
}

export const verifier = (mission, resultat, indices) => tache({ type: 'verifier', mission, resultat, indices });
export const jouer = (mission) => tache({ type: 'jouer', mission });
export async function arreter() { if (fil) { const f = fil; fil = null; await f.terminate(); } }
