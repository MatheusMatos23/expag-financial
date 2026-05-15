-- Garante que revenues tem as colunas de rastreamento (IF NOT EXISTS para ser seguro)
ALTER TABLE revenues
  ADD COLUMN IF NOT EXISTS sessionId INT NULL,
  ADD COLUMN IF NOT EXISTS divergenceId INT NULL,
  ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NULL;

-- Garante que expenses tem as colunas de rastreamento
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS sessionId INT NULL,
  ADD COLUMN IF NOT EXISTS divergenceId INT NULL,
  ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NULL;

-- Índices para performance nas queries de deleção por sessão
CREATE INDEX IF NOT EXISTS rev_session_idx ON revenues (sessionId);
CREATE INDEX IF NOT EXISTS exp_session_idx ON expenses (sessionId);
CREATE INDEX IF NOT EXISTS rev_divergence_idx ON revenues (divergenceId);
CREATE INDEX IF NOT EXISTS exp_divergence_idx ON expenses (divergenceId);
