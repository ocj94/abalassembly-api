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
- Systematic verification of distributed-Lab submissions (engine replay, opening authenticity) — see the README
- Dependabot enabled (alerts + automatic security updates for npm dependencies)
