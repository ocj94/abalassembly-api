-- Abalassembly — schéma initial (privacy-by-design)
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS citext;       -- email insensible à la casse
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ─── Comptes ───
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE,                       -- NULL après anonymisation
  password_hash TEXT NOT NULL DEFAULT '',            -- argon2id
  username      TEXT NOT NULL,
  bio           TEXT,
  country       CHAR(2),
  role          TEXT NOT NULL DEFAULT 'player',       -- 'player' | 'admin' (RBAC)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ                            -- soft-delete → purge par le job
);

-- ─── Progression ───
CREATE TABLE IF NOT EXISTS progress (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp         INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  streak     INTEGER NOT NULL DEFAULT 0,
  elo        INTEGER NOT NULL DEFAULT 1200,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Historique de parties (purge 12 mois) ───
CREATE TABLE IF NOT EXISTS game_results (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result     TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
  mode       TEXT NOT NULL DEFAULT 'ai',
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_results_user ON game_results(user_id);
CREATE INDEX IF NOT EXISTS idx_game_results_time ON game_results(played_at);

-- ─── Tournois (inscription + palmarès) ───
CREATE TABLE IF NOT EXISTS tournament_entries (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL,
  stage         INTEGER NOT NULL DEFAULT 0,
  result        TEXT,
  xp_awarded    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tournament_id)
);

-- ─── Journal d'audit (IP hachée, purge 6 mois) ───
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  user_id UUID,                                       -- pas de FK stricte : conservé même après purge du compte
  action  TEXT NOT NULL,
  ip_hash TEXT,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at);
