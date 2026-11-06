// L'exécutant Node : brancher un PC (ou un serveur) sur l'ordonnanceur d'Abalassembly.
//
//   node scripts/executant.js --api https://api.exemple.fr --email moi@exemple.fr [--coeurs 3] [--nom "PC du salon"]
//
// Le mot de passe est demandé par la variable ABA_MDP (jamais en argument : il
// resterait dans l'historique du terminal), ou un jeton déjà obtenu par ABA_JETON.
// Code MFA si le compte en a un : --otp 123456 (au démarrage seulement).
//
// Il joue les missions que l'ordonnanceur lui confie, une par cœur, avec le même
// moteur que le jeu (moteur/fil-*.js, le moteur par défaut du registre), et
// rend chaque résultat : le serveur le vérifie avant de le compter. Ctrl-C le
// débranche proprement : ses missions en cours repartent tout de suite dans la
// file (sinon, elles y repartiraient à l'expiration de leur bail).
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { registre } from '../src/moteurIA.js';

function arg(nom, defaut) { const i = process.argv.indexOf('--' + nom); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut; }
const API = (arg('api', process.env.ABA_API || 'http://127.0.0.1:3000')).replace(/\/$/, '');
const COEURS = Math.max(1, Math.min(128, Number(arg('coeurs', Math.max(1, os.cpus().length - 1))) | 0));
const MOTEUR = arg('moteur', registre().defaut);
const NOM = arg('nom', os.hostname().slice(0, 40));
const ATTENTE_VIDE_MS = Number(process.env.ABA_ATTENTE_MS) || 15000;
const heure = () => new Date().toLocaleTimeString('fr-FR');
const dire = (s) => console.log(heure() + '  ' + s);

let jeton = process.env.ABA_JETON || null, executant = null, battementS = 20, arret = false, continuer = true;
const fils = [];

async function appel(chemin, corps, methode) {
  const r = await fetch(API + chemin, { method: methode || (corps ? 'POST' : 'GET'),
    headers: Object.assign({ 'content-type': 'application/json' }, jeton ? { authorization: 'Bearer ' + jeton } : {}),
    body: corps ? JSON.stringify(corps) : undefined });
  let b = null; try { b = await r.json(); } catch (e) {}
  return { statut: r.status, b: b || {} };
}

async function connexion() {
  if (jeton) return;
  const email = arg('email', process.env.ABA_EMAIL), mdp = process.env.ABA_MDP;
  if (!email || !mdp) throw new Error('donner --email et la variable ABA_MDP (ou un jeton dans ABA_JETON)');
  const r = await appel('/auth/login', { email, password: mdp, otp: arg('otp', undefined) });
  if (r.statut !== 200 || !r.b.token) throw new Error('connexion refusée : ' + (r.b.error || r.statut));
  jeton = r.b.token;
}

function filDeCalcul() {
  const w = new Worker(new URL('../src/verificateurFil.js', import.meta.url));
  let n = 0; const attente = new Map();
  w.on('message', (m) => { const p = attente.get(m.id); attente.delete(m.id); if (p) m.erreur ? p.rej(new Error(m.erreur)) : p.res(m.out); });
  w.on('error', (e) => { for (const [, p] of attente) p.rej(e); attente.clear(); });
  return { jouer: (mission) => new Promise((res, rej) => { const id = ++n; attente.set(id, { res, rej }); w.postMessage({ id, type: 'jouer', mission }); }),
    fin: () => w.terminate() };
}

async function boucle(k) {
  const f = fils[k];
  while (!arret) {
    if (!continuer) { await new Promise((r) => setTimeout(r, battementS * 1000)); continue; }
    const r = await appel('/ordo/missions/reclamer', { executant: executant.id });
    if (r.statut === 403 || r.statut === 409) { dire('✋ ' + (r.b.error || r.statut) + ' : arrêt'); arret = true; break; }
    if (r.statut !== 200) { dire('serveur : ' + r.statut + ' ' + (r.b.error || '') + ', nouvel essai dans 30 s'); await new Promise((x) => setTimeout(x, 30000)); continue; }
    if (!r.b.mission) { await new Promise((x) => setTimeout(x, ATTENTE_VIDE_MS)); continue; }
    const { mission, tentative } = r.b;
    dire(`▶ cœur ${k + 1} : mission ${mission.id} (campagne ${mission.campagne}, profondeur ${mission.profondeur}, A joue ${mission.couleurA === 'black' ? 'Noir' : 'Blanc'})`);
    let res;
    try { res = await f.jouer(mission); }
    catch (e) { dire('✗ mission ' + mission.id + ' : ' + e.message); await appel(`/ordo/tentatives/${tentative.id}/abandon`, { jeton: tentative.jeton }); continue; }
    if (arret) break;
    const v = await appel(`/ordo/tentatives/${tentative.id}/resultat`, Object.assign({ jeton: tentative.jeton }, res));
    if (v.statut === 200) dire(`✓ mission ${mission.id} : ${res.vainqueur === 'A' ? 'A gagne' : res.vainqueur === 'B' ? 'B gagne' : 'nulle'} (${res.pourquoi}), ${res.coups.length} demi-coups, ${Math.round(res.ms / 1000)} s — vérifiée, ${v.b.compte ? 'comptée' : 'déjà faite par un autre'}`);
    else dire(`✗ mission ${mission.id} refusée : ${v.b.error || v.statut}`);
  }
}

async function debrancher() {
  if (!executant) return;
  try { const r = await appel(`/ordo/executants/${executant.id}/debrancher`, {}); dire('débranché' + (r.b.missionsRendues ? ' : ' + r.b.missionsRendues + ' mission(s) rendue(s) à la file' : '')); } catch (e) {}
}

async function principal() {
  if (!MOTEUR) throw new Error('aucun moteur dans moteur/registre.json (scripts/importer-moteur.js)');
  await connexion();
  const r = await appel('/ordo/executants', { famille: 'node', coeurs: COEURS, moteur: MOTEUR, nom: NOM });
  if (r.statut !== 200) throw new Error('branchement refusé : ' + (r.b.error || r.statut));
  executant = r.b.executant; battementS = r.b.battementS || 20;
  dire(`🔌 branché sur ${API} : ${COEURS} cœur(s), moteur ${registre().moteurs[MOTEUR].version}. Ctrl-C pour débrancher.`);
  const bat = setInterval(async () => {
    try { const b = await appel(`/ordo/executants/${executant.id}/battement`, {}); if (b.statut === 200) { if (continuer && !b.b.continuer) dire('⏸ l\'ordonnanceur ne donne plus de mission à cet exécutant (famille ou exécutant débranché)'); continuer = !!b.b.continuer; if (!b.b.actif) arret = true; } } catch (e) {}
  }, battementS * 1000);
  for (let k = 0; k < COEURS; k++) fils.push(filDeCalcul());
  await Promise.all(fils.map((_, k) => boucle(k)));
  clearInterval(bat);
  await debrancher();
  fils.forEach((f) => f.fin());
}

process.on('SIGINT', async () => { if (arret) process.exit(1); arret = true; dire('Ctrl-C : débranchement…'); await debrancher(); fils.forEach((f) => f.fin()); process.exit(0); });
principal().catch((e) => { console.error(e.message); process.exit(1); });
