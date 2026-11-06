-- ═══════════════════════════════════════════════════════════════════════
-- 008 — Ordonnanceur : missions de calcul pour des exécutants branchables
--
-- Le Labo crée une CAMPAGNE (deux jeux de poids à départager, à profondeur
-- fixe). Elle devient des MISSIONS : une partie chacune, deux par paire
-- (chaque jeu de poids joue Noir une fois). Un EXÉCUTANT (un navigateur,
-- un programme Node, plus tard d'autres familles) se branche, réclame une
-- mission et reçoit une TENTATIVE : un jeton et un bail. Le bail se renouvelle
-- tant que l'exécutant donne signe de vie ; s'il expire (exécutant débranché,
-- fermé, perdu), la mission repart dans la file. Le résultat rendu n'est
-- compté qu'après vérification : la partie est rejouée et le moteur du
-- serveur recherche lui-même quelques demi-coups tirés au hasard.
--
-- Rejouée à chaque `npm run migrate` (pas de table de suivi) : idempotente.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ordo_familles (
  famille TEXT PRIMARY KEY,
  actif   BOOLEAN NOT NULL DEFAULT true          -- l'interrupteur de toute une famille
);
INSERT INTO ordo_familles (famille) VALUES ('navigateur'), ('node'), ('natif'), ('serveur'), ('boinc')
  ON CONFLICT (famille) DO NOTHING;

CREATE TABLE IF NOT EXISTS ordo_campagnes (
  id          BIGSERIAL PRIMARY KEY,
  nom         TEXT NOT NULL,
  moteur      TEXT NOT NULL,                     -- empreinte SHA-256 du fil de calcul
  poids_a     JSONB NOT NULL,
  poids_b     JSONB NOT NULL,
  reglages    JSONB NOT NULL,                    -- profondeur, maxPlies, ouverture, equilibre, drawWin, arbitrage
  paires      INT NOT NULL CHECK (paires BETWEEN 1 AND 5000),
  priorite    INT NOT NULL DEFAULT 2 CHECK (priorite BETWEEN 0 AND 3),
  etat        TEXT NOT NULL DEFAULT 'active' CHECK (etat IN ('active', 'pause', 'finie')),
  cree_par    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordo_missions (
  id           BIGSERIAL PRIMARY KEY,
  campagne_id  BIGINT NOT NULL REFERENCES ordo_campagnes(id) ON DELETE CASCADE,
  paire        INT NOT NULL,
  couleur_a    TEXT NOT NULL CHECK (couleur_a IN ('black', 'white')),
  graine       BIGINT NOT NULL,
  etat         TEXT NOT NULL DEFAULT 'en_file' CHECK (etat IN ('en_file', 'attribuee', 'faite', 'rejetee')),
  essais       INT NOT NULL DEFAULT 0,
  vainqueur    TEXT CHECK (vainqueur IN ('A', 'B', 'D')),
  pourquoi     TEXT,
  plies        INT,
  coups        JSONB,
  fait_par     UUID,                             -- l'exécutant dont le résultat a été accepté
  fait_at      TIMESTAMPTZ,
  UNIQUE (campagne_id, paire, couleur_a)
);
CREATE INDEX IF NOT EXISTS idx_ordo_missions_file ON ordo_missions (campagne_id, etat, paire);

CREATE TABLE IF NOT EXISTS ordo_executants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  famille      TEXT NOT NULL REFERENCES ordo_familles(famille),
  nom          TEXT,
  coeurs       INT NOT NULL CHECK (coeurs BETWEEN 1 AND 128),
  moteur       TEXT NOT NULL,
  branche      BOOLEAN NOT NULL DEFAULT true,    -- l'interrupteur de son propriétaire
  actif        BOOLEAN NOT NULL DEFAULT true,    -- l'interrupteur de l'administrateur (ou du serveur, après des tricheries)
  ms_par_coup  REAL,                             -- vitesse mesurée sur ses missions acceptées
  prof_mesure  INT,
  faites       INT NOT NULL DEFAULT 0,
  rejetees     INT NOT NULL DEFAULT 0,
  expirees     INT NOT NULL DEFAULT 0,
  vu_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordo_executants_user ON ordo_executants (user_id);

CREATE TABLE IF NOT EXISTS ordo_tentatives (
  id            BIGSERIAL PRIMARY KEY,
  mission_id    BIGINT NOT NULL REFERENCES ordo_missions(id) ON DELETE CASCADE,
  executant_id  UUID NOT NULL REFERENCES ordo_executants(id) ON DELETE CASCADE,
  jeton         TEXT NOT NULL,
  etat          TEXT NOT NULL DEFAULT 'en_cours'
                CHECK (etat IN ('en_cours', 'verification', 'acceptee', 'rejetee', 'expiree', 'abandonnee')),
  bail_jusqu_a  TIMESTAMPTZ NOT NULL,
  debut         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin           TIMESTAMPTZ,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ordo_tentatives_cours ON ordo_tentatives (etat, bail_jusqu_a);
CREATE INDEX IF NOT EXISTS idx_ordo_tentatives_exec ON ordo_tentatives (executant_id, etat);
