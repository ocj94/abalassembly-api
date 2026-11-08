🇬🇧 [English version](../docs-en/DEPLOY.en.md)

# Mise en service

Ce backend est **dormant** : il n'a jamais tourné en production. Ce document
donne la marche à suivre, pas un feu vert. Lis la dernière section avant de
lancer quoi que ce soit.

## Ce qui est prêt

- `Dockerfile` — image de production, dépendances sans les outils de build,
  exécution en utilisateur non privilégié, sonde de santé sur `/health`.
- `docker-compose.yml` — pile complète (API + PostgreSQL + Redis) pour un
  VPS ou un essai local, plus des exécutants de calcul facultatifs (profil
  `calcul`).
- `.env.example` — toutes les variables attendues, documentées.
- `.github/workflows/test.yml` — suite de tests, contrôle de synchronisation
  du moteur, et essai de bout en bout de la pile Docker (`scripts/essai-docker.js` :
  image construite, base + Redis + API en production, deux exécutants qui jouent
  une campagne vérifiée par l'API, puis débranchés) à chaque push.

## Essai local, en trois commandes

```bash
cp .env.example .env          # puis remplir JWT_SECRET
docker compose up -d db redis
docker compose run --rm api npm run migrate
docker compose up -d api
curl localhost:3000/health
```

Les migrations sont lancées **explicitement**, pas au démarrage du conteneur.
Un conteneur qui migre tout seul rejoue le schéma à chaque redémarrage et
autant de fois qu'il y a de replicas.

Dans la pile, la base n'est joignable que par le réseau interne de Docker et
n'a pas de certificat : `DATABASE_URL` y porte `?sslmode=disable` (sans lui,
`NODE_ENV=production` exige SSL et l'API ne se connectait pas). Une base hébergée
ailleurs garde SSL (`DATABASE_CA`).

Lance `npm run migrate` **deux fois de suite** : `migrations/run.js` rejoue
tous les `.sql` à chaque exécution, sans table de suivi. Chaque instruction
doit donc être idempotente. C'est le premier test à faire, et il n'a jamais
été exécuté contre un vrai PostgreSQL.

## Hébergeur géré

Chez Scaleway, Clever Cloud ou Render, ne garde que le service `api` : la
base et Redis sont fournis par la plateforme. Renseigne `DATABASE_URL`,
`REDIS_URL`, et surtout `DATABASE_CA` avec le certificat de l'hébergeur —
sans lui, la vérification TLS stricte de la base est désactivée.

## Secrets

`JWT_SECRET` se génère avec `openssl rand -hex 32`. Il ne doit exister que
dans le gestionnaire de secrets de l'hébergeur. Un secret qui a transité par
un fichier de configuration, un dépôt ou une conversation est à considérer
comme compromis, et doit être régénéré avant la mise en service.

Sans `JWT_SECRET`, ou avec la valeur d'exemple, ou avec moins de 32
caractères, le serveur **refuse de démarrer**. Avant novembre 2026, il
démarrait avec un secret écrit dans ce dépôt public : n'importe qui pouvait
fabriquer un jeton valable pour n'importe quel compte.

## Le relais devant le serveur (`TRUST_PROXY`)

La limite de débit compte les requêtes par adresse. Derrière un relais
(Cloudflare, puis le reverse proxy TLS), l'adresse du client n'arrive que par
l'en-tête `X-Forwarded-For` — que n'importe quel client peut aussi écrire.
Le serveur ne croit donc cet en-tête que s'il vient d'un relais déclaré :

- `TRUST_PROXY` vide (par défaut) : personne n'est cru. Derrière un relais,
  toutes les requêtes semblent venir de lui et partagent une seule limite :
  trop strict, à régler avant l'ouverture, mais jamais contournable.
- `TRUST_PROXY=127.0.0.1` (ou une plage, ex. `172.16.0.0/12` pour la
  passerelle Docker de `docker-compose.yml`) : l'adresse depuis laquelle le
  reverse proxy joint le serveur.
- `TRUST_PROXY=true` est refusé au démarrage.

Avec Cloudflare devant le reverse proxy, c'est ce dernier qui doit écrire la
vraie adresse : n'accepter que les plages de Cloudflare, et remplacer
`X-Forwarded-For` par l'en-tête `CF-Connecting-IP` (avec nginx :
`set_real_ip_from` pour chaque plage Cloudflare, `real_ip_header
CF-Connecting-IP`, puis `proxy_set_header X-Forwarded-For $remote_addr`).

## Le réseau de calcul (`/ordo`)

- **La CSP du jeu** n'autorise aujourd'hui aucune connexion vers le serveur : le jour de l'ouverture, ajouter son adresse à `connect-src` (dans `src/00-html.part` du jeu), en même temps que `BACKEND.enabled = true` et `BACKEND.url`.
- **Le moteur** : après chaque version du jeu qui change le fil de calcul, `node scripts/importer-moteur.js <index.html de cette version>`, puis déployer (pile Docker : `docker compose build`, le moteur est copié dans l'image). Sinon les navigateurs à jour ne peuvent plus se brancher (le serveur refuse un moteur qu'il ne sait pas rejouer).
- **La vérification** consomme du calcul sur le serveur (un fil, une vérification à la fois : quelques secondes par partie à profondeur 2). La limiter avec `ORDO_VERIF_COUPS` si le serveur est petit.

## Administrateurs

Il n'y a plus de compte admin de démarrage (`BOOTSTRAP_ADMIN_EMAIL` est sans
effet : l'inscription avec cette adresse donnait le rôle admin au premier
venu, puisque rien ne vérifie qu'on possède l'adresse). Le futur admin
s'inscrit normalement, puis, sur le serveur :

```bash
node --env-file=.env scripts/admin.js nommer <email>     # ou : retirer <email>
# dans la pile Docker :
docker compose exec api node scripts/admin.js nommer <email>
```

Il doit ensuite activer la MFA (`/mfa/setup` puis `/mfa/enable`) : les
actions d'administration la refusent sans elle. La seule aujourd'hui est la
validation des candidats du Labo distribué (`/lab/pending`,
`/lab/job/:id/approve`, `/lab/job/:id/reject`).

## Exécutants de calcul en conteneurs

Le service `executant` de `docker-compose.yml` branche les machines de
l'opérateur sur l'ordonnanceur, dans la famille `serveur` : elle a son propre
interrupteur, séparé des appareils des joueurs. Même image que l'API, mais le
conteneur ne reçoit ni le `.env` ni l'accès à la base, seulement l'adresse de
l'API et un **compte de calcul** sans droits d'administration (il se connecte
donc sans MFA ; une fuite de son mot de passe ne donne que des missions, vérifiées
comme toutes les autres).

```bash
# 1. le compte de calcul s'inscrit normalement (site ou /auth/signup), puis :
docker compose exec api node scripts/admin.js calcul <email>
# 2. dans .env : ABA_CALCUL_EMAIL, ABA_CALCUL_MDP, ABA_COEURS (cœurs par conteneur, 2)
# 3. brancher trois conteneurs, puis les débrancher
docker compose --profile calcul up -d --scale executant=3
docker compose logs -f executant
docker compose stop executant
```

`docker compose stop` envoie SIGTERM : chaque exécutant rend ses missions en
cours à la file avant de s'arrêter. Pour tout suspendre sans arrêter les
conteneurs, l'admin débranche la famille `serveur` (`POST /ordo/familles/serveur`
`{"actif": false}`) : ils attendent et reprennent quand elle revient. Un
conteneur ne s'arrête jamais de lui-même une fois branché (serveur redémarré,
jeton expiré : il attend, se reconnecte et reprend), donc pas de boucle de
redémarrages. L'API vérifie les résultats avec le moteur copié dans l'image
(`moteur/`) : reconstruire l'image après chaque `scripts/importer-moteur.js`.

Sur d'autres machines que celle de l'API, lancer la même image avec
`ABA_API=https://api.exemple.fr` (ou `node scripts/executant.js --famille serveur`).
Le compte de calcul branche au plus 64 exécutants vivants à la fois
(`ORDO_EXECUTANTS_CALCUL`).

## Avant d'ouvrir au public

Rien de ce qui suit n'est fait, et chacun de ces points engage :

- **Un nom de domaine et un reverse proxy TLS.** Le conteneur n'écoute que
  sur `127.0.0.1` dans la pile fournie, délibérément. Ne l'expose jamais en
  direct.
- **Les sauvegardes de la base.** Aucune n'est configurée.
- **Les obligations RGPD.** Dès qu'un compte existe, tu traites des données
  personnelles : mentions d'information, base légale, durée de conservation,
  procédure d'effacement. Le code prévoit une purge (`src/jobs/purge.js`),
  mais rien ne la déclenche.
- **Finir l'audit de sécurité.** Un premier audit (novembre 2026), mené comme
  si des joueurs se connectaient, a trouvé et corrigé huit failles vérifiées :
  secret JWT par défaut, limite de débit contournable, admin de démarrage,
  sessions d'un compte supprimé, MFA (retrait sans code, rejeu, essais
  illimités), scores déclarés par le client, Labo distribué, dépendances.
  Chaque attaque est rejouée par les tests. Restent ouverts, moins graves :
  mots de passe faibles acceptés (`password`, `12345678`), inscription et
  temps de réponse de la connexion qui révèlent si une adresse a un compte,
  pseudos contenant du HTML (à échapper à l'affichage). Un regard extérieur
  reste souhaitable avant l'ouverture.
- **Une raison.** Aujourd'hui, la partie par code permet de jouer à deux
  sans compte ni serveur. Tant que personne ne demande à retrouver ses
  parties depuis un autre appareil, mettre ceci en ligne ajoute une surface
  d'attaque et une charge de maintenance en échange d'aucun service rendu.

Le déclencheur raisonnable est un troisième joueur qui réclame la
synchronisation entre appareils, ou un classement réellement partagé.
