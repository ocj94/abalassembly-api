-- Diversité des ouvertures dans le Labo distribué (inspiré d'OpenBench / Fishtest) :
-- chaque soumission indique désormais QUELLE disposition de départ (parmi les 5
-- officielles) sa partie témoin utilise, et le serveur VÉRIFIE que la position
-- annoncée correspond réellement à cette disposition (pas seulement qu'elle est
-- légale) — une couche de vérification supplémentaire, pas seulement statistique.
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS layout text;
CREATE INDEX IF NOT EXISTS idx_lab_results_job_layout ON lab_results(job_id, layout);
