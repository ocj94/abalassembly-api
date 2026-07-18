-- Correction de conception : sample_start_color mélangeait deux notions
-- distinctes — "qui commence la partie" (toujours Noir, règle fixe du jeu,
-- jamais un choix) et "quel camp est le candidat testé" (peut être Noir ou
-- Blanc). Renommé pour refléter ce que la colonne signifie réellement.
-- Idempotent (comme les migrations précédentes, run.js rejoue tous les
-- fichiers à chaque exécution) : le renommage ne s'applique qu'une fois.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lab_results' AND column_name = 'sample_start_color'
  ) THEN
    ALTER TABLE lab_results RENAME COLUMN sample_start_color TO candidate_color;
  END IF;
END $$;

