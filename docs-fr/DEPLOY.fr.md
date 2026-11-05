🇬🇧 [English version](../docs-en/DEPLOY.en.md)

# Mise en service

Ce backend est **dormant** : il n'a jamais tourné en production. Ce document
donne la marche à suivre, pas un feu vert. Lis la dernière section avant de
lancer quoi que ce soit.

## Ce qui est prêt

- `Dockerfile` — image de production, dépendances sans les outils de build,
  exécution en utilisateur non privilégié, sonde de santé sur `/health`.
- `docker-compose.yml` — pile complète (API + PostgreSQL + Redis) pour un
  VPS ou un essai local.
- `.env.example` — toutes les variables attendues, documentées.
- `.github/workflows/test.yml` — suite de tests et contrôle de synchronisation
  du moteur à chaque push.

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

## Administrateurs

Il n'y a plus de compte admin de démarrage (`BOOTSTRAP_ADMIN_EMAIL` est sans
effet : l'inscription avec cette adresse donnait le rôle admin au premier
venu, puisque rien ne vérifie qu'on possède l'adresse). Le futur admin
s'inscrit normalement, puis, sur le serveur :

```bash
node --env-file=.env scripts/admin.js nommer <email>     # ou : retirer <email>
```

Il doit ensuite activer la MFA (`/mfa/setup` puis `/mfa/enable`) : les
actions d'administration la refusent sans elle. La seule aujourd'hui est la
validation des candidats du Labo distribué (`/lab/pending`,
`/lab/job/:id/approve`, `/lab/job/:id/reject`).

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
