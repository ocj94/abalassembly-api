🇬🇧 [English version](../docs-en/CONTRIBUTING.en.md)

# Contribuer

Un mot honnête d'abord : c'est un projet essentiellement maintenu seul, en
parallèle d'[Abalassembly](https://github.com/ocj94/Abalassembly), pas un
projet avec une communauté de mainteneurs établie. Les contributions sont
les bienvenues, mais attends-toi à un rythme de revue personnel, pas celui
d'une organisation.

## Signaler une vulnérabilité

Pas ici — voir [`SECURITY.md`](SECURITY.fr.md), qui pointe vers le formulaire
privé du dépôt plutôt qu'une issue publique.

## Mise en route

Tout est dans le [`README.md`](README.fr.md) : installation, variables
d'environnement, lancement local. Pas dupliqué ici pour ne pas avoir deux
versions à tenir à jour.

## Avant de proposer un changement

**Lance la suite de tests en local** (`npm test`) — nécessite un vrai
PostgreSQL et un vrai Redis, aucun mock. Une pull request dont les tests ne
passent pas contre de vraies instances ne sera pas fusionnée même si elle
« a l'air » de marcher.

**Si tu touches `src/engine.js`** : lance aussi
`node scripts/check-engine-sync.js`. Ce script compare 13 fonctions
critiques (géométrie, légalité des coups) entre ce fichier et le moteur
client d'Abalassembly, et échoue si elles divergent. Ce n'est pas une
formalité — il existe précisément parce qu'un écart entre les deux copies
a causé un vrai bug (« OPP_DIR », session du 19/07/2026) qui n'a été
découvert que des mois après coup. Il tourne aussi automatiquement en CI
sur chaque push et chaque pull request ; une divergence bloque le
merge, pas seulement un avertissement.

## Style et principes

Ce dépôt suit les mêmes principes qu'Abalassembly : ne rien affirmer sans
l'avoir vérifié, ne jamais fabriquer une donnée ou un résultat pour combler
un manque, documenter honnêtement les limites plutôt que les taire. Le
README du Labo distribué en est un exemple concret — la section « ce qui
n'est PAS vérifié » y est aussi soignée que le reste.

## Ce qui aide vraiment

- Un correctif accompagné d'un test qui échouait avant et passe après
- Une issue qui décrit un écart concret entre ce que le code fait et ce que
  la documentation dit, plutôt qu'une demande de fonctionnalité pour un
  backend qui reste volontairement dormant
