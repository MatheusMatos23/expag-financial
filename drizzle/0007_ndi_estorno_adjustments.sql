-- NDI e Estorno nos divergences
ALTER TABLE divergences
  ADD COLUMN IF NOT EXISTS isNdi TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ndiNote TEXT NULL,
  ADD COLUMN IF NOT EXISTS isEstorno TINYINT(1) NOT NULL DEFAULT 0;

-- Tabela de ajustes manuais de saldo
CREATE TABLE IF NOT EXISTS manual_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sessionId INT NULL,
  description TEXT NOT NULL,
  adjustmentType ENUM('bank_split','api_split','rounding','manual') NOT NULL DEFAULT 'manual',
  apiAmount DECIMAL(18,2) NOT NULL,
  bankAmounts TEXT NULL,
  totalBankAmount DECIMAL(18,2) NULL,
  difference DECIMAL(18,2) NULL,
  divergenceIds TEXT NULL,
  status ENUM('pendente','aprovado','rejeitado') NOT NULL DEFAULT 'aprovado',
  createdByName VARCHAR(200) NULL,
  notes TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX adj_session_idx (sessionId)
);
