import { and, desc, eq, gte, lte, sql, between, like, or, isNotNull, inArray } from "drizzle-orm";
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

export async function deleteReconciliationSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Apaga tudo ligado à sessão — incluindo receitas e despesas criadas automaticamente
  await db.execute(sql`DELETE FROM revenues WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM expenses WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM divergences WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM bank_transactions WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM api_transactions WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM reconciliation_sessions WHERE id = ${id}`);
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

export async function createBankTransaction(data: {
  sessionId: number; type: 'credit' | 'debit'; transactionDate: string;
  description: string; amount: string; channel?: string; bankName?: string; externalId?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO bank_transactions (sessionId, type, transactionDate, description, amount, channel, bankName, externalId)
    VALUES (${data.sessionId}, ${data.type}, ${data.transactionDate}, ${data.description || null}, ${data.amount}, ${data.channel || null}, ${data.bankName || null}, ${data.externalId || null})
  `);
}

export async function createApiTransaction(data: {
  sessionId: number; type: 'credit' | 'debit'; transactionDate: string;
  description: string; amount: string; channel?: string; clientName?: string; externalId?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO api_transactions (sessionId, type, transactionDate, description, amount, channel, clientName, externalId)
    VALUES (${data.sessionId}, ${data.type}, ${data.transactionDate}, ${data.description || null}, ${data.amount}, ${data.channel || null}, ${data.clientName || null}, ${data.externalId || null})
  `);
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
  bankDescription?: string; apiDescription?: string;
  externalId?: string; bankAmount?: string; apiAmount?: string;
  transactionType?: 'credit' | 'debit';
  observation?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.execute(sql`
    INSERT INTO divergences (
      sessionId, divergenceDate, bankName, clientId, clientName,
      divergenceType, amount, origin, category, priority, status,
      bankDescription, apiDescription, externalId, bankAmount, apiAmount, transactionType,
      observation
    ) VALUES (
      ${data.sessionId}, ${data.divergenceDate}, ${data.bankName || null}, ${data.clientId || null},
      ${data.clientName || null}, ${data.divergenceType}, ${data.amount}, ${data.origin || null},
      ${data.category}, ${data.priority || 'medium'}, 'pendente',
      ${data.bankDescription || null}, ${data.apiDescription || null},
      ${data.externalId || null}, ${data.bankAmount || null}, ${data.apiAmount || null},
      ${data.transactionType || null}, ${data.observation || null}
    )
  `);
  return (result as any)[0]?.insertId ?? 0;
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
  const bankBal = parseFloat(data.bankBalance || '0');
  const clientBal = parseFloat(data.clientBalance || '0');
  const committedBal = parseFloat(data.committedBalance || '0');
  const divBal = parseFloat(data.divergenceBalance || '0');
  const realCash = (bankBal - clientBal - committedBal + divBal).toFixed(2);
  const ownCash = (bankBal - clientBal).toFixed(2);
  const freeCash = (bankBal - clientBal - committedBal).toFixed(2);
  const thirdParty = data.thirdPartyResources || null;
  const futureObl = data.futureObligations || null;
  const fundNeeded = data.fundingNeeded || null;
  const openDiv = data.openDivergences ?? 0;
  await db.execute(sql`
    INSERT INTO managerial_balances (referenceDate, bankBalance, clientBalance, committedBalance, divergenceBalance, realCash, ownCash, committedCash, freeCash, thirdPartyResources, futureObligations, fundingNeeded, openDivergences)
    VALUES (${data.referenceDate}, ${data.bankBalance}, ${data.clientBalance}, ${data.committedBalance}, ${data.divergenceBalance}, ${realCash}, ${ownCash}, ${committedBal.toFixed(2)}, ${freeCash}, ${thirdParty}, ${futureObl}, ${fundNeeded}, ${openDiv})
    ON DUPLICATE KEY UPDATE
      bankBalance = VALUES(bankBalance), clientBalance = VALUES(clientBalance),
      committedBalance = VALUES(committedBalance), divergenceBalance = VALUES(divergenceBalance),
      realCash = VALUES(realCash), ownCash = VALUES(ownCash),
      committedCash = VALUES(committedCash), freeCash = VALUES(freeCash),
      thirdPartyResources = VALUES(thirdPartyResources), futureObligations = VALUES(futureObligations),
      fundingNeeded = VALUES(fundingNeeded), openDivergences = VALUES(openDivergences)
  `);
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
  createdByName?: string; divergenceId?: number; sessionId?: number;
  origin?: 'auto_tariff' | 'manual_move' | 'manual';
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const revStatus = data.status === 'previsto' || data.status === 'cancelado' ? data.status : 'realizado';
  const result = await db.insert(revenues).values({
    referenceDate: data.referenceDate as unknown as Date,
    type: data.type as any,
    description: data.description ?? null,
    amount: data.amount,
    clientId: data.clientId ?? null,
    clientName: data.clientName ?? null,
    status: revStatus as any,
    costCenterId: data.costCenterId ?? null,
    createdByName: data.createdByName ?? null,
  });
  return (result as any)[0]?.insertId ?? 0;
}

export async function getRevenues(filters?: {
  dateFrom?: string; dateTo?: string; type?: string; status?: string; origin?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.dateFrom) conditions.push(sql`${revenues.referenceDate} >= ${filters.dateFrom}`);
  if (filters?.dateTo) conditions.push(sql`${revenues.referenceDate} <= ${filters.dateTo}`);
  if (filters?.type) conditions.push(eq(revenues.type, filters.type as any));
  if (filters?.status) conditions.push(eq(revenues.status, filters.status as any));
  if (filters?.origin) conditions.push(eq(revenues.origin as any, filters.origin));
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
  createdByName?: string; divergenceId?: number; sessionId?: number;
  origin?: 'auto_tariff' | 'manual_move' | 'manual';
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const expStatus = (data.status === 'previsto' || data.status === 'cancelado') ? data.status : 'realizado';
  const result = await db.insert(expenses).values({
    referenceDate: data.referenceDate as unknown as Date,
    category: data.category as any,
    subcategory: data.subcategory ?? null,
    description: data.description ?? null,
    amount: data.amount,
    supplier: data.supplier ?? null,
    status: expStatus as any,
    costCenterId: data.costCenterId ?? null,
    createdByName: data.createdByName ?? null,
  });
  return (result as any)[0]?.insertId ?? 0;
}

/** Move uma ou mais divergências para Receitas (bulk) */
export async function moveDivergencesToRevenue(
  ids: number[],
  data: {
    type: string; description?: string; clientName?: string;
    sessionId?: number; createdByName?: string;
  }
) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("DB unavailable");

  const divs = await dbConn.select().from(divergences).where(inArray(divergences.id, ids));
  const revenueIds: number[] = [];

  for (const div of divs) {
    const revId = await createRevenue({
      referenceDate: String(div.divergenceDate),
      type: data.type,
      description: data.description ?? div.bankDescription ?? div.apiDescription ?? undefined,
      amount: String(div.amount),
      clientName: data.clientName ?? div.clientName ?? undefined,
      sessionId: data.sessionId ?? div.sessionId ?? undefined,
      createdByName: data.createdByName,
      divergenceId: div.id,
      origin: 'manual_move',
    });
    revenueIds.push(revId);
  }

  // Marca divergências como regularizado
  await dbConn.update(divergences)
    .set({ status: 'regularizado', actionTaken: 'Movido para Receitas' })
    .where(inArray(divergences.id, ids));

  return revenueIds;
}

/** Move uma ou mais divergências para Despesas (bulk) */
export async function moveDivergencesToExpense(
  ids: number[],
  data: {
    category: string; subcategory?: string; description?: string;
    supplier?: string; sessionId?: number; createdByName?: string;
  }
) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("DB unavailable");

  const divs = await dbConn.select().from(divergences).where(inArray(divergences.id, ids));
  const expenseIds: number[] = [];

  for (const div of divs) {
    const expId = await createExpense({
      referenceDate: String(div.divergenceDate),
      category: data.category,
      subcategory: data.subcategory,
      description: data.description ?? div.bankDescription ?? div.apiDescription ?? undefined,
      amount: String(div.amount),
      supplier: data.supplier ?? div.clientName ?? undefined,
      sessionId: data.sessionId ?? div.sessionId ?? undefined,
      createdByName: data.createdByName,
      divergenceId: div.id,
      origin: 'manual_move',
    });
    expenseIds.push(expId);
  }

  await dbConn.update(divergences)
    .set({ status: 'regularizado', actionTaken: 'Movido para Despesas' })
    .where(inArray(divergences.id, ids));

  return expenseIds;
}

export async function getExpenses(filters?: {
  dateFrom?: string; dateTo?: string; category?: string; status?: string; origin?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.dateFrom) conditions.push(sql`${expenses.referenceDate} >= ${filters.dateFrom}`);
  if (filters?.dateTo) conditions.push(sql`${expenses.referenceDate} <= ${filters.dateTo}`);
  if (filters?.category) conditions.push(eq(expenses.category, filters.category as any));
  if (filters?.status) conditions.push(eq(expenses.status, filters.status as any));
  if (filters?.origin) conditions.push(eq(expenses.origin as any, filters.origin));
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
  await db.execute(sql`DELETE FROM payables WHERE id = ${id}`);
}

// ─── CARTEIRA DE CRÉDITO ──────────────────────────────────────────────────────
export async function createCreditEntry(data: {
  clientId: string; clientName: string; principal: string; interestRate: string;
  totalInstallments: number; startDate: string; expectedEndDate: string;
  fundingSource?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const fundingSource = data.fundingSource ?? 'capital_proprio';
  const result = await db.execute(sql`
    INSERT INTO credit_portfolio (clientId, clientName, principal, interestRate, totalInstallments, startDate, expectedEndDate, fundingSource, outstandingBalance, status, notes)
    VALUES (${data.clientId}, ${data.clientName}, ${data.principal}, ${data.interestRate}, ${data.totalInstallments}, ${data.startDate}, ${data.expectedEndDate}, ${fundingSource}, ${data.principal}, 'ativo', ${data.notes || null})
  `);
  return (result as any)[0]?.insertId ?? 0;
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
  await db.execute(sql`
    INSERT INTO dre (referenceMonth, grossRevenue, netRevenue, financialCosts, operationalCosts, adminExpenses, commercialExpenses, taxes, operationalResult, financialResult, netProfit, margin)
    VALUES (${data.referenceMonth}, ${gross.toFixed(2)}, ${net.toFixed(2)}, ${finCosts.toFixed(2)}, ${opCosts.toFixed(2)}, ${adminExp.toFixed(2)}, ${commExp.toFixed(2)}, ${taxesVal.toFixed(2)}, ${opResult.toFixed(2)}, '0', ${opResult.toFixed(2)}, ${margin.toFixed(4)})
    ON DUPLICATE KEY UPDATE
      grossRevenue = VALUES(grossRevenue), netRevenue = VALUES(netRevenue),
      financialCosts = VALUES(financialCosts), operationalCosts = VALUES(operationalCosts),
      adminExpenses = VALUES(adminExpenses), commercialExpenses = VALUES(commercialExpenses),
      taxes = VALUES(taxes), operationalResult = VALUES(operationalResult),
      netProfit = VALUES(netProfit), margin = VALUES(margin)
  `);
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
  const fundingNeeded = closing < 0 ? Math.abs(closing).toFixed(2) : '0';
  const projIn = data.projectedInflows || null;
  const projOut = data.projectedOutflows || null;
  const d7 = data.projectionD7 || null;
  const d15 = data.projectionD15 || null;
  const d30 = data.projectionD30 || null;
  await db.execute(sql`
    INSERT INTO cash_flow (referenceDate, openingBalance, projectedInflows, realizedInflows, projectedOutflows, realizedOutflows, closingBalance, freeCash, committedCash, fundingNeeded, projectionD7, projectionD15, projectionD30)
    VALUES (${data.referenceDate}, ${opening.toFixed(2)}, ${projIn}, ${realIn.toFixed(2)}, ${projOut}, ${realOut.toFixed(2)}, ${closing.toFixed(2)}, ${closing.toFixed(2)}, '0', ${fundingNeeded}, ${d7}, ${d15}, ${d30})
    ON DUPLICATE KEY UPDATE
      openingBalance = VALUES(openingBalance), projectedInflows = VALUES(projectedInflows),
      realizedInflows = VALUES(realizedInflows), projectedOutflows = VALUES(projectedOutflows),
      realizedOutflows = VALUES(realizedOutflows), closingBalance = VALUES(closingBalance),
      freeCash = VALUES(freeCash), fundingNeeded = VALUES(fundingNeeded),
      projectionD7 = VALUES(projectionD7), projectionD15 = VALUES(projectionD15), projectionD30 = VALUES(projectionD30)
  `);
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

export async function createCostCenter(data: { name: string; type: string; description?: string; budget?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const budget = data.budget && data.budget !== "" ? data.budget : null;
  const result = await db.execute(sql`
    INSERT INTO cost_centers (name, type, description, budget)
    VALUES (${data.name}, ${data.type}, ${data.description || null}, ${budget})
  `);
  return (result as any)[0]?.insertId ?? 0;
}

export async function deleteCostCenter(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM cost_centers WHERE id = ${id}`);
}

export async function updateCostCenter(id: number, data: { name?: string; type?: string; description?: string; budget?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    UPDATE cost_centers SET
      name = ${data.name ?? sql`name`},
      type = ${data.type ?? sql`type`},
      description = ${data.description ?? null},
      budget = ${data.budget ?? null}
    WHERE id = ${id}
  `);
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
  const validStatus = ['previsto', 'realizado', 'cancelado'];
  const status = data.status && validStatus.includes(data.status) ? data.status : 'realizado';
  await db.execute(sql`
    UPDATE revenues SET
      referenceDate = ${data.referenceDate ?? sql`referenceDate`},
      type = ${data.type ?? sql`type`},
      description = ${data.description ?? null},
      amount = ${data.amount ?? sql`amount`},
      clientName = ${data.clientName ?? null},
      status = ${status}
    WHERE id = ${id}
  `);
}

export async function deleteRevenue(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM revenues WHERE id = ${id}`);
}

export async function updateExpense(id: number, data: {
  referenceDate?: string; category?: string; description?: string;
  amount?: string; supplier?: string; status?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const validStatus = ['previsto', 'realizado', 'cancelado'];
  const status = data.status && validStatus.includes(data.status) ? data.status : 'realizado';
  await db.execute(sql`
    UPDATE expenses SET
      referenceDate = ${data.referenceDate ?? sql`referenceDate`},
      category = ${data.category ?? sql`category`},
      description = ${data.description ?? null},
      amount = ${data.amount ?? sql`amount`},
      supplier = ${data.supplier ?? null},
      status = ${status}
    WHERE id = ${id}
  `);
}

export async function deleteExpense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM expenses WHERE id = ${id}`);
}

export async function updateCreditPortfolio(id: number, data: {
  status?: string; outstandingBalance?: string; paidInstallments?: number; notes?: string;
  principal?: string; interestRate?: string; totalInstallments?: number; expectedEndDate?: string; fundingSource?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    UPDATE credit_portfolio SET
      status = ${data.status ?? sql`status`},
      outstandingBalance = ${data.outstandingBalance ?? sql`outstandingBalance`},
      paidInstallments = ${data.paidInstallments ?? sql`paidInstallments`},
      notes = ${data.notes ?? null},
      principal = ${data.principal ?? sql`principal`},
      interestRate = ${data.interestRate ?? sql`interestRate`},
      totalInstallments = ${data.totalInstallments ?? sql`totalInstallments`},
      expectedEndDate = ${data.expectedEndDate ?? sql`expectedEndDate`},
      fundingSource = ${data.fundingSource ?? sql`fundingSource`}
    WHERE id = ${id}
  `);
}

export async function deleteCreditPortfolio(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM credit_portfolio WHERE id = ${id}`);
}

export async function updatePayable(id: number, data: {
  dueDate?: string; description?: string; category?: string;
  amount?: string; supplier?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    UPDATE payables SET
      dueDate = ${data.dueDate ?? sql`dueDate`},
      description = ${data.description ?? sql`description`},
      category = ${data.category ?? sql`category`},
      amount = ${data.amount ?? sql`amount`},
      supplier = ${data.supplier ?? null},
      notes = ${data.notes ?? null}
    WHERE id = ${id}
  `);
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
  await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
}

export async function deleteManagerialBalance(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM managerial_balances WHERE id = ${id}`);
}

export async function deleteDRE(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM dre WHERE id = ${id}`);
}

export async function deleteCashFlow(referenceDate: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM cash_flow WHERE referenceDate = ${referenceDate}`);
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
