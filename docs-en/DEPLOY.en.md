🇫🇷 [Version française](../docs-fr/DEPLOY.fr.md)

# Going live

This backend is **dormant**: it has never run in production. This document
gives the steps to follow, not a green light. Read the last section before
running anything.

## What's ready

- `Dockerfile` — production image, dependencies without build tools,
  runs as an unprivileged user, health probe on `/health`.
- `docker-compose.yml` — the full stack (API + PostgreSQL + Redis) for a
  VPS or a local trial, plus optional compute executors (`calcul` profile).
- `.env.example` — every expected variable, documented.
- `.github/workflows/test.yml` — the test suite, an engine sync check, and an
  end-to-end trial of the Docker stack (`scripts/essai-docker.js`: image built,
  database + Redis + API in production mode, two executors playing a campaign the
  API verifies, then unplugged) on every push.

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

In the stack, the database is only reachable over Docker's internal network and
has no certificate: `DATABASE_URL` carries `?sslmode=disable` there (without it,
`NODE_ENV=production` requires SSL and the API could not connect). A database
hosted elsewhere keeps SSL (`DATABASE_CA`).

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

Without `JWT_SECRET`, or with the example value, or with fewer than 32
characters, the server **refuses to start**. Before November 2026 it started
with a secret written in this public repository: anyone could forge a valid
token for any account.

## The proxy in front of the server (`TRUST_PROXY`)

Rate limiting counts requests per address. Behind a proxy (Cloudflare, then
the TLS reverse proxy), the client's address only arrives through the
`X-Forwarded-For` header — which any client can also write. So the server
only trusts that header when it comes from a declared proxy:

- `TRUST_PROXY` empty (the default): nobody is trusted. Behind a proxy, every
  request seems to come from it and they all share one limit: too strict, to
  be set before opening, but never bypassable.
- `TRUST_PROXY=127.0.0.1` (or a range, e.g. `172.16.0.0/12` for the Docker
  gateway of `docker-compose.yml`): the address the reverse proxy reaches the
  server from.
- `TRUST_PROXY=true` is refused at startup.

With Cloudflare in front of the reverse proxy, the latter must write the real
address: accept only Cloudflare's ranges, and replace `X-Forwarded-For` with
the `CF-Connecting-IP` header (with nginx: `set_real_ip_from` for each
Cloudflare range, `real_ip_header CF-Connecting-IP`, then
`proxy_set_header X-Forwarded-For $remote_addr`).

## The compute network (`/ordo`)

- **The game's CSP** currently allows no connection to the server: on opening day, add its address to `connect-src` (in the game's `src/00-html.part`), together with `BACKEND.enabled = true` and `BACKEND.url`.
- **The engine**: after every game version that changes the worker code, `node scripts/importer-moteur.js <that version's index.html>`, then deploy (Docker stack: `docker compose build`, the engine is copied into the image). Otherwise up-to-date browsers can no longer plug in (the server refuses an engine it can't replay).
- **Verification** uses compute on the server (one thread, one verification at a time: a few seconds per game at depth 2). Limit it with `ORDO_VERIF_COUPS` on a small server.

## Administrators

There is no bootstrap admin account anymore (`BOOTSTRAP_ADMIN_EMAIL` has no
effect: signing up with that address gave the admin role to whoever came
first, since nothing checks that you own the address). The future admin signs
up normally, then, on the server:

```bash
node --env-file=.env scripts/admin.js nommer <email>     # or: retirer <email>
# in the Docker stack:
docker compose exec api node scripts/admin.js nommer <email>
```

They must then enable MFA (`/mfa/setup` then `/mfa/enable`): admin actions
refuse without it. The only one today is approving distributed-Lab candidates
(`/lab/pending`, `/lab/job/:id/approve`, `/lab/job/:id/reject`).

## Compute executors in containers

The `executant` service of `docker-compose.yml` plugs the operator's machines into
the scheduler, in the `serveur` family: it has its own switch, separate from the
players' devices. Same image as the API, but the container gets neither the `.env`
nor database access, only the API's address and a **compute account** with no
admin rights (so it logs in without MFA; a leak of its password only yields
missions, verified like all others).

```bash
# 1. the compute account signs up normally (site or /auth/signup), then:
docker compose exec api node scripts/admin.js calcul <email>
# 2. in .env: ABA_CALCUL_EMAIL, ABA_CALCUL_MDP, ABA_COEURS (cores per container, 2)
# 3. plug in three containers, then unplug them
docker compose --profile calcul up -d --scale executant=3
docker compose logs -f executant
docker compose stop executant
```

`docker compose stop` sends SIGTERM: each executor hands its running missions back
to the queue before stopping. To pause everything without stopping the containers,
the admin unplugs the `serveur` family (`POST /ordo/familles/serveur`
`{"actif": false}`): they wait and resume when it comes back. Once plugged in, a
container never stops on its own (server restarted, token expired: it waits, logs
in again and resumes), so there is no restart loop. The API verifies results with
the engine copied into the image (`moteur/`): rebuild the image after every
`scripts/importer-moteur.js`.

On machines other than the API's, run the same image with
`ABA_API=https://api.example.com` (or `node scripts/executant.js --famille serveur`).
The compute account plugs in at most 64 live executors at once
(`ORDO_EXECUTANTS_CALCUL`).

## Before opening to the public

None of the following is done, and each of these points carries real weight:

- **A domain name and a TLS reverse proxy.** The container only listens on
  `127.0.0.1` in the provided stack, deliberately. Never expose it directly.
- **Database backups.** None are configured.
- **GDPR obligations.** As soon as an account exists, you're processing
  personal data: privacy notices, legal basis, retention periods, an erasure
  procedure. The code includes a purge job (`src/jobs/purge.js`), but nothing
  triggers it.
- **Finishing the security audit.** A first audit (November 2026), run as if
  players were connecting, found and fixed eight verified flaws: default JWT
  secret, bypassable rate limiting, bootstrap admin, sessions of a deleted
  account, MFA (removal without a code, replay, unlimited attempts), scores
  declared by the client, distributed Lab, dependencies. Every attack is
  replayed by the tests. Still open, less severe: weak passwords accepted
  (`password`, `12345678`), signup and login response time revealing whether
  an address has an account, usernames containing HTML (to be escaped on
  display). An outside review is still advisable before opening.
- **A reason.** Today, game-by-code already lets two people play without an
  account or a server. Until someone actually asks to pick up their games on
  another device, putting this online adds an attack surface and a
  maintenance burden in exchange for no real benefit.

The reasonable trigger is a third player asking for cross-device sync, or a
genuinely shared leaderboard.
