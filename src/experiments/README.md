# Expériences

Code exploratoire, **jamais utilisé en production**. Rien ici n'est importé
par `src/routes/*` ni par le jeu (`index.html`).

## `fastEngine.js` + `benchmark.js` — bitboard-ish vs objet à clés texte

**Question posée** : le moteur actuel (`src/engine.js`, plateau = objet JS à
clés texte `"r,c"`) gagnerait-il à passer à une représentation façon bitboard
(tableau plat + table de voisins précalculée) ?

**Méthode** : `fastEngine.js` réimplique les mêmes règles que
`getAllMovesForColor`/`validateMove`, mais avec des index de tableau au lieu
de clés texte reconstruites à chaque accès. `benchmark.js` vérifie D'ABORD
que les deux moteurs produisent EXACTEMENT les mêmes coups légaux sur 35
positions diverses (5 ouvertures officielles + 30 milieux/fins de partie par
auto-jeu), et ne mesure la vitesse QUE si la correction est parfaite.

**Résultat** (3 mesures, 2000 itérations × 35 positions) :

```
✅ CORRECTION : 35/35 positions, coups identiques au moteur réel
Facteur : 1.88× – 1.91×
```

**Deux vrais bugs trouvés en le construisant** — une bonne raison de ne
JAMAIS déployer une réécriture du moteur sans ce genre de harnais de
vérification préalable :
1. `orderAlong` suivait les liens de voisinage sans vérifier qu'il restait
   dans l'ensemble de cases d'origine — sortait du plateau silencieusement.
2. Une constante géométrique (`OPP_DIR`, les directions opposées) avait été
   recopiée à la main et était fausse — corrigée en la calculant depuis
   `AX_DIRS` plutôt que de la deviner.

**Conclusion honnête** : un gain réel (~1,9×), mais loin des « ~200x » vus
sur des bibliothèques Python/numpy — les `BigInt` ont un coût propre en JS
qui limite l'intérêt d'un bitboard « pur » ; le tableau plat + voisins
précalculés est déjà l'essentiel du gain accessible en JavaScript. Vu le
chantier que représenterait la resynchronisation du moteur client ET serveur
(voir la discussion du 18 juillet 2026), ce n'est pas mis en production sans
décision explicite — ce dossier documente juste la mesure réelle.
