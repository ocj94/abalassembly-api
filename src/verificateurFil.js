// Fil de verification (worker_threads) : le rejeu et les recherches du moteur prennent
// quelques secondes ; ils ne bloquent ainsi jamais les autres requetes du serveur.
import { parentPort } from 'node:worker_threads';
import { creerFil, verifierMission, jouerMission } from './moteurIA.js';

const fils = new Map();
const fil = (sha) => { if (!fils.has(sha)) fils.set(sha, creerFil(sha)); return fils.get(sha); };

parentPort.on('message', (t) => {
  try {
    const out = t.type === 'jouer' ? jouerMission(fil(t.mission.moteur), t.mission)
      : verifierMission(fil(t.mission.moteur), t.mission, t.resultat, t.indices);
    parentPort.postMessage({ id: t.id, out });
  } catch (e) { parentPort.postMessage({ id: t.id, erreur: String(e && e.message || e) }); }
});
