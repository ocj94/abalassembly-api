// Tests MFA (TOTP, RFC 6238).
// Le point le plus important : notre implémentation maison (src/totp.js, zéro
// dépendance) est vérifiée contre un ORACLE INDÉPENDANT — pyotp (Python,
// bibliothèque tierce établie) — pas contre elle-même. Un bug qui produirait
// des codes cohérents en interne mais faux au sens RFC serait invisible dans
// un test qui ne fait que rappeler totpCode() ; comparer à pyotp le révèle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeApp, teardown, signupUser } from './helpers.js';
import { generateSecret, totpCode } from '../src/totp.js';

let app;
before(async () => { app = await makeApp(); });
after(async () => { await teardown(app); });

function authed(token) { return { authorization: 'Bearer ' + token }; }

function pyotpCode(secretBase32, atMs) {
  const py = `
import pyotp, sys
t = pyotp.TOTP(sys.argv[1])
print(t.at(int(sys.argv[2]) / 1000))
`;
  return execFileSync('python3', ['-c', py, secretBase32, String(atMs)]).toString().trim();
}

test('oracle RFC 6238 : notre TOTP maison est bit-à-bit identique à pyotp (bibliothèque tierce)', () => {
  const secret = generateSecret(); // secret aléatoire base32, comme en production
  const now = Date.now();
  // 5 instants distincts (fenêtres 30s) : passé récent, présent, futur proche
  for (const offsetSteps of [-2, -1, 0, 1, 2]) {
    const t = now + offsetSteps * 30_000;
    const ours = totpCode(secret, t);
    const theirs = pyotpCode(secret, t);
    assert.equal(ours, theirs, `désaccord à l'instant ${new Date(t).toISOString()} (offset ${offsetSteps})`);
  }
});

test('setup : génère un secret et une URI otpauth valide, MFA reste désactivée', async () => {
  const { token } = await signupUser(app);
  const res = await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(token) });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(/^[A-Z2-7]+$/.test(body.secret), 'secret en base32 valide');
  assert.ok(body.otpauth.startsWith('otpauth://totp/'));
  assert.ok(body.otpauth.includes('secret=' + body.secret));

  const status = await app.inject({ method: 'GET', url: '/mfa/status', headers: authed(token) });
  assert.equal(status.json().enabled, false, 'setup seul n\'active pas la MFA');
});

test('enable : code invalide refusé (401), code correct active la MFA', async () => {
  const { token } = await signupUser(app);
  const setup = await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(token) });
  const { secret } = setup.json();

  const bad = await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(token),
    payload: { otp: '000000' } });
  assert.equal(bad.statusCode, 401);

  const good = await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(token),
    payload: { otp: totpCode(secret) } });
  assert.equal(good.statusCode, 200);
  assert.equal(good.json().enabled, true);

  const status = await app.inject({ method: 'GET', url: '/mfa/status', headers: authed(token) });
  assert.equal(status.json().enabled, true);
});

test('login avec MFA activée : refusé sans code, refusé avec mauvais code, accepté avec le bon', async () => {
  const { email, password, token } = await signupUser(app);
  const setup = await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(token) });
  const { secret } = setup.json();
  await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(token),
    payload: { otp: totpCode(secret) } });

  const noOtp = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  assert.equal(noOtp.statusCode, 401);
  assert.equal(noOtp.json().mfaRequired, true);

  const wrongOtp = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password, otp: '000000' } });
  assert.equal(wrongOtp.statusCode, 401);
  assert.equal(wrongOtp.json().mfaRequired, true);

  const rightOtp = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password, otp: totpCode(secret) } });
  assert.equal(rightOtp.statusCode, 200);
  assert.ok(rightOtp.json().token);
});

test('disable : exige un code valide, puis retire réellement la MFA (login sans code redevient possible)', async () => {
  const { email, password, token } = await signupUser(app);
  const setup = await app.inject({ method: 'POST', url: '/mfa/setup', headers: authed(token) });
  const { secret } = setup.json();
  await app.inject({ method: 'POST', url: '/mfa/enable', headers: authed(token), payload: { otp: totpCode(secret) } });

  const badDisable = await app.inject({ method: 'POST', url: '/mfa/disable', headers: authed(token),
    payload: { otp: '000000' } });
  assert.equal(badDisable.statusCode, 401, 'un attaquant avec le jeton mais sans le TOTP ne peut pas désactiver la MFA');

  const okDisable = await app.inject({ method: 'POST', url: '/mfa/disable', headers: authed(token),
    payload: { otp: totpCode(secret) } });
  assert.equal(okDisable.statusCode, 200);
  assert.equal(okDisable.json().enabled, false);

  const loginNow = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  assert.equal(loginNow.statusCode, 200, 'plus besoin de code après désactivation réelle en base');
});
