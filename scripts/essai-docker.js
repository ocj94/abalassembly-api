// Essai de bout en bout de la pile Docker : image, docker-compose.yml, exécutants « serveur ».
// C'est le job `docker` de la CI (.github/workflows/test.yml) ; il demande Docker et
// le plugin compose, et s'arrête si un .env existe déjà (il écrit le sien, jetable).
//
//   node scripts/essai-docker.js
//
// Il construit l'image, vérifie ce qu'elle contient (moteur intact, pas de tests ni de
// secrets, utilisateur non root), lance base + Redis + API comme en production
// (NODE_ENV=production), crée un admin avec MFA et un compte de calcul par
// scripts/admin.js dans le conteneur, lance une petite campagne, branche deux
// conteneurs `executant`, attend que les quatre parties soient jouées par eux et
// vérifiées par l'API, puis les arrête : ils doivent se débrancher proprement.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../src/totp.js';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
if (fs.existsSync('.env')) {
  console.error('.env existe déjà : cet essai écrit le sien. Le lancer dans une copie propre du dépôt (comme la CI).');
  process.exit(2);
}

const PROJET = 'abaessai', API = 'http://127.0.0.1:3000';
const compose = (args, opts = {}) => execFileSync('docker', ['compose', '-p', PROJET, '--profile', 'calcul', ...args],
  { stdio: opts.sortie ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', timeout: opts.delai || 600000 });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const etape = (s) => console.log('\n━━ ' + s);
function verifier(cond, msg) { if (!cond) throw new Error('ÉCHEC : ' + msg); console.log('  ✓ ' + msg); }
async function http(methode, chemin, corps, jeton) {
  const r = await fetch(API + chemin, { method: methode, headers: Object.assign(corps ? { 'content-type': 'application/json' } : {},
    jeton ? { authorization: 'Bearer ' + jeton } : {}), body: corps ? JSON.stringify(corps) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(methode + ' ' + chemin + ' → ' + r.status + ' ' + JSON.stringify(b));
  return b;
}
async function attendre(quoi, test, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await test().catch((e) => { console.log('  … ' + e.message); return null; });
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('ÉCHEC : délai dépassé (' + Math.round(ms / 1000) + ' s) : ' + quoi);
    await dormir(2000);
  }
}

const hasard = () => crypto.randomBytes(12).toString('hex');
const ADMIN = { email: 'admin.' + hasard() + '@essai.example.org', password: hasard() };
const CALCUL = { email: 'calcul.' + hasard() + '@essai.example.org', password: hasard() };
const P = { center: 6, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14, chain: 10, fortress: 20 };

let ok = false;
try {
  fs.writeFileSync('.env', [
    'PORT=3000', 'NODE_ENV=production', 'CORS_ORIGINS=http://localhost',
    'JWT_SECRET=' + crypto.randomBytes(32).toString('hex'),
    'ORDO_BAIL_S=6',                                   // signe de vie toutes les 2 s : l'essai va plus vite
    'ABA_CALCUL_EMAIL=' + CALCUL.email, 'ABA_CALCUL_MDP=' + CALCUL.password, 'ABA_COEURS=1', ''].join('\n'));

  etape('construction de l\'image');
  compose(['build']);

  etape('contenu de l\'image');
  const inv = JSON.parse(compose(['run', '--rm', '--no-deps', '-T', 'api', 'node', '--input-type=module', '-e', `
    import fs from 'node:fs';
    const m = await import('/app/src/moteurIA.js'), r = m.registre();
    let integre = false; try { m.codeMoteur(r.defaut); integre = true; } catch (e) {}
    console.log(JSON.stringify({ uid: process.getuid(), defaut: r.defaut, version: r.defaut && r.moteurs[r.defaut].version, integre,
      presents: ['moteur', 'scripts/admin.js', 'scripts/executant.js', 'src/verificateurFil.js'].filter((f) => fs.existsSync(f)),
      absents: ['test', '.env', '.git', 'scripts/check-engine-sync.js', 'scripts/essai-docker.js'].filter((f) => !fs.existsSync(f)) }));`],
  { sortie: true }).trim().split('\n').pop());
  verifier(inv.uid !== 0, 'l\'image ne tourne pas en root (uid ' + inv.uid + ')');
  verifier(inv.integre, 'moteur ' + inv.version + ' présent et intact (empreinte ' + String(inv.defaut).slice(0, 12) + '…)');
  verifier(inv.presents.length === 4, 'moteur, admin.js, executant.js et le fil de vérification sont dans l\'image');
  verifier(inv.absents.length === 5, 'ni tests, ni .env, ni .git, ni scripts de développement dans l\'image');
  const aide = compose(['run', '--rm', '--no-deps', '-T', 'executant', 'node', 'scripts/executant.js', '--aide'], { sortie: true });
  verifier(/ABA_FAMILLE/.test(aide), 'l\'exécutant répond à --aide dans le conteneur');

  etape('base, Redis, migrations, API (NODE_ENV=production)');
  compose(['up', '-d', '--wait', 'db', 'redis']);
  compose(['run', '--rm', '-T', 'api', 'npm', 'run', 'migrate']);
  compose(['up', '-d', '--wait', 'api']);
  const sante = await http('GET', '/health');
  verifier(sante && (sante.ok || sante.status), 'l\'API répond sur /health');

  etape('comptes : un admin avec MFA, un compte de calcul (scripts/admin.js dans le conteneur)');
  const a = await http('POST', '/auth/signup', ADMIN);
  await http('POST', '/auth/signup', CALCUL);
  compose(['exec', '-T', 'api', 'node', 'scripts/admin.js', 'nommer', ADMIN.email]);
  compose(['exec', '-T', 'api', 'node', 'scripts/admin.js', 'calcul', CALCUL.email]);
  const s = await http('POST', '/mfa/setup', null, a.token);
  await http('POST', '/mfa/enable', { otp: totpCode(s.secret) }, a.token);
  verifier(true, 'admin nommé, MFA active ; compte de calcul nommé');

  etape('une campagne, deux conteneurs exécutants');
  const c = await http('POST', '/ordo/campagnes', { nom: 'essai docker', poidsA: { ...P, center: 20 }, poidsB: P, profondeur: 1, paires: 2, maxPlies: 12, ouverture: 2 }, a.token);
  verifier(c.missions === 4, 'campagne ' + c.campagne + ' : 4 missions en file');
  compose(['up', '-d', '--scale', 'executant=2', 'executant']);
  await attendre('deux exécutants branchés dans la famille « serveur »', async () =>
    (await http('GET', '/ordo/etat')).familles.find((f) => f.famille === 'serveur').branches === 2, 120000);
  verifier(true, 'deux exécutants branchés dans la famille « serveur »');
  const fin = await attendre('les quatre parties jouées et vérifiées', async () => {
    const e = await http('GET', '/ordo/campagnes/' + c.campagne, null, a.token);
    console.log('  … missions ' + JSON.stringify(e.missions));
    return e.missions.faite === 4 ? e : null;
  }, 300000);
  verifier(fin.parFamille.serveur === 4, 'les 4 parties ont été jouées par la famille « serveur » et acceptées par l\'API (' + fin.bilan.W + ' / ' + fin.bilan.D + ' / ' + fin.bilan.L + ')');

  etape('docker compose stop executant : débranchement propre');
  compose(['stop', 'executant']);
  const etat = await http('GET', '/ordo/etat');
  verifier(etat.familles.find((f) => f.famille === 'serveur').branches === 0, 'plus aucun exécutant branché dans la famille « serveur »');
  const ex = (await http('GET', '/ordo/executants', null, a.token)).executants.filter((x) => x.famille === 'serveur');
  verifier(ex.length === 2 && ex.every((x) => !x.branche), 'les deux exécutants sont marqués débranchés');
  verifier(ex.reduce((n, x) => n + x.faites, 0) === 4, 'et ils ont fait les 4 parties à eux deux');
  const journal = compose(['logs', '--no-color', 'executant'], { sortie: true });
  verifier((journal.match(/SIGTERM : débranchement/g) || []).length === 2, 'chacun a reçu SIGTERM et s\'est débranché lui-même');
  ok = true;
} catch (e) {
  console.error('\n' + e.message);
  try { compose(['logs', '--no-color', '--tail', '150']); } catch (x) {}
} finally {
  try { compose(['down', '-v', '--remove-orphans'], { delai: 120000 }); } catch (x) {}
  fs.rmSync('.env', { force: true });
}
console.log(ok ? '\n✅ pile Docker : tout fonctionne' : '\n❌ pile Docker : échec');
process.exit(ok ? 0 : 1);
