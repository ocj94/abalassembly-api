# abalassembly-api

[![Tests](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml/badge.svg)](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)

Backend **dormant** d'Abalassembly. Construit mais non déployé : le HTML mono-fichier ne l'appelle que lorsque `BACKEND.enabled = true` y est activé.

Stack : **Node + Fastify · PostgreSQL · Redis**, derrière **Cloudflare**, hébergé en **UE**. Conçu RGPD-ready (privacy-by-design).

## Démarrage local

```bash
cp .env.example .env          # puis remplir (générer JWT_SECRET : openssl rand -hex 32)
npm install
npm run migrate               # crée le schéma PostgreSQL (001 + 002 MFA)
npm run dev                   # démarre l'API sur http://localhost:3000
```

## Tests

Suite d'intégration contre un **vrai** PostgreSQL et un **vrai** Redis (pas de mocks) — 24 tests couvrant signup/login, MFA (TOTP vérifié contre `pyotp`, une bibliothèque tierce indépendante), l'export RGPD (portabilité) et la suppression en cascade (droit à l'oubli), ainsi que le rate-limit.

```bash
# nécessite un PostgreSQL et un Redis locaux (ex. `apt install postgresql redis-server`)
createuser aba_test --superuser          # une fois
createdb abalassembly_test -O aba_test   # une fois
npm test                                 # applique les migrations puis lance la suite (node --test)
```

`.env.test` (committé, valeurs locales sans secret réel) fixe la configuration utilisée par `npm test` — ne pas s'en servir en production.

## Endpoints

| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| POST | `/auth/signup` | — | créer un compte (argon2) |
| POST | `/auth/login` | — | authentifier → JWT |
| POST | `/auth/logout` | ✔ | révoquer le jeton |
| GET/PUT | `/profile` | ✔ | lire / modifier le profil |
| GET/PUT | `/progress` | ✔ | synchroniser XP/niveau/elo |
| POST | `/game/result` | ✔ | enregistrer le résultat d'une partie |
| GET | `/game/history` | ✔ | historique personnel (200 dernières parties) |
| POST | `/tournament/result` | ✔ | soumettre un résultat |
| GET | `/tournament/leaderboard` | — | classement mondial |
| GET | `/account/export` | ✔ | **portabilité** (export JSON) |
| DELETE | `/account` | ✔ | **droit à l'oubli** (purge réelle) |
| POST | `/mfa/setup` | ✔ | générer secret TOTP + QR (otpauth) |
| POST | `/mfa/enable` | ✔ | activer la MFA (valide un 1er code) |
| POST | `/mfa/disable` | ✔ | désactiver (exige un code) |
| GET | `/mfa/status` | ✔ | état MFA du compte |
| GET | `/health` | — | sonde de vie |

## Sécurité & RGPD intégrés

- Mots de passe **argon2id**, jamais en clair
- **JWT** avec `jti` révocable (logout via Redis)
- **RBAC** : middleware `requireRole('admin')`
- **MFA TOTP** (RFC 6238, sans dépendance) : `/mfa/*`, vérifié au login si activée
- **Rate-limiting** Redis (anti-bruteforce)
- **Validation de schéma** Fastify (rejette les entrées malformées)
- Requêtes SQL **paramétrées** (injection impossible)
- **Audit log** avec IP **hachée** (jamais en clair)
- **Purge automatique** (`npm run purge`, à planifier en cron) selon les durées de conservation
- **Export** + **suppression réelle** en cascade

## Déploiement (le jour venu)

1. Hébergeur UE : **Scaleway** (Paris) ou **Clever Cloud** (Nantes)
2. PostgreSQL managé + Redis managé (chiffrés au repos)
3. **Cloudflare** devant (WAF, anti-DDoS, TLS)
4. Planifier `npm run purge` (cron quotidien)
5. Sauvegardes PostgreSQL automatiques chiffrées + test de restauration
6. Signer le **DPA** avec l'hébergeur
7. Basculer `BACKEND.enabled = true` + renseigner l'URL dans le HTML

> Tant que le drapeau est `false`, ce backend n'est jamais contacté et aucune obligation RGPD ne s'applique.

Licence : GPL-3.0-or-later (cohérent avec Abalassembly).
