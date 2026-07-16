-- Labo distribué : un "job" = un candidat (nouveau jeu de poids) testé contre
-- le champion actuel. Plusieurs clients peuvent contribuer des résultats au
-- même job en parallèle — voir docs/lab-design.md pour la logique d'agrégation.

CREATE TABLE IF NOT EXISTS lab_jobs (
  id bigserial PRIMARY KEY,
  baseline_weights jsonb NOT NULL,   -- poids du champion actuel au moment du lancement
  candidate_weights jsonb NOT NULL,  -- poids proposés à tester
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','promoted','rejected')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS lab_results (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES lab_jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  candidate_wins int NOT NULL CHECK (candidate_wins >= 0),
  draws int NOT NULL DEFAULT 0 CHECK (draws >= 0),
  baseline_wins int NOT NULL CHECK (baseline_wins >= 0),
  -- Une partie représentative de ce lot, pour re-vérification serveur par
  -- rejeu (légalité des coups + cohérence du résultat annoncé). On ne
  -- demande pas TOUTES les parties du lot (coût), un échantillon suffit à
  -- détecter un client qui fabrique des résultats sans avoir vraiment joué.
  sample_start text NOT NULL,
  sample_start_color text NOT NULL DEFAULT 'black',
  sample_seq text NOT NULL,
  sample_winner text NOT NULL CHECK (sample_winner IN ('candidate','baseline','draw')),
  verified boolean,              -- NULL = pas encore vérifié, true/false après rejeu serveur
  verify_note text,              -- raison du rejet si verified=false
  ip_hash text,
  reported_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_results_job_id ON lab_results(job_id);
CREATE INDEX IF NOT EXISTS idx_lab_jobs_status ON lab_jobs(status) WHERE status = 'open';
