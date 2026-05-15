-- Adiciona novos tipos de alerta ao enum
ALTER TABLE alerts MODIFY COLUMN type ENUM(
  'cash_shortage', 'negative_cash', 'insufficient_funding',
  'excessive_client_balance_use', 'critical_divergence', 'overdue_payable',
  'credit_default', 'concentration_excess',
  'credit_delinquency', 'ndi_aging', 'stale_divergence', 'upcoming_payable'
) NOT NULL;
