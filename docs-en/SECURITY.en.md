🇫🇷 [Version française](../docs-fr/SECURITY.fr.md)

# Security policy

GDPR-ready backend for Abalassembly (Node + Fastify + PostgreSQL + Redis).
**Currently dormant**: not deployed, no real data passes through it until
the game has `BACKEND.enabled = true`.

## Reporting a vulnerability

Use this repository's **[Security → Report a vulnerability](https://github.com/ocj94/abalassembly-api/security/advisories/new)**
tab (a private report) rather than a public issue.

Please include:
- A clear description of the problem
- Steps to reproduce it
- The potential impact

## Practices already in place

- **argon2id** passwords, never stored in plain text
- **JWT** with a revocable `jti` (logout via Redis)
- **TOTP MFA** (RFC 6238, no external dependency)
- **Redis rate-limiting** (anti-brute-force)
- **Parameterized** SQL queries (injection is not possible)
- **Audit log** with a **hashed** IP, never stored in plain text
- No startup without a strong `JWT_SECRET`; the account is re-read from the database on every request (a deleted account keeps no session, the token's role is never trusted)
- MFA: a code works only once, 5 wrong codes lock for 15 minutes, it can't be removed without a code; admin actions reserved to admins with MFA, appointed on the server (`scripts/admin.js`)
- Rate limiting counted on the real address: `X-Forwarded-For` is only trusted from a declared proxy (`TRUST_PROXY`)
- Elo, online wins and tournament XP are never declared by the client
- Distributed Lab: one game per submission, replayed and finished, only its result counts; at least 3 contributors; an admin's approval before any new champion — see the README
- Every attack from the November 2026 audit is replayed by the test suite (`test/securite.test.js`, 🛡️ tests in `test/lab.test.js` and `test/ratelimit.test.js`)
- Dependabot enabled (alerts + automatic security updates for npm dependencies)
