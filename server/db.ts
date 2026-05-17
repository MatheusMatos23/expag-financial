import { and, desc, eq, gte, lte, sql, between, like, or, isNotNull, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  reconciliationSessions, bankTransactions, apiTransactions, divergences, managerialBalances,
  revenues, expenses, payables, creditPortfolio, creditInstallments,
  costCenters, dre, cashFlow, alerts, systemConfig,
  manualAdjustments, auditLogs,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// ── CACHE: evita recomputar queries caras dentro do mesmo processo ────────────
// TTL: 30s para dashboards, 5min para agregações históricas
const _cache = new Map<string, { data: any; expiresAt: number }>();
function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data as T;
}
function cacheSet(key: string, data: any, ttlMs = 30_000) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
function cacheInvalidate(pattern: string) {
  for (const key of Array.from(_cache.keys())) {
    if (key.startsWith(pattern)) _cache.delete(key);
  }
}

/** Converte Date do MySQL (ou string) para ISO YYYY-MM-DD de forma segura */
function toISODate(val: Date | string | null | undefined): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  // Já está em formato ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Tenta parsear formato livre (ex: "Fri Apr 17 2026...")
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

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

export function invalidateReconciliationCache() {
  // Limpa todo o cache — garante que dados apagados não reapareçam
  _cache.clear();
}

export async function deleteReconciliationSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Apaga receitas e despesas da sessão (com fallback seguro caso coluna não exista)
  try { await db.execute(sql`DELETE FROM revenues WHERE sessionId = ${id}`); } catch {}
  try { await db.execute(sql`DELETE FROM expenses WHERE sessionId = ${id}`); } catch {}
  // Apaga divergências movidas manualmente para receitas/despesas
  try {
    await db.execute(sql`
      DELETE FROM revenues WHERE divergenceId IN (
        SELECT id FROM divergences WHERE sessionId = ${id}
      )
    `);
    await db.execute(sql`
      DELETE FROM expenses WHERE divergenceId IN (
        SELECT id FROM divergences WHERE sessionId = ${id}
      )
    `);
  } catch {}
  await db.execute(sql`DELETE FROM divergences WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM bank_transactions WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM api_transactions WHERE sessionId = ${id}`);
  await db.execute(sql`DELETE FROM reconciliation_sessions WHERE id = ${id}`);
}

/**
 * Limpa completamente os dados de uma sessão que falhou no meio do processamento.
 * Garante atomicidade: ou a conciliação completa com sucesso, ou nada fica no banco.
 * Diferente de deleteReconciliationSession: preserva o registro da sessão marcado
 * como 'error' para rastreabilidade, mas remove todas as transações/divergências órfãs.
 */
export async function cleanupFailedSession(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    // Remove dados derivados que possam ter sido parcialmente criados
    await db.execute(sql`
      DELETE FROM revenues WHERE divergenceId IN (
        SELECT id FROM divergences WHERE sessionId = ${id}
      )
    `);
    await db.execute(sql`
      DELETE FROM expenses WHERE divergenceId IN (
        SELECT id FROM divergences WHERE sessionId = ${id}
      )
    `);
  } catch {}
  try { await db.execute(sql`DELETE FROM revenues WHERE sessionId = ${id}`); } catch {}
  try { await db.execute(sql`DELETE FROM expenses WHERE sessionId = ${id}`); } catch {}
  try { await db.execute(sql`DELETE FROM divergences WHERE sessionId = ${id}`); } catch {}
  try { await db.execute(sql`DELETE FROM bank_transactions WHERE sessionId = ${id}`); } catch {}
  try { await db.execute(sql`DELETE FROM api_transactions WHERE sessionId = ${id}`); } catch {}
  // A sessão em si NÃO é removida — fica como 'error' para auditoria
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
  matchStatus?: 'matched' | 'divergent' | 'manual';
}) {
  const db = await getDb();
  if (!db) return;
  const ms = data.matchStatus ?? 'divergent';
  await db.execute(sql`
    INSERT INTO bank_transactions (sessionId, type, transactionDate, description, amount, channel, bankName, externalId, matchStatus)
    VALUES (${data.sessionId}, ${data.type}, ${data.transactionDate}, ${data.description || null}, ${data.amount}, ${data.channel || null}, ${data.bankName || null}, ${data.externalId || null}, ${ms})
  `);
}

/** BATCH INSERT — insere até 500 bank_transactions por query (104x mais rápido) */
export async function insertBankTransactionsBatch(rows: Array<{
  sessionId: number; type: string; transactionDate: string;
  description?: string; amount: string; channel?: string; bankName?: string;
  externalId?: string; matchStatus?: string;
}>) {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r =>
      `(${r.sessionId}, '${r.type}', '${r.transactionDate}',
        ${r.description ? `'${r.description.replace(/'/g,"''").slice(0,500)}'` : 'NULL'},
        '${r.amount}',
        ${r.channel ? `'${r.channel.replace(/'/g,"''")}'` : 'NULL'},
        ${r.bankName ? `'${r.bankName.replace(/'/g,"''")}'` : 'NULL'},
        ${r.externalId ? `'${r.externalId.replace(/'/g,"''").slice(0,200)}'` : 'NULL'},
        '${r.matchStatus ?? 'divergent'}')`
    ).join(',');
    await db.execute(sql.raw(
      `INSERT INTO bank_transactions (sessionId, type, transactionDate, description, amount, channel, bankName, externalId, matchStatus) VALUES ${values}`
    ));
  }
}

/** BATCH INSERT — insere até 500 api_transactions por query */
export async function insertApiTransactionsBatch(rows: Array<{
  sessionId: number; type: string; transactionDate: string;
  description?: string; amount: string; channel?: string; clientName?: string;
  externalId?: string; matchStatus?: string;
}>) {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r =>
      `(${r.sessionId}, '${r.type}', '${r.transactionDate}',
        ${r.description ? `'${r.description.replace(/'/g,"''").slice(0,500)}'` : 'NULL'},
        '${r.amount}',
        ${r.channel ? `'${r.channel.replace(/'/g,"''")}'` : 'NULL'},
        ${r.clientName ? `'${r.clientName.replace(/'/g,"''").slice(0,200)}'` : 'NULL'},
        ${r.externalId ? `'${r.externalId.replace(/'/g,"''").slice(0,200)}'` : 'NULL'},
        '${r.matchStatus ?? 'divergent'}')`
    ).join(',');
    await db.execute(sql.raw(
      `INSERT INTO api_transactions (sessionId, type, transactionDate, description, amount, channel, clientName, externalId, matchStatus) VALUES ${values}`
    ));
  }
}

/** BATCH INSERT — insere até 200 divergences por query */
export async function insertDivergencesBatch(rows: Array<{
  sessionId: number; divergenceDate: string; bankName?: string;
  clientName?: string; divergenceType: string; amount: string;
  origin?: string; category: string; priority?: string;
  bankDescription?: string; apiDescription?: string;
  bankAmount?: string; apiAmount?: string; transactionType?: string;
  externalId?: string; observation?: string;
}>) {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r => {
      const esc = (v?: string | null) => v ? `'${String(v).replace(/'/g,"''").slice(0,500)}'` : 'NULL';
      return `(${r.sessionId}, ${esc(r.divergenceDate)}, ${esc(r.bankName)}, ${esc(r.clientName)},
        '${r.divergenceType}', ${esc(r.amount)}, ${esc(r.origin)}, '${r.category}',
        '${r.priority ?? 'medium'}', 'pendente',
        ${esc(r.bankDescription)}, ${esc(r.apiDescription)},
        ${esc(r.externalId)}, ${esc(r.bankAmount)}, ${esc(r.apiAmount)},
        ${esc(r.transactionType)}, ${esc(r.observation)})`;
    }).join(',');
    await db.execute(sql.raw(
      `INSERT INTO divergences
        (sessionId, divergenceDate, bankName, clientName, divergenceType, amount, origin, category, priority, status,
         bankDescription, apiDescription, externalId, bankAmount, apiAmount, transactionType, observation)
       VALUES ${values}`
    ));
  }
}

export async function createApiTransaction(data: {
  sessionId: number; type: 'credit' | 'debit'; transactionDate: string;
  description: string; amount: string; channel?: string; clientName?: string; externalId?: string;
  matchStatus?: 'matched' | 'divergent' | 'manual';
}) {
  const db = await getDb();
  if (!db) return;
  const ms = data.matchStatus ?? 'divergent';
  await db.execute(sql`
    INSERT INTO api_transactions (sessionId, type, transactionDate, description, amount, channel, clientName, externalId, matchStatus)
    VALUES (${data.sessionId}, ${data.type}, ${data.transactionDate}, ${data.description || null}, ${data.amount}, ${data.channel || null}, ${data.clientName || null}, ${data.externalId || null}, ${ms})
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
    .orderBy(desc(divergences.createdAt))
    .limit(1000);  // never do full table scan
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
    sessionId: data.sessionId ?? null,
    divergenceId: data.divergenceId ?? null,
    origin: data.origin ?? 'manual',
  });
  return (result as any)[0]?.insertId ?? 0;
}

export async function getRevenues(filters?: {
  dateFrom?: string; dateTo?: string; type?: string; status?: string; origin?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.dateFrom) conditions.push(sql`referenceDate >= ${filters.dateFrom}`);
  if (filters?.dateTo) conditions.push(sql`referenceDate <= ${filters.dateTo}`);
  if (filters?.type) conditions.push(eq(revenues.type, filters.type as any));
  if (filters?.status) conditions.push(eq(revenues.status, filters.status as any));
  if (filters?.origin) conditions.push(sql`revenues.origin = ${filters.origin}`);
  const limit = Math.min((filters as any)?.limit ?? 2000, 5000);
  return db.select().from(revenues)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(revenues.referenceDate))
    .limit(limit);
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
    sessionId: data.sessionId ?? null,
    divergenceId: data.divergenceId ?? null,
    origin: data.origin ?? 'manual',
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
  if (filters?.dateFrom) conditions.push(sql`referenceDate >= ${filters.dateFrom}`);
  if (filters?.dateTo) conditions.push(sql`referenceDate <= ${filters.dateTo}`);
  if (filters?.category) conditions.push(eq(expenses.category, filters.category as any));
  if (filters?.status) conditions.push(eq(expenses.status, filters.status as any));
  if (filters?.origin) conditions.push(sql`expenses.origin = ${filters.origin}`);
  const limit = Math.min((filters as any)?.limit ?? 2000, 5000);
  return db.select().from(expenses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(expenses.referenceDate))
    .limit(limit);
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
  // Tenta obter DRE automático a partir de revenues e expenses
  // Agrupa por mês e calcula resultado
  const result = await db.execute(sql`
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      SUM(CAST(amount AS DECIMAL(18,2)))  as totalRevenue,
      0                                    as totalExpense
    FROM revenues
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
    UNION ALL
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      0                                    as totalRevenue,
      SUM(CAST(amount AS DECIMAL(18,2)))  as totalExpense
    FROM expenses
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
    ORDER BY month DESC
  `);
  
  const rows = (result as any)[0] ?? [];
  const byMonth: Record<string, { revenue: number; expense: number }> = {};
  for (const r of rows) {
    const m = r.month;
    if (!byMonth[m]) byMonth[m] = { revenue: 0, expense: 0 };
    byMonth[m].revenue += parseFloat(String(r.totalRevenue ?? 0));
    byMonth[m].expense += parseFloat(String(r.totalExpense ?? 0));
  }

  // Mescla com DRE manual (override se existir)
  const manualDRE = await db.select().from(dre).orderBy(desc(dre.referenceMonth)).limit(months);
  const manualByMonth: Record<string, any> = {};
  for (const m of manualDRE) manualByMonth[String(m.referenceMonth)] = m;

  const months12 = Array.from({ length: months }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  return months12.map(m => {
    const manual = manualByMonth[m];
    if (manual) return { ...manual, source: 'manual' };
    const auto = byMonth[m];
    if (!auto) return null;
    const { revenue, expense } = auto;
    const net = revenue - expense;
    const margin = revenue > 0 ? net / revenue : 0;
    return {
      id: 0, referenceMonth: m, source: 'auto',
      grossRevenue: revenue.toFixed(2),
      netRevenue: revenue.toFixed(2),
      financialCosts: '0', operationalCosts: expense.toFixed(2),
      adminExpenses: '0', commercialExpenses: '0', taxes: '0',
      operationalResult: net.toFixed(2), financialResult: '0',
      netProfit: net.toFixed(2), margin: margin.toFixed(4),
    };
  }).filter(Boolean);
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

  // Calcula fluxo de caixa automático a partir de revenues e expenses por dia
  const result = await db.execute(sql`
    SELECT
      referenceDate as date,
      SUM(CAST(amount AS DECIMAL(18,2))) as inflow,
      0 as outflow
    FROM revenues
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
    GROUP BY referenceDate
    UNION ALL
    SELECT
      referenceDate as date,
      0 as inflow,
      SUM(CAST(amount AS DECIMAL(18,2))) as outflow
    FROM expenses
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
    GROUP BY referenceDate
    ORDER BY date ASC
  `);

  const rows = (result as any)[0] ?? [];
  const byDate: Record<string, { inflow: number; outflow: number }> = {};
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (!byDate[d]) byDate[d] = { inflow: 0, outflow: 0 };
    byDate[d].inflow  += parseFloat(String(r.inflow ?? 0));
    byDate[d].outflow += parseFloat(String(r.outflow ?? 0));
  }

  // Mescla com cashFlow manual (override se existir)
  const manualCF = await db.select().from(cashFlow).orderBy(desc(cashFlow.referenceDate)).limit(days);
  const manualByDate: Record<string, any> = {};
  for (const c of manualCF) manualByDate[String(c.referenceDate).slice(0, 10)] = c;

  let runningBalance = 0;
  const entries = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  const autoRows = entries.map(([date, { inflow, outflow }]) => {
    const manual = manualByDate[date];
    if (manual) { runningBalance = parseFloat(String(manual.closingBalance ?? 0)); return { ...manual, source: 'manual' }; }
    const opening = runningBalance;
    const closing = opening + inflow - outflow;
    runningBalance = closing;
    return {
      id: 0, referenceDate: date, source: 'auto',
      openingBalance: opening.toFixed(2),
      realizedInflows: inflow.toFixed(2),
      realizedOutflows: outflow.toFixed(2),
      closingBalance: closing.toFixed(2),
      projectedInflows: null, projectedOutflows: null,
      freeCash: closing.toFixed(2), committedCash: '0',
      fundingNeeded: closing < 0 ? Math.abs(closing).toFixed(2) : '0',
      projectionD7: null, projectionD15: null, projectionD30: null,
    };
  });

  return [...autoRows, ...manualCF.filter(c => !byDate[String(c.referenceDate).slice(0, 10)])].sort(
    (a, b) => String(b.referenceDate ?? b.date ?? '').localeCompare(String(a.referenceDate ?? a.date ?? ''))
  ).slice(0, days);
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
/** Gera alertas automáticos verificando todo o estado do sistema */
export async function generateSystemAlerts() {
  const db = await getDb();
  if (!db) return { generated: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const generated: string[] = [];

  // Helper: cria alerta apenas se não existir um igual nos últimos 7 dias
  const upsertAlert = async (type: string, title: string, message: string, severity: string, refId?: number) => {
    const existing = await db.execute(sql`
      SELECT id FROM alerts
      WHERE type = ${type}
      AND status = 'active'
      AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ${refId ? sql.raw(`AND referenceId = ${refId}`) : sql.raw('')}
      LIMIT 1
    `);
    if ((existing as any)[0]?.length > 0) return; // já existe
    await createAlert({ type, title, message, severity: severity as any, referenceId: refId });
    generated.push(type);
  };

  // 1. Contas a pagar vencidas
  const overduePayables = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total
    FROM payables
    WHERE status = 'pendente' AND dueDate < ${today}
  `);
  const ovPay = (overduePayables as any)[0]?.[0];
  if (parseInt(String(ovPay?.cnt ?? 0)) > 0) {
    await upsertAlert('overdue_payable', 'Contas a Pagar Vencidas',
      `${ovPay.cnt} conta(s) vencida(s) — R$ ${parseFloat(String(ovPay.total)).toFixed(2)} em atraso`,
      'critical');
  }

  // 2. Parcelas de crédito vencidas (inadimplência)
  const overdueLoans = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(totalAmount AS DECIMAL(18,2))),0) as total
    FROM credit_installments
    WHERE (status = 'pendente' OR status IS NULL) AND dueDate < ${today}
  `);
  const ovLoan = (overdueLoans as any)[0]?.[0];
  if (parseInt(String(ovLoan?.cnt ?? 0)) > 0) {
    await upsertAlert('credit_delinquency', 'Inadimplência na Carteira de Crédito',
      `${ovLoan.cnt} parcela(s) vencida(s) — R$ ${parseFloat(String(ovLoan.total)).toFixed(2)} em atraso`,
      'critical');
    // Atualiza status do crédito para 'atrasado'
    await db.execute(sql`
      UPDATE credit_portfolio SET status = 'atrasado'
      WHERE id IN (
        SELECT DISTINCT creditId FROM credit_installments
        WHERE status = 'pendente' AND dueDate < ${today}
      ) AND status = 'ativo'
    `);
  }

  // 3. NDI acima de 30 dias sem identificação
  const oldNdi = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total
    FROM divergences
    WHERE isNdi = 1
    AND status NOT IN ('regularizado','reclassificado','baixado')
    AND divergenceDate < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  `);
  const ndiData = (oldNdi as any)[0]?.[0];
  if (parseInt(String(ndiData?.cnt ?? 0)) > 0) {
    await upsertAlert('ndi_aging', 'NDI com mais de 30 dias sem identificação',
      `${ndiData.cnt} entrada(s) não identificada(s) com mais de 30 dias — R$ ${parseFloat(String(ndiData.total)).toFixed(2)}`,
      'warning');
  }

  // 4. Divergências críticas pendentes há mais de 7 dias
  const staleDivergences = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total
    FROM divergences
    WHERE priority IN ('critical','high')
    AND status NOT IN ('regularizado','reclassificado','baixado')
    AND divergenceDate < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  `);
  const staleDiv = (staleDivergences as any)[0]?.[0];
  if (parseInt(String(staleDiv?.cnt ?? 0)) > 0) {
    await upsertAlert('stale_divergence', 'Divergências Críticas Pendentes há +7 dias',
      `${staleDiv.cnt} divergência(s) crítica(s) sem tratativa há mais de 7 dias — R$ ${parseFloat(String(staleDiv.total)).toFixed(2)}`,
      'critical');
  }

  // 5. Contas a pagar com vencimento nos próximos 3 dias
  const soonPayables = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total
    FROM payables
    WHERE status = 'pendente'
    AND dueDate BETWEEN ${today} AND DATE_ADD(${today}, INTERVAL 3 DAY)
  `);
  const spData = (soonPayables as any)[0]?.[0];
  if (parseInt(String(spData?.cnt ?? 0)) > 0) {
    await upsertAlert('upcoming_payable', 'Contas a Pagar Vencem em Breve',
      `${spData.cnt} conta(s) vence(m) nos próximos 3 dias — R$ ${parseFloat(String(spData.total)).toFixed(2)}`,
      'warning');
  }

  return { generated: generated.length, types: generated };
}

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
// ─── NDI — NÃO IDENTIFICADOS ──────────────────────────────────────────────────

export async function resolveNdi(id: number, data: {
  clientName: string;
  description: string;
  createdByName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const divs = await db.select().from(divergences).where(eq(divergences.id, id)).limit(1);
  if (!divs[0]) throw new Error("Divergência não encontrada");
  const div = divs[0];

  // NDI é uma entrada no BANCO sem correspondência na API.
  // Quando identificado, criamos uma transação na API (não receita)
  // para que o par banco↔API fique conciliado.
  // A transação de bank_transactions (NDI) já existe — criamos o par na api_transactions.
  if (div.sessionId) {
    const dateStr = String(div.divergenceDate).slice(0, 10).replace(/\//g, '-');
    await db.execute(sql`
      INSERT INTO api_transactions
        (sessionId, type, transactionDate, description, amount, channel, clientName, externalId, matchStatus, matchType)
      VALUES
        (${div.sessionId}, 'credit', ${dateStr}, ${data.description || `PIX identificado: ${data.clientName}`},
         ${String(div.amount)}, 'PIX', ${data.clientName}, ${div.externalId ?? null}, 'manual', 'manual')
    `);

    // Atualiza bank_transaction correspondente para matchStatus = manual
    if (div.bankTransactionId) {
      await db.execute(sql`
        UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
        WHERE id = ${div.bankTransactionId}
      `);
    } else if (div.externalId) {
      await db.execute(sql`
        UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
        WHERE sessionId = ${div.sessionId} AND externalId = ${div.externalId}
      `);
    }
  }

  // Marca NDI como regularizado
  await db.update(divergences)
    .set({
      status: 'regularizado',
      isNdi: false,
      clientName: data.clientName,
      actionTaken: `NDI identificado: ${data.clientName} (por ${data.createdByName})`,
      responsible: data.createdByName,
    })
    .where(eq(divergences.id, id));

  // Recalcula contadores da sessão
  if (div.sessionId) {
    const pending = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM divergences
      WHERE sessionId = ${div.sessionId}
      AND status NOT IN ('regularizado','reclassificado','baixado')
    `);
    const pendingCount = (pending as any)[0]?.[0]?.cnt ?? 0;

    const matchedTxs = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM bank_transactions
      WHERE sessionId = ${div.sessionId} AND matchStatus IN ('matched','manual')
    `);
    const newMatchedCount = parseInt(String((matchedTxs as any)[0]?.[0]?.cnt ?? 0));

    await db.update(reconciliationSessions)
      .set({ matchedCount: newMatchedCount, pendingCount })
      .where(eq(reconciliationSessions.id, div.sessionId));
  }

  return { success: true };
}

export async function markDivergencesAsNdi(ids: number[], ndiNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    UPDATE divergences SET isNdi = 1, ndiNote = ${ndiNote || null},
    status = 'em_analise', observation = CONCAT(COALESCE(observation,''), ' | NDI: aguardando identificação')
    WHERE id IN (${sql.raw(ids.join(','))})
  `);
}

export async function unmarkNdi(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE divergences SET isNdi = 0, ndiNote = NULL WHERE id = ${id}`);
}

export async function getNdiDivergences() {
  const db = await getDb();
  if (!db) return [];
  return db.execute(sql`
    SELECT * FROM divergences WHERE isNdi = 1 ORDER BY divergenceDate DESC, amount DESC
  `).then((r: any) => r[0] ?? []);
}

// ─── AJUSTES MANUAIS DE SALDO ──────────────────────────────────────────────

export async function createManualAdjustment(data: {
  sessionId?: number;
  description: string;
  adjustmentType?: string;
  apiAmount: string;
  bankAmounts: number[];
  divergenceIds?: number[];
  createdByName?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const totalBank = data.bankAmounts.reduce((s, v) => s + v, 0);
  const apiAmt = parseFloat(data.apiAmount);
  const diff = Math.abs(totalBank - apiAmt);

  const result = await db.insert(manualAdjustments).values({
    sessionId: data.sessionId ?? null,
    description: data.description,
    adjustmentType: (data.adjustmentType ?? 'manual') as any,
    apiAmount: data.apiAmount,
    bankAmounts: JSON.stringify(data.bankAmounts),
    totalBankAmount: totalBank.toFixed(2),
    difference: diff.toFixed(2),
    divergenceIds: data.divergenceIds ? JSON.stringify(data.divergenceIds) : null,
    createdByName: data.createdByName ?? null,
    notes: data.notes ?? null,
    status: 'aprovado',
  });

  // Marca divergências como regularizado (sai das pendências)
  if (data.divergenceIds && data.divergenceIds.length > 0) {
    const dbConn = db;

    // Busca divergências para pegar bankTransactionId e externalId
    const divs = await dbConn.select().from(divergences)
      .where(inArray(divergences.id, data.divergenceIds));

    await dbConn.execute(sql`
      UPDATE divergences
      SET status = 'regularizado',
          actionTaken = CONCAT('Ajuste manual: ', ${data.description})
      WHERE id IN (${sql.raw(data.divergenceIds.join(','))})
    `);

    // Atualiza matchStatus nas bank_transactions vinculadas
    const bankTxIds = divs.map(d => d.bankTransactionId).filter((id): id is number => id != null && id > 0);
    if (bankTxIds.length > 0) {
      await dbConn.execute(sql`
        UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
        WHERE id IN (${sql.raw(bankTxIds.join(','))})
      `);
    }
    // Fallback por externalId
    const extIds = divs.map(d => d.externalId).filter((id): id is string => id != null && id.length > 0);
    if (extIds.length > 0 && data.sessionId) {
      await dbConn.execute(sql`
        UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
        WHERE sessionId = ${data.sessionId}
        AND externalId IN (${sql.raw(extIds.map(e => `'${e.replace(/'/g, "''")}'`).join(','))})
      `);
    }

    // Recalcula matchedCount a partir das bank_transactions reais
    if (data.sessionId) {
      const pending = await dbConn.execute(sql`
        SELECT COUNT(*) as cnt FROM divergences
        WHERE sessionId = ${data.sessionId}
        AND status NOT IN ('regularizado','reclassificado','baixado')
      `);
      const pendingCount = (pending as any)[0]?.[0]?.cnt ?? 0;

      const matchedTxs = await dbConn.execute(sql`
        SELECT COUNT(*) as cnt FROM bank_transactions
        WHERE sessionId = ${data.sessionId} AND matchStatus IN ('matched','manual')
      `);
      const newMatchedCount = parseInt(String((matchedTxs as any)[0]?.[0]?.cnt ?? 0));

      await dbConn.update(reconciliationSessions)
        .set({ matchedCount: newMatchedCount, pendingCount })
        .where(eq(reconciliationSessions.id, data.sessionId));
    }
  }

  return (result as any)[0]?.insertId ?? 0;
}

export async function getManualAdjustments(sessionId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (sessionId) {
    return db.execute(sql`SELECT * FROM manual_adjustments WHERE sessionId = ${sessionId} ORDER BY createdAt DESC`).then((r: any) => r[0] ?? []);
  }
  return db.execute(sql`SELECT * FROM manual_adjustments ORDER BY createdAt DESC LIMIT 50`).then((r: any) => r[0] ?? []);
}

// ─── CONCILIAÇÃO MANUAL ────────────────────────────────────────────────────────

export async function manualReconcileDivergences(ids: number[], note: string, createdByName: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Busca divergências selecionadas
  const divs = await db.select().from(divergences).where(inArray(divergences.id, ids));
  if (divs.length === 0) return { success: false, count: 0 };

  const sessionId = divs[0].sessionId;

  // Calcula valor líquido real: créditos somam, débitos subtraem
  // (quando concilia um crédito do banco + falta na API, eles se compensam)
  // Valor líquido: crédito no banco (+) vs débito no banco (-)
  // Dois bank_surplus podem cancelar se um é credit e outro é debit
  const totalCredits = divs
    .filter(d => d.transactionType === "credit")
    .reduce((s, d) => s + parseFloat(String(d.bankAmount ?? d.amount ?? 0)), 0);
  const totalDebits = divs
    .filter(d => d.transactionType === "debit")
    .reduce((s, d) => s + parseFloat(String(d.bankAmount ?? d.amount ?? 0)), 0);
  const totalAmount = divs.reduce((s, d) => s + parseFloat(String(d.bankAmount ?? d.amount ?? 0)), 0);
  const netAmount = totalCredits - totalDebits; // 0 quando crédito e débito se cancelam

  // Marca divergências como regularizado
  await db.update(divergences)
    .set({
      status: "regularizado",
      actionTaken: `Conciliado manualmente por ${createdByName}: ${note}`,
      responsible: createdByName,
    })
    .where(inArray(divergences.id, ids));

  // Atualiza matchStatus nas bank_transactions vinculadas
  // Tenta por bankTransactionId, depois por externalId, depois por date+amount+type
  const bankTxIds = divs.map(d => d.bankTransactionId).filter((id): id is number => id != null && id > 0);
  if (bankTxIds.length > 0) {
    await db.execute(sql`UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual' WHERE id IN (${sql.raw(bankTxIds.join(','))})`);
  }

  const externalIds = divs.map(d => d.externalId).filter((id): id is string => id != null && id.length > 3);
  if (externalIds.length > 0 && sessionId) {
    await db.execute(sql`
      UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
      WHERE sessionId = ${sessionId}
      AND externalId IN (${sql.raw(externalIds.map(e => `'${e.replace(/'/g, "''")}'`).join(','))})
    `);
  }

  // Fallback: match por bankAmount + date + type quando não tem externalId ou bankTransactionId
  const divsWithoutLink = divs.filter(d => !d.bankTransactionId && (!d.externalId || d.externalId.length <= 3));
  for (const div of divsWithoutLink) {
    const amt = parseFloat(String(div.bankAmount ?? div.amount ?? 0));
    if (amt > 0) {
      const dateStr = toISODate(div.divergenceDate as any);
      const txType  = div.transactionType ?? (div.divergenceType === 'bank_surplus' ? 'credit' : 'debit');
      await db.execute(sql`
        UPDATE bank_transactions SET matchStatus = 'manual', matchType = 'manual'
        WHERE sessionId = ${sessionId}
        AND DATE(transactionDate) = ${dateStr}
        AND type = ${txType}
        AND ABS(CAST(amount AS DECIMAL(18,2)) - ${amt}) < 0.02
        AND matchStatus != 'matched'
        LIMIT 1
      `);
    }
  }

  // Recalcula contadores reais da sessão
  const pending = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM divergences
    WHERE sessionId = ${sessionId}
    AND status NOT IN ('regularizado','reclassificado','baixado')
  `);
  const pendingCount = (pending as any)[0]?.[0]?.cnt ?? 0;

  // matchedCount: soma bank_transactions matched/manual + session.matchedCount original
  // (para sessions antigas sem matchStatus nas bank_transactions)
  const matchedBankTxs = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM bank_transactions
    WHERE sessionId = ${sessionId} AND matchStatus IN ('matched','manual')
  `);
  const matchedTxCount = parseInt(String((matchedBankTxs as any)[0]?.[0]?.cnt ?? 0));

  const sessionData = await db.select().from(reconciliationSessions).where(eq(reconciliationSessions.id, sessionId)).limit(1);
  const sessionMatchedBase = sessionData[0]?.matchedCount ?? 0;
  // Se bank_transactions têm matchStatus, usa esse valor; senão usa session + ids.length
  const newMatchedCount = matchedTxCount > sessionMatchedBase ? matchedTxCount : sessionMatchedBase + ids.length;

  await db.update(reconciliationSessions)
    .set({ matchedCount: newMatchedCount, pendingCount })
    .where(eq(reconciliationSessions.id, sessionId));

  return { success: true, count: ids.length, netAmount };
}

// ─── SALDO DIÁRIO POR BANCO (do histórico de sessões) ─────────────────────────

export async function getBankBalancesByBank() {
  const cached = cacheGet<any[]>('bank_balances_by_bank');
  if (cached) return cached;
  const db = await getDb();
  if (!db) return [];
  // Agrega bank_transactions por bankName das últimas sessões completadas
  const result = await db.execute(sql`
    SELECT
      bt.bankName,
      SUM(CASE WHEN bt.type = 'credit' THEN CAST(bt.amount AS DECIMAL(18,2)) ELSE 0 END) as totalCredits,
      SUM(CASE WHEN bt.type = 'debit'  THEN CAST(bt.amount AS DECIMAL(18,2)) ELSE 0 END) as totalDebits,
      COUNT(*)                                                                              as totalTxs,
      SUM(CASE WHEN bt.matchStatus IN ('matched','manual') THEN 1 ELSE 0 END)             as matchedTxs,
      SUM(CASE WHEN bt.matchStatus NOT IN ('matched','manual') THEN 1 ELSE 0 END)         as divergentTxs,
      MAX(rs.referenceDate)                                                                 as lastDate
    FROM bank_transactions bt
    JOIN reconciliation_sessions rs ON rs.id = bt.sessionId
    WHERE bt.bankName IS NOT NULL AND bt.bankName != ''
    GROUP BY bt.bankName
    ORDER BY totalCredits DESC
  `);
  const data = (result as any)[0] ?? [];
  cacheSet('bank_balances_by_bank', data, 10_000); // 10s cache
  return data;
}

export async function getDailyBankBalances() {
  const db = await getDb();
  if (!db) return [];
  // Agrupa por data de referência e banco os totais das sessões conciliadas
  const result = await db.execute(sql`
    SELECT
      rs.referenceDate as date,
      SUM(rs.totalBankCredits) as totalCredits,
      SUM(rs.totalBankDebits)  as totalDebits,
      SUM(rs.totalApiCredits)  as apiCredits,
      SUM(rs.totalApiDebits)   as apiDebits,
      SUM(rs.matchedCount)     as matched,
      SUM(rs.divergentCount)   as divergent
    FROM reconciliation_sessions rs
    WHERE rs.status = 'completed'
    GROUP BY rs.referenceDate
    ORDER BY rs.referenceDate DESC
    LIMIT 30
  `);
  return ((result as any)[0] ?? []).reverse();
}

/** BATCH INSERT para expenses - evita loop individual de tarifas */
export async function insertExpensesBatch(rows: Array<{
  referenceDate: string; category: string; subcategory?: string;
  description?: string; amount: string; supplier?: string;
  sessionId?: number; origin?: string; createdByName?: string;
}>) {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r => {
      const esc = (v?: string | null) => v ? `'${String(v).replace(/'/g,"''").slice(0,500)}'` : 'NULL';
      return `(${esc(r.referenceDate)}, ${esc(r.category)}, ${esc(r.subcategory)},
        ${esc(r.description)}, ${esc(r.amount)}, ${esc(r.supplier)},
        'realizado', NULL, ${esc(r.createdByName)},
        ${r.sessionId ?? 'NULL'}, NULL, ${esc(r.origin ?? 'auto_tariff')})`;
    }).join(',');
    await db.execute(sql.raw(
      `INSERT INTO expenses (referenceDate, category, subcategory, description, amount, supplier, status, costCenterId, createdByName, sessionId, divergenceId, origin) VALUES ${values}`
    ));
  }
}

/** BATCH INSERT para revenues - evita loop individual de tarifas */
export async function insertRevenuesBatch(rows: Array<{
  referenceDate: string; type: string; description?: string;
  amount: string; clientName?: string;
  sessionId?: number; origin?: string; createdByName?: string;
}>) {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(r => {
      const esc = (v?: string | null) => v ? `'${String(v).replace(/'/g,"''").slice(0,500)}'` : 'NULL';
      return `(${esc(r.referenceDate)}, ${esc(r.type)}, ${esc(r.description)},
        ${esc(r.amount)}, NULL, ${esc(r.clientName)},
        'realizado', NULL, ${esc(r.createdByName)},
        ${r.sessionId ?? 'NULL'}, NULL, ${esc(r.origin ?? 'auto_tariff')})`;
    }).join(',');
    await db.execute(sql.raw(
      `INSERT INTO revenues (referenceDate, type, description, amount, clientId, clientName, status, costCenterId, createdByName, sessionId, divergenceId, origin) VALUES ${values}`
    ));
  }
}

export async function getControllershipDashboard(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return null;

  // ── SQL aggregation (muito mais rápido que fetch-all + JS reduce) ──────────
  const [revSummary, expSummary, divSummary, revByType, expByCat, dailyRev, dailyExp] = await Promise.all([
    db.execute(sql`SELECT COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM revenues WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo}`),
    db.execute(sql`SELECT COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM expenses WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo}`),
    db.execute(sql`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM divergences WHERE status NOT IN ('regularizado','reclassificado','baixado')`),
    db.execute(sql`SELECT type, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM revenues WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} GROUP BY type ORDER BY total DESC`),
    db.execute(sql`SELECT category, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM expenses WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} GROUP BY category ORDER BY total DESC`),
    db.execute(sql`SELECT referenceDate as date, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as receitas FROM revenues WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} GROUP BY referenceDate ORDER BY referenceDate`),
    db.execute(sql`SELECT referenceDate as date, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as despesas FROM expenses WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} GROUP BY referenceDate ORDER BY referenceDate`),
  ]);

  const totalRevenue  = parseFloat(String((revSummary as any)[0]?.[0]?.total ?? 0));
  const totalExpenses = parseFloat(String((expSummary as any)[0]?.[0]?.total ?? 0));
  const netResult     = totalRevenue - totalExpenses;
  const margin        = totalRevenue > 0 ? (netResult / totalRevenue) * 100 : 0;
  const divCount      = parseInt(String((divSummary as any)[0]?.[0]?.cnt ?? 0));
  const divValue      = parseFloat(String((divSummary as any)[0]?.[0]?.total ?? 0));

  // Receitas por tipo
  const revenueByType: Record<string, number> = {};
  for (const r of (revByType as any)[0] ?? []) {
    revenueByType[String(r.type ?? 'outros')] = parseFloat(String(r.total ?? 0));
  }

  // Despesas por categoria
  const expenseByCategory: Record<string, number> = {};
  for (const e of (expByCat as any)[0] ?? []) {
    expenseByCategory[String(e.category ?? 'outros')] = parseFloat(String(e.total ?? 0));
  }

  // Evolução diária (merge revenue + expense by date)
  const dailyMap: Record<string, { date: string; receitas: number; despesas: number }> = {};
  for (const r of (dailyRev as any)[0] ?? []) {
    const d = String(r.date).slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { date: d, receitas: 0, despesas: 0 };
    dailyMap[d].receitas += parseFloat(String(r.receitas ?? 0));
  }
  for (const e of (dailyExp as any)[0] ?? []) {
    const d = String(e.date).slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { date: d, receitas: 0, despesas: 0 };
    dailyMap[d].despesas += parseFloat(String(e.despesas ?? 0));
  }
  const dailyEvolution = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Recent entries (lightweight — only last 10)
  const [recentRevs, recentExps, originRevs, originExps] = await Promise.all([
    getRevenues({ dateFrom, dateTo }),
    getExpenses({ dateFrom, dateTo }),
    db.execute(sql`SELECT origin, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM revenues WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} AND origin IS NOT NULL GROUP BY origin`),
    db.execute(sql`SELECT origin, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total FROM expenses WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo} AND origin IS NOT NULL GROUP BY origin`),
  ]);
  const revRows = recentRevs; const expRows = recentExps;

  const revOriginMap: Record<string, number> = {};
  for (const r of (originRevs as any)[0] ?? []) revOriginMap[String(r.origin)] = parseFloat(String(r.total ?? 0));
  const expOriginMap: Record<string, number> = {};
  for (const e of (originExps as any)[0] ?? []) expOriginMap[String(e.origin)] = parseFloat(String(e.total ?? 0));

  const autoRevenue  = revOriginMap['auto_tariff']  ?? 0;
  const autoExpense  = expOriginMap['auto_tariff']  ?? 0;
  const movedRevenue = revOriginMap['manual_move']  ?? 0;
  const movedExpense = expOriginMap['manual_move']  ?? 0;

  return {
    totalRevenue, totalExpenses, netResult, margin,
    divValue, divCount,
    revenueByType, expenseByCategory,
    autoRevenue, autoExpense, movedRevenue, movedExpense,
    dailyEvolution,
    recentRevenues: revRows.slice(0, 10),
    recentExpenses: expRows.slice(0, 10),
  };
}

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

export async function updateUserRole(id: number, role: "admin" | "user") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE users SET role = ${role} WHERE id = ${id}`);
}

export async function updateUserProfile(id: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE users SET name = ${name} WHERE id = ${id}`);
}

export async function countAdmins(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'`);
  return parseInt(String((res as any)[0]?.[0]?.cnt ?? 0));
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


// ═══════════════════════════════════════════════════════════════════════════
// ─── AUDIT LOG ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditEntry {
  userId?: number | null;
  userName?: string | null;
  userEmail?: string | null;
  action: string;
  category: string;
  entityType?: string | null;
  entityId?: string | number | null;
  summary: string;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
}

/**
 * Registra uma ação no log de auditoria. Nunca lança erro — falha silenciosa
 * para não interromper a operação principal do usuário.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values({
      userId:     entry.userId ?? null,
      userName:   entry.userName ?? null,
      userEmail:  entry.userEmail ?? null,
      action:     entry.action,
      category:   entry.category,
      entityType: entry.entityType ?? null,
      entityId:   entry.entityId != null ? String(entry.entityId) : null,
      summary:    entry.summary,
      metadata:   entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress:  entry.ipAddress ?? null,
    });
  } catch (err) {
    console.error("[AUDIT] Falha ao registrar log:", err);
  }
}

export async function getAuditLogs(filters?: {
  category?: string;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.category && filters.category !== "all") {
    conditions.push(eq(auditLogs.category, filters.category));
  }
  if (filters?.userId) {
    conditions.push(eq(auditLogs.userId, filters.userId));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(auditLogs.createdAt, new Date(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    conditions.push(lte(auditLogs.createdAt, new Date(filters.dateTo + "T23:59:59")));
  }
  const limit = Math.min(filters?.limit ?? 500, 2000);
  return db.select().from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function getAuditStats() {
  const db = await getDb();
  if (!db) return { total: 0, today: 0, byCategory: [] };
  const today = new Date().toISOString().slice(0, 10);
  const [totalRes, todayRes, catRes] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as cnt FROM audit_logs`),
    db.execute(sql`SELECT COUNT(*) as cnt FROM audit_logs WHERE DATE(createdAt) = ${today}`),
    db.execute(sql`SELECT category, COUNT(*) as cnt FROM audit_logs GROUP BY category ORDER BY cnt DESC`),
  ]);
  return {
    total: parseInt(String((totalRes as any)[0]?.[0]?.cnt ?? 0)),
    today: parseInt(String((todayRes as any)[0]?.[0]?.cnt ?? 0)),
    byCategory: ((catRes as any)[0] ?? []).map((r: any) => ({
      category: r.category, count: parseInt(String(r.cnt ?? 0)),
    })),
  };
}
