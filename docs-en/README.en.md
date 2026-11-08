🇫🇷 [Version française](../docs-fr/README.fr.md)

# abalassembly-api

[![Tests](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml/badge.svg)](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](../LICENSE)

**Dormant** backend for Abalassembly. Built but not deployed: the single-file HTML only calls it once `BACKEND.enabled = true` is set there.

Stack: **Node + Fastify · PostgreSQL · Redis**, behind **Cloudflare**, hosted in the **EU**. Designed GDPR-ready (privacy-by-design).

## Running locally

```bash
cp .env.example .env          # then fill it in (generate JWT_SECRET: openssl rand -hex 32)
npm install
npm run migrate               # creates the PostgreSQL schema (001 + 002 MFA)
npm run dev                   # starts the API on http://localhost:3000
```

## Tests

Integration suite against a **real** PostgreSQL and a **real** Redis (no mocks) — 24 tests covering signup/login, MFA (TOTP checked against `pyotp`, an independent third-party library), GDPR export (portability), and cascading deletion (right to erasure), plus rate limiting.

```bash
# requires a local PostgreSQL and Redis (e.g. `apt install postgresql redis-server`)
createuser aba_test --superuser          # once
createdb abalassembly_test -O aba_test   # once
npm test                                 # applies migrations then runs the suite (node --test)
```

`.env.test` (committed, local values with no real secret) sets the configuration `npm test` uses — never reuse it in production.

## Endpoints

| Method | Route | Auth | Role |
|---|---|---|---|
| POST | `/auth/signup` | — | create an account (argon2) |
| POST | `/auth/login` | — | authenticate → JWT |
| POST | `/auth/logout` | ✔ | revoke the token |
| GET/PUT | `/profile` | ✔ | read / edit the profile |
| GET/PUT | `/progress` | ✔ | sync XP/level/streak (Elo is kept by the server) |
| POST | `/game/result` | ✔ | record a game's result |
| GET | `/game/history` | ✔ | personal history (last 200 games) |
| POST | `/tournament/result` | ✔ | submit a result of this month's tournament (XP set by the server) |
| GET | `/tournament/leaderboard` | — | world leaderboard |
| GET | `/lab/champion` | — | current distributed-Lab weights (public) |
| GET | `/lab/contributors` | — | contributor leaderboard, reliability (public) |
| GET | `/lab/job` | ✔ | current collective test job + suggested layout |
| POST | `/lab/job` | ✔ | propose a candidate to test |
| POST | `/lab/result` | ✔ | submit one game (replayed; only it counts) |
| GET | `/lab/pending` | admin + MFA | confirmed candidates awaiting approval |
| POST | `/lab/job/:id/approve` · `/reject` | admin + MFA | make a candidate the champion, or discard it |
| GET | `/ordo/etat` | — | state of the compute network: families, missions, campaigns (public) |
| POST | `/ordo/executants` | ✔ | plug in an executor (family, cores, engine fingerprint) |
| POST | `/ordo/executants/:id/battement` · `/debrancher` · `/rebrancher` | ✔ | heartbeat (renews leases), unplug, plug back in |
| POST | `/ordo/missions/reclamer` | ✔ | ask for a mission (the server chooses) |
| POST | `/ordo/tentatives/:id/resultat` · `/abandon` | ✔ | hand in a game (verified before it counts), or give it up |
| GET | `/ordo/mes-executants` | ✔ | one's own executors and their figures |
| POST | `/ordo/campagnes` · GET `/ordo/campagnes/:id` · POST `…/etat` | admin + MFA | create, follow, pause or finish a campaign |
| POST | `/ordo/familles/:famille` · `/ordo/executants/:id/actif` · GET `/ordo/executants` | admin + MFA | the switches: a whole family, one executor |
| GET | `/account/export` | ✔ | **portability** (JSON export) |
| DELETE | `/account` | ✔ | **right to erasure** (real purge) |
| POST | `/mfa/setup` | ✔ | generate TOTP secret + QR (otpauth) |
| POST | `/mfa/enable` | ✔ | enable MFA (validates a first code) |
| POST | `/mfa/disable` | ✔ | disable it (requires a code) |
| GET | `/mfa/status` | ✔ | account's MFA status |
| GET | `/health` | — | liveness probe |

### Alphabetical route index

| Route | Method | Auth | Role |
|---|---|---|---|
| `/account` | DELETE | ✔ | **right to erasure** (real purge) |
| `/account/export` | GET | ✔ | **portability** (JSON export) |
| `/auth/login` | POST | — | authenticate → JWT |
| `/auth/logout` | POST | ✔ | revoke the token |
| `/auth/signup` | POST | — | create an account (argon2) |
| `/game/history` | GET | ✔ | personal history (last 200 games) |
| `/game/result` | POST | ✔ | record a game's result |
| `/health` | GET | — | liveness probe |
| `/lab/champion` | GET | — | current distributed-Lab weights (public) |
| `/lab/contributors` | GET | — | contributor leaderboard, reliability (public) |
| `/lab/job` | GET | ✔ | current collective test job + suggested layout |
| `/lab/job` | POST | ✔ | propose a candidate to test |
| `/lab/job/:id/approve` · `/reject` | POST | admin + MFA | make a candidate the champion, or discard it |
| `/lab/pending` | GET | admin + MFA | confirmed candidates awaiting approval |
| `/lab/result` | POST | ✔ | submit one game (replayed; only it counts) |
| `/mfa/disable` | POST | ✔ | disable it (requires a code) |
| `/mfa/enable` | POST | ✔ | enable MFA (validates a first code) |
| `/mfa/setup` | POST | ✔ | generate TOTP secret + QR (otpauth) |
| `/mfa/status` | GET | ✔ | account's MFA status |
| `/profile` | GET/PUT | ✔ | read / edit the profile |
| `/progress` | GET/PUT | ✔ | sync XP/level/streak (Elo is kept by the server) |
| `/tournament/leaderboard` | GET | — | world leaderboard |
| `/tournament/result` | POST | ✔ | submit a result of this month's tournament (XP set by the server) |

*Same content as the "Endpoints" table above, sorted by route instead of by domain — useful for looking up a specific route.*

## Distributed Lab (`/lab/*`)

The game's Lab (see `index.html`) normally runs locally, in each player's `localStorage` — see the Abalassembly README for that mode. These routes enable a **collective** variant: several players contribute duel results to the same test, aggregated server-side by a real SPRT (Wald sequential test, Fishtest/Stockfish/[OpenBench](https://github.com/AndyGrant/OpenBench) methodology).

**How it works**: a candidate (new evaluation weight set) is proposed via `POST /lab/job`. Players contribute to it via `POST /lab/result` — **one submission = one whole game** (layout + starting position + move sequence), which the server **replays with the real engine** (`src/engine.js`): the replay decides who won, and only that game counts. When the cumulative LLR crosses the threshold **with at least 3 different contributors**, the candidate goes **pending**: it only becomes the public champion (`GET /lab/champion`, no authentication) once an administrator with MFA enabled approves it (`POST /lab/job/:id/approve`, or `/reject` to discard it).

**Opening diversity** (idea borrowed from OpenBench): each submission states which of the **5 official layouts** (`standard`/`belgian`/`german`/`dutch`/`swiss`, see `src/layouts.js`) its witness game uses. `GET /lab/job` suggests the layout **least covered so far for this job** (greedy balancing) — whatever order contributors connect in, all 5 openings naturally end up represented, instead of a candidate over-specializing on a single starting position.

**Contributor leaderboard** (`GET /lab/contributors`, public): verified/submitted games per player, with a reliability ratio. Recognition for contribution, and a quiet trust signal — a contributor with a long history of verified submissions is more reliable than a brand-new account.

**Balancing which color the candidate plays**: in Abalone, Black always moves first (a fixed rule, never a choice) — but the candidate under test can play Black or White depending on the game, just like the local Lab, which already alternates `colorA` from one game to the next to avoid a first-player bias. `GET /lab/job` suggests the least-represented color so far (`suggestedColor`) and exposes the result breakdown by color (`byColor`), also available on `GET /lab/champion` for the promoted candidate — the server-side equivalent of `byColorAn`/`byColorAwin` already present client-side.

**A real design bug found and fixed** (migration `005_candidate_color.sql`): the field was originally called `sampleStartColor` and conflated two distinct notions — who starts the replayed game (always Black, mandatorily) and which side is the candidate under test (can be Black or White). Since every early test only covered candidates playing Black, this flaw was never exposed. Renamed to `candidateColor`, with the replay now always started by Black regardless of this value — plus two dedicated tests (a White candidate accepted with the correct result, a White candidate rejected if the result isn't inverted) so this never gets overlooked again.

**Anti-fraud — what's actually verified:**
- **Legality**: every move of the witness game is validated against the real rules of the game — a move invented out of thin air is rejected, never counted in the aggregate (see `test/lab.test.js`, tests marked 🛡️).
- **Opening authenticity**: the declared starting position must **exactly** match the claimed official layout — no claiming to test "standard" while actually playing from a rigged position.
- **A finished game, by the game Lab's rules**: 6 marbles pushed off, a 3-marble lead (the Lab stops the game there), or the 80-ply limit (the leader wins, equal = draw). An unfinished game doesn't count; a move played after the end, or beyond 80 plies, gets the game refused.
- **Result consistency**: the announced winner must be the replay's, correctly interpreted based on the candidate's color — announcing a win that didn't happen (or wrongly inverting the result for a White candidate) is detected. What the server counts is the replay's result, never a number announced by the client.
- **Bounded weights**: every candidate weight stays within the game Lab's bounds (0 to `SPSA_MAX`) — an AI with negative weights, trying to lose, is refused outright.
- **A human decision**: at least 3 contributors for the SPRT to conclude, then approval by an administrator with MFA before weights reach every player.
- **What is NOT verified**: the AI's own thinking (search/evaluation) isn't replayed for every submission — only the legality, opening authenticity, and result of the game. Colluding accounts fabricating legal games aren't caught by this mechanism: that's exactly why a confirmed candidate waits for a human decision. Before the November 2026 audit, a game of ONE legal move vouched for a batch of 200 announced wins, and a brand-new account could get any weights promoted in a single submission. Likewise, nothing on the server guarantees that White actually used the reference weights rather than any other choice — that check only exists in the local Lab, which recomputes every move itself.

## Scheduler (`/ordo/*`): pluggable executors

The Lab decides **what** to compute: a *campaign*, two weight sets to settle in fixed-depth games. The scheduler decides **where and when**: each game is a *mission*, given to an *executor*. Verification decides whether the result counts. The scheduler knows no technology, only a contract every executor honours: executors can be plugged in and out at any time without touching the rest.

- **Families**: `navigateur` (the browser — the game Lab's "Contribute" button, 🌐 Compute network tab), `node` (`scripts/executant.js`, on any PC), `serveur` (the operator's machines: Docker containers of the `executant` service, reserved for the compute account), and `natif`, `boinc` reserved for future adapters. Each family has its switch (admin); each executor has its own (its owner can unplug it, the admin can cut it off). An account plugs in at most 8 live executors (64 for the compute account); a device switched off without unplugging stops counting after two leases without a heartbeat.
- **The contract**: plug in (family, cores, SHA-256 fingerprint of the engine); claim a mission; send a heartbeat (the 60 s lease is renewed); hand in the result; unplug. A mission whose lease expires (tab closed, phone asleep, machine lost) goes back to the queue. Every attempt has its token: an executor coming back too late can't make a result count, and a mission only counts once.
- **The choice**: the server assigns, never the executor. Same engine required, one mission per core, campaigns by priority, and a duration rule based on each executor's **measured speed**: a mission estimated too long for a browser (over 5 minutes) goes to a PC (up to an hour).
- **Verification**: nothing an executor says is trusted. The server replays the game with the game's engine (`moteur/fil-<version>.js`, in a separate thread) and **searches three randomly drawn plies itself**, unknown to the executor in advance, which must be exactly the game's. Possible since game v3.18: at fixed depth, a game can be redone move for move (checked on 116 plies recomputed one by one, up to depth 3). Illegal move, opening that doesn't come from the seed, move that isn't the engine's, unfinished game or wrong winner: refused. Three refusals (more than accepted games) cut the executor off.
- **The tally**: A's wins, draws and losses, pentanomial per pair (each pair plays the same opening, colours swapped), Elo with its margin, SPRT (no conclusion before 30 games).
- **The engine**: `node scripts/importer-moteur.js <game index.html>` registers a game version's worker code in `moteur/registre.json`. A browser whose game version isn't registered can't plug in (409). To redo for every game version that changes the worker code.

Plugging in a PC:

```bash
ABA_MDP='…' node scripts/executant.js --api https://api.example.com --email me@example.com --coeurs 3 --nom "Living-room PC"
```

Ctrl-C or SIGTERM unplug it cleanly (its missions go straight back to the queue). Once plugged in, it never stops on its own: server unreachable, token expired (it logs in again with its password), family unplugged or executor cut off, it waits and resumes. Every option has its environment variable (`ABA_API`, `ABA_EMAIL`, `ABA_FAMILLE`, `ABA_COEURS`, `ABA_NOM`…): `node scripts/executant.js --aide`.

Plugging in containers (`serveur` family, see [DEPLOY.en.md](DEPLOY.en.md#compute-executors-in-containers)):

```bash
docker compose --profile calcul up -d --scale executant=3
docker compose stop executant        # clean unplug (SIGTERM)
```

Useful server variables: `ORDO_BAIL_S` (lease duration, 60 s), `ORDO_VERIF_COUPS` (plies searched per result, 3), `ORDO_VERIF_DELAI_MS` (maximum duration of a verification, 120 s), `ORDO_EXECUTANTS_CALCUL` (live executors of the compute account, 64).

## Security & GDPR, built in

- **argon2id** passwords, never stored in plain text
- **JWT** with a revocable `jti` (logout via Redis); **no startup without a strong `JWT_SECRET`** (at least 32 characters, never the example value)
- The account is **re-read from the database on every request**: a deleted account keeps no session, a removed role applies immediately (the role written in the token is never trusted)
- **RBAC**: `requireRole('admin')` middleware; an admin is appointed on the server (`scripts/admin.js`), never through signup, and admin actions require **MFA**; the `calcul` role (same script) only grants plugging in `serveur` executors
- **TOTP MFA** (RFC 6238, no dependency): `/mfa/*`, checked at login once enabled; a code works only once, 5 wrong codes lock the account's MFA for 15 minutes, `/mfa/setup` can no longer remove it
- **Redis rate-limiting** (anti-brute-force), counted on the real address: `X-Forwarded-For` is only trusted from a declared proxy (`TRUST_PROXY`)
- **Scores**: Elo, online wins and tournament XP are never declared by the client
- Fastify **schema validation** (rejects malformed input)
- **Parameterized** SQL queries (injection is not possible)
- **Audit log** with a **hashed** IP, never stored in plain text
- **Automatic purge** (`npm run purge`, meant to be cron-scheduled) per retention periods
- **Export** + real cascading **deletion**

## Deployment (when the day comes)

1. EU host: **Scaleway** (Paris) or **Clever Cloud** (Nantes)
2. Managed PostgreSQL + managed Redis (encrypted at rest)
3. **Cloudflare** in front (WAF, anti-DDoS, TLS)
4. Schedule `npm run purge` (daily cron)
5. Automatic encrypted PostgreSQL backups + a restore test
6. Sign the **DPA** with the host
7. Flip `BACKEND.enabled = true` and set the URL in the HTML

> As long as the flag is `false`, this backend is never contacted and no GDPR obligation applies.

License: GPL-3.0-or-later (consistent with Abalassembly).
