import { and, desc, eq, gte, lte, sql, between, like, or, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  reconciliationSessions, bankTransactions, apiTransactions, divergences, managerialBalances,
  revenues, expenses, payables, creditPortfolio, creditInstallments,
  costCenters, dre, cashFlow, alerts, systemConfig,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── USERS ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    textFields.forEach(field => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    });
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// ─── CONCILIAÇÃO ──────────────────────────────────────────────────────────────
export async function createReconciliationSession(data: {
  userId: number; referenceDate: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(reconciliationSessions).values({
    userId: data.userId,
    referenceDate: data.referenceDate as unknown as Date,
    status: 'processing',
  });
  return result[0].insertId;
}

export async function getReconciliationSessions(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reconciliationSessions).orderBy(desc(reconciliationSessions.createdAt)).limit(limit);
}

export async function getReconciliationSessionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(reconciliationSessions).where(eq(reconciliationSessions.id, id)).limit(1);
  return result[0] ?? null;
}

export async function insertBankTransactions(rows: Array<{
  sessionId: number; type: 'credit' | 'debit'; transactionDate: string;
  description: string; amount: string; channel?: string; bankName?: string; externalId?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (rows.length === 0) return;
  await db.insert(bankTransactions).values(rows.map(r => ({
    ...r,
    transactionDate: r.transactionDate as unknown as Date,
  })));
}

export async function insertApiTransactions(rows: Array<{
  sessionId: number; type: 'credit' | 'debit'; transactionDate: string;
  description: string; amount: string; channel?: string; clientId?: string; clientName?: string; externalId?: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (rows.length === 0) return;
  await db.insert(apiTransactions).values(rows.map(r => ({
    ...r,
    transactionDate: r.transactionDate as unknown as Date,
  })));
}

export async function getBankTransactionsBySession(sessionId: number, type?: 'credit' | 'debit') {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(bankTransactions.sessionId, sessionId)];
  if (type) conditions.push(eq(bankTransactions.type, type));
  return db.select().from(bankTransactions).where(and(...conditions));
}

export async function getApiTransactionsBySession(sessionId: number, type?: 'credit' | 'debit') {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(apiTransactions.sessionId, sessionId)];
  if (type) conditions.push(eq(apiTransactions.type, type));
  return db.select().from(apiTransactions).where(and(...conditions));
}

export async function updateBankTransactionMatch(id: number, data: {
  matchStatus: 'matched' | 'divergent' | 'manual'; matchedApiTransactionId?: number;
  matchType?: 'exact' | 'partial' | 'approximate' | 'manual' | 'divergent';
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(bankTransactions).set(data).where(eq(bankTransactions.id, id));
}

export async function updateApiTransactionMatch(id: number, data: {
  matchStatus: 'matched' | 'divergent' | 'manual'; matchedBankTransactionId?: number;
  matchType?: 'exact' | 'partial' | 'approximate' | 'manual' | 'divergent';
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(apiTransactions).set(data).where(eq(apiTransactions.id, id));
}

export async function updateReconciliationSession(id: number, data: Partial<{
  status: 'processing' | 'completed' | 'error';
  totalBankCredits: string; totalBankDebits: string;
  totalApiCredits: string; totalApiDebits: string;
  matchedCount: number; divergentCount: number; pendingCount: number;
}>) {
  const db = await getDb();
  if (!db) return;
  await db.update(reconciliationSessions).set(data).where(eq(reconciliationSessions.id, id));
}

// ─── DIVERGÊNCIAS ─────────────────────────────────────────────────────────────
export async function createDivergence(data: {
  sessionId: number; divergenceDate: string; bankName?: string;
  clientId?: string; clientName?: string;
  divergenceType: 'bank_surplus' | 'bank_shortage'; amount: string;
  origin?: string; category: string; responsible?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  slaDeadline?: string;
  bankTransactionId?: number; apiTransactionId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(divergences).values({
    ...data,
    divergenceDate: data.divergenceDate as unknown as Date,
    slaDeadline: data.slaDeadline as unknown as Date | undefined,
    category: data.category as any,
    status: 'pendente',
  });
  return result[0].insertId;
}

export async function getDivergences(filters?: {
  sessionId?: number; status?: string; priority?: string; dateFrom?: string; dateTo?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.sessionId) conditions.push(eq(divergences.sessionId, filters.sessionId));
  if (filters?.status) conditions.push(eq(divergences.status, filters.status as any));
  if (filters?.priority) conditions.push(eq(divergences.priority, filters.priority as any));
  if (filters?.dateFrom) conditions.push(gte(divergences.divergenceDate, filters.dateFrom as unknown as Date));
  if (filters?.dateTo) conditions.push(lte(divergences.divergenceDate, filters.dateTo as unknown as Date));
  return db.select().from(divergences)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(divergences.createdAt));
}

export async function updateDivergenceStatus(id: number, data: {
  status: string; responsible?: string; observation?: string; actionTaken?: string;
  slaDeadline?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(divergences).set({
    status: data.status as any,
    responsible: data.responsible,
    observation: data.observation,
    actionTaken: data.actionTaken,
    slaDeadline: data.slaDeadline ? data.slaDeadline as unknown as Date : undefined,
  }).where(eq(divergences.id, id));
}

// ─── MOTOR GERENCIAL ──────────────────────────────────────────────────────────
export async function upsertManagerialBalance(data: {
  referenceDate: string; bankBalance: string; clientBalance: string;
  committedBalance: string; divergenceBalance: string;
  thirdPartyResources?: string; futureObligations?: string; fundingNeeded?: string;
  openDivergences?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const bankBal = parseFloat(data.bankBalance);
  const clientBal = parseFloat(data.clientBalance);
  const committedBal = parseFloat(data.committedBalance);
  const divBal = parseFloat(data.divergenceBalance);
  // realCash = saldo que efetivamente pertence à empresa após obrigações e divergências
  const realCash = bankBal - clientBal - committedBal + divBal;
  // ownCash = capital próprio antes do comprometimento
  const ownCash = bankBal - clientBal;
  // freeCash = capital próprio disponível após compromissos (pode ser negativo — isso é crítico)
  const freeCash = ownCash - committedBal;
  await db.insert(managerialBalances).values({
    referenceDate: data.referenceDate as unknown as Date,
    bankBalance: data.bankBalance,
    clientBalance: data.clientBalance,
    committedBalance: data.committedBalance,
    divergenceBalance: data.divergenceBalance,
    realCash: realCash.toFixed(2),
    ownCash: ownCash.toFixed(2),
    committedCash: committedBal.toFixed(2),
    freeCash: freeCash.toFixed(2),
    thirdPartyResources: data.thirdPartyResources,
    futureObligations: data.futureObligations,
    fundingNeeded: data.fundingNeeded,
    openDivergences: data.openDivergences,
  }).onDuplicateKeyUpdate({
    set: {
      bankBalance: data.bankBalance, clientBalance: data.clientBalance,
      committedBalance: data.committedBalance, divergenceBalance: data.divergenceBalance,
      realCash: realCash.toFixed(2), ownCash: ownCash.toFixed(2),
      committedCash: committedBal.toFixed(2), freeCash: freeCash.toFixed(2),
      thirdPartyResources: data.thirdPartyResources, futureObligations: data.futureObligations,
      fundingNeeded: data.fundingNeeded, openDivergences: data.openDivergences,
    }
  });
}

export async function getManagerialBalances(days = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(managerialBalances).orderBy(desc(managerialBalances.referenceDate)).limit(days);
}

export async function getLatestManagerialBalance() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(managerialBalances).orderBy(desc(managerialBalances.referenceDate)).limit(1);
  return result[0] ?? null;
}

// ─── RECEITAS ─────────────────────────────────────────────────────────────────
export async function createRevenue(data: {
  referenceDate: string; type: string; description?: string; amount: string;
  clientId?: string; clientName?: string; status?: string; costCenterId?: number;
  createdByName?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const status = data.status ?? 'realizado';
  const result = await db.execute(sql`
    INSERT INTO revenues (referenceDate, type, description, amount, clientId, clientName, status, costCenterId, createdByName)
    VALUES (${data.referenceDate}, ${data.type}, ${data.description || null}, ${data.amount}, ${data.clientId || null}, ${data.clientName || null}, ${status}, ${data.costCenterId ?? null}, ${data.createdByName || null})
  `);
  return (result as any)[0]?.insertId ?? 0;
}

export async function getRevenues(filters?: {
  dateFrom?: string; dateTo?: string; type?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.dateFrom) conditions.push(gte(revenues.referenceDate, filters.dateFrom as unknown as Date));
  if (filters?.dateTo) conditions.push(lte(revenues.referenceDate, filters.dateTo as unknown as Date));
  if (filters?.type) conditions.push(eq(revenues.type, filters.type as any));
  if (filters?.status) conditions.push(eq(revenues.status, filters.status as any));
  return db.select().from(revenues)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(revenues.referenceDate));
}

export async function getRevenueSummary(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    type: revenues.type,
    total: sql<string>`SUM(${revenues.amount})`,
    count: sql<number>`COUNT(*)`,
  }).from(revenues)
    .where(and(
      gte(revenues.referenceDate, dateFrom as unknown as Date),
      lte(revenues.referenceDate, dateTo as unknown as Date),
      eq(revenues.status, 'realizado'),
    ))
    .groupBy(revenues.type);
}

// ─── DESPESAS ─────────────────────────────────────────────────────────────────
export async function createExpense(data: {
  referenceDate: string; category: string; subcategory?: string;
  description?: string; amount: string; supplier?: string; status?: string; costCenterId?: number;
  createdByName?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const status = data.status ?? 'realizado';
  const result = await db.execute(sql`
    INSERT INTO expenses (referenceDate, category, subcategory, description, amount, supplier, status, costCenterId, createdByName)
    VALUES (
      ${data.referenceDate},
      ${data.category},
      ${data.subcategory || null},
      ${data.description || null},
      ${data.amount},
      ${data.supplier || null},
      ${status},
      ${data.costCenterId || null},
      ${data.createdByName || null}
    )
  `);
  return (result as any)[0]?.insertId ?? 0;
}

export async function getExpenses(filters?: {
  dateFrom?: string; dateTo?: string; category?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.dateFrom) conditions.push(gte(expenses.referenceDate, filters.dateFrom as unknown as Date));
  if (filters?.dateTo) conditions.push(lte(expenses.referenceDate, filters.dateTo as unknown as Date));
  if (filters?.category) conditions.push(eq(expenses.category, filters.category as any));
  if (filters?.status) conditions.push(eq(expenses.status, filters.status as any));
  return db.select().from(expenses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(expenses.referenceDate));
}

export async function getExpenseSummary(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    category: expenses.category,
    total: sql<string>`SUM(${expenses.amount})`,
    count: sql<number>`COUNT(*)`,
  }).from(expenses)
    .where(and(
      gte(expenses.referenceDate, dateFrom as unknown as Date),
      lte(expenses.referenceDate, dateTo as unknown as Date),
      eq(expenses.status, 'realizado'),
    ))
    .groupBy(expenses.category);
}

// ─── CONTAS A PAGAR ───────────────────────────────────────────────────────────
export async function createPayable(data: {
  description: string; supplier?: string; category: string; amount: string;
  dueDate: string; recurrent?: boolean; recurrenceDay?: number; notes?: string;
  createdByName?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.execute(sql`
    INSERT INTO payables (description, supplier, category, amount, dueDate, recurrent, recurrenceDay, notes, status, createdByName)
    VALUES (
      ${data.description},
      ${data.supplier || null},
      ${data.category},
      ${data.amount},
      ${data.dueDate},
      ${data.recurrent ? 1 : 0},
      ${data.recurrenceDay || null},
      ${data.notes || null},
      'pendente',
      ${data.createdByName || null}
    )
  `);
  return (result as any)[0]?.insertId ?? 0;
}

export async function getPayables(filters?: { status?: string; dateFrom?: string; dateTo?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.status) conditions.push(eq(payables.status, filters.status as any));
  if (filters?.dateFrom) conditions.push(gte(payables.dueDate, filters.dateFrom as unknown as Date));
  if (filters?.dateTo) conditions.push(lte(payables.dueDate, filters.dateTo as unknown as Date));
  return db.select().from(payables)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(payables.dueDate);
}

export async function updatePayableStatus(id: number, status: string, paidDate?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(payables).set({
    status: status as any,
    paidDate: paidDate ? paidDate as unknown as Date : undefined,
  }).where(eq(payables.id, id));
}

export async function deletePayable(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(payables).where(eq(payables.id, id));
}

// ─── CARTEIRA DE CRÉDITO ──────────────────────────────────────────────────────
export async function createCreditEntry(data: {
  clientId: string; clientName: string; principal: string; interestRate: string;
  totalInstallments: number; startDate: string; expectedEndDate: string;
  fundingSource?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(creditPortfolio).values({
    ...data,
    startDate: data.startDate as unknown as Date,
    expectedEndDate: data.expectedEndDate as unknown as Date,
    fundingSource: (data.fundingSource ?? 'capital_proprio') as any,
    outstandingBalance: data.principal,
    status: 'ativo',
  });
  return result[0].insertId;
}

export async function getCreditPortfolio(filters?: { status?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.status) conditions.push(eq(creditPortfolio.status, filters.status as any));
  return db.select().from(creditPortfolio)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(creditPortfolio.createdAt));
}

export async function getCreditInstallments(creditId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(creditInstallments)
    .where(eq(creditInstallments.creditId, creditId))
    .orderBy(creditInstallments.installmentNumber);
}

export async function createCreditInstallments(installments: Array<{
  creditId: number; installmentNumber: number; dueDate: string;
  principalAmount: string; interestAmount: string; totalAmount: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (installments.length === 0) return;
  await db.insert(creditInstallments).values(installments.map(i => ({
    ...i,
    dueDate: i.dueDate as unknown as Date,
  })));
}

// ─── DRE ──────────────────────────────────────────────────────────────────────
export async function getDRE(months = 12) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dre).orderBy(desc(dre.referenceMonth)).limit(months);
}

export async function upsertDRE(data: {
  referenceMonth: string; grossRevenue?: string; netRevenue?: string;
  financialCosts?: string; operationalCosts?: string; adminExpenses?: string;
  commercialExpenses?: string; taxes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const gross = parseFloat(data.grossRevenue ?? '0');
  const finCosts = parseFloat(data.financialCosts ?? '0');
  const opCosts = parseFloat(data.operationalCosts ?? '0');
  const adminExp = parseFloat(data.adminExpenses ?? '0');
  const commExp = parseFloat(data.commercialExpenses ?? '0');
  const taxesVal = parseFloat(data.taxes ?? '0');
  const net = gross - finCosts;
  const opResult = net - opCosts - adminExp - commExp - taxesVal;
  const margin = gross > 0 ? (opResult / gross) : 0;
  await db.insert(dre).values({
    referenceMonth: data.referenceMonth,
    grossRevenue: gross.toFixed(2),
    netRevenue: net.toFixed(2),
    financialCosts: finCosts.toFixed(2),
    operationalCosts: opCosts.toFixed(2),
    adminExpenses: adminExp.toFixed(2),
    commercialExpenses: commExp.toFixed(2),
    taxes: taxesVal.toFixed(2),
    operationalResult: opResult.toFixed(2),
    financialResult: '0',
    netProfit: opResult.toFixed(2),
    margin: margin.toFixed(4),
  }).onDuplicateKeyUpdate({
    set: {
      grossRevenue: gross.toFixed(2), netRevenue: net.toFixed(2),
      financialCosts: finCosts.toFixed(2), operationalCosts: opCosts.toFixed(2),
      adminExpenses: adminExp.toFixed(2), commercialExpenses: commExp.toFixed(2),
      taxes: taxesVal.toFixed(2), operationalResult: opResult.toFixed(2),
      netProfit: opResult.toFixed(2), margin: margin.toFixed(4),
    }
  });
}

// ─── FLUXO DE CAIXA ───────────────────────────────────────────────────────────
export async function getCashFlow(days = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cashFlow).orderBy(desc(cashFlow.referenceDate)).limit(days);
}

export async function upsertCashFlow(data: {
  referenceDate: string; openingBalance?: string; projectedInflows?: string;
  realizedInflows?: string; projectedOutflows?: string; realizedOutflows?: string;
  projectionD7?: string; projectionD15?: string; projectionD30?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const opening = parseFloat(data.openingBalance ?? '0');
  const realIn = parseFloat(data.realizedInflows ?? '0');
  const realOut = parseFloat(data.realizedOutflows ?? '0');
  const closing = opening + realIn - realOut;
  await db.insert(cashFlow).values({
    referenceDate: data.referenceDate as unknown as Date,
    openingBalance: opening.toFixed(2),
    projectedInflows: data.projectedInflows,
    realizedInflows: realIn.toFixed(2),
    projectedOutflows: data.projectedOutflows,
    realizedOutflows: realOut.toFixed(2),
    closingBalance: closing.toFixed(2),
    freeCash: closing.toFixed(2),
    committedCash: '0',
    fundingNeeded: closing < 0 ? Math.abs(closing).toFixed(2) : '0',
    projectionD7: data.projectionD7,
    projectionD15: data.projectionD15,
    projectionD30: data.projectionD30,
  }).onDuplicateKeyUpdate({
    set: {
      openingBalance: opening.toFixed(2), projectedInflows: data.projectedInflows,
      realizedInflows: realIn.toFixed(2), projectedOutflows: data.projectedOutflows,
      realizedOutflows: realOut.toFixed(2), closingBalance: closing.toFixed(2),
      freeCash: closing.toFixed(2), fundingNeeded: closing < 0 ? Math.abs(closing).toFixed(2) : '0',
      projectionD7: data.projectionD7, projectionD15: data.projectionD15, projectionD30: data.projectionD30,
    }
  });
}

// ─── ALERTAS ──────────────────────────────────────────────────────────────────
export async function createAlert(data: {
  type: string; title: string; message: string;
  severity?: 'info' | 'warning' | 'critical';
  referenceId?: number; referenceType?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(alerts).values({
    type: data.type as any,
    title: data.title,
    message: data.message,
    severity: data.severity ?? 'warning',
    status: 'active',
    referenceId: data.referenceId,
    referenceType: data.referenceType,
  });
}

export async function getAlerts(status?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (status) conditions.push(eq(alerts.status, status as any));
  return db.select().from(alerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alerts.createdAt))
    .limit(50);
}

export async function acknowledgeAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({
    status: 'acknowledged',
    acknowledgedBy: userId,
    acknowledgedAt: new Date(),
  }).where(eq(alerts.id, id));
}

// ─── CENTROS DE CUSTO ─────────────────────────────────────────────────────────
export async function getCostCenters() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(costCenters).where(eq(costCenters.active, true));
}

export async function createCostCenter(data: { name: string; type: string; description?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(costCenters).values({ ...data, type: data.type as any });
  return result[0].insertId;
}

export async function deleteCostCenter(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(costCenters).where(eq(costCenters.id, id));
}

export async function updateCostCenter(id: number, data: { name?: string; type?: string; description?: string; budget?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.budget !== undefined) updateData.budget = data.budget;
  await db.update(costCenters).set(updateData).where(eq(costCenters.id, id));
}

export async function getCostCenterSummary(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return [];
  const [expRows, revRows] = await Promise.all([
    db.select({ costCenterId: expenses.costCenterId, total: sql<string>`SUM(amount)` })
      .from(expenses).where(and(gte(expenses.referenceDate, new Date(dateFrom)), lte(expenses.referenceDate, new Date(dateTo)), isNotNull(expenses.costCenterId)))
      .groupBy(expenses.costCenterId),
    db.select({ costCenterId: revenues.costCenterId, total: sql<string>`SUM(amount)` })
      .from(revenues).where(and(gte(revenues.referenceDate, new Date(dateFrom)), lte(revenues.referenceDate, new Date(dateTo)), isNotNull(revenues.costCenterId)))
      .groupBy(revenues.costCenterId),
  ]);
  const map: Record<number, { expenses: number; revenues: number }> = {};
  for (const r of expRows) if (r.costCenterId) { map[r.costCenterId] = map[r.costCenterId] ?? { expenses: 0, revenues: 0 }; map[r.costCenterId].expenses += parseFloat(r.total ?? "0"); }
  for (const r of revRows) if (r.costCenterId) { map[r.costCenterId] = map[r.costCenterId] ?? { expenses: 0, revenues: 0 }; map[r.costCenterId].revenues += parseFloat(r.total ?? "0"); }
  return Object.entries(map).map(([id, v]) => ({ costCenterId: Number(id), totalExpenses: v.expenses.toFixed(2), totalRevenues: v.revenues.toFixed(2), total: (v.expenses + v.revenues).toFixed(2) }));
}

// ─── SYSTEM CONFIG ────────────────────────────────────────────────────────────
export async function getSystemConfig(key: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  return result[0]?.value ?? null;
}

export async function setSystemConfig(key: string, value: string, description?: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(systemConfig).values({ key, value, description }).onDuplicateKeyUpdate({ set: { value } });
}

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────
export async function getDashboardSummary(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return null;
  const [revSummary, expSummary, latestBalance, activeDivergences, overduePayables, activeAlerts] = await Promise.all([
    getRevenueSummary(dateFrom, dateTo),
    getExpenseSummary(dateFrom, dateTo),
    getLatestManagerialBalance(),
    getDivergences({ status: 'pendente' }),
    getPayables({ status: 'vencido' }),
    getAlerts('active'),
  ]);
  const totalRevenue = revSummary.reduce((sum, r) => sum + parseFloat(r.total ?? '0'), 0);
  const totalExpenses = expSummary.reduce((sum, e) => sum + parseFloat(e.total ?? '0'), 0);
  return {
    totalRevenue, totalExpenses, netResult: totalRevenue - totalExpenses,
    latestBalance, activeDivergences: activeDivergences.length,
    overduePayables: overduePayables.length, activeAlerts: activeAlerts.length,
    revenueSummary: revSummary, expenseSummary: expSummary,
  };
}

// ─── EDIT/DELETE OPERATIONS ───────────────────────────────────────────────────

export async function updateRevenue(id: number, data: {
  referenceDate?: string; type?: string; description?: string;
  amount?: string; clientName?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(revenues).set({
    ...(data.referenceDate && { referenceDate: data.referenceDate as unknown as Date }),
    ...(data.type && { type: data.type as any }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.amount && { amount: data.amount }),
    ...(data.clientName !== undefined && { clientName: data.clientName }),
    ...(data.status && { status: data.status as any }),
  }).where(eq(revenues.id, id));
}

export async function deleteRevenue(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(revenues).where(eq(revenues.id, id));
}

export async function updateExpense(id: number, data: {
  referenceDate?: string; category?: string; description?: string;
  amount?: string; supplier?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(expenses).set({
    ...(data.referenceDate && { referenceDate: data.referenceDate as unknown as Date }),
    ...(data.category && { category: data.category as any }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.amount && { amount: data.amount }),
    ...(data.supplier !== undefined && { supplier: data.supplier }),
    ...(data.status && { status: data.status as any }),
  }).where(eq(expenses.id, id));
}

export async function deleteExpense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(expenses).where(eq(expenses.id, id));
}

export async function updateCreditPortfolio(id: number, data: {
  status?: string; outstandingBalance?: string; paidInstallments?: number; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(creditPortfolio).set({
    ...(data.status && { status: data.status as any }),
    ...(data.outstandingBalance !== undefined && { outstandingBalance: data.outstandingBalance }),
    ...(data.paidInstallments !== undefined && { paidInstallments: data.paidInstallments }),
    ...(data.notes !== undefined && { notes: data.notes }),
  }).where(eq(creditPortfolio.id, id));
}

export async function deleteCreditPortfolio(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(creditPortfolio).where(eq(creditPortfolio.id, id));
}

export async function updatePayable(id: number, data: {
  dueDate?: string; description?: string; category?: string;
  amount?: string; supplier?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(payables).set({
    ...(data.dueDate && { dueDate: data.dueDate as unknown as Date }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.category && { category: data.category as any }),
    ...(data.amount && { amount: data.amount }),
    ...(data.supplier !== undefined && { supplier: data.supplier }),
    ...(data.notes !== undefined && { notes: data.notes }),
  }).where(eq(payables.id, id));
}

export async function getUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id, openId: users.openId, name: users.name,
    email: users.email, role: users.role, createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn, loginMethod: users.loginMethod,
  }).from(users).orderBy(users.createdAt);
}

export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(users).where(eq(users.id, id));
}

export async function deleteManagerialBalance(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(managerialBalances).where(eq(managerialBalances.id, id));
}

export async function deleteDRE(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(dre).where(eq(dre.id, id));
}

export async function deleteCashFlow(referenceDate: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(cashFlow).where(eq(cashFlow.referenceDate, referenceDate as unknown as Date));
}


export async function createUser(data: {
  email: string; name: string; passwordHash: string; role?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { emailToOpenId } = await import("./_core/localAuth");
  const openId = emailToOpenId(data.email);
  await db.insert(users).values({
    openId, email: data.email, name: data.name,
    passwordHash: data.passwordHash,
    loginMethod: "local",
    role: (data.role as "user" | "admin") ?? "user",
    lastSignedIn: new Date(),
  });
  return openId;
}
