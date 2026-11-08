// Protections contre les robots (src/protection.js, src/preuve.js) : limites propres
// à la connexion et à l'inscription, IPv6 par bloc /64, mots de passe faux par
// compte, preuve de travail, temps de réponse identique pour un email inconnu.
// Fichier à part : il remet les vraies limites des routes d'authentification, que
// test/helpers.js relève pour les autres fichiers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeApp, teardown, uniqueEmail, signupUser, STRONG_PASSWORD, preuve } from './helpers.js';
import { cleIp, LIMITE_CONNEXION, LIMITE_INSCRIPTION, ECHECS_AVANT_PREUVE, ECHECS_AVANT_BLOCAGE } from '../src/protection.js';
import { nouveauDefi, verifierPreuve, resoudreDefi, bitsNuls } from '../src/preuve.js';

delete process.env.RATE_LIMIT_AUTH_MAX_TEST_OVERRIDE;
let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });

// une adresse neuve par appel : chaque test a ses propres compteurs
const octet = () => crypto.randomInt(1, 255);
const ipv4 = () => `198.18.${octet()}.${octet()}`;
const bloc64 = () => `2001:db8:${crypto.randomBytes(2).toString('hex')}:${crypto.randomBytes(2).toString('hex')}`;
const connexion = (payload, ip = ipv4()) => app.inject({ method: 'POST', url: '/auth/login', remoteAddress: ip, payload });

test('cleIp : une IPv6 compte par bloc /64, une IPv4 (même écrite en IPv6) par adresse', () => {
  assert.equal(cleIp('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(cleIp('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(cleIp('2001:0DB8:0001:0002:ffff::1'), '2001:db8:1:2::/64');
  assert.equal(cleIp('::1'), '0:0:0:0::/64');
  assert.equal(cleIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(cleIp('203.0.113.9'), '203.0.113.9');
});

test('🛡️ connexion : ' + LIMITE_CONNEXION + ' essais par minute et par adresse ; changer d\'adresse dans le même /64 ne sert à rien', async () => {
  const b = bloc64(), statuts = [];
  for (let i = 0; i <= LIMITE_CONNEXION; i++)     // une adresse différente du bloc à chaque essai
    statuts.push((await connexion({ email: uniqueEmail(), password: 'MauvaisMotDePasse1' }, `${b}:0:0:0:${i + 1}`)).statusCode);
  assert.deepEqual(statuts.slice(0, LIMITE_CONNEXION), Array(LIMITE_CONNEXION).fill(401));
  assert.equal(statuts[LIMITE_CONNEXION], 429, 'le même bloc /64 est bloqué');
  const ailleurs = await connexion({ email: uniqueEmail(), password: 'MauvaisMotDePasse1' }, `${bloc64()}::1`);
  assert.equal(ailleurs.statusCode, 401, 'un autre abonné n\'est pas touché');
});

test('🛡️ inscription : ' + LIMITE_INSCRIPTION + ' comptes par heure et par adresse', async () => {
  const ip = ipv4(), statuts = [];
  for (let i = 0; i <= LIMITE_INSCRIPTION; i++)
    statuts.push((await app.inject({ method: 'POST', url: '/auth/signup', remoteAddress: ip,
      payload: { email: uniqueEmail('lim'), password: STRONG_PASSWORD, preuve: await preuve(app) } })).statusCode);
  assert.deepEqual(statuts, [...Array(LIMITE_INSCRIPTION).fill(200), 429]);
});

test('🤖 preuve de travail : exigée à l\'inscription, signée, à usage unique, non falsifiable', async () => {
  const inscrire = (p) => app.inject({ method: 'POST', url: '/auth/signup', remoteAddress: ipv4(),
    payload: Object.assign({ email: uniqueEmail('pdt'), password: STRONG_PASSWORD }, p === undefined ? {} : { preuve: p }) });
  const sans = await inscrire();
  assert.equal(sans.statusCode, 400); assert.equal(sans.json().preuveRequise, true);

  const bonne = await preuve(app);
  assert.equal((await inscrire(bonne)).statusCode, 200);
  const rejeu = await inscrire(bonne);
  assert.equal(rejeu.statusCode, 400); assert.match(rejeu.json().error, /déjà utilisée/);

  // un nonce qui ne donne pas assez de zéros
  const d = (await app.inject({ method: 'GET', url: '/auth/defi' })).json();
  const sel = JSON.parse(Buffer.from(d.defi.split('.')[0], 'base64url')).s;
  let faux = 0; while (bitsNuls(crypto.createHash('sha256').update(sel + ':' + faux).digest()) >= d.bits) faux++;
  assert.equal((await inscrire({ defi: d.defi, nonce: faux })).statusCode, 400);

  // baisser la difficulté dans le défi casse sa signature
  const charge = JSON.parse(Buffer.from(d.defi.split('.')[0], 'base64url'));
  const triche = Buffer.from(JSON.stringify(Object.assign(charge, { b: 0 }))).toString('base64url') + '.' + d.defi.split('.')[1];
  assert.equal((await inscrire({ defi: triche, nonce: 0 })).statusCode, 400);

  // la difficulté par défaut, hors tests : 17 bits (≈ 130 000 essais : 0,3 s sur un ordinateur, environ 1 s sur un téléphone)
  const avant = process.env.PREUVE_BITS; delete process.env.PREUVE_BITS;
  try { assert.equal(nouveauDefi().bits, 17); } finally { process.env.PREUVE_BITS = avant; }
  // défi résolu côté Node (exécutant, essai Docker) : accepté une fois
  assert.equal((await verifierPreuve(resoudreDefi(nouveauDefi().defi))).ok, true);
});

test('🛡️ mots de passe faux pour un compte : preuve de travail après ' + ECHECS_AVANT_PREUVE + ', blocage après ' + ECHECS_AVANT_BLOCAGE + ', même depuis des adresses différentes', async () => {
  const u = await signupUser(app, { ip: ipv4() });
  const faux = async () => connexion({ email: u.email, password: 'MauvaisMotDePasse1', preuve: await preuve(app) });
  const r = [];
  for (let i = 0; i < ECHECS_AVANT_PREUVE; i++) r.push((await connexion({ email: u.email, password: 'MauvaisMotDePasse1' })).json());
  assert.equal(r[ECHECS_AVANT_PREUVE - 2].preuveRequise, undefined);
  assert.equal(r[ECHECS_AVANT_PREUVE - 1].preuveRequise, true, 'le dernier échec annonce la preuve');

  const sansPreuve = await connexion({ email: u.email, password: u.password });
  assert.equal(sansPreuve.statusCode, 401, 'même le bon mot de passe doit venir avec sa preuve');
  assert.equal(sansPreuve.json().preuveRequise, true);
  const avecPreuve = await connexion({ email: u.email, password: u.password, preuve: await preuve(app) });
  assert.equal(avecPreuve.statusCode, 200, 'bon mot de passe + preuve : on entre, et le compteur repart de zéro ');
  assert.equal((await connexion({ email: u.email, password: u.password })).statusCode, 200);

  for (let i = 0; i < ECHECS_AVANT_PREUVE; i++) await connexion({ email: u.email, password: 'MauvaisMotDePasse1' });
  for (let i = ECHECS_AVANT_PREUVE; i < ECHECS_AVANT_BLOCAGE; i++) assert.equal((await faux()).statusCode, 401);
  const bloque = await connexion({ email: u.email, password: u.password, preuve: await preuve(app) });
  assert.equal(bloque.statusCode, 429, 'bloqué 15 minutes, même avec le bon mot de passe');
  assert.match(bloque.json().error, /15 minutes/);
  // la session déjà ouverte n'est pas touchée
  assert.equal((await app.inject({ method: 'GET', url: '/profile', headers: { authorization: 'Bearer ' + u.token } })).statusCode, 200);
});

test('🛡️ email inconnu : même réponse et même temps de calcul qu\'un mauvais mot de passe', async () => {
  const u = await signupUser(app, { ip: ipv4() });
  const mesure = async (email) => {
    const t = [];
    for (let i = 0; i < ECHECS_AVANT_PREUVE; i++) {   // au-delà, la preuve serait demandée avant tout calcul
      const t0 = process.hrtime.bigint();
      const r = await connexion({ email, password: 'MauvaisMotDePasse' + i });
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.equal(r.statusCode, 401); assert.equal(r.json().error, 'identifiants invalides');
    }
    return t.sort((a, b) => a - b)[1];
  };
  await connexion({ email: uniqueEmail(), password: 'Echauffement1' });     // le condensé factice se calcule une fois
  const connu = await mesure(u.email);
  const inconnu = await mesure(uniqueEmail('personne'));
  assert.ok(inconnu > connu * 0.5, `email inconnu ${inconnu.toFixed(1)} ms contre ${connu.toFixed(1)} ms pour un compte existant`);
});
