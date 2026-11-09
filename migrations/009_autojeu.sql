-- ═══════════════════════════════════════════════════════════════════════
-- 009 — Campagnes « auto-jeu » : la base de positions d'un futur réseau de neurones
--
-- Une campagne « duel » (008) départage deux jeux de poids. Une campagne
-- « autojeu » fait jouer UN jeu de poids contre lui-même, chaque partie
-- avec sa propre graine (donc sa propre ouverture tirée au hasard) : elle
-- produit des parties variées, vérifiées comme les autres, dont on tire des
-- millions de positions étiquetées par le résultat final
-- (scripts/exporter-positions.js). Ces positions entraîneront un réseau
-- qui jouera « en ombre », à côté du juge actuel, sans jamais le remplacer.
--
-- Pour l'autojeu, la colonne paires compte les parties (une mission chacune).
-- Idempotente (rejouée à chaque migrate).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE ordo_campagnes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'duel';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordo_campagnes_type_check') THEN
    ALTER TABLE ordo_campagnes ADD CONSTRAINT ordo_campagnes_type_check CHECK (type IN ('duel', 'autojeu'));
  END IF;
END $$;
