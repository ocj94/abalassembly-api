🇬🇧 [English version](../docs-en/SECURITY.en.md)

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
- Pas de démarrage sans `JWT_SECRET` solide ; compte relu en base à chaque requête (un compte supprimé n'a plus de session, le rôle du jeton n'est jamais cru)
- MFA : un code ne sert qu'une fois, 5 codes faux bloquent 15 minutes, impossible de la retirer sans code ; actions d'administration réservées aux admins avec MFA, nommés sur le serveur (`scripts/admin.js`)
- Limite de débit comptée sur la vraie adresse : `X-Forwarded-For` n'est cru que d'un relais déclaré (`TRUST_PROXY`)
- Elo, victoires en ligne et XP des tournois jamais déclarés par le client
- Labo distribué : une partie par envoi, rejouée et conclue, seul son résultat compte ; 3 contributeurs au moins ; validation d'un admin avant tout nouveau champion — voir le README
- Chaque attaque de l'audit de novembre 2026 est rejouée par la suite de tests (`test/securite.test.js`, tests 🛡️ de `test/lab.test.js` et `test/ratelimit.test.js`)
- Dependabot activé (alertes + mises à jour de sécurité automatiques sur les dépendances npm)
