-- Vincula revenues e expenses à divergência de origem
-- Permite rastrear o que foi reclassificado e de onde veio

ALTER TABLE revenues
  ADD COLUMN IF NOT EXISTS divergenceId INT NULL,
  ADD COLUMN IF NOT EXISTS sessionId INT NULL,
  ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NULL COMMENT 'auto_tariff | manual_move | manual';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS divergenceId INT NULL,
  ADD COLUMN IF NOT EXISTS sessionId INT NULL,
  ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NULL COMMENT 'auto_tariff | manual_move | manual';

-- Índice para busca por divergência
CREATE INDEX IF NOT EXISTS rev_divergence_idx ON revenues (divergenceId);
CREATE INDEX IF NOT EXISTS exp_divergence_idx ON expenses (divergenceId);
CREATE INDEX IF NOT EXISTS rev_session_idx ON revenues (sessionId);
CREATE INDEX IF NOT EXISTS exp_session_idx ON expenses (sessionId);
