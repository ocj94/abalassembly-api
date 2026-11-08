// L'exécutant Node : brancher un PC (ou un serveur) sur l'ordonnanceur d'Abalassembly.
//
//   node scripts/executant.js --api https://api.exemple.fr --email moi@exemple.fr [--coeurs 3] [--nom "PC du salon"]
//   node scripts/executant.js --aide
//
// Il joue les missions que l'ordonnanceur lui confie, une par cœur, avec le même
// moteur que le jeu (moteur/fil-*.js, le moteur par défaut du registre), et rend
// chaque résultat : le serveur le vérifie avant de le compter.
//
// Ctrl-C (SIGINT) ou `docker stop` (SIGTERM) le débranchent proprement : ses
// missions en cours repartent tout de suite dans la file (sinon, elles y
// repartiraient à l'expiration de leur bail).
//
// Il ne s'arrête jamais de lui-même une fois branché : serveur injoignable, jeton
// expiré (il se reconnecte), famille débranchée ou exécutant coupé par l'admin — il
// attend et reprend dès que c'est possible. Ainsi, en conteneur, l'interrupteur de
// la famille « serveur » suffit à tout suspendre, sans boucle de redémarrages.
// Il ne quitte en erreur (code 1) qu'au démarrage, si le serveur refuse le branchement.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { registre } from '../src/moteurIA.js';
import { resoudreDefi } from '../src/preuveClient.js';

const AIDE = `Exécutant Abalassembly : branche cette machine sur l'ordonnanceur de calcul.

  node scripts/executant.js [options]

  --api <url>      ABA_API      serveur (défaut http://127.0.0.1:3000)
  --email <a@b>    ABA_EMAIL    compte
                   ABA_MDP      mot de passe (variable seulement : jamais en argument)
                   ABA_JETON    ou un jeton déjà obtenu, à la place du mot de passe
  --otp <code>                  code MFA, si le compte en a un (au démarrage seulement : un tel
                                compte ne peut pas se reconnecter seul quand son jeton expire)
  --famille <f>    ABA_FAMILLE  node (défaut) ou serveur (compte de calcul de l'opérateur)
  --coeurs <n>     ABA_COEURS   missions jouées en même temps (défaut : cœurs - 1)
  --nom <texte>    ABA_NOM      nom vu par les admins (défaut : nom de la machine)
  --moteur <sha>   ABA_MOTEUR   moteur à utiliser (défaut : celui du registre)
  --aide                        ce message

Ctrl-C ou SIGTERM : débranche proprement (les missions en cours repartent dans la file).`;

const ARGV = process.argv.slice(2);
if (ARGV.includes('--aide') || ARGV.includes('--help') || ARGV.includes('-h')) { console.log(AIDE); process.exit(0); }
function arg(nom, variable, defaut) {
  const i = ARGV.indexOf('--' + nom);
  if (i >= 0 && ARGV[i + 1] !== undefined) return ARGV[i + 1];
  if (variable && process.env[variable]) return process.env[variable];
  return defaut;
}

const FAMILLES_CLI = ['node', 'serveur'];
const API = arg('api', 'ABA_API', 'http://127.0.0.1:3000').replace(/\/$/, '');
const FAMILLE = arg('famille', 'ABA_FAMILLE', 'node');
const COEURS = Math.max(1, Math.min(128, Number(arg('coeurs', 'ABA_COEURS', Math.max(1, os.cpus().length - 1))) | 0));
const MOTEUR = arg('moteur', 'ABA_MOTEUR', registre().defaut);
const NOM = String(arg('nom', 'ABA_NOM', os.hostname())).slice(0, 40);
const EMAIL = arg('email', 'ABA_EMAIL', null), MDP = process.env.ABA_MDP || null, OTP = arg('otp', null, undefined);
const ATTENTE_VIDE_MS = Number(process.env.ABA_ATTENTE_MS) || 15000;
const ATTENTE_ERREUR_MS = Number(process.env.ABA_ATTENTE_ERREUR_MS) || 30000;
const heure = () => new Date().toLocaleTimeString('fr-FR');
const dire = (s) => console.log(heure() + '  ' + s);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let jeton = process.env.ABA_JETON || null, executant = null, battementS = 20, arret = false, continuer = true, raisonPause = '';
const fils = [];

// une requête ; ne lève jamais : serveur injoignable → statut 0
async function brut(chemin, corps) {
  try {
    const r = await fetch(API + chemin, { method: corps ? 'POST' : 'GET',
      headers: Object.assign({ 'content-type': 'application/json' }, jeton ? { authorization: 'Bearer ' + jeton } : {}),
      body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(30000) });
    let b = null; try { b = await r.json(); } catch (e) {}
    return { statut: r.status, b: b || {} };
  } catch (e) { return { statut: 0, b: { error: 'serveur injoignable (' + ((e.cause && (e.cause.code || e.cause.message)) || e.message) + ')' } }; }
}

async function connexion() {
  if (!EMAIL || !MDP) throw new Error('donner --email (ou ABA_EMAIL) et la variable ABA_MDP, ou un jeton dans ABA_JETON');
  let r = await brut('/auth/login', { email: EMAIL, password: MDP, otp: OTP });
  // des mots de passe faux ont été tapés pour ce compte : le serveur demande une preuve de travail
  if (r.statut === 401 && r.b.preuveRequise) {
    const d = await brut('/auth/defi');
    if (d.statut === 200 && d.b.defi) r = await brut('/auth/login', { email: EMAIL, password: MDP, otp: OTP, preuve: resoudreDefi(d.b.defi) });
  }
  if (r.statut !== 200 || !r.b.token) { const e = new Error('connexion refusée : ' + (r.b.error || r.statut)); e.statut = r.statut; throw e; }
  jeton = r.b.token;
}

// jeton expiré (7 jours) ou révoqué : une seule reconnexion à la fois, pour tous les cœurs
let reconnexion = null;
function reconnecter() {
  if (!EMAIL || !MDP) return Promise.resolve(false);
  if (!reconnexion) reconnexion = connexion().then(() => { dire('🔑 session renouvelée'); return true; },
    (e) => { dire('✗ ' + e.message); return false; }).finally(() => { reconnexion = null; });
  return reconnexion;
}

async function appel(chemin, corps) {
  let r = await brut(chemin, corps);
  if (r.statut === 401 && await reconnecter()) r = await brut(chemin, corps);
  return r;
}

// suspendu (famille débranchée, exécutant coupé ou débranché ailleurs) ↔ actif : dit chaque changement une fois
function etat(oui, raison) {
  if (oui && !continuer) dire('▶ reprise : l\'ordonnanceur donne de nouveau des missions');
  if (!oui && (continuer || raison !== raisonPause)) dire('⏸ en attente : ' + raison + ' (Ctrl-C pour quitter)');
  continuer = oui; raisonPause = oui ? '' : raison;
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
    if (!continuer) { await pause(battementS * 1000); continue; }
    const r = await appel('/ordo/missions/reclamer', { executant: executant.id });
    if (arret) break;
    if (r.statut === 403 || r.statut === 409) { etat(false, r.b.error || String(r.statut)); continue; }
    if (r.statut !== 200) { dire('serveur : ' + (r.statut || '') + ' ' + (r.b.error || '') + ', nouvel essai dans ' + Math.round(ATTENTE_ERREUR_MS / 1000) + ' s'); await pause(ATTENTE_ERREUR_MS); continue; }
    if (!r.b.mission) { await pause(ATTENTE_VIDE_MS); continue; }
    const { mission, tentative } = r.b;
    dire(`▶ cœur ${k + 1} : mission ${mission.id} (campagne ${mission.campagne}, profondeur ${mission.profondeur}, A joue ${mission.couleurA === 'black' ? 'Noir' : 'Blanc'})`);
    let res;
    try { res = await f.jouer(mission); }
    catch (e) { if (arret) break; dire('✗ mission ' + mission.id + ' : ' + e.message); await appel(`/ordo/tentatives/${tentative.id}/abandon`, { jeton: tentative.jeton }); continue; }
    if (arret) break;
    const v = await appel(`/ordo/tentatives/${tentative.id}/resultat`, Object.assign({ jeton: tentative.jeton }, res));
    if (v.statut === 200) dire(`✓ mission ${mission.id} : ${res.vainqueur === 'A' ? 'A gagne' : res.vainqueur === 'B' ? 'B gagne' : 'nulle'} (${res.pourquoi}), ${res.coups.length} demi-coups, ${Math.round(res.ms / 1000)} s — vérifiée, ${v.b.compte ? 'comptée' : 'déjà faite par un autre'}`);
    else dire(`✗ mission ${mission.id} refusée : ${v.b.error || v.statut}`);
  }
}

async function debrancher() {
  if (!executant) return;
  const r = await brut(`/ordo/executants/${executant.id}/debrancher`, {});
  dire(r.statut === 200 ? 'débranché' + (r.b.missionsRendues ? ' : ' + r.b.missionsRendues + ' mission(s) rendue(s) à la file' : '')
    : 'débranchement non confirmé (' + (r.b.error || r.statut) + ') : ses missions repartiront à la fin de leur bail');
}

// au démarrage, le serveur peut ne pas être encore prêt : on réessaie un peu (2 min), puis on abandonne
async function auDemarrage(faire) {
  for (let essai = 1; ; essai++) {
    try { return await faire(); }
    catch (e) {
      if (e.statut !== 0 || essai >= 12 || arret) throw e;
      dire(e.message + ', nouvel essai dans 10 s'); await pause(10000);
    }
  }
}

async function principal() {
  if (!FAMILLES_CLI.includes(FAMILLE)) throw new Error('famille inconnue : ' + FAMILLE + ' (node ou serveur)');
  if (!MOTEUR || !registre().moteurs[MOTEUR]) throw new Error('aucun moteur ' + (MOTEUR || '') + ' dans moteur/registre.json (scripts/importer-moteur.js)');
  if (!jeton) await auDemarrage(connexion);
  const r = await auDemarrage(async () => {
    const x = await appel('/ordo/executants', { famille: FAMILLE, coeurs: COEURS, moteur: MOTEUR, nom: NOM });
    if (x.statut !== 200) { const e = new Error('branchement refusé : ' + (x.b.error || x.statut)); e.statut = x.statut; throw e; }
    return x;
  });
  if (arret) return;
  executant = r.b.executant; battementS = r.b.battementS || 20;
  dire(`🔌 branché sur ${API} : famille ${FAMILLE}, ${COEURS} cœur(s), moteur ${registre().moteurs[MOTEUR].version}. Ctrl-C pour débrancher.`);
  const bat = setInterval(async () => {
    const b = await appel(`/ordo/executants/${executant.id}/battement`, {});
    if (b.statut !== 200 || arret) return;
    etat(!!b.b.continuer, !b.b.actif ? 'exécutant coupé par l\'administrateur' : !b.b.branche ? 'exécutant débranché depuis un autre appareil'
      : 'la famille « ' + FAMILLE + ' » est débranchée');
  }, battementS * 1000);
  for (let k = 0; k < COEURS; k++) fils.push(filDeCalcul());
  await Promise.all(fils.map((_, k) => boucle(k)));
  clearInterval(bat);
}

let quitte = false;
async function quitter(signal) {
  if (quitte) process.exit(1);           // second Ctrl-C : sortie immédiate
  quitte = true; arret = true;
  dire((signal === 'SIGINT' ? 'Ctrl-C' : signal) + ' : débranchement…');
  fils.forEach((f) => f.fin());
  await debrancher();
  process.exit(0);
}
process.on('SIGINT', () => quitter('SIGINT'));
process.on('SIGTERM', () => quitter('SIGTERM'));
principal().catch((e) => { console.error(e.message); process.exit(1); });
