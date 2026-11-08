// Audit de sécurité de novembre 2026 : chaque attaque vérifiée contre le serveur
// d'avant est rejouée ici, et doit échouer. (Le Labo a ses attaques dans
// lab.test.js, la limite de débit derrière un relais dans ratelimit.test.js.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import jwt from 'jsonwebtoken';
import { makeApp, teardown, signupUser, uniqueEmail, STRONG_PASSWORD, preuve } from './helpers.js';
import { db } from '../src/db.js';
import { redis } from '../src/redis.js';
import { totpCode } from '../src/totp.js';
import { MFA_ESSAIS_MAX } from '../src/mfaCode.js';
import { tournoisOuverts, tournoiDuMois, TOURNOI_XP } from '../src/routes/tournament.js';
import { changerRole } from '../scripts/admin.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });
const authed = (token) => ({ authorization: 'Bearer ' + token });

// ─── 1. Secret de signature des jetons ───

// démarre build() dans un processus neuf avec l'environnement donné ; renvoie l'erreur ou ''
function demarrer(env) {
  try {
    execFileSync(process.execPath, ['-e', "import('./src/server.js').then(m => m.build()).then(a => a.close()).then(() => process.exit(0), e => { console.error(e.message); process.exit(3); })"],
      { cwd: racine, env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, ...env }, stdio: 'pipe', timeout: 20000 });
    return '';
  } catch (e) { return String(e.stderr || e.message); }
}

test('🛡️ JWT : sans JWT_SECRET, le serveur refuse de démarrer (avant : il démarrait avec un secret public)', () => {
  assert.match(demarrer({}), /JWT_SECRET/);
  assert.match(demarrer({ JWT_SECRET: 'dev-only-insecure-secret-change-me' }), /JWT_SECRET/, 'l\'ancien secret par défaut, écrit dans ce dépôt public');
  assert.match(demarrer({ JWT_SECRET: 'CHANGE_ME_32_bytes_hex_minimum' }), /JWT_SECRET/, 'la valeur d\'exemple de .env.example');
  assert.match(demarrer({ JWT_SECRET: 'court' }), /JWT_SECRET/);
  assert.equal(demarrer({ JWT_SECRET: 'a'.repeat(64) }), '', 'un vrai secret : démarrage normal');
});

test('🛡️ JWT : un jeton forgé avec l\'ancien secret public ne lit pas le profil de la victime', async () => {
  const victime = await signupUser(app);
  const faux = jwt.sign({ sub: victime.user.id, name: 'x', role: 'admin', jti: 'x' }, 'dev-only-insecure-secret-change-me', { expiresIn: '7d' });
  const r = await app.inject({ method: 'GET', url: '/profile', headers: authed(faux) });
  assert.equal(r.statusCode, 401);
});

test('🛡️ JWT : un jeton non signé (alg « none ») est refusé', async () => {
  const victime = await signupUser(app);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const nu = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ sub: victime.user.id, role: 'admin', jti: 'y', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.';
  assert.equal((await app.inject({ method: 'GET', url: '/profile', headers: authed(nu) })).statusCode, 401);
});

// ─── 2. Administrateur de démarrage ───

test('🛡️ ADMIN : s\'inscrire avec l\'adresse BOOTSTRAP_ADMIN_EMAIL ne donne plus le rôle admin', async () => {
  const adresse = uniqueEmail('admin');
  process.env.BOOTSTRAP_ADMIN_EMAIL = adresse; // l'ancienne variable, désormais sans effet
  try {
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { preuve: await preuve(app), email: adresse, password: STRONG_PASSWORD, username: 'intrus' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().user.role, 'player');
  } finally { delete process.env.BOOTSTRAP_ADMIN_EMAIL; }
});

test('🛡️ ADMIN : le rôle écrit dans le jeton n\'est jamais cru — il est relu en base à chaque requête', async () => {
  const j = await signupUser(app);
  await changerRole(j.email, 'admin');
  // jeton émis quand le compte était joueur : le rôle admin s'applique quand même tout de suite...
  const r1 = await app.inject({ method: 'GET', url: '/lab/pending', headers: authed(j.token) });
  assert.equal(r1.statusCode, 403);
  assert.match(r1.json().error, /MFA/, 'refusé pour la MFA, plus pour le rôle : le rôle a été relu en base');
  // ...et un rôle retiré aussi, même avec un jeton qui dit « admin »
  const jetonAdmin = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: j.email, password: j.password } })).json().token;
  assert.equal(jwt.decode(jetonAdmin).role, 'admin');
  await changerRole(j.email, 'player');
  const r2 = await app.inject({ method: 'GET', url: '/lab/pending', headers: authed(jetonAdmin) });
  assert.equal(r2.statusCode, 403);
  assert.match(r2.json().error, /rôle/);
});

test('ADMIN : scripts/admin.js refuse une adresse sans compte actif', async () => {
  const r = await changerRole(uniqueEmail('personne'), 'admin');
  assert.equal(r.ok, false);
});

// ─── 3. Compte supprimé ───

test('🛡️ SUPPRESSION : après DELETE /account, le jeton ne marche plus et ne recrée aucune donnée', async () => {
  const u = await signupUser(app);
  // une autre session du même compte (un autre appareil)
  const autre = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: u.password } })).json().token;
  assert.equal((await app.inject({ method: 'DELETE', url: '/account', headers: authed(u.token) })).statusCode, 200);
  for (const tok of [u.token, autre]) {
    assert.equal((await app.inject({ method: 'PUT', url: '/progress', headers: authed(tok), payload: { xp: 5 } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/game/result', headers: authed(tok), payload: { result: 'win', mode: 'ai' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/account/export', headers: authed(tok) })).statusCode, 401);
  }
  const { rows } = await db.query('SELECT (SELECT count(*) FROM game_results WHERE user_id=$1)::int AS g, (SELECT count(*) FROM progress WHERE user_id=$1)::int AS p', [u.user.id]);
  assert.deepEqual(rows[0], { g: 0, p: 0 }, 'aucune donnée recréée au nom du compte effacé');
});

// ─── 4. MFA ───

async function compteMfa() {
  const u = await signupUser(app);
  const s = (await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(u.token) })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(u.token), payload: { otp: totpCode(s.secret) } })).statusCode, 200);
  return { ...u, secret: s.secret };
}
const connexion = (u, otp) => app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: u.password, otp } });

test('🛡️ MFA : un jeton volé ne retire plus la MFA par /mfa/setup', async () => {
  const u = await compteMfa();
  const r = await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(u.token) });
  assert.equal(r.statusCode, 409);
  const st = await app.inject({ method: 'GET', url: '/mfa/status', headers: authed(u.token) });
  assert.equal(st.json().enabled, true, 'la MFA est toujours active');
  assert.equal((await connexion(u)).statusCode, 401, 'la connexion sans code reste refusée');
});

test('🛡️ MFA : un même code ne sert qu\'une fois (rejeu refusé)', async () => {
  const u = await compteMfa();
  const code = totpCode(u.secret, Date.now() + 30000); // fenêtre suivante : celle de l'activation est consommée
  assert.equal((await connexion(u, code)).statusCode, 200);
  const rejeu = await connexion(u, code);
  assert.equal(rejeu.statusCode, 401);
  assert.match(rejeu.json().error, /déjà utilisé/);
  // le code d'activation non plus
  assert.equal((await connexion(u, totpCode(u.secret))).statusCode, 401);
});

test('🛡️ MFA : deux connexions simultanées avec le même code → une seule passe', async () => {
  const u = await compteMfa();
  const code = totpCode(u.secret, Date.now() + 30000);
  const r = await Promise.all([connexion(u, code), connexion(u, code), connexion(u, code)]);
  assert.equal(r.filter(x => x.statusCode === 200).length, 1);
});

test('🛡️ MFA : ' + MFA_ESSAIS_MAX + ' codes faux bloquent la MFA du compte, même le bon code est alors refusé', async () => {
  const u = await compteMfa();
  for (let i = 0; i < MFA_ESSAIS_MAX; i++) assert.equal((await connexion(u, '000000')).statusCode, 401);
  const bloque = await connexion(u, totpCode(u.secret, Date.now() + 30000));
  assert.equal(bloque.statusCode, 429);
  // le blocage vaut aussi pour /mfa/disable (un jeton volé ne contourne pas la limite)
  assert.equal((await app.inject({ method: 'POST', url: '/mfa/disable', headers: authed(u.token), payload: { otp: '123456' } })).statusCode, 429);
  await redis.del('mfa:echecs:' + u.user.id); // fin du blocage (15 min en vrai)
  assert.equal((await connexion(u, totpCode(u.secret, Date.now() + 30000))).statusCode, 200);
});

test('MFA : un code juste remet le compteur d\'échecs à zéro', async () => {
  const u = await compteMfa();
  for (let i = 0; i < MFA_ESSAIS_MAX - 1; i++) await connexion(u, '000000');
  assert.equal((await connexion(u, totpCode(u.secret, Date.now() + 30000))).statusCode, 200);
  assert.equal(await redis.exists('mfa:echecs:' + u.user.id), 0);
});

// ─── 5. Scores déclarés par le client ───

test('🛡️ SCORES : PUT /progress { elo: 4000 } ne change pas l\'Elo — il appartient au serveur', async () => {
  const u = await signupUser(app);
  const r = await app.inject({ method: 'PUT', url: '/progress', headers: authed(u.token), payload: { xp: 10, level: 2, streak: 1, elo: 4000 } });
  assert.equal(r.statusCode, 200);
  const p = (await app.inject({ method: 'GET', url: '/progress', headers: authed(u.token) })).json();
  assert.equal(p.elo, 1200);
  assert.equal(p.xp, 10);
});

test('🛡️ SCORES : une victoire « en ligne » ne se déclare pas (50 envois → 0 enregistrée)', async () => {
  const u = await signupUser(app);
  let acceptees = 0;
  for (let i = 0; i < 50; i++) if ((await app.inject({ method: 'POST', url: '/game/result', headers: authed(u.token), payload: { result: 'win', mode: 'online' } })).statusCode === 201) acceptees++;
  assert.equal(acceptees, 0);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM game_results WHERE user_id=$1 AND mode='online'`, [u.user.id]);
  assert.equal(rows[0].n, 0);
});

test('🛡️ SCORES : tournoi — l\'XP est fixée par le serveur, un tournoi passé ou à venir est refusé', async () => {
  const u = await signupUser(app);
  const mois = tournoiDuMois();
  const r = await app.inject({ method: 'POST', url: '/tournament/result', headers: authed(u.token), payload: { tournamentId: mois, result: 'champion', xpAwarded: 100000 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().xpAwarded, TOURNOI_XP.champion);
  const { rows } = await db.query(`SELECT xp_awarded FROM tournament_entries WHERE user_id=$1`, [u.user.id]);
  assert.equal(rows[0].xp_awarded, 1000, 'les 100 000 XP annoncées sont sans effet');
  for (const id of ['2020-01', '2099-12', 'abc']) {
    assert.equal((await app.inject({ method: 'POST', url: '/tournament/result', headers: authed(u.token), payload: { tournamentId: id, result: 'champion' } })).statusCode, 400, id);
  }
});

test('SCORES : tournoisOuverts accepte le mois en cours, à un jour près', () => {
  const t = Date.UTC(2026, 10, 30, 23, 30); // 30 novembre, 23 h 30 UTC
  assert.deepEqual(tournoisOuverts(t), ['2026-11', '2026-12']);
  assert.deepEqual(tournoisOuverts(Date.UTC(2026, 10, 15)), ['2026-11']);
});
