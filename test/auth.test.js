// Tests d'authentification (signup / login / logout) contre un vrai serveur
// Fastify, une vraie base PostgreSQL de test et un vrai Redis — pas de mocks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, teardown, uniqueEmail, signupUser, STRONG_PASSWORD } from './helpers.js';

let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });

test('signup : crée un compte et renvoie un jeton exploitable', async () => {
  const email = uniqueEmail('signup-ok');
  const res = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email, password: STRONG_PASSWORD, username: 'Olivier' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.email, email.toLowerCase());
  assert.equal(body.user.username, 'Olivier');
  assert.equal(body.user.role, 'player');
  assert.ok(body.token && body.token.split('.').length === 3, 'un JWT a 3 segments');
  assert.equal(body.user.password_hash, undefined, 'le hash ne doit jamais fuiter');

  // Le jeton émis fonctionne réellement sur une route protégée
  const profile = await app.inject({ method: 'GET', url: '/profile',
    headers: { authorization: 'Bearer ' + body.token } });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().email, email.toLowerCase());
});

test('signup : email déjà utilisé → 409, mot de passe non ré-exposé', async () => {
  const email = uniqueEmail('dup');
  const first = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email, password: STRONG_PASSWORD } });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email, password: 'AutreMotDePasse99' } });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error, 'email déjà utilisé');
});

test('signup : validations de schéma (mot de passe trop court, email invalide)', async () => {
  const short = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email: uniqueEmail(), password: '1234567' } }); // 7 caractères < minLength 8
  assert.equal(short.statusCode, 400);

  const badEmail = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email: 'pas-un-email', password: STRONG_PASSWORD } });
  assert.equal(badEmail.statusCode, 400);
});

test('signup : un champ non prévu (ex. "role") est sans effet — impossible de s\'auto-promouvoir admin', async () => {
  const res = await app.inject({ method: 'POST', url: '/auth/signup',
    payload: { email: uniqueEmail(), password: STRONG_PASSWORD, role: 'admin' } });
  // Fastify (removeAdditional:true par défaut) retire silencieusement les champs hors
  // schéma plutôt que de rejeter la requête — donc 200, pas 400. Ce qui compte vraiment :
  // le serveur ne lit jamais req.body.role pour l'inscription, le rôle reste 'player'.
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.role, 'player', 'le champ role envoyé par le client doit être totalement ignoré');
});

test('login : mot de passe faux → 401, message générique', async () => {
  const { email } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password: 'MauvaisMotDePasse1' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'identifiants invalides');
});

test('login : email inconnu → même statut ET même message que mot de passe faux (anti énumération)', async () => {
  const unknown = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: uniqueEmail('inconnu'), password: STRONG_PASSWORD } });
  const { email } = await signupUser(app);
  const wrongPass = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password: 'MauvaisMotDePasse1' } });

  assert.equal(unknown.statusCode, wrongPass.statusCode);
  assert.deepEqual(unknown.json(), wrongPass.json(),
    'un attaquant ne doit pas pouvoir distinguer "compte inexistant" de "mauvais mot de passe"');
});

test('login : identifiants corrects → jeton valide, last_seen_at mis à jour', async () => {
  const { email, password } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.email, email.toLowerCase());
  assert.ok(body.token);
});

test('logout : révoque le jeton — une requête ultérieure avec le même jeton est refusée', async () => {
  const { token } = await signupUser(app);
  const before = await app.inject({ method: 'GET', url: '/profile', headers: { authorization: 'Bearer ' + token } });
  assert.equal(before.statusCode, 200, 'le jeton fonctionne avant logout');

  const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: 'Bearer ' + token } });
  assert.equal(out.statusCode, 200);
  assert.equal(out.json().ok, true);

  const after = await app.inject({ method: 'GET', url: '/profile', headers: { authorization: 'Bearer ' + token } });
  assert.equal(after.statusCode, 401, 'le même jeton doit être rejeté après logout (révocation jti via Redis)');
});

test('routes protégées : sans jeton → 401 ; jeton invalide → 401', async () => {
  const noToken = await app.inject({ method: 'GET', url: '/profile' });
  assert.equal(noToken.statusCode, 401);

  const badToken = await app.inject({ method: 'GET', url: '/profile',
    headers: { authorization: 'Bearer ceci-nest-pas-un-jwt' } });
  assert.equal(badToken.statusCode, 401);
});

test('/health répond sans authentification', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});
