-- Migration 0013: Boletos — compensação diária BB x API
-- Trata o caso específico do Banco do Brasil que credita "cobrança"
-- como valor agregado de todos os boletos pagos no dia.

CREATE TABLE IF NOT EXISTS boleto_daily_balances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entryDate DATE NOT NULL UNIQUE,
  bankName VARCHAR(80) NOT NULL DEFAULT 'Banco do Brasil',
  bankAmount DECIMAL(18, 2) NOT NULL DEFAULT 0,
  apiAmount DECIMAL(18, 2) NOT NULL DEFAULT 0,
  difference DECIMAL(18, 2) NOT NULL DEFAULT 0,
  originDivergenceIds TEXT NULL,
  observation TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX boleto_date_idx (entryDate)
);
