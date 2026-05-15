-- Performance indexes para queries mais comuns

-- bank_transactions: busca por externalId (matching engine)
CREATE INDEX IF NOT EXISTS bt_externalid_idx ON bank_transactions (externalId(100));
CREATE INDEX IF NOT EXISTS bt_date_amount_idx ON bank_transactions (transactionDate, matchStatus);

-- api_transactions: busca por externalId (matching engine)  
CREATE INDEX IF NOT EXISTS at_externalid_idx ON api_transactions (externalId(100));
CREATE INDEX IF NOT EXISTS at_date_amount_idx ON api_transactions (transactionDate, matchStatus);

-- divergences: queries mais comuns
CREATE INDEX IF NOT EXISTS div_ndi_idx ON divergences (isNdi);
CREATE INDEX IF NOT EXISTS div_type_status_idx ON divergences (divergenceType, status);
CREATE INDEX IF NOT EXISTS div_amount_idx ON divergences (amount);

-- revenues: queries de período
CREATE INDEX IF NOT EXISTS rev_date_origin_idx ON revenues (referenceDate, origin);

-- expenses: queries de período
CREATE INDEX IF NOT EXISTS exp_date_origin_idx ON expenses (referenceDate, origin);
CREATE INDEX IF NOT EXISTS exp_date_cat_idx ON expenses (referenceDate, category);

-- reconciliation_sessions
CREATE INDEX IF NOT EXISTS rs_status_idx ON reconciliation_sessions (status);
CREATE INDEX IF NOT EXISTS rs_date_idx ON reconciliation_sessions (referenceDate);
