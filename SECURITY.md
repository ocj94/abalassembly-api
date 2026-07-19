# Politique de sécurité

Backend RGPD-ready pour Abalassembly (Node + Fastify + PostgreSQL + Redis).
**Actuellement dormant** : non déployé, aucune donnée réelle n'y transite tant
que le jeu n'a pas `BACKEND.enabled = true`.

## Signaler une vulnérabilité

Utilisez l'onglet **[Security → Report a vulnerability](https://github.com/ocj94/abalassembly-api/security/advisories/new)**
de ce dépôt (rapport privé) plutôt qu'une issue publique.

Merci d'inclure :
- Une description claire du problème
- Les étapes pour le reproduire
- L'impact potentiel

## Bonnes pratiques déjà en place

- Mots de passe **argon2id**, jamais en clair
- **JWT** avec `jti` révocable (logout via Redis)
- **MFA TOTP** (RFC 6238, sans dépendance externe)
- **Rate-limiting** Redis (anti-bruteforce)
- Requêtes SQL **paramétrées** (injection impossible)
- **Audit log** avec IP **hachée**, jamais en clair
- Vérification systématique des soumissions du Labo distribué (rejeu moteur, authenticité de l'ouverture) — voir le README
- Dependabot activé (alertes + mises à jour de sécurité automatiques sur les dépendances npm)
