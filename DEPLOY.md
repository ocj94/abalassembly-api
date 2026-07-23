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
- **Un audit de sécurité.** L'authentification — argon2id, JWT, TOTP, RBAC —
  a été écrite mais jamais confrontée à du trafic réel. Les dépendances
  doivent être réauditées : elles ont vieilli sans jamais servir.
- **Une raison.** Aujourd'hui, la partie par code permet de jouer à deux
  sans compte ni serveur. Tant que personne ne demande à retrouver ses
  parties depuis un autre appareil, mettre ceci en ligne ajoute une surface
  d'attaque et une charge de maintenance en échange d'aucun service rendu.

Le déclencheur raisonnable est un troisième joueur qui réclame la
synchronisation entre appareils, ou un classement réellement partagé.
