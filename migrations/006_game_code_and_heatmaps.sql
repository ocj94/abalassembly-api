-- ═══════════════════════════════════════════════════════════════════════
-- 006 — Aligner le schéma sur le jeu (Abalassembly v1.9 → v1.11)
--
-- Deux écarts s'étaient creusés entre le fichier unique et ce dépôt.
--
-- 1. game_results ne conservait qu'un verdict : gagné/perdu/nul, le mode,
--    la date. Aucune partie n'était donc réellement stockée, et un
--    « historique personnel » n'aurait rien eu à montrer sinon une liste
--    de résultats secs. La v1.9 du jeu a introduit un format de code
--    autosuffisant (ABAL1) qui porte la partie entière depuis le premier
--    coup : c'est exactement ce qu'il faut conserver, et rien de plus.
--
-- 2. La v1.10 a séparé les cartes de chaleur en me_black / me_white /
--    opponent, après un bug qui rangeait les coups du bot dans la carte
--    personnelle du joueur dès qu'il tenait les blancs. Le serveur ne
--    connaissait aucune carte de chaleur ; s'il en synchronise un jour,
--    il doit le faire avec cette séparation, pas avec l'ancienne clé
--    unique heatmapWhite, qui mélangeait adversaire local et IA.
--
-- Le backend reste dormant : cette migration prépare le terrain, elle
-- n'active rien.
-- ═══════════════════════════════════════════════════════════════════════

-- NOTE — migrations/run.js rejoue TOUS les .sql a chaque execution, sans
-- table de suivi : chaque instruction doit donc etre idempotente. Postgres
-- ne connait pas ADD CONSTRAINT IF NOT EXISTS, d'ou les blocs DO qui
-- interrogent pg_constraint. Les blocs sont delimites par $mig$ et non $$ :
-- le motif du code de partie contient un $ d'ancrage, et un delimiteur nomme
-- ecarte toute ambiguite de lecture.
-- Sans cela, le deuxieme `npm run migrate`
-- echouerait, et avec lui le `pretest` de la suite.

-- ─── Parties : de quoi rejouer, pas seulement de quoi compter ───

ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS color     TEXT,
  ADD COLUMN IF NOT EXISTS variant   TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS plies     INTEGER,
  ADD COLUMN IF NOT EXISTS game_code TEXT;

-- La couleur tenue par le joueur conditionne l'affichage POV de
-- l'historique (son camp toujours en bas) et l'attribution des
-- statistiques. Nullable : les lignes déjà écrites ne la connaissent pas,
-- et on préfère un trou honnête à une valeur par défaut inventée.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_results_color_chk') THEN
    ALTER TABLE game_results ADD CONSTRAINT game_results_color_chk
      CHECK (color IS NULL OR color IN ('black', 'white'));
  END IF;
END $mig$;


-- Les cinq dispositions officielles, alignées sur LAYOUTS (src/layouts.js,
-- miroir de index.html).
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_results_variant_chk') THEN
    ALTER TABLE game_results ADD CONSTRAINT game_results_variant_chk
      CHECK (variant IN ('standard', 'belgian', 'german', 'dutch', 'swiss'));
  END IF;
END $mig$;


-- Format du code de partie, volontairement contraint : préfixe de version,
-- nom de disposition, puis le corps en cases Aba-Pro et indices de
-- direction. Une ligne qui ne respecte pas cette forme ne serait pas
-- rejouable, donc elle n'a rien à faire ici.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_results_code_chk') THEN
    ALTER TABLE game_results ADD CONSTRAINT game_results_code_chk
      CHECK (game_code IS NULL OR game_code ~ '^ABAL1:[a-z_]+:[a-i0-9]*$');
  END IF;
END $mig$;


DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_results_plies_chk') THEN
    ALTER TABLE game_results ADD CONSTRAINT game_results_plies_chk
      CHECK (plies IS NULL OR plies >= 0);
  END IF;
END $mig$;


COMMENT ON COLUMN game_results.color IS
  'Couleur tenue par le joueur. Determine l''orientation POV de l''historique.';
COMMENT ON COLUMN game_results.game_code IS
  'Code ABAL1 autosuffisant : la partie entiere depuis le premier coup, rejouable et verifiable contre le moteur.';

-- ─── Cartes de chaleur : trois espaces distincts, jamais melanges ───

ALTER TABLE progress
  ADD COLUMN IF NOT EXISTS heatmaps JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN progress.heatmaps IS
  'Cumuls par identifiant : me_black, me_white, opponent, et variantes suffixees @layout. Les coups de l''adversaire ne doivent jamais entrer dans une cle me_*.';

CREATE INDEX IF NOT EXISTS idx_game_results_user_color
  ON game_results(user_id, color);
