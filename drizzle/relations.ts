import { relations } from "drizzle-orm";
import {
  users,
  reconciliationSessions,
  bankTransactions,
  apiTransactions,
  divergences,
  revenues,
  expenses,
  payables,
  creditPortfolio,
  creditInstallments,
  costCenters,
  alerts,
} from "./schema";

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  reconciliationSessions: many(reconciliationSessions),
}));

// ─── SESSÕES DE CONCILIAÇÃO ───────────────────────────────────────────────────
export const reconciliationSessionsRelations = relations(
  reconciliationSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [reconciliationSessions.userId],
      references: [users.id],
    }),
    bankTransactions: many(bankTransactions),
    apiTransactions: many(apiTransactions),
    divergences: many(divergences),
  })
);

// ─── TRANSAÇÕES BANCÁRIAS ─────────────────────────────────────────────────────
export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  session: one(reconciliationSessions, {
    fields: [bankTransactions.sessionId],
    references: [reconciliationSessions.id],
  }),
}));

// ─── TRANSAÇÕES DA API ────────────────────────────────────────────────────────
export const apiTransactionsRelations = relations(apiTransactions, ({ one }) => ({
  session: one(reconciliationSessions, {
    fields: [apiTransactions.sessionId],
    references: [reconciliationSessions.id],
  }),
}));

// ─── DIVERGÊNCIAS ─────────────────────────────────────────────────────────────
export const divergencesRelations = relations(divergences, ({ one }) => ({
  session: one(reconciliationSessions, {
    fields: [divergences.sessionId],
    references: [reconciliationSessions.id],
  }),
}));

// ─── RECEITAS ─────────────────────────────────────────────────────────────────
export const revenuesRelations = relations(revenues, ({ one }) => ({
  costCenter: one(costCenters, {
    fields: [revenues.costCenterId],
    references: [costCenters.id],
  }),
}));

// ─── DESPESAS ─────────────────────────────────────────────────────────────────
export const expensesRelations = relations(expenses, ({ one }) => ({
  costCenter: one(costCenters, {
    fields: [expenses.costCenterId],
    references: [costCenters.id],
  }),
}));

// ─── CENTROS DE CUSTO ─────────────────────────────────────────────────────────
export const costCentersRelations = relations(costCenters, ({ many }) => ({
  revenues: many(revenues),
  expenses: many(expenses),
}));

// ─── CARTEIRA DE CRÉDITO ──────────────────────────────────────────────────────
export const creditPortfolioRelations = relations(creditPortfolio, ({ many }) => ({
  installments: many(creditInstallments),
}));

export const creditInstallmentsRelations = relations(creditInstallments, ({ one }) => ({
  credit: one(creditPortfolio, {
    fields: [creditInstallments.creditId],
    references: [creditPortfolio.id],
  }),
}));

// ─── ALERTAS ──────────────────────────────────────────────────────────────────
export const alertsRelations = relations(alerts, ({ one }) => ({
  acknowledgedByUser: one(users, {
    fields: [alerts.acknowledgedBy],
    references: [users.id],
  }),
}));

// payables tem referências de negócio mas sem FK formal — sem relação Drizzle aqui
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _payablesRef = payables; // re-exporta para manter o import usado

