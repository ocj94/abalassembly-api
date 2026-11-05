🇬🇧 [English version](../docs-en/README.en.md)

# abalassembly-api

[![Tests](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml/badge.svg)](https://github.com/ocj94/abalassembly-api/actions/workflows/test.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](../LICENSE)

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
| GET/PUT | `/progress` | ✔ | synchroniser XP/niveau/série (l'Elo est tenu par le serveur) |
| POST | `/game/result` | ✔ | enregistrer le résultat d'une partie |
| GET | `/game/history` | ✔ | historique personnel (200 dernières parties) |
| POST | `/tournament/result` | ✔ | soumettre un résultat du tournoi du mois (XP fixée par le serveur) |
| GET | `/tournament/leaderboard` | — | classement mondial |
| GET | `/lab/champion` | — | poids actuels du Labo distribué (public) |
| GET | `/lab/contributors` | — | classement des contributeurs, fiabilité (public) |
| GET | `/lab/job` | ✔ | job de test collectif en cours + disposition suggérée |
| POST | `/lab/job` | ✔ | proposer un candidat à tester |
| POST | `/lab/result` | ✔ | soumettre une partie (rejouée ; seule elle compte) |
| GET | `/lab/pending` | admin + MFA | candidats confirmés en attente de validation |
| POST | `/lab/job/:id/approve` · `/reject` | admin + MFA | faire d'un candidat le champion, ou l'écarter |
| GET | `/account/export` | ✔ | **portabilité** (export JSON) |
| DELETE | `/account` | ✔ | **droit à l'oubli** (purge réelle) |
| POST | `/mfa/setup` | ✔ | générer secret TOTP + QR (otpauth) |
| POST | `/mfa/enable` | ✔ | activer la MFA (valide un 1er code) |
| POST | `/mfa/disable` | ✔ | désactiver (exige un code) |
| GET | `/mfa/status` | ✔ | état MFA du compte |
| GET | `/health` | — | sonde de vie |

### Index alphabétique des routes

| Route | Méthode | Auth | Rôle |
|---|---|---|---|
| `/account` | DELETE | ✔ | **droit à l'oubli** (purge réelle) |
| `/account/export` | GET | ✔ | **portabilité** (export JSON) |
| `/auth/login` | POST | — | authentifier → JWT |
| `/auth/logout` | POST | ✔ | révoquer le jeton |
| `/auth/signup` | POST | — | créer un compte (argon2) |
| `/game/history` | GET | ✔ | historique personnel (200 dernières parties) |
| `/game/result` | POST | ✔ | enregistrer le résultat d'une partie |
| `/health` | GET | — | sonde de vie |
| `/lab/champion` | GET | — | poids actuels du Labo distribué (public) |
| `/lab/contributors` | GET | — | classement des contributeurs, fiabilité (public) |
| `/lab/job` | GET | ✔ | job de test collectif en cours + disposition suggérée |
| `/lab/job` | POST | ✔ | proposer un candidat à tester |
| `/lab/job/:id/approve` · `/reject` | POST | admin + MFA | faire d'un candidat le champion, ou l'écarter |
| `/lab/pending` | GET | admin + MFA | candidats confirmés en attente de validation |
| `/lab/result` | POST | ✔ | soumettre une partie (rejouée ; seule elle compte) |
| `/mfa/disable` | POST | ✔ | désactiver (exige un code) |
| `/mfa/enable` | POST | ✔ | activer la MFA (valide un 1er code) |
| `/mfa/setup` | POST | ✔ | générer secret TOTP + QR (otpauth) |
| `/mfa/status` | GET | ✔ | état MFA du compte |
| `/profile` | GET/PUT | ✔ | lire / modifier le profil |
| `/progress` | GET/PUT | ✔ | synchroniser XP/niveau/série (l'Elo est tenu par le serveur) |
| `/tournament/leaderboard` | GET | — | classement mondial |
| `/tournament/result` | POST | ✔ | soumettre un résultat du tournoi du mois (XP fixée par le serveur) |

*Même contenu que le tableau « Endpoints » ci-dessus, trié par route plutôt que par domaine — pratique pour chercher une route précise.*

## Labo distribué (`/lab/*`)

Le Labo du jeu (voir `index.html`) tourne normalement en local, dans le `localStorage` de chaque joueur — voir le README d'Abalassembly pour ce mode. Ces routes permettent une variante **collective** : plusieurs joueurs contribuent des résultats de duels au même test, agrégés par un vrai SPRT (test séquentiel de Wald, méthodologie Fishtest/Stockfish/[OpenBench](https://github.com/AndyGrant/OpenBench)) côté serveur.

**Comment ça marche** : un candidat (nouveau jeu de poids d'évaluation) est proposé via `POST /lab/job`. Les joueurs y contribuent via `POST /lab/result` — **un envoi = une partie entière** (disposition + position de départ + séquence de coups), que le serveur **rejoue avec le vrai moteur** (`src/engine.js`) : c'est le rejeu qui dit qui a gagné, et seule cette partie compte. Quand le LLR cumulé franchit le seuil **avec au moins 3 contributeurs différents**, le candidat passe **en attente** : il ne devient le champion public (`GET /lab/champion`, sans authentification) qu'après validation par un administrateur dont la MFA est active (`POST /lab/job/:id/approve`, ou `/reject` pour l'écarter).

**Diversité des ouvertures** (idée reprise d'OpenBench) : chaque soumission indique laquelle des **5 dispositions officielles** (`standard`/`belgian`/`german`/`dutch`/`swiss`, voir `src/layouts.js`) sa partie témoin utilise. `GET /lab/job` suggère la disposition la **moins couverte jusqu'ici pour ce job** (équilibrage glouton) — quel que soit l'ordre de connexion des contributeurs, les 5 ouvertures finissent naturellement représentées, au lieu qu'un candidat se sur-spécialise sur une seule position de départ.

**Classement des contributeurs** (`GET /lab/contributors`, public) : parties vérifiées / soumises par joueur, avec un ratio de fiabilité. Reconnaissance de la contribution, et signal de confiance discret — un contributeur au long historique de soumissions vérifiées est plus fiable qu'un compte flambant neuf.

**Équilibrage de la couleur jouée par le candidat** : dans Abalone, Noir commence toujours (règle fixe, jamais un choix) — mais le candidat testé peut jouer Noir ou Blanc selon la partie, comme le Labo local qui alterne déjà `colorA` d'une partie à l'autre pour éviter un biais premier-joueur. `GET /lab/job` suggère la couleur la moins représentée jusqu'ici (`suggestedColor`) et expose la répartition des résultats par couleur (`byColor`), également disponible sur `GET /lab/champion` pour le candidat promu — équivalent serveur de `byColorAn`/`byColorAwin` déjà présents côté client.

**Un vrai bug de conception trouvé et corrigé** (migration `005_candidate_color.sql`) : le champ s'appelait à l'origine `sampleStartColor` et mélangeait deux notions distinctes — qui commence la partie rejouée (toujours Noir, obligatoirement) et quel camp est le candidat testé (peut être Noir ou Blanc). Comme tous les tests initiaux ne couvraient que des candidats jouant Noir, ce défaut n'avait jamais été révélé. Renommé en `candidateColor`, avec le rejeu désormais toujours démarré par Noir indépendamment de cette valeur — et deux tests dédiés (candidat Blanc accepté avec le bon résultat, candidat Blanc rejeté si le résultat n'est pas inversé) pour ne plus jamais le regarder ailleurs.

**Anti-fraude, ce qui est réellement vérifié :**
- **Légalité** : chaque coup de la partie témoin est validé contre les règles réelles du jeu — un coup inventé de toutes pièces est rejeté, jamais compté dans l'agrégat (voir `test/lab.test.js`, tests marqués 🛡️).
- **Authenticité de l'ouverture** : la position de départ annoncée doit correspondre **exactement** à la disposition officielle revendiquée — impossible de prétendre tester "standard" en jouant en réalité depuis une position truquée.
- **Partie conclue, selon les règles du Labo du jeu** : 6 billes sorties, 3 billes d'avance (le Labo arrête la partie là), ou la limite de 80 demi-coups (celui qui mène gagne, égalité = nulle). Une partie inachevée ne compte pas ; un coup joué après la fin, ou au-delà de 80 demi-coups, fait refuser la partie.
- **Cohérence du résultat** : le vainqueur annoncé doit être celui du rejeu, correctement interprété selon la couleur du candidat — annoncer une victoire qui ne s'est pas produite (ou mal inverser le résultat pour un candidat Blanc) est détecté. Ce que le serveur compte, c'est le résultat du rejeu, jamais un nombre annoncé par le client.
- **Poids bornés** : chaque poids d'un candidat reste dans les bornes du Labo du jeu (0 à `SPSA_MAX`) — une IA aux poids négatifs, qui chercherait à perdre, est refusée d'emblée.
- **Une décision humaine** : au moins 3 contributeurs pour que le SPRT conclue, puis la validation d'un administrateur avec MFA avant que des poids partent chez tous les joueurs.
- **Ce qui n'est PAS vérifié** : la réflexion de l'IA elle-même (recherche/évaluation) n'est pas rejouée pour chaque soumission — seulement la légalité, l'authenticité de l'ouverture et le résultat de la partie. Des comptes complices qui fabriquent des parties légales ne sont pas détectés par ce mécanisme : c'est précisément pourquoi un candidat confirmé attend une validation humaine. Avant l'audit de novembre 2026, une partie d'UN coup légal justifiait un lot de 200 victoires annoncées, et un compte neuf faisait promouvoir n'importe quels poids en un seul envoi. De même, rien ne garantit côté serveur que Blanc a réellement utilisé les poids de référence plutôt que n'importe quel autre choix — cette vérification-là n'existe que côté Labo local, qui recalcule chaque coup lui-même.

## Sécurité & RGPD intégrés



- Mots de passe **argon2id**, jamais en clair
- **JWT** avec `jti` révocable (logout via Redis) ; **pas de démarrage sans `JWT_SECRET`** solide (32 caractères au moins, jamais la valeur d'exemple)
- Compte **relu en base à chaque requête** : un compte supprimé n'a plus aucune session, un rôle retiré s'applique tout de suite (le rôle écrit dans le jeton n'est jamais cru)
- **RBAC** : middleware `requireRole('admin')` ; un admin se nomme sur le serveur (`scripts/admin.js`), jamais par l'inscription, et ses actions exigent la **MFA**
- **MFA TOTP** (RFC 6238, sans dépendance) : `/mfa/*`, vérifiée au login si activée ; un code ne sert qu'une fois, 5 codes faux bloquent la MFA du compte 15 minutes, `/mfa/setup` ne peut plus la retirer
- **Rate-limiting** Redis (anti-bruteforce), compté sur la vraie adresse : `X-Forwarded-For` n'est cru que d'un relais déclaré (`TRUST_PROXY`)
- **Scores** : l'Elo, les victoires en ligne et l'XP des tournois ne sont jamais déclarés par le client
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
