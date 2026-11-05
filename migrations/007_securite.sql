-- ═══════════════════════════════════════════════════════════════════════
-- 007 — Sécurité (audit de novembre 2026)
--
-- 1. MFA : un code TOTP ne sert qu'une fois. On retient la dernière fenêtre
--    de 30 s acceptée pour chaque compte ; un code de cette fenêtre (ou d'une
--    plus ancienne) est refusé. Avant, le même code ouvrait une session autant
--    de fois qu'on le rejouait pendant sa minute et demie de validité.
--
-- 2. Labo : un candidat confirmé par le SPRT ne devient plus le champion
--    public tout seul. Il passe « pending » et attend qu'un administrateur
--    (MFA activée) le valide. Le rejeu prouve qu'une partie est légale, pas
--    qu'elle a été jouée par l'IA avec ces poids : un humain doit trancher
--    avant que des poids partent chez tous les joueurs.
--
-- Rejouée à chaque `npm run migrate` (pas de table de suivi) : idempotente.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;

ALTER TABLE lab_jobs
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- Le nom par défaut que PostgreSQL a donné à la contrainte de 003 : on la
-- remplace par une version qui connaît l'état « pending ».
ALTER TABLE lab_jobs DROP CONSTRAINT IF EXISTS lab_jobs_status_check;
ALTER TABLE lab_jobs ADD CONSTRAINT lab_jobs_status_check
  CHECK (status IN ('open', 'pending', 'promoted', 'rejected'));
