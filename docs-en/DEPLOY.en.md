🇫🇷 [Version française](../docs-fr/DEPLOY.fr.md)

# Going live

This backend is **dormant**: it has never run in production. This document
gives the steps to follow, not a green light. Read the last section before
running anything.

## What's ready

- `Dockerfile` — production image, dependencies without build tools,
  runs as an unprivileged user, health probe on `/health`.
- `docker-compose.yml` — the full stack (API + PostgreSQL + Redis) for a
  VPS or a local trial.
- `.env.example` — every expected variable, documented.
- `.github/workflows/test.yml` — the test suite and an engine sync check on every push.

## Local trial, in three commands

```bash
cp .env.example .env          # then fill in JWT_SECRET
docker compose up -d db redis
docker compose run --rm api npm run migrate
docker compose up -d api
curl localhost:3000/health
```

Migrations run **explicitly**, not on container startup. A container that
migrates itself replays the schema on every restart, and once per replica.

Run `npm run migrate` **twice in a row**: `migrations/run.js` replays every
`.sql` file on each run, with no tracking table. Every statement therefore
has to be idempotent. That's the first test to run, and it has never been
run against a real PostgreSQL.

## Managed hosting

On Scaleway, Clever Cloud, or Render, keep only the `api` service: the
database and Redis are provided by the platform. Set `DATABASE_URL`,
`REDIS_URL`, and above all `DATABASE_CA` with the host's certificate —
without it, strict TLS verification for the database is disabled.

## Secrets

Generate `JWT_SECRET` with `openssl rand -hex 32`. It should only ever live
in the host's secrets manager. A secret that has passed through a config
file, a repository, or a conversation should be considered compromised and
regenerated before going live.

## Before opening to the public

None of the following is done, and each of these points carries real weight:

- **A domain name and a TLS reverse proxy.** The container only listens on
  `127.0.0.1` in the provided stack, deliberately. Never expose it directly.
- **Database backups.** None are configured.
- **GDPR obligations.** As soon as an account exists, you're processing
  personal data: privacy notices, legal basis, retention periods, an erasure
  procedure. The code includes a purge job (`src/jobs/purge.js`), but nothing
  triggers it.
- **A security audit.** The authentication layer — argon2id, JWT, TOTP, RBAC —
  has been written but never faced real traffic. Dependencies need
  re-auditing: they've aged without ever being used.
- **A reason.** Today, game-by-code already lets two people play without an
  account or a server. Until someone actually asks to pick up their games on
  another device, putting this online adds an attack surface and a
  maintenance burden in exchange for no real benefit.

The reasonable trigger is a third player asking for cross-device sync, or a
genuinely shared leaderboard.
