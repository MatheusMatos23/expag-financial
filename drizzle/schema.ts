import {
  bigint,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  date,
  boolean,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── USERS ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 256 }),  // para login local
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

// ─── CAMADA 1: CONCILIAÇÃO ────────────────────────────────────────────────────

// Sessões de conciliação (cada upload gera uma sessão)
export const reconciliationSessions = mysqlTable("reconciliation_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  referenceDate: date("referenceDate").notNull(),
  status: mysqlEnum("status", ["processing", "completed", "error"]).default("processing").notNull(),
  totalBankCredits: decimal("totalBankCredits", { precision: 18, scale: 2 }).default("0"),
  totalBankDebits: decimal("totalBankDebits", { precision: 18, scale: 2 }).default("0"),
  totalApiCredits: decimal("totalApiCredits", { precision: 18, scale: 2 }).default("0"),
  totalApiDebits: decimal("totalApiDebits", { precision: 18, scale: 2 }).default("0"),
  matchedCount: int("matchedCount").default(0),
  divergentCount: int("divergentCount").default(0),
  pendingCount: int("pendingCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Transações bancárias importadas
export const bankTransactions = mysqlTable("bank_transactions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  type: mysqlEnum("type", ["credit", "debit"]).notNull(),
  transactionDate: date("transactionDate").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  channel: varchar("channel", { length: 50 }), // PIX, TED, BOLETO, etc.
  bankName: varchar("bankName", { length: 100 }),
  externalId: varchar("externalId", { length: 100 }),
  matchStatus: mysqlEnum("matchStatus", ["pending", "matched", "divergent", "manual"]).default("pending").notNull(),
  matchedApiTransactionId: int("matchedApiTransactionId"),
  matchType: mysqlEnum("matchType", ["exact", "partial", "approximate", "manual", "divergent"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index("bt_session_idx").on(table.sessionId),
  dateIdx: index("bt_date_idx").on(table.transactionDate),
  statusIdx: index("bt_status_idx").on(table.matchStatus),
  sessionTypeIdx: index("bt_session_type_idx").on(table.sessionId, table.type),
}));

// Transações da API importadas
export const apiTransactions = mysqlTable("api_transactions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  type: mysqlEnum("type", ["credit", "debit"]).notNull(),
  transactionDate: date("transactionDate").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  channel: varchar("channel", { length: 50 }),
  clientId: varchar("clientId", { length: 100 }),
  clientName: varchar("clientName", { length: 200 }),
  externalId: varchar("externalId", { length: 100 }),
  matchStatus: mysqlEnum("matchStatus", ["pending", "matched", "divergent", "manual"]).default("pending").notNull(),
  matchedBankTransactionId: int("matchedBankTransactionId"),
  matchType: mysqlEnum("matchType", ["exact", "partial", "approximate", "manual", "divergent"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index("at_session_idx").on(table.sessionId),
  dateIdx: index("at_date_idx").on(table.transactionDate),
  statusIdx: index("at_status_idx").on(table.matchStatus),
  sessionTypeIdx: index("at_session_type_idx").on(table.sessionId, table.type),
}));

// Motor de Divergências
export const divergences = mysqlTable("divergences", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  divergenceDate: date("divergenceDate").notNull(),
  bankName: varchar("bankName", { length: 100 }),
  clientId: varchar("clientId", { length: 100 }),
  clientName: varchar("clientName", { length: 200 }),
  divergenceType: mysqlEnum("divergenceType", ["bank_surplus", "bank_shortage"]).notNull(), // sobra ou falta no banco
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  origin: varchar("origin", { length: 100 }),
  category: mysqlEnum("category", [
    "receita_nao_lancada",
    "pix_sem_cliente",
    "receita_financeira",
    "estorno",
    "devolucao",
    "deposito_nao_identificado",
    "tarifa_nao_apropriada",
    "ted_orfa",
    "receita_operacional",
    "emprestimo_operacional",
    "uso_saldo_clientes",
    "despesa_nao_lancada",
    "tarifa_bancaria",
    "imposto",
    "repasse_externo",
    "ajuste_manual",
    "saida_operacional",
    "liquidacao_divergente",
    "outros",
  ]).notNull(),
  subcategory: varchar("subcategory", { length: 100 }),
  responsible: varchar("responsible", { length: 200 }),
  status: mysqlEnum("status", [
    "pendente",
    "em_analise",
    "identificado",
    "regularizado",
    "reclassificado",
    "baixado",
    "em_aberto",
    "escalado_diretoria",
  ]).default("pendente").notNull(),
  slaDeadline: date("slaDeadline"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  evidence: text("evidence"),
  observation: text("observation"),
  actionTaken: text("actionTaken"),
  // NID — Não Identificado: entrada no banco sem correspondência na API.
  // Propriedade TS = isNid (sigla correta), mas coluna SQL mantém o nome
  // antigo "isNdi" para evitar migration de rename (drizzle-kit push é
  // interativo nesse caso e quebra o deploy do Railway).
  isNid: boolean("isNdi").default(false),
  nidNote: text("ndiNote"),
  nidFoundDate: date("ndiFoundDate"),       // data em que foi identificado
  nidClientName: varchar("ndiClientName", { length: 200 }), // cliente identificado
  // Rastreio do ciclo de vida completo do NID — quando entrou, quando
  // identificou, quando conciliou, com quem, e por qual motivo.
  nidMarkedAt: timestamp("nidMarkedAt"),           // quando foi marcado como NID
  nidReconciledAt: timestamp("nidReconciledAt"),   // quando foi conciliado/resolvido
  nidReconciledWithId: int("nidReconciledWithId"), // ID da divergência par
  nidReconciledBy: varchar("nidReconciledBy", { length: 200 }), // quem conciliou
  nidReconcileType: varchar("nidReconcileType", { length: 50 }), // 'api_payment' | 'bank_return'
  // Estorno: transação estornada automaticamente detectada
  isEstorno: boolean("isEstorno").default(false),
  bankTransactionId: int("bankTransactionId"),
  apiTransactionId: int("apiTransactionId"),
  bankDescription: varchar("bankDescription", { length: 500 }),
  apiDescription: varchar("apiDescription", { length: 500 }),
  externalId: varchar("externalId", { length: 200 }),
  bankAmount: decimal("bankAmount", { precision: 18, scale: 2 }),
  apiAmount: decimal("apiAmount", { precision: 18, scale: 2 }),
  transactionType: mysqlEnum("transactionType", ["credit", "debit"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  sessionIdx: index("div_session_idx").on(table.sessionId),
  statusIdx: index("div_status_idx").on(table.status),
  priorityIdx: index("div_priority_idx").on(table.priority),
  dateIdx: index("div_date_idx").on(table.divergenceDate),
  statusPriorityIdx: index("div_status_priority_idx").on(table.status, table.priority),
}));

// Motor Gerencial - Saldo Real
export const managerialBalances = mysqlTable("managerial_balances", {
  id: int("id").autoincrement().primaryKey(),
  referenceDate: date("referenceDate").notNull().unique(),
  bankBalance: decimal("bankBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  clientBalance: decimal("clientBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  committedBalance: decimal("committedBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  divergenceBalance: decimal("divergenceBalance", { precision: 18, scale: 2 }).default("0").notNull(),
  realCash: decimal("realCash", { precision: 18, scale: 2 }).default("0").notNull(), // bankBalance - clientBalance - committedBalance ± divergenceBalance
  ownCash: decimal("ownCash", { precision: 18, scale: 2 }).default("0").notNull(),
  committedCash: decimal("committedCash", { precision: 18, scale: 2 }).default("0").notNull(),
  freeCash: decimal("freeCash", { precision: 18, scale: 2 }).default("0").notNull(),
  thirdPartyResources: decimal("thirdPartyResources", { precision: 18, scale: 2 }).default("0"),
  futureObligations: decimal("futureObligations", { precision: 18, scale: 2 }).default("0"),
  fundingNeeded: decimal("fundingNeeded", { precision: 18, scale: 2 }).default("0"),
  openDivergences: int("openDivergences").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── CAMADA 2: CONTROLADORIA ──────────────────────────────────────────────────

// Receitas
export const revenues = mysqlTable("revenues", {
  id: int("id").autoincrement().primaryKey(),
  referenceDate: date("referenceDate").notNull(),
  type: mysqlEnum("type", [
    "pix",
    "ted",
    "boleto",
    "credito",
    "antecipacao",
    "pos",
    "white_label",
    "receita_financeira",
    "receita_operacional",
    "outros",
  ]).notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  clientId: varchar("clientId", { length: 100 }),
  clientName: varchar("clientName", { length: 200 }),
  status: mysqlEnum("status", ["previsto", "realizado", "cancelado"]).default("realizado").notNull(),
  bankTransactionId: int("bankTransactionId"),
  costCenterId: int("costCenterId"),
  createdByName: varchar("createdByName", { length: 200 }),
  // Rastreamento de origem — adicionado via migração 0005
  sessionId: int("sessionId"),
  divergenceId: int("divergenceId"),
  origin: varchar("origin", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dateIdx: index("rev_date_idx").on(table.referenceDate),
  statusIdx: index("rev_status_idx").on(table.status),
  typeIdx: index("rev_type_idx").on(table.type),
  sessionIdx: index("rev_session_idx").on(table.sessionId),
}));
export const expenses = mysqlTable("expenses", {
  id: int("id").autoincrement().primaryKey(),
  referenceDate: date("referenceDate").notNull(),
  category: mysqlEnum("category", [
    "bancaria",
    "api",
    "tecnologia",
    "infra",
    "operacional",
    "comercial",
    "folha",
    "comissao",
    "impostos",
    "reembolso",
    "chargeback",
    "estorno",
    "marketing",
    "juridico",
    "administrativo",
    "outros",
  ]).notNull(),
  subcategory: varchar("subcategory", { length: 100 }),
  description: text("description"),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  supplier: varchar("supplier", { length: 200 }),
  status: mysqlEnum("status", ["previsto", "realizado", "cancelado"]).default("realizado").notNull(),
  bankTransactionId: int("bankTransactionId"),
  costCenterId: int("costCenterId"),
  createdByName: varchar("createdByName", { length: 200 }),
  // Rastreamento de origem — adicionado via migração 0005
  sessionId: int("sessionId"),
  divergenceId: int("divergenceId"),
  origin: varchar("origin", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Ajustes Manuais de Saldo — para casos de splitting bancário e outras regularizações
export const manualAdjustments = mysqlTable("manual_adjustments", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId"),
  description: text("description").notNull(),
  adjustmentType: mysqlEnum("adjustmentType", [
    "bank_split",        // banco divide pagamento em parcelas
    "api_split",         // API divide em múltiplas entradas
    "rounding",          // diferença de centavos
    "manual",            // ajuste genérico
  ]).notNull().default("manual"),
  apiAmount: decimal("apiAmount", { precision: 18, scale: 2 }).notNull(),
  bankAmounts: text("bankAmounts"),  // JSON array de valores do banco
  totalBankAmount: decimal("totalBankAmount", { precision: 18, scale: 2 }),
  difference: decimal("difference", { precision: 18, scale: 2 }),
  divergenceIds: text("divergenceIds"),  // JSON array de divergência IDs resolvidas
  status: mysqlEnum("status", ["pendente", "aprovado", "rejeitado"]).default("aprovado").notNull(),
  createdByName: varchar("createdByName", { length: 200 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  sessionIdx: index("adj_session_idx").on(table.sessionId),
}));

export type ManualAdjustment = typeof manualAdjustments.$inferSelect;

// Contas a Pagar
export const payables = mysqlTable("payables", {
  id: int("id").autoincrement().primaryKey(),
  description: text("description").notNull(),
  supplier: varchar("supplier", { length: 200 }),
  category: mysqlEnum("category", [
    "bancaria",
    "api",
    "tecnologia",
    "infra",
    "operacional",
    "comercial",
    "folha",
    "comissao",
    "impostos",
    "reembolso",
    "marketing",
    "juridico",
    "administrativo",
    "outros",
  ]).notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  dueDate: date("dueDate").notNull(),
  paidDate: date("paidDate"),
  status: mysqlEnum("status", ["pendente", "pago", "vencido", "cancelado"]).default("pendente").notNull(),
  recurrent: boolean("recurrent").default(false),
  recurrenceDay: int("recurrenceDay"),
  notes: text("notes"),
  createdByName: varchar("createdByName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dueDateIdx: index("pay_due_date_idx").on(table.dueDate),
  statusIdx: index("pay_status_idx").on(table.status),
  statusDueDateIdx: index("pay_status_due_idx").on(table.status, table.dueDate),
}));

// Carteira de Crédito
export const creditPortfolio = mysqlTable("credit_portfolio", {
  id: int("id").autoincrement().primaryKey(),
  clientId: varchar("clientId", { length: 100 }).notNull(),
  clientName: varchar("clientName", { length: 200 }).notNull(),
  principal: decimal("principal", { precision: 18, scale: 2 }).notNull(),
  interestRate: decimal("interestRate", { precision: 8, scale: 4 }).notNull(), // taxa mensal
  totalInstallments: int("totalInstallments").notNull(),
  paidInstallments: int("paidInstallments").default(0).notNull(),
  totalInterestEarned: decimal("totalInterestEarned", { precision: 18, scale: 2 }).default("0"),
  outstandingBalance: decimal("outstandingBalance", { precision: 18, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["ativo", "quitado", "inadimplente", "renegociado", "cancelado"]).default("ativo").notNull(),
  startDate: date("startDate").notNull(),
  expectedEndDate: date("expectedEndDate").notNull(),
  lastPaymentDate: date("lastPaymentDate"),
  fundingSource: mysqlEnum("fundingSource", ["capital_proprio", "uso_custodia", "externo"]).default("capital_proprio"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("cp_status_idx").on(table.status),
  clientIdx: index("cp_client_idx").on(table.clientId),
}));

// Parcelas de crédito
export const creditInstallments = mysqlTable("credit_installments", {
  id: int("id").autoincrement().primaryKey(),
  creditId: int("creditId").notNull(),
  installmentNumber: int("installmentNumber").notNull(),
  dueDate: date("dueDate").notNull(),
  principalAmount: decimal("principalAmount", { precision: 18, scale: 2 }).notNull(),
  interestAmount: decimal("interestAmount", { precision: 18, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 18, scale: 2 }).notNull(),
  paidAmount: decimal("paidAmount", { precision: 18, scale: 2 }).default("0"),
  paidDate: date("paidDate"),
  status: mysqlEnum("status", ["pendente", "pago", "vencido", "parcial"]).default("pendente").notNull(),
  // Rastreamento contábil — ID da revenue de juros gerada automaticamente
  // ao registrar pagamento. Usado para reverter (excluir a revenue) caso
  // o usuário edite ou apague o pagamento. Amortização do principal NÃO
  // vira revenue (não é resultado — é só devolução de capital).
  interestRevenueId: int("interestRevenueId"),
  penaltyRevenueId: int("penaltyRevenueId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  creditIdx: index("ci_credit_idx").on(table.creditId),
  statusIdx: index("ci_status_idx").on(table.status),
  dueDateIdx: index("ci_due_date_idx").on(table.dueDate),
}));

// ─── CAMADA 3: CONTABILIDADE ──────────────────────────────────────────────────

// Centros de Custo
export const costCenters = mysqlTable("cost_centers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  type: mysqlEnum("type", ["receita", "despesa_fixa", "despesa_variavel", "imposto", "investimento", "credito"]).notNull(),
  description: text("description"),
  budget: decimal("budget", { precision: 18, scale: 2 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// DRE - Demonstração de Resultado
// Movimentações Internas (Contabilidade)
// Aba de visualização das operações na API Expag — agregado diário por tipo.
// É independente: NÃO afeta DRE, Cash Flow, Receitas, Despesas ou Conciliação.
// Linhas com isTransfer=true (transferência entre contas) aparecem nos relatórios
// mas NÃO somam/subtraem do total geral porque são apenas movimentação interna.
export const internalMovements = mysqlTable("internal_movements", {
  id: int("id").autoincrement().primaryKey(),
  movementDate: date("movementDate").notNull(),
  operationType: varchar("operationType", { length: 200 }).notNull(),  // ex: "PIX ENVIADO", "DEPÓSITO POR BOLETO"
  processor: varchar("processor", { length: 200 }),                    // ex: "BANCO DO BRASIL S.A.", "EXPAG", null
  quantity: int("quantity").default(1).notNull(),                      // qtd de transações agregadas no dia
  debitAmount: decimal("debitAmount", { precision: 18, scale: 2 }).default("0").notNull(),
  creditAmount: decimal("creditAmount", { precision: 18, scale: 2 }).default("0").notNull(),
  isTransfer: boolean("isTransfer").default(false).notNull(),          // true = transferência entre contas (neutro, não soma)
  notes: text("notes"),
  source: mysqlEnum("source", ["manual", "imported"]).default("manual").notNull(),
  createdBy: varchar("createdBy", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dateIdx: index("im_date_idx").on(table.movementDate),
  typeIdx: index("im_type_idx").on(table.operationType),
}));

// Apuração Manual de Resultado
// Tabela INDEPENDENTE para alimentar o Dashboard de Apuração Manual.
// Não afeta DRE, Cash Flow, Receitas, Despesas, nem qualquer outra parte do
// sistema. Cada linha é uma categoria em um mês de referência.
// Usado para apresentação rápida à diretoria quando a conciliação completa
// ainda não foi finalizada.
export const manualApuracao = mysqlTable("manual_apuracao", {
  id: int("id").autoincrement().primaryKey(),
  referenceMonth: varchar("referenceMonth", { length: 7 }).notNull(), // YYYY-MM
  // API de origem do dado. Hoje só "expag" e "cinqbank" — useEnum para
  // validar no banco. Default 'expag' garante que linhas antigas (criadas
  // antes desta coluna existir) recebam um valor automaticamente.
  apiSource: mysqlEnum("apiSource", ["expag", "cinqbank"]).default("expag").notNull(),
  kind: mysqlEnum("kind", ["receita", "despesa"]).notNull(),
  category: varchar("category", { length: 200 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdBy: varchar("createdBy", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  monthIdx: index("ma_month_idx").on(table.referenceMonth),
  kindIdx: index("ma_kind_idx").on(table.kind),
  apiIdx: index("ma_api_idx").on(table.apiSource),
  monthKindIdx: index("ma_month_kind_idx").on(table.referenceMonth, table.kind),
}));

export const dre = mysqlTable("dre", {
  id: int("id").autoincrement().primaryKey(),
  referenceMonth: varchar("referenceMonth", { length: 7 }).notNull(), // YYYY-MM
  grossRevenue: decimal("grossRevenue", { precision: 18, scale: 2 }).default("0"),
  netRevenue: decimal("netRevenue", { precision: 18, scale: 2 }).default("0"),
  // Receita Financeira: juros recebidos de empréstimos, investimentos.
  // Separada da receita operacional para não distorcer margem operacional.
  financialRevenue: decimal("financialRevenue", { precision: 18, scale: 2 }).default("0"),
  financialCosts: decimal("financialCosts", { precision: 18, scale: 2 }).default("0"),
  operationalCosts: decimal("operationalCosts", { precision: 18, scale: 2 }).default("0"),
  adminExpenses: decimal("adminExpenses", { precision: 18, scale: 2 }).default("0"),
  commercialExpenses: decimal("commercialExpenses", { precision: 18, scale: 2 }).default("0"),
  taxes: decimal("taxes", { precision: 18, scale: 2 }).default("0"),
  operationalResult: decimal("operationalResult", { precision: 18, scale: 2 }).default("0"),
  financialResult: decimal("financialResult", { precision: 18, scale: 2 }).default("0"),
  netProfit: decimal("netProfit", { precision: 18, scale: 2 }).default("0"),
  margin: decimal("margin", { precision: 8, scale: 4 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Fluxo de Caixa
export const cashFlow = mysqlTable("cash_flow", {
  id: int("id").autoincrement().primaryKey(),
  referenceDate: date("referenceDate").notNull().unique(),
  openingBalance: decimal("openingBalance", { precision: 18, scale: 2 }).default("0"),
  projectedInflows: decimal("projectedInflows", { precision: 18, scale: 2 }).default("0"),
  realizedInflows: decimal("realizedInflows", { precision: 18, scale: 2 }).default("0"),
  projectedOutflows: decimal("projectedOutflows", { precision: 18, scale: 2 }).default("0"),
  realizedOutflows: decimal("realizedOutflows", { precision: 18, scale: 2 }).default("0"),
  closingBalance: decimal("closingBalance", { precision: 18, scale: 2 }).default("0"),
  freeCash: decimal("freeCash", { precision: 18, scale: 2 }).default("0"),
  committedCash: decimal("committedCash", { precision: 18, scale: 2 }).default("0"),
  fundingNeeded: decimal("fundingNeeded", { precision: 18, scale: 2 }).default("0"),
  // Projeções
  projectionD7: decimal("projectionD7", { precision: 18, scale: 2 }),
  projectionD15: decimal("projectionD15", { precision: 18, scale: 2 }),
  projectionD30: decimal("projectionD30", { precision: 18, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── ALERTAS ──────────────────────────────────────────────────────────────────
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", [
    "cash_shortage",
    "negative_cash",
    "insufficient_funding",
    "excessive_client_balance_use",
    "critical_divergence",
    "overdue_payable",
    "credit_default",
    "concentration_excess",
    "credit_delinquency",
    "ndi_aging",
    "stale_divergence",
    "upcoming_payable",
  ]).notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  message: text("message").notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("warning").notNull(),
  status: mysqlEnum("status", ["active", "acknowledged", "resolved", "dismissed"]).default("active").notNull(),
  referenceId: int("referenceId"),
  referenceType: varchar("referenceType", { length: 50 }),
  acknowledgedBy: int("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── BOLETOS — Compensação diária BB x API (Camada 1) ─────────────────────────
// Trata o caso específico do BB lançar "cobrança" como valor agregado de boletos
// pagos. Cada linha representa um dia: o valor que veio do banco (somado das
// divergências regularizadas) vs o valor que o usuário lança manualmente do
// sistema. A coluna `difference` é acumulativa entre dias.
export const boletoDailyBalances = mysqlTable("boleto_daily_balances", {
  id: int("id").autoincrement().primaryKey(),
  entryDate: date("entryDate").notNull().unique(),
  bankName: varchar("bankName", { length: 80 }).default("Banco do Brasil").notNull(),
  bankAmount: decimal("bankAmount", { precision: 18, scale: 2 }).default("0").notNull(),
  apiAmount: decimal("apiAmount", { precision: 18, scale: 2 }).default("0").notNull(),
  difference: decimal("difference", { precision: 18, scale: 2 }).default("0").notNull(),
  // IDs das divergências que originaram a linha (JSON array) — para rastreabilidade
  originDivergenceIds: text("originDivergenceIds"),
  // Observação livre do usuário
  observation: text("observation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  dateIdx: index("boleto_date_idx").on(table.entryDate),
}));

// ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────────
export const systemConfig = mysqlTable("system_config", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 200 }),
  userEmail: varchar("userEmail", { length: 200 }),
  action: varchar("action", { length: 80 }).notNull(),       // ex: "reconciliation.create"
  category: varchar("category", { length: 50 }).notNull(),   // ex: "conciliacao", "usuario", "divergencia"
  entityType: varchar("entityType", { length: 50 }),         // ex: "session", "user", "divergence"
  entityId: varchar("entityId", { length: 100 }),            // id da entidade afetada
  summary: text("summary").notNull(),                        // descrição legível da ação
  metadata: text("metadata"),                                // JSON com detalhes extras
  ipAddress: varchar("ipAddress", { length: 60 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── TYPES ────────────────────────────────────────────────────────────────────
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ReconciliationSession = typeof reconciliationSessions.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type ApiTransaction = typeof apiTransactions.$inferSelect;
export type Divergence = typeof divergences.$inferSelect;
export type ManagerialBalance = typeof managerialBalances.$inferSelect;
export type BoletoDailyBalance = typeof boletoDailyBalances.$inferSelect;
export type Revenue = typeof revenues.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Payable = typeof payables.$inferSelect;
export type CreditPortfolio = typeof creditPortfolio.$inferSelect;
export type CreditInstallment = typeof creditInstallments.$inferSelect;
export type CostCenter = typeof costCenters.$inferSelect;
export type DRE = typeof dre.$inferSelect;
export type CashFlow = typeof cashFlow.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
