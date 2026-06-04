import { and, desc, eq, gte, lte, sql, between, like, or, isNotNull, inArray, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  reconciliationSessions, bankTransactions, apiTransactions, divergences, managerialBalances,
  revenues, expenses, payables, creditPortfolio, creditInstallments,
  costCenters, dre, cashFlow, alerts, systemConfig,
  manualAdjustments, auditLogs, boletoDailyBalances, internalMovements, manualApuracao,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Converte qualquer valor de data para o formato AAAA-MM-DD aceito pelo MySQL.
 * O driver pode devolver datas como objeto Date — e String(Date) produz
 * "Fri Apr 17 2026..." que NÃO é uma data válida para o banco. Este helper
 * trata objeto Date, string ISO e outros formatos com segurança.
 */
export function toMysqlDate(raw: any): string {
  if (raw instanceof Date) {
    return isNaN(raw.getTime())
      ? new Date().toISOString().slice(0, 10)
      : raw.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}


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

/** Invalida todos os caches que dependem do estado das conciliações.
 *  Chamado após qualquer ação que mude o estado: conciliação manual,
 *  desvinculação, atualização de divergência, contrapartida, etc. */
function invalidateReconciliationCaches() {
  _cache.delete('divergences_all');
  _cache.delete('bank_balances_by_bank');
  _cache.delete('daily_bank_balances');
  _cache.delete('boleto_daily_balances');
  cacheInvalidate('reconciliation_sessions_');
}

/** Converte Date do MySQL (ou string) para ISO YYYY-MM-DD de forma segura */

/**
 * Quando uma divergência é regularizada (movida pra Receita, Despesa, Boleto,
 * resolvida como NID, etc.), a bank_transaction correspondente TAMBÉM precisa
 * ser marcada como resolvida. Sem isso, getSessionStats continua contando ela
 * como 'divergent' e a taxa de matching nunca sobe — impossível chegar em 100%.
 *
 * Esta função lê o bankTransactionId de cada divergência e atualiza o
 * matchStatus para 'manual' (que já é contado em getSessionStats como
 * conciliado). Apenas atualiza transações que ainda estão 'divergent' ou
 * 'pending' — não toca em transações já 'matched' pelo engine.
 */
async function markResolvedBankTransactions(divergenceIds: number[]) {
  if (divergenceIds.length === 0) return;
  const dbConn = await getDb();
  if (!dbConn) return;

  // Busca bankTransactionId e apiTransactionId das divergências
  const rows = await dbConn.execute(sql`
    SELECT bankTransactionId, apiTransactionId
    FROM divergences
    WHERE id IN (${sql.raw(divergenceIds.join(','))})
    AND bankTransactionId IS NOT NULL
  `);

  const bankTxIds = ((rows as any)[0] ?? [])
    .map((r: any) => r.bankTransactionId)
    .filter(Boolean);

  if (bankTxIds.length > 0) {
    await dbConn.execute(sql`
      UPDATE bank_transactions
      SET matchStatus = 'manual'
      WHERE id IN (${sql.raw(bankTxIds.join(','))})
      AND matchStatus NOT IN ('matched')
    `);
  }

  // Para divergências com apiTransactionId (bank_shortage), marca a API tx também
  const apiRows = await dbConn.execute(sql`
    SELECT apiTransactionId
    FROM divergences
    WHERE id IN (${sql.raw(divergenceIds.join(','))})
    AND apiTransactionId IS NOT NULL
  `);

  const apiTxIds = ((apiRows as any)[0] ?? [])
    .map((r: any) => r.apiTransactionId)
    .filter(Boolean);

  if (apiTxIds.length > 0) {
    await dbConn.execute(sql`
      UPDATE api_transactions
      SET matchStatus = 'manual'
      WHERE id IN (${sql.raw(apiTxIds.join(','))})
      AND matchStatus NOT IN ('matched')
    `);
  }
}

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
  const cacheKey = `reconciliation_sessions_${limit}`;
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return cached;
  const db = await getDb();
  if (!db) return [];
  const sessions = await db.select().from(reconciliationSessions)
    .orderBy(desc(reconciliationSessions.createdAt)).limit(limit);

  // Anexa o total real de transações de banco a cada sessão.
  // Isso garante que o cálculo de taxa de conciliação use o MESMO
  // denominador de getSessionStats (total de bank_transactions),
  // mantendo consistência entre Dashboard e página de Conciliação.
  if (sessions.length === 0) return sessions;

  const counts = await db.execute(sql`
    SELECT sessionId, COUNT(*) as cnt
    FROM bank_transactions
    WHERE sessionId IN (${sql.join(sessions.map(s => sql`${s.id}`), sql`, `)})
    GROUP BY sessionId
  `);
  const countMap = new Map<number, number>();
  for (const row of ((counts as any)[0] ?? [])) {
    countMap.set(Number(row.sessionId), parseInt(String(row.cnt ?? 0)));
  }

  const data = sessions.map(s => ({
    ...s,
    totalTransactions: countMap.get(s.id) ?? ((s.matchedCount ?? 0) + (s.divergentCount ?? 0)),
  }));
  cacheSet(cacheKey, data, 8_000); // 8s cache
  return data;
}

export async function getReconciliationSessionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(reconciliationSessions).where(eq(reconciliationSessions.id, id)).limit(1);
  return result[0] ?? null;
}

/**
 * Retorna sessões existentes com a MESMA data de referência.
 * Usado para avisar o usuário antes de criar uma conciliação duplicada
 * (mesma data conciliada mais de uma vez gera divergências repetidas).
 */
export async function getSessionsByReferenceDate(referenceDate: string) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT s.id, s.referenceDate, s.status, s.createdAt,
           COUNT(DISTINCT bt.id) as bankCount,
           COUNT(DISTINCT d.id) as divCount
    FROM reconciliation_sessions s
    LEFT JOIN bank_transactions bt ON bt.sessionId = s.id
    LEFT JOIN divergences d ON d.sessionId = s.id
    WHERE s.referenceDate = ${referenceDate}
    GROUP BY s.id, s.referenceDate, s.status, s.createdAt
    ORDER BY s.createdAt DESC
  `);
  return ((result as any)[0] ?? []).map((r: any) => ({
    id: Number(r.id),
    referenceDate: r.referenceDate,
    status: r.status,
    createdAt: r.createdAt,
    bankCount: parseInt(String(r.bankCount ?? 0)),
    divCount: parseInt(String(r.divCount ?? 0)),
  }));
}

export function invalidateReconciliationCache() {
  // Limpa todo o cache — garante que dados apagados não reapareçam
  _cache.clear();
}

/**
 * Remove divergências DUPLICADAS de uma sessão.
 *
 * Bug histórico: quando o banco tinha transações idênticas (mesmo valor/data/
 * banco, sem externalId — ex: vários PIX MESMA TITULARIDADE de R$ 14.999,96),
 * o "safety net" do processReconciliationJob criava divergências extras
 * (categoria 'outros', sem cliente) porque o link 1:1 falhava.
 *
 * Esta função detecta grupos (data + valor + banco + tipo) onde há MAIS
 * divergências pendentes que bank_transactions divergentes, e remove o
 * excesso — preferindo manter as que têm cliente/categoria informada e
 * apagar as genéricas ('outros' sem cliente).
 *
 * Retorna quantas foram removidas.
 */
export async function dedupSessionDivergences(sessionId: number): Promise<{ removed: number }> {
  const db = await getDb();
  if (!db) return { removed: 0 };

  // Para cada grupo (data+valor+banco), quantas bank_transactions divergentes existem
  // e quantas divergências pendentes existem. Remove o excesso.
  const groupsRes = await db.execute(sql`
    SELECT d.divergenceDate, d.bankAmount, d.bankName, COUNT(*) as divCount,
           (SELECT COUNT(*) FROM bank_transactions bt
            WHERE bt.sessionId = ${sessionId}
              AND bt.transactionDate = d.divergenceDate
              AND CAST(bt.amount AS DECIMAL(18,2)) = CAST(d.bankAmount AS DECIMAL(18,2))
              AND COALESCE(bt.bankName,'') = COALESCE(d.bankName,'')
              AND bt.matchStatus NOT IN ('matched','manual')
           ) as bankCount
    FROM divergences d
    WHERE d.sessionId = ${sessionId}
      AND d.divergenceType = 'bank_surplus'
      AND d.status NOT IN ('regularizado','reclassificado','baixado')
      AND d.bankAmount IS NOT NULL
    GROUP BY d.divergenceDate, d.bankAmount, d.bankName
    HAVING divCount > bankCount
  `);
  const groups = (groupsRes as any)[0] ?? [];

  let removed = 0;
  for (const g of groups) {
    const excess = parseInt(String(g.divCount)) - parseInt(String(g.bankCount));
    if (excess <= 0) continue;
    // Pega as divergências deste grupo, ordenando pra apagar primeiro as
    // genéricas (categoria 'outros' e sem cliente) — mantém as informativas.
    const dupsRes = await db.execute(sql`
      SELECT id, category, clientName FROM divergences
      WHERE sessionId = ${sessionId}
        AND divergenceType = 'bank_surplus'
        AND status NOT IN ('regularizado','reclassificado','baixado')
        AND divergenceDate = ${g.divergenceDate}
        AND CAST(bankAmount AS DECIMAL(18,2)) = CAST(${g.bankAmount} AS DECIMAL(18,2))
        AND COALESCE(bankName,'') = COALESCE(${g.bankName ?? ''}, '')
      ORDER BY
        CASE WHEN category = 'outros' AND (clientName IS NULL OR clientName = '') THEN 0 ELSE 1 END,
        id ASC
    `);
    const dups = (dupsRes as any)[0] ?? [];
    const toRemove = dups.slice(0, excess).map((r: any) => Number(r.id));
    if (toRemove.length > 0) {
      await db.execute(sql`DELETE FROM divergences WHERE id IN (${sql.raw(toRemove.join(','))})`);
      removed += toRemove.length;
    }
  }

  if (removed > 0) invalidateReconciliationCaches();
  return { removed };
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
      observation, bankTransactionId, apiTransactionId
    ) VALUES (
      ${data.sessionId}, ${data.divergenceDate}, ${data.bankName || null}, ${data.clientId || null},
      ${data.clientName || null}, ${data.divergenceType}, ${data.amount}, ${data.origin || null},
      ${data.category}, ${data.priority || 'medium'}, 'pendente',
      ${data.bankDescription || null}, ${data.apiDescription || null},
      ${data.externalId || null}, ${data.bankAmount || null}, ${data.apiAmount || null},
      ${data.transactionType || null}, ${data.observation || null},
      ${data.bankTransactionId ?? null}, ${data.apiTransactionId ?? null}
    )
  `);
  return (result as any)[0]?.insertId ?? 0;
}

export async function getDivergences(filters?: {
  sessionId?: number; status?: string; priority?: string; dateFrom?: string; dateTo?: string;
  includeResolved?: boolean; // true para incluir regularizado/reclassificado/baixado
}) {
  // Caso especial: chamada sem filtros (do Dashboard) é a mais pesada e a mais
  // repetida. Vale a pena cachear por alguns segundos.
  const isUnfiltered = !filters || (
    !filters.sessionId && !filters.status && !filters.priority &&
    !filters.dateFrom && !filters.dateTo && !filters.includeResolved
  );
  if (isUnfiltered) {
    const cached = cacheGet<any[]>('divergences_all');
    if (cached) return cached;
  }
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.sessionId) conditions.push(eq(divergences.sessionId, filters.sessionId));
  if (filters?.status) conditions.push(eq(divergences.status, filters.status as any));
  if (filters?.priority) conditions.push(eq(divergences.priority, filters.priority as any));
  if (filters?.dateFrom) conditions.push(gte(divergences.divergenceDate, filters.dateFrom as unknown as Date));
  if (filters?.dateTo) conditions.push(lte(divergences.divergenceDate, filters.dateTo as unknown as Date));

  // Por padrão, exclui divergências já resolvidas (regularizado/reclassificado/baixado).
  // Sem isso, o Dashboard e a tela de Divergências mostravam itens "fantasma"
  // que já tinham sido tratados mas ainda apareciam nas contagens.
  // Para ver tudo (auditoria), passe includeResolved: true ou um status explícito.
  if (!filters?.status && !filters?.includeResolved) {
    conditions.push(notInArray(divergences.status, ['regularizado', 'reclassificado', 'baixado']));
  }

  const result = await db.select().from(divergences)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(divergences.createdAt))
    .limit(1000);  // never do full table scan
  if (isUnfiltered) {
    cacheSet('divergences_all', result, 10_000); // 10s cache
  }
  return result;
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
  invalidateReconciliationCaches();
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
  // Saldo gerencial alimenta cards no Dashboard — invalida caches relacionados
  invalidateReconciliationCaches();
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
      referenceDate: toMysqlDate(div.divergenceDate),
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

  // Atualiza bank_transactions correspondentes → taxa de matching sobe
  await markResolvedBankTransactions(ids);

  // Invalida cache: divergências mudaram + saldos podem ter sido afetados
  invalidateReconciliationCaches();

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
      referenceDate: toMysqlDate(div.divergenceDate),
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

  // Atualiza bank_transactions correspondentes → taxa de matching sobe
  await markResolvedBankTransactions(ids);

  // Invalida cache: divergências mudaram + saldos podem ter sido afetados
  invalidateReconciliationCaches();

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
//
// O DRE auto agora SEPARA Receita Financeira (juros recebidos de empréstimos,
// investimentos) das Receitas Operacionais. Estrutura contábil correta:
//
//   Receita Bruta Operacional  ── não inclui juros recebidos
//   (−) Custos Operacionais    ── todas as despesas
//   = Resultado Operacional
//
//   Receita Financeira         ── juros recebidos (type='receita_financeira')
//   (−) Despesa Financeira     ── custos financeiros (manual override)
//   = Resultado Financeiro
//
//   = LUCRO LÍQUIDO (Operacional + Financeiro)
//
// Margem é calculada sobre Receita Operacional (não inclui juros) — a margem
// mostra eficiência da operação principal, não do retorno financeiro.
export async function getDRE(months = 12) {
  const db = await getDb();
  if (!db) return [];

  // Agrupa receitas por mês E por tipo (financeira vs outras)
  const revResult = await db.execute(sql`
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      SUM(CASE WHEN type = 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as financialRevenue,
      SUM(CASE WHEN type != 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as operationalRevenue
    FROM revenues
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)
      AND status = 'realizado'
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
  `);

  const expResult = await db.execute(sql`
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      SUM(CAST(amount AS DECIMAL(18,2))) as totalExpense
    FROM expenses
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)
      AND status = 'realizado'
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
  `);

  const revRows = (revResult as any)[0] ?? [];
  const expRows = (expResult as any)[0] ?? [];

  type MonthData = { operationalRevenue: number; financialRevenue: number; expense: number };
  const byMonth: Record<string, MonthData> = {};
  for (const r of revRows) {
    const m = r.month;
    if (!byMonth[m]) byMonth[m] = { operationalRevenue: 0, financialRevenue: 0, expense: 0 };
    byMonth[m].operationalRevenue += parseFloat(String(r.operationalRevenue ?? 0));
    byMonth[m].financialRevenue += parseFloat(String(r.financialRevenue ?? 0));
  }
  for (const r of expRows) {
    const m = r.month;
    if (!byMonth[m]) byMonth[m] = { operationalRevenue: 0, financialRevenue: 0, expense: 0 };
    byMonth[m].expense += parseFloat(String(r.totalExpense ?? 0));
  }

  // Override manual sobrescreve auto
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
    const { operationalRevenue, financialRevenue, expense } = auto;

    const operationalResult = operationalRevenue - expense;
    const financialResult = financialRevenue; // sem despesas financeiras no auto (vem só do override)
    const netProfit = operationalResult + financialResult;
    // Margem operacional: lucro op / receita op (não inclui juros)
    const margin = operationalRevenue > 0 ? operationalResult / operationalRevenue : 0;

    return {
      id: 0, referenceMonth: m, source: 'auto',
      grossRevenue: operationalRevenue.toFixed(2),
      netRevenue: operationalRevenue.toFixed(2),
      financialRevenue: financialRevenue.toFixed(2),
      financialCosts: '0',
      operationalCosts: expense.toFixed(2),
      adminExpenses: '0', commercialExpenses: '0', taxes: '0',
      operationalResult: operationalResult.toFixed(2),
      financialResult: financialResult.toFixed(2),
      netProfit: netProfit.toFixed(2),
      margin: margin.toFixed(4),
    };
  }).filter(Boolean);
}

export async function upsertDRE(data: {
  referenceMonth: string; grossRevenue?: string; netRevenue?: string;
  financialRevenue?: string;
  financialCosts?: string; operationalCosts?: string; adminExpenses?: string;
  commercialExpenses?: string; taxes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const gross = parseFloat(data.grossRevenue ?? '0');         // receita operacional bruta
  const finRevenue = parseFloat(data.financialRevenue ?? '0');// juros recebidos
  const finCosts = parseFloat(data.financialCosts ?? '0');    // juros pagos
  const opCosts = parseFloat(data.operationalCosts ?? '0');
  const adminExp = parseFloat(data.adminExpenses ?? '0');
  const commExp = parseFloat(data.commercialExpenses ?? '0');
  const taxesVal = parseFloat(data.taxes ?? '0');

  // Resultado Operacional: receita op - todas as despesas operacionais e admin/comerciais/impostos
  const opResult = gross - opCosts - adminExp - commExp - taxesVal;
  // Resultado Financeiro: juros recebidos - juros pagos
  const finResult = finRevenue - finCosts;
  // Lucro Líquido: operacional + financeiro
  const netProfit = opResult + finResult;
  // Margem operacional (sobre receita operacional, não inclui juros)
  const margin = gross > 0 ? (opResult / gross) : 0;

  await db.execute(sql`
    INSERT INTO dre (referenceMonth, grossRevenue, netRevenue, financialRevenue, financialCosts, operationalCosts, adminExpenses, commercialExpenses, taxes, operationalResult, financialResult, netProfit, margin)
    VALUES (${data.referenceMonth}, ${gross.toFixed(2)}, ${gross.toFixed(2)}, ${finRevenue.toFixed(2)}, ${finCosts.toFixed(2)}, ${opCosts.toFixed(2)}, ${adminExp.toFixed(2)}, ${commExp.toFixed(2)}, ${taxesVal.toFixed(2)}, ${opResult.toFixed(2)}, ${finResult.toFixed(2)}, ${netProfit.toFixed(2)}, ${margin.toFixed(4)})
    ON DUPLICATE KEY UPDATE
      grossRevenue = VALUES(grossRevenue), netRevenue = VALUES(netRevenue),
      financialRevenue = VALUES(financialRevenue), financialCosts = VALUES(financialCosts),
      operationalCosts = VALUES(operationalCosts),
      adminExpenses = VALUES(adminExpenses), commercialExpenses = VALUES(commercialExpenses),
      taxes = VALUES(taxes), operationalResult = VALUES(operationalResult),
      financialResult = VALUES(financialResult),
      netProfit = VALUES(netProfit), margin = VALUES(margin)
  `);
  // Override de DRE afeta cálculos do Dashboard de Controladoria
  invalidateReconciliationCaches();
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
  // Override de fluxo de caixa afeta saldos e indicadores no Dashboard
  invalidateReconciliationCaches();
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

  // 3. NID acima de 30 dias sem identificação
  const oldNid = await db.execute(sql`
    SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as total
    FROM divergences
    WHERE isNdi = 1
    AND status NOT IN ('regularizado','reclassificado','baixado')
    AND divergenceDate < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  `);
  const nidData = (oldNid as any)[0]?.[0];
  if (parseInt(String(nidData?.cnt ?? 0)) > 0) {
    await upsertAlert('nid_aging', 'NID com mais de 30 dias sem identificação',
      `${nidData.cnt} entrada(s) não identificada(s) com mais de 30 dias — R$ ${parseFloat(String(nidData.total)).toFixed(2)}`,
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
// ─── NID — NÃO IDENTIFICADOS ──────────────────────────────────────────────────

/**
 * Identifica uma NID — registra de quem é o dinheiro, MAS não fecha ainda.
 *
 * Mudança em relação à versão anterior: antes, identificar uma NID criava
 * automaticamente uma transação fake na API para conciliar o par. Isso era
 * incorreto — o dinheiro entrou no banco mas a API só recebe a confirmação
 * em dias seguintes. Criar uma transação fake na hora distorcia os totais.
 *
 * Agora: identificar só preenche nidClientName + nidFoundDate. A NID continua
 * pendente (status='em_analise', isNid=true), visível na aba NID. Quando o
 * pagamento real chegar pela API (em outra conciliação, gerando uma divergência
 * bank_shortage), o usuário usa `reconcileNidWithDivergence` para casar os dois
 * lados manualmente.
 */
export async function resolveNid(id: number, data: {
  clientName: string;
  description: string;
  createdByName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const divs = await db.select().from(divergences).where(eq(divergences.id, id)).limit(1);
  if (!divs[0]) throw new Error("Divergência não encontrada");

  const today = new Date().toISOString().slice(0, 10);
  await db.update(divergences)
    .set({
      // Mantém isNid=true e status='em_analise' — NID continua visível
      // na aba NID até o pagamento real ser conciliado.
      nidClientName: data.clientName,
      nidFoundDate: today as any,
      clientName: data.clientName,  // também na coluna principal
      nidNote: data.description || null,
      responsible: data.createdByName,
      actionTaken: `NID identificado: ${data.clientName} (por ${data.createdByName}) — aguardando entrada do pagamento na API`,
    })
    .where(eq(divergences.id, id));

  invalidateReconciliationCaches();
  return { success: true };
}

/**
 * Concilia uma NID identificada com uma divergência existente.
 *
 * Aceita DOIS tipos de divergência alvo:
 *
 * 1. bank_shortage (API sem par no banco) — cenário "pagamento pela API":
 *    Dia 1: PIX entra no banco sem identificação → NID
 *    Dia X: pagamento real chega pela API → divergência bank_shortage
 *    Concilia: bank_tx (NID) ↔ api_tx (pagamento). Ambas viram 'manual'.
 *
 * 2. bank_surplus (banco sem par na API) — cenário "devolução pelo banco":
 *    Dia 1: PIX entra no banco sem identificação → NID (crédito)
 *    Dia X: empresa devolve pelo banco → débito aparece como bank_surplus
 *    Concilia: as duas divergências se regularizam (crédito + débito se anulam).
 *    Neste caso NÃO existe transação na API — só dois lados do banco.
 *
 * Em ambos os casos:
 * - Ambas as divergências ficam status='regularizado' (saem da aba Divergências)
 * - Campos de rastreio preenchidos (nidReconciledAt, nidReconciledWithId, etc.)
 * - Contadores das sessões afetadas recalculados
 */
export async function reconcileNidWithDivergence(params: {
  nidId: number;
  targetDivergenceId: number;
  createdByName: string;
}): Promise<{ success: true; nidSessionId?: number; targetSessionId?: number; reconcileType: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [nidRow] = await db.select().from(divergences).where(eq(divergences.id, params.nidId)).limit(1);
  const [tgtRow] = await db.select().from(divergences).where(eq(divergences.id, params.targetDivergenceId)).limit(1);

  if (!nidRow) throw new Error("NID não encontrada");
  if (!tgtRow) throw new Error("Divergência alvo não encontrada");

  // Validações
  if (!nidRow.isNid) throw new Error("Divergência de origem não é uma NID");
  if (!['bank_shortage', 'bank_surplus'].includes(String(tgtRow.divergenceType))) {
    throw new Error("Divergência alvo precisa ser do tipo 'falta no banco' (API) ou 'sobra no banco' (devolução)");
  }
  if (['regularizado', 'reclassificado', 'baixado'].includes(String(nidRow.status))) {
    throw new Error("NID já está regularizada");
  }
  if (['regularizado', 'reclassificado', 'baixado'].includes(String(tgtRow.status))) {
    throw new Error("Divergência alvo já está regularizada");
  }

  // Valores devem ser iguais (tolerância R$ 0,01)
  const nidAmount = parseFloat(String(nidRow.amount));
  const tgtAmount = parseFloat(String(tgtRow.amount));
  if (Math.abs(nidAmount - tgtAmount) > 0.01) {
    throw new Error(
      `Valores não batem: NID R$ ${nidAmount.toFixed(2)} vs Divergência R$ ${tgtAmount.toFixed(2)}`
    );
  }

  // Determinar tipo de conciliação
  const reconcileType = tgtRow.divergenceType === 'bank_shortage' ? 'api_payment' : 'bank_return';
  const actionLabel = reconcileType === 'api_payment'
    ? `NID conciliada com pagamento da API (divergência #${params.targetDivergenceId})`
    : `NID conciliada com devolução bancária (divergência #${params.targetDivergenceId})`;

  // 1) Marcar transações como 'manual' conforme o cenário
  if (reconcileType === 'api_payment') {
    // Cenário API: ligar bank_tx (NID) ↔ api_tx (pagamento)
    if (nidRow.bankTransactionId && tgtRow.apiTransactionId) {
      await db.execute(sql`
        UPDATE bank_transactions SET matchStatus='manual', matchType='manual',
          matchedApiTransactionId = ${tgtRow.apiTransactionId}
        WHERE id = ${nidRow.bankTransactionId}
      `);
      await db.execute(sql`
        UPDATE api_transactions SET matchStatus='manual', matchType='manual',
          matchedBankTransactionId = ${nidRow.bankTransactionId}
        WHERE id = ${tgtRow.apiTransactionId}
      `);
    } else {
      if (nidRow.bankTransactionId) {
        await db.execute(sql`UPDATE bank_transactions SET matchStatus='manual', matchType='manual' WHERE id = ${nidRow.bankTransactionId}`);
      }
      if (tgtRow.apiTransactionId) {
        await db.execute(sql`UPDATE api_transactions SET matchStatus='manual', matchType='manual' WHERE id = ${tgtRow.apiTransactionId}`);
      }
    }
  } else {
    // Cenário devolução: dois lados do banco (crédito NID + débito devolução)
    // Marca ambas bank_transactions como 'manual' (se existirem)
    if (nidRow.bankTransactionId) {
      await db.execute(sql`UPDATE bank_transactions SET matchStatus='manual', matchType='manual' WHERE id = ${nidRow.bankTransactionId}`);
    }
    if (tgtRow.bankTransactionId) {
      await db.execute(sql`UPDATE bank_transactions SET matchStatus='manual', matchType='manual' WHERE id = ${tgtRow.bankTransactionId}`);
    }
  }

  // 2) Marca ambas divergências como regularizadas + rastreio completo
  await db.execute(sql`
    UPDATE divergences
    SET status = 'regularizado',
        actionTaken = ${`${actionLabel} por ${params.createdByName}`},
        nidReconciledAt = NOW(),
        nidReconciledWithId = CASE
          WHEN id = ${params.nidId} THEN ${params.targetDivergenceId}
          ELSE ${params.nidId}
        END,
        nidReconciledBy = ${params.createdByName},
        nidReconcileType = ${reconcileType}
    WHERE id IN (${params.nidId}, ${params.targetDivergenceId})
  `);

  // 3) Recalcula contadores das sessões afetadas
  const sessionsToUpdate = new Set<number>();
  if (nidRow.sessionId) sessionsToUpdate.add(nidRow.sessionId);
  if (tgtRow.sessionId) sessionsToUpdate.add(tgtRow.sessionId);

  for (const sid of Array.from(sessionsToUpdate)) {
    const pending = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM divergences
      WHERE sessionId = ${sid} AND status NOT IN ('regularizado','reclassificado','baixado')
    `);
    const matched = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM bank_transactions
      WHERE sessionId = ${sid} AND matchStatus IN ('matched','manual')
    `);
    const pendingCount = parseInt(String((pending as any)[0]?.[0]?.cnt ?? 0));
    const matchedCount = parseInt(String((matched as any)[0]?.[0]?.cnt ?? 0));
    await db.update(reconciliationSessions)
      .set({ matchedCount, pendingCount })
      .where(eq(reconciliationSessions.id, sid));
  }

  invalidateReconciliationCaches();
  return {
    success: true,
    nidSessionId: nidRow.sessionId ?? undefined,
    targetSessionId: tgtRow.sessionId ?? undefined,
    reconcileType,
  };
}

/**
 * Busca candidatos para conciliar com uma NID identificada.
 *
 * Retorna divergências pendentes em qualquer sessão, com valor próximo
 * (tolerância R$ 0,01), de DOIS tipos:
 *
 * 1. bank_shortage (API sem par no banco): cenário clássico — o pagamento
 *    real chegou pela API dias depois.
 *
 * 2. bank_surplus (banco sem par na API): cenário de DEVOLUÇÃO — a empresa
 *    devolveu o PIX pelo banco dias depois. Aparece como débito no banco
 *    sem correspondência na API.
 *
 * Cada candidato inclui um campo `reconcileType` indicando o tipo:
 * - 'api_payment'  → pagamento que entrou pela API
 * - 'bank_return'  → devolução feita pelo banco
 *
 * Ordenadas por proximidade de data (mais recentes primeiro).
 */
export async function getNidReconcileCandidates(nidId: number) {
  const db = await getDb();
  if (!db) return [];

  const [nid] = await db.select().from(divergences).where(eq(divergences.id, nidId)).limit(1);
  if (!nid) return [];

  const amount = parseFloat(String(nid.amount));
  const min = (amount - 0.01).toFixed(2);
  const max = (amount + 0.01).toFixed(2);

  // Busca bank_shortage (pagamento API) + bank_surplus (devolução banco)
  // Exclui a própria NID e divergências já resolvidas.
  // Para bank_surplus, exclui outras NIDs (não faz sentido conciliar NID com NID).
  const result = await db.execute(sql`
    SELECT d.id, d.sessionId, d.divergenceDate, d.amount, d.bankName, d.clientName,
           d.apiDescription, d.bankDescription, d.priority, d.status, d.divergenceType,
           d.transactionType,
           rs.referenceDate as sessionDate,
           CASE
             WHEN d.divergenceType = 'bank_shortage' THEN 'api_payment'
             WHEN d.divergenceType = 'bank_surplus' THEN 'bank_return'
             ELSE 'other'
           END as reconcileType
    FROM divergences d
    LEFT JOIN reconciliation_sessions rs ON rs.id = d.sessionId
    WHERE d.divergenceType IN ('bank_shortage', 'bank_surplus')
      AND d.status NOT IN ('regularizado','reclassificado','baixado')
      AND CAST(d.amount AS DECIMAL(18,2)) BETWEEN ${min} AND ${max}
      AND d.id != ${nidId}
      AND (d.isNdi = 0 OR d.isNdi IS NULL)
    ORDER BY ABS(DATEDIFF(d.divergenceDate, ${nid.divergenceDate})) ASC, d.divergenceDate DESC
    LIMIT 50
  `);

  return ((result as any)[0] ?? []) as any[];
}

export async function markDivergencesAsNid(ids: number[], nidNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    UPDATE divergences SET isNdi = 1, ndiNote = ${nidNote || null},
    nidMarkedAt = NOW(),
    status = 'em_analise', observation = CONCAT(COALESCE(observation,''), ' | NID: aguardando identificação')
    WHERE id IN (${sql.raw(ids.join(','))})
  `);
  invalidateReconciliationCaches();
}

export async function unmarkNid(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE divergences SET isNdi = 0, ndiNote = NULL WHERE id = ${id}`);
  invalidateReconciliationCaches();
}

export async function getNidDivergences() {
  const db = await getDb();
  if (!db) return [];
  // Usa o ORM (não SQL raw) para que o drizzle traduza nomes SQL → TS
  // automaticamente (isNdi → isNid, ndiNote → nidNote, etc).
  return db.select().from(divergences)
    .where(eq(divergences.isNid, true))
    .orderBy(desc(divergences.divergenceDate), desc(divergences.amount));
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

  // Ajuste manual mudou divergências e contadores de sessão
  invalidateReconciliationCaches();
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

  invalidateReconciliationCaches();

  return { success: true, count: ids.length, netAmount };
}

// ─── SALDO DIÁRIO POR BANCO (do histórico de sessões) ─────────────────────────

export async function getBankBalancesByBank() {
  const cached = cacheGet<any[]>('bank_balances_by_bank');
  if (cached) return cached;
  const db = await getDb();
  if (!db) return [];

  // 1) Saldos e matching por banco — vem de bank_transactions
  const balRes = await db.execute(sql`
    SELECT
      bt.bankName,
      SUM(CASE WHEN bt.type = 'credit' THEN CAST(bt.amount AS DECIMAL(18,2)) ELSE 0 END) as totalCredits,
      SUM(CASE WHEN bt.type = 'debit'  THEN CAST(bt.amount AS DECIMAL(18,2)) ELSE 0 END) as totalDebits,
      COUNT(*)                                                                          as totalTxs,
      SUM(CASE WHEN bt.matchStatus IN ('matched','manual') THEN 1 ELSE 0 END)           as matchedTxs,
      MAX(rs.referenceDate)                                                             as lastDate
    FROM bank_transactions bt
    JOIN reconciliation_sessions rs ON rs.id = bt.sessionId
    WHERE bt.bankName IS NOT NULL AND bt.bankName != ''
    GROUP BY bt.bankName
    ORDER BY totalCredits DESC
  `);
  const balRows: any[] = (balRes as any)[0] ?? [];

  // 2) Contagem de divergências pendentes por banco — vem da tabela divergences.
  //    bank_surplus tem bankName do banco. bank_shortage (falta no banco / sobra
  //    na API) é gravado com bankName='API' como texto literal — agrupado como
  //    'API / Sem banco' junto com casos onde bankName veio null/vazio.
  const divRes = await db.execute(sql`
    SELECT
      CASE
        WHEN bankName IS NULL OR bankName = '' OR bankName = 'API' THEN 'API / Sem banco'
        ELSE bankName
      END as grp,
      COUNT(*) as cnt
    FROM divergences
    WHERE status NOT IN ('regularizado','reclassificado','baixado')
    GROUP BY grp
  `);
  const divMap = new Map<string, number>();
  for (const row of ((divRes as any)[0] ?? [])) {
    divMap.set(String(row.grp), parseInt(String(row.cnt ?? 0)));
  }

  // 3) Junta: cada banco recebe sua contagem real de divergências
  const data = balRows.map(b => ({
    ...b,
    divergentTxs: divMap.get(String(b.bankName)) ?? 0,
  }));

  // 4) Se houver divergências sem banco (lado API), adiciona uma linha própria
  //    para que a soma do card bata com o total da aba Divergências.
  const apiSideDivs = divMap.get('API / Sem banco') ?? 0;
  if (apiSideDivs > 0) {
    data.push({
      bankName: 'API / Sem banco',
      totalCredits: 0, totalDebits: 0,
      totalTxs: 0, matchedTxs: 0,
      divergentTxs: apiSideDivs,
      lastDate: null,
      apiSideOnly: true,
    });
  }

  cacheSet('bank_balances_by_bank', data, 5_000); // 5s cache — sincronia rápida com ações
  return data;
}

export async function getDailyBankBalances() {
  const cached = cacheGet<any[]>('daily_bank_balances');
  if (cached) return cached;
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
  const data = ((result as any)[0] ?? []).reverse();
  cacheSet('daily_bank_balances', data, 10_000); // 10s cache
  return data;
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
  // credit_installments.creditId não tem FK com ON DELETE CASCADE no schema atual,
  // então apagamos as parcelas manualmente antes do empréstimo para evitar
  // órfãs. Bug anterior: deletar via API REST direta deixava installments
  // pendurados sem dono, que continuavam aparecendo em getCreditInstallments
  // se alguém consultasse pelo creditId antigo.
  await db.execute(sql`DELETE FROM credit_installments WHERE creditId = ${id}`);
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

// ═══════════════════════════════════════════════════════════════════════════
// ─── BACKUP COMPLETO DE DADOS ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exporta TODOS os dados do sistema como um objeto JSON estruturado.
 * Cada tabela vira uma chave. Usado para backup externo — protege contra
 * perda de dados caso o banco fique indisponível.
 *
 * Senhas (passwordHash) são EXCLUÍDAS do backup por segurança.
 */
export async function exportFullBackup(): Promise<{
  meta: { generatedAt: string; version: string; tableCount: number; totalRecords: number };
  tables: Record<string, any[]>;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Lista de tabelas a exportar (nome lógico → tabela Drizzle)
  const tableMap: Array<[string, any]> = [
    ["users", users],
    ["reconciliation_sessions", reconciliationSessions],
    ["bank_transactions", bankTransactions],
    ["api_transactions", apiTransactions],
    ["divergences", divergences],
    ["managerial_balances", managerialBalances],
    ["revenues", revenues],
    ["expenses", expenses],
    ["manual_adjustments", manualAdjustments],
    ["payables", payables],
    ["credit_portfolio", creditPortfolio],
    ["credit_installments", creditInstallments],
    ["cost_centers", costCenters],
    ["dre", dre],
    ["cash_flow", cashFlow],
    ["alerts", alerts],
    ["system_config", systemConfig],
    ["audit_logs", auditLogs],
  ];

  const tables: Record<string, any[]> = {};
  let totalRecords = 0;

  for (const [name, table] of tableMap) {
    try {
      const rows = await db.select().from(table);
      // Remove passwordHash da tabela users — nunca exportar credenciais
      const sanitized = name === "users"
        ? rows.map((r: any) => {
            const { passwordHash, ...rest } = r;
            return rest;
          })
        : rows;
      tables[name] = sanitized;
      totalRecords += sanitized.length;
    } catch (err) {
      // Se uma tabela falhar (ex: ainda não existe), registra vazia e continua
      console.error(`[BACKUP] Falha ao exportar tabela ${name}:`, err);
      tables[name] = [];
    }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: "1.0",
      tableCount: tableMap.length,
      totalRecords,
    },
    tables,
  };
}


/**
 * Limpa TODOS os dados operacionais do sistema — usado para zerar o banco
 * antes de entrar com dados reais de produção (remove dados de demonstração).
 *
 * PRESERVA: usuários, configurações do sistema, log de auditoria.
 * APAGA: conciliações, transações, divergências, receitas, despesas,
 *        contas a pagar, carteira de crédito, DRE, fluxo de caixa,
 *        saldo gerencial, centros de custo, alertas, ajustes manuais.
 *
 * É uma operação destrutiva e irreversível — exige confirmação explícita.
 */
export async function clearOperationalData(): Promise<{ clearedTables: string[]; totalRows: number }> {
  return _clearTables(false);
}

/** Reset completo de fábrica — limpa TUDO incluindo usuários, audit, config.
 *  O admin padrão é recriado automaticamente no próximo login. */
export async function factoryReset(): Promise<{ clearedTables: string[]; totalRows: number }> {
  return _clearTables(true);
}

async function _clearTables(includeSystemTables: boolean): Promise<{ clearedTables: string[]; totalRows: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Ordem importa: tabelas-filhas antes das tabelas-pai (respeita dependências)
  const tablesToClear = [
    "credit_installments",
    "credit_portfolio",
    "divergences",
    "bank_transactions",
    "api_transactions",
    "manual_adjustments",
    "reconciliation_sessions",
    "revenues",
    "expenses",
    "payables",
    "managerial_balances",
    "dre",
    "cash_flow",
    "cost_centers",
    "alerts",
    "boleto_daily_balances",
  ];

  if (includeSystemTables) {
    tablesToClear.push("audit_logs", "system_config", "users");
  }

  const clearedTables: string[] = [];
  let totalRows = 0;

  // Desativa FK checks temporariamente para poder truncar em qualquer ordem
  await db.execute(sql.raw("SET FOREIGN_KEY_CHECKS = 0"));

  for (const tableName of tablesToClear) {
    try {
      const countRes = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ${tableName}`));
      const rowCount = parseInt(String((countRes as any)[0]?.[0]?.cnt ?? 0));
      // TRUNCATE é mais rápido que DELETE e reseta auto-increment
      await db.execute(sql.raw(`TRUNCATE TABLE ${tableName}`));
      clearedTables.push(tableName);
      totalRows += rowCount;
    } catch (err) {
      console.error(`[CLEANUP] Falha ao limpar tabela ${tableName}:`, err);
    }
  }

  await db.execute(sql.raw("SET FOREIGN_KEY_CHECKS = 1"));

  _cache.clear();
  console.log(`[FACTORY RESET] ${includeSystemTables ? 'COMPLETO' : 'OPERACIONAL'}: ${clearedTables.length} tabelas, ${totalRows} registros removidos`);
  return { clearedTables, totalRows };
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── LANÇAMENTO MANUAL DE CONTRAPARTIDA ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Lança manualmente a transação que faltava (a "contrapartida") de uma
 * divergência, e concilia os dois lados.
 *
 * Cenário: existe uma transação no banco SEM par na API (ou vice-versa),
 * porque o dado não foi importado ou foi lançado depois. O usuário informa
 * os dados da transação que falta — o sistema cria ela do lado correto e
 * casa as duas, regularizando a divergência.
 *
 * IMPORTANTE: deve ser usado apenas para dados REAIS (a transação realmente
 * existiu). Toda a ação fica registrada para auditoria.
 */
export async function postCounterpartEntry(params: {
  divergenceId: number;
  side: "bank" | "api";          // onde lançar a transação que falta
  amount: number;
  transactionDate: string;
  description: string;
  channel?: string;
  bankName?: string;             // usado quando side = 'bank'
  clientName?: string;           // usado quando side = 'api'
  createdByName: string;
}): Promise<{ success: boolean; newTransactionId?: number; sessionId?: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Busca a divergência
  const divRows = await db.select().from(divergences).where(eq(divergences.id, params.divergenceId)).limit(1);
  const div = divRows[0];
  if (!div) throw new Error("Divergência não encontrada.");

  const sessionId = div.sessionId;
  const txType: "credit" | "debit" =
    (div as any).transactionType === "debit" ? "debit" : "credit";

  let newTransactionId: number | undefined;

  // Valor da divergência — usado no fallback de busca da transação original
  const divAmount = parseFloat(String((div as any).bankAmount ?? (div as any).apiAmount ?? div.amount ?? 0));

  if (params.side === "api") {
    // Falta a transação na API → cria do lado da API e casa com a do banco.
    // 1ª opção: ID vinculado na divergência. Fallback: busca por valor+tipo na sessão.
    let bankTxId = div.bankTransactionId;
    if (!bankTxId) {
      const found = await db.execute(sql`
        SELECT id FROM bank_transactions
        WHERE sessionId = ${sessionId}
          AND type = ${txType}
          AND ABS(amount - ${divAmount}) < 0.01
          AND matchStatus IN ('pending','divergent')
        ORDER BY id LIMIT 1
      `);
      bankTxId = Number((found as any)[0]?.[0]?.id ?? 0) || null;
    }
    if (!bankTxId) {
      throw new Error("Não foi possível localizar a transação bancária correspondente a esta divergência.");
    }
    const res = await db.insert(apiTransactions).values({
      sessionId,
      type: txType,
      transactionDate: params.transactionDate,
      description: params.description,
      amount: params.amount.toFixed(2),
      channel: params.channel ?? "MANUAL",
      clientName: params.clientName ?? null,
      matchStatus: "manual",
      matchType: "manual",
      matchedBankTransactionId: bankTxId,
    } as any);
    newTransactionId = Number((res as any).insertId ?? (res as any)[0]?.insertId);

    // Casa a transação do banco com a nova transação da API
    await db.execute(sql`
      UPDATE bank_transactions
      SET matchStatus = 'manual', matchType = 'manual', matchedApiTransactionId = ${newTransactionId}
      WHERE id = ${bankTxId}
    `);
  } else {
    // Falta a transação no banco → cria do lado do banco e casa com a da API
    let apiTxId = div.apiTransactionId;
    if (!apiTxId) {
      const found = await db.execute(sql`
        SELECT id FROM api_transactions
        WHERE sessionId = ${sessionId}
          AND type = ${txType}
          AND ABS(amount - ${divAmount}) < 0.01
          AND matchStatus IN ('pending','divergent')
        ORDER BY id LIMIT 1
      `);
      apiTxId = Number((found as any)[0]?.[0]?.id ?? 0) || null;
    }
    if (!apiTxId) {
      throw new Error("Não foi possível localizar a transação de API correspondente a esta divergência.");
    }
    const res = await db.insert(bankTransactions).values({
      sessionId,
      type: txType,
      transactionDate: params.transactionDate,
      description: params.description,
      amount: params.amount.toFixed(2),
      channel: params.channel ?? "MANUAL",
      bankName: params.bankName ?? div.bankName ?? null,
      matchStatus: "manual",
      matchType: "manual",
      matchedApiTransactionId: apiTxId,
    } as any);
    newTransactionId = Number((res as any).insertId ?? (res as any)[0]?.insertId);

    // Casa a transação da API com a nova transação do banco
    await db.execute(sql`
      UPDATE api_transactions
      SET matchStatus = 'manual', matchType = 'manual', matchedBankTransactionId = ${newTransactionId}
      WHERE id = ${apiTxId}
    `);
  }

  // Regulariza a divergência
  await db.update(divergences)
    .set({
      status: "regularizado",
      actionTaken: `Contrapartida lançada manualmente por ${params.createdByName} no lado ${params.side === "api" ? "API" : "Banco"}: ${params.description}`,
      responsible: params.createdByName,
    })
    .where(eq(divergences.id, params.divergenceId));

  // Limpa o cache para os totais refletirem na hora
  _cache.clear();

  return { success: true, newTransactionId, sessionId };
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── PARES CONCILIADOS — VISÃO DEDICADA ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Retorna a lista de bancos distintos (não nulos) presentes nas transações
 * de uma sessão — usado para popular o dropdown de filtro na aba auditoria.
 */
export async function getSessionBanks(sessionId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT DISTINCT bankName
    FROM bank_transactions
    WHERE sessionId = ${sessionId}
      AND bankName IS NOT NULL
      AND bankName != ''
    ORDER BY bankName ASC
  `);
  return ((result as any)[0] ?? []).map((r: any) => String(r.bankName));
}

/**
 * Lista todos os pares conciliados de uma sessão. Retorna os dois lados
 * (banco + API) lado a lado, com paginação e filtros.
 *
 * Suporta busca por descrição, cliente, valor (exato ou faixa), data e tipo.
 * É a base da aba "Pares Conciliados" — onde o usuário audita as conciliações
 * e pode desvincular um par errado.
 */
export async function getMatchedPairs(params: {
  sessionId: number;
  search?: string;       // busca em descrição/cliente
  amount?: number;       // valor exato (ou faixa com tolerance)
  amountTolerance?: number;  // ± centavos/reais
  dateFrom?: string;
  dateTo?: string;
  type?: 'credit' | 'debit';
  bankName?: string;
  matchType?: string;    // exact, approximate, manual, etc
  exactOnly?: boolean;   // se true, retorna SÓ pares com bank.amount == api.amount
  sortBy?: 'amount_desc' | 'amount_asc' | 'date_desc' | 'date_asc';
  page?: number;
  pageSize?: number;
}): Promise<{
  rows: any[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const db = await getDb();
  if (!db) {
    return { rows: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0 };
  }

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(500, Math.max(10, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  // Constrói as condições WHERE dinamicamente
  // JOIN primário: matchedApiTransactionId (link direto criado na conciliação).
  // Fallback: se matchedApiTransactionId for NULL (sessões antigas criadas antes
  // do link automático), faz JOIN por externalId no mesmo sessionId.
  // Este fallback permite que sessões existentes mostrem pares sem migração.
  const conditions: any[] = [
    sql`bt.sessionId = ${params.sessionId}`,
    sql`bt.matchStatus IN ('matched','manual')`,
  ];

  // JOIN flexível: prefere matchedApiTransactionId, fallback por externalId
  const joinClause = sql`
    LEFT JOIN api_transactions at ON (
      (bt.matchedApiTransactionId IS NOT NULL AND at.id = bt.matchedApiTransactionId)
      OR
      (bt.matchedApiTransactionId IS NULL AND at.sessionId = bt.sessionId
       AND at.externalId = bt.externalId AND bt.externalId IS NOT NULL AND at.externalId IS NOT NULL
       AND at.matchStatus IN ('matched','manual'))
    )
  `;
  // Garante que encontrou um par (exclui bank_txs sem nenhum API match)
  conditions.push(sql`at.id IS NOT NULL`);

  if (params.search && params.search.trim().length > 0) {
    const pattern = `%${params.search.trim()}%`;
    conditions.push(sql`(
      bt.description LIKE ${pattern}
      OR at.clientName LIKE ${pattern}
      OR at.description LIKE ${pattern}
    )`);
  }

  if (params.amount !== undefined) {
    const tol = params.amountTolerance ?? 0;
    if (tol > 0) {
      conditions.push(sql`ABS(bt.amount - ${params.amount}) <= ${tol}`);
    } else {
      conditions.push(sql`bt.amount = ${params.amount}`);
    }
  }

  if (params.dateFrom) conditions.push(sql`bt.transactionDate >= ${params.dateFrom}`);
  if (params.dateTo)   conditions.push(sql`bt.transactionDate <= ${params.dateTo}`);
  if (params.type)     conditions.push(sql`bt.type = ${params.type}`);
  if (params.bankName) conditions.push(sql`bt.bankName = ${params.bankName}`);
  if (params.matchType) conditions.push(sql`bt.matchType = ${params.matchType}`);
  if (params.exactOnly) conditions.push(sql`bt.amount = at.amount`);

  // Une as condições com AND
  const whereClause = sql.join(conditions, sql` AND `);

  // Count total para paginação
  const countRes = await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM bank_transactions bt
    ${joinClause}
    WHERE ${whereClause}
  `);
  const totalCount = parseInt(String(((countRes as any)[0] ?? [])[0]?.total ?? 0));

  // Determina a ordenação dinâmica
  let orderClause = sql`bt.transactionDate DESC, bt.id DESC`; // default
  switch (params.sortBy) {
    case 'amount_desc':
      orderClause = sql`bt.amount DESC, bt.transactionDate DESC`;
      break;
    case 'amount_asc':
      orderClause = sql`bt.amount ASC, bt.transactionDate DESC`;
      break;
    case 'date_asc':
      orderClause = sql`bt.transactionDate ASC, bt.id ASC`;
      break;
    case 'date_desc':
    default:
      orderClause = sql`bt.transactionDate DESC, bt.id DESC`;
      break;
  }

  // Lista paginada
  const result = await db.execute(sql`
    SELECT
      bt.id              AS bank_id,
      bt.transactionDate AS bank_date,
      bt.type            AS bank_type,
      bt.description     AS bank_description,
      bt.amount          AS bank_amount,
      bt.channel         AS bank_channel,
      bt.bankName        AS bank_bankName,
      bt.matchType       AS bank_matchType,
      bt.externalId      AS bank_externalId,
      at.id              AS api_id,
      at.transactionDate AS api_date,
      at.type            AS api_type,
      at.description     AS api_description,
      at.amount          AS api_amount,
      at.channel         AS api_channel,
      at.clientName      AS api_clientName,
      at.matchType       AS api_matchType,
      ABS(bt.amount - at.amount) AS amount_diff,
      DATEDIFF(bt.transactionDate, at.transactionDate) AS day_diff
    FROM bank_transactions bt
    ${joinClause}
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const rows = ((result as any)[0] ?? []).map((r: any) => ({
    bank: {
      id: r.bank_id,
      transactionDate: r.bank_date,
      type: r.bank_type,
      description: r.bank_description,
      amount: r.bank_amount,
      channel: r.bank_channel,
      bankName: r.bank_bankName,
      matchType: r.bank_matchType,
      externalId: r.bank_externalId,
    },
    api: {
      id: r.api_id,
      transactionDate: r.api_date,
      type: r.api_type,
      description: r.api_description,
      amount: r.api_amount,
      channel: r.api_channel,
      clientName: r.api_clientName,
      matchType: r.api_matchType,
    },
    amountDiff: parseFloat(String(r.amount_diff ?? 0)),
    dayDiff: parseInt(String(r.day_diff ?? 0)),
  }));

  return {
    rows,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// ─── BUSCA DE PARES SUSPEITOS ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Dado uma divergência, busca pares já conciliados na mesma sessão que
 * possam estar errados — ou seja, com valor e data próximos ao da divergência.
 * Tolerância fixa: R$ 2,00 de diferença de valor e ±3 dias de data.
 */
export async function findSuspiciousPairsForDivergence(divergenceId: number): Promise<{
  divergenceAmount: number;
  divergenceDate: string;
  sessionId: number;
  pairs: Array<{
    bank: any;
    api: any;
    amountDiff: number;
    dayDiff: number;
  }>;
}> {
  const db = await getDb();
  if (!db) {
    return { divergenceAmount: 0, divergenceDate: '', sessionId: 0, pairs: [] };
  }

  // Busca a divergência
  const divRows = await db.select().from(divergences)
    .where(eq(divergences.id, divergenceId)).limit(1);
  const div = divRows[0];
  if (!div) {
    throw new Error("Divergência não encontrada.");
  }

  const divAmount = parseFloat(String(div.amount));
  const sessionId = div.sessionId;
  const divDateStr = toMysqlDate(div.divergenceDate);

  // Tolerâncias (fixas e generosas — podem ser ajustadas no futuro)
  const AMOUNT_TOLERANCE = 2.00;     // até R$ 2,00 de diferença
  const DATE_TOLERANCE_DAYS = 3;     // ±3 dias

  // Busca pares conciliados na mesma sessão com valor próximo.
  // Faz JOIN entre bank_transactions e api_transactions pelo matchedApiTransactionId.
  const result = await db.execute(sql`
    SELECT
      bt.id           AS bank_id,
      bt.transactionDate AS bank_date,
      bt.type         AS bank_type,
      bt.description  AS bank_description,
      bt.amount       AS bank_amount,
      bt.channel      AS bank_channel,
      bt.bankName     AS bank_bankName,
      bt.matchType    AS bank_matchType,
      bt.matchStatus  AS bank_matchStatus,
      at.id           AS api_id,
      at.transactionDate AS api_date,
      at.type         AS api_type,
      at.description  AS api_description,
      at.amount       AS api_amount,
      at.channel      AS api_channel,
      at.clientName   AS api_clientName,
      at.matchType    AS api_matchType,
      ABS(bt.amount - ${divAmount}) AS amount_diff,
      DATEDIFF(bt.transactionDate, ${divDateStr}) AS day_diff
    FROM bank_transactions bt
    INNER JOIN api_transactions at
      ON at.id = bt.matchedApiTransactionId
    WHERE bt.sessionId = ${sessionId}
      AND bt.matchStatus IN ('matched','manual')
      AND ABS(bt.amount - ${divAmount}) <= ${AMOUNT_TOLERANCE}
      AND ABS(DATEDIFF(bt.transactionDate, ${divDateStr})) <= ${DATE_TOLERANCE_DAYS}
    ORDER BY ABS(bt.amount - ${divAmount}) ASC, ABS(DATEDIFF(bt.transactionDate, ${divDateStr})) ASC
    LIMIT 20
  `);

  const rows = (result as any)[0] ?? [];

  const pairs = rows.map((r: any) => ({
    bank: {
      id: r.bank_id,
      transactionDate: r.bank_date,
      type: r.bank_type,
      description: r.bank_description,
      amount: r.bank_amount,
      channel: r.bank_channel,
      bankName: r.bank_bankName,
      matchType: r.bank_matchType,
      matchStatus: r.bank_matchStatus,
    },
    api: {
      id: r.api_id,
      transactionDate: r.api_date,
      type: r.api_type,
      description: r.api_description,
      amount: r.api_amount,
      channel: r.api_channel,
      clientName: r.api_clientName,
      matchType: r.api_matchType,
    },
    amountDiff: parseFloat(String(r.amount_diff ?? 0)),
    dayDiff: parseInt(String(r.day_diff ?? 0)),
  }));

  return {
    divergenceAmount: divAmount,
    divergenceDate: divDateStr,
    sessionId: sessionId ?? 0,
    pairs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── DESCONCILIAR PAR ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Desfaz uma conciliação entre uma transação bancária e uma transação da API.
 * Os dois lados voltam ao status 'pending', o vínculo é removido, e duas
 * novas divergências são criadas para que cada lado apareça novamente como
 * pendente na lista — permitindo ao usuário analisar e reconciliar de outra
 * forma. Toda a ação é auditável.
 *
 * Pode ser acionado a partir de qualquer um dos lados (banco ou API) —
 * o sistema localiza o par e desfaz ambos.
 */
/**
 * Desconcilia a partir de uma DIVERGÊNCIA — caso típico: divergência de
 * "diferença de centavos" onde o motor tentou conciliar bank + api mas
 * reconheceu que os valores não batem, gravando ambos como 'divergent'
 * e criando uma divergência informativa com bankAmount + apiAmount.
 *
 * IMPORTANTE: o engine NÃO faz vínculo real (matchedApiTransactionId é null)
 * nesse caso — ele só grava a divergência. Logo, "desconciliar" aqui
 * significa: separar o registro em duas divergências limpas e apagar a
 * divergência original.
 *
 * Fluxo:
 * 1. Localiza bank tx (por externalId ou sessionId+amount+date)
 * 2. Localiza api tx correspondente (por sessionId+amount+date e clientName)
 * 3. Garante que ambos estão como pending (já podem estar como divergent)
 * 4. Cria duas divergências limpas (Sobra puro + Falta pura)
 * 5. Apaga a divergência original
 */
export async function unmatchFromDivergence(divergenceId: number): Promise<{
  success: boolean;
  newDivergenceIds: number[];
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // 1. Busca a divergência original
  const divRows = await db.select().from(divergences)
    .where(eq(divergences.id, divergenceId)).limit(1);
  const div = divRows[0];
  if (!div) throw new Error("Divergência não encontrada.");
  if (!div.sessionId) throw new Error("Divergência sem sessão — não há par para desfazer.");
  if (!div.bankAmount || !div.apiAmount) {
    throw new Error("Esta divergência não tem dois lados (banco + API) — não há nada para desconciliar.");
  }

  const sessionId = div.sessionId;
  const bankAmountStr = String(div.bankAmount);
  const apiAmountStr = String(div.apiAmount);
  const divDate = toMysqlDate(div.divergenceDate);

  // 2. Localiza a transação bancária — primeiro tenta por externalId
  let bankTx: any = null;
  if (div.externalId) {
    const r = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, bankName, channel, matchStatus
      FROM bank_transactions
      WHERE sessionId = ${sessionId} AND externalId = ${div.externalId}
      LIMIT 1
    `);
    bankTx = ((r as any)[0] ?? [])[0] ?? null;
  }
  // Fallback: por sessionId + amount + data — SEMPRE filtrando por bankName
  // (sem isso, podia pegar transação de outro banco com mesmo valor/data)
  if (!bankTx) {
    // Tenta vários "matchers" de bankName: o label completo da divergência
    // ("Sicoob"), o código em minúsculas ("sicoob"), ou início do label
    // (caso o banco esteja salvo como código no bank_transactions e como
    //  label na divergência ou vice-versa)
    const divBankName = String(div.bankName ?? "").trim();
    const divBankCode = divBankName.toLowerCase().split(" ")[0]; // "JD (Expag)" → "jd"
    const r = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, bankName, channel, matchStatus
      FROM bank_transactions
      WHERE sessionId = ${sessionId}
        AND amount = ${bankAmountStr}
        AND transactionDate = ${divDate}
        AND (
          bankName = ${divBankName}
          OR LOWER(bankName) = ${divBankCode}
          OR LOWER(bankName) = ${divBankName.toLowerCase()}
        )
      LIMIT 1
    `);
    bankTx = ((r as any)[0] ?? [])[0] ?? null;
  }
  if (!bankTx) {
    throw new Error(`Transação bancária correspondente não encontrada nesta sessão (banco: ${div.bankName}, valor: ${div.bankAmount}, data: ${divDate}).`);
  }

  // 3. Localiza a transação API correspondente
  // Prioridade 1: link direto via matchedApiTransactionId (mais confiável)
  let apiTx: any = null;
  if (bankTx?.matchedApiTransactionId) {
    const r = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, clientName, matchStatus
      FROM api_transactions WHERE id = ${bankTx.matchedApiTransactionId} LIMIT 1
    `);
    apiTx = ((r as any)[0] ?? [])[0] ?? null;
  }

  // Prioridade 2: link direto via apiTransactionId na divergência
  if (!apiTx && div.apiTransactionId) {
    const r = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, clientName, matchStatus
      FROM api_transactions WHERE id = ${div.apiTransactionId} LIMIT 1
    `);
    apiTx = ((r as any)[0] ?? [])[0] ?? null;
  }

  // Prioridade 3: busca por externalId (E2E)
  if (!apiTx && div.externalId) {
    const r = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, clientName, matchStatus
      FROM api_transactions
      WHERE sessionId = ${sessionId} AND externalId = ${div.externalId}
      LIMIT 1
    `);
    apiTx = ((r as any)[0] ?? [])[0] ?? null;
  }

  // Prioridade 4: busca por amount + date (com tolerância de R$ 5,00)
  if (!apiTx) {
    const apiAmount = parseFloat(apiAmountStr);
    const minApi = (apiAmount - 5.0).toFixed(2);
    const maxApi = (apiAmount + 5.0).toFixed(2);
    const apiSearch = await db.execute(sql`
      SELECT id, transactionDate, amount, type, description, clientName, matchStatus
      FROM api_transactions
      WHERE sessionId = ${sessionId}
        AND CAST(amount AS DECIMAL(18,2)) BETWEEN ${minApi} AND ${maxApi}
        AND transactionDate = ${divDate}
      LIMIT 10
    `);
    const apiCandidates: any[] = (apiSearch as any)[0] ?? [];
    if (apiCandidates.length === 1) {
      apiTx = apiCandidates[0];
    } else if (apiCandidates.length > 1 && div.clientName) {
      apiTx = apiCandidates.find((c: any) =>
        String(c.clientName ?? "").trim().toLowerCase() === String(div.clientName).trim().toLowerCase()
      ) ?? apiCandidates[0];
    } else if (apiCandidates.length > 0) {
      apiTx = apiCandidates[0];
    }
  }

  if (!apiTx) {
    throw new Error(
      `Transação API correspondente não encontrada nesta sessão. ` +
      `Tente desconciliar pela aba "✓ Conciliados" na sessão, ou verifique se a transação API existe.`
    );
  }

  // 4. Garante que ambos estão como pending (limpa qualquer vínculo residual)
  await db.execute(sql`
    UPDATE bank_transactions
    SET matchStatus = 'pending', matchType = NULL, matchedApiTransactionId = NULL
    WHERE id = ${bankTx.id}
  `);
  await db.execute(sql`
    UPDATE api_transactions
    SET matchStatus = 'pending', matchType = NULL, matchedBankTransactionId = NULL
    WHERE id = ${apiTx.id}
  `);

  // 5. Cria duas novas divergências limpas
  // IMPORTANTE: usa o `bankName` da divergência ORIGINAL (que está com o
  // label correto, ex: "Sicoob") em vez de `bankTx.bankName` (que pode estar
  // com o código bruto, ex: "sicoob"). Isso preserva o que o usuário já via.
  const newIds: number[] = [];
  const bankAmountNum = parseFloat(String(bankTx.amount));
  const apiAmountNum = parseFloat(String(apiTx.amount));
  const preservedBankName = div.bankName ?? bankTx.bankName ?? null;

  // Sobra no banco — preserva o clientName da divergência original
  // (que veio da API pareada antes do desfazer) para manter o contexto
  // que o usuário já via. Ex: PIX da Gol → clientName='GOL COMBUSTIVEIS SA'
  // tanto na divergência banco quanto na divergência API.
  const r1 = await db.execute(sql`
    INSERT INTO divergences (
      sessionId, divergenceDate, bankName, clientName, divergenceType, amount,
      category, priority, status, bankAmount, transactionType,
      bankDescription, observation, externalId
    ) VALUES (
      ${sessionId}, ${toMysqlDate(bankTx.transactionDate)}, ${preservedBankName},
      ${div.clientName ?? apiTx.clientName ?? null},
      'bank_surplus', ${String(bankAmountNum.toFixed(2))},
      'outros', 'medium', 'pendente',
      ${String(bankAmountNum.toFixed(2))}, ${bankTx.type},
      ${bankTx.description || null},
      ${`Desconciliado da divergência #${divergenceId} (diferença de R$ ${(Math.abs(bankAmountNum - apiAmountNum)).toFixed(2)})`},
      ${div.externalId || null}
    )
  `);
  const id1 = Number((r1 as any)[0]?.insertId ?? 0);
  if (id1 > 0) newIds.push(id1);

  // Falta no banco / Sobra na API
  const r2 = await db.execute(sql`
    INSERT INTO divergences (
      sessionId, divergenceDate, bankName, clientName, divergenceType, amount,
      category, priority, status, apiAmount, transactionType,
      apiDescription, observation
    ) VALUES (
      ${sessionId}, ${toMysqlDate(apiTx.transactionDate)}, 'API', ${apiTx.clientName || null},
      'bank_shortage', ${String(apiAmountNum.toFixed(2))},
      'outros', 'medium', 'pendente',
      ${String(apiAmountNum.toFixed(2))}, ${apiTx.type},
      ${apiTx.description || null},
      ${`Desconciliado da divergência #${divergenceId} (diferença de R$ ${(Math.abs(bankAmountNum - apiAmountNum)).toFixed(2)})`}
    )
  `);
  const id2 = Number((r2 as any)[0]?.insertId ?? 0);
  if (id2 > 0) newIds.push(id2);

  // 6. Remove a divergência original
  await db.execute(sql`DELETE FROM divergences WHERE id = ${divergenceId}`);

  // 7. Invalida caches
  invalidateReconciliationCaches();

  return { success: true, newDivergenceIds: newIds };
}

export async function unmatchPair(params: {
  bankTransactionId?: number;
  apiTransactionId?: number;
  deleteManualEntry?: boolean;    // se true, e o par foi criado por contrapartida, apaga a transação criada
}): Promise<{
  success: boolean;
  sessionId: number;
  bankTxId: number;
  apiTxId: number;
  deletedManualEntry: boolean;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // 1. Localiza o par
  let bankTx: any = null;
  let apiTx: any = null;

  if (params.bankTransactionId) {
    const r = await db.execute(sql`SELECT * FROM bank_transactions WHERE id = ${params.bankTransactionId} LIMIT 1`);
    bankTx = (r as any)[0]?.[0];
    if (!bankTx) throw new Error("Transação bancária não encontrada.");
    // Link direto
    if (bankTx.matchedApiTransactionId) {
      const r2 = await db.execute(sql`SELECT * FROM api_transactions WHERE id = ${bankTx.matchedApiTransactionId} LIMIT 1`);
      apiTx = (r2 as any)[0]?.[0];
    }
    // Fallback por externalId (sessões onde matchedApiTransactionId não foi linkado)
    if (!apiTx && bankTx.externalId) {
      const r2 = await db.execute(sql`
        SELECT * FROM api_transactions
        WHERE sessionId = ${bankTx.sessionId}
          AND externalId = ${bankTx.externalId}
          AND matchStatus IN ('matched','manual')
        LIMIT 1
      `);
      apiTx = (r2 as any)[0]?.[0];
    }
    // Fallback por date + amount + type
    if (!apiTx) {
      const r2 = await db.execute(sql`
        SELECT * FROM api_transactions
        WHERE sessionId = ${bankTx.sessionId}
          AND transactionDate = ${bankTx.transactionDate}
          AND ABS(CAST(amount AS DECIMAL(18,2)) - CAST(${String(bankTx.amount)} AS DECIMAL(18,2))) < 5
          AND matchStatus IN ('matched','manual')
        LIMIT 1
      `);
      apiTx = (r2 as any)[0]?.[0];
    }
  } else if (params.apiTransactionId) {
    const r = await db.execute(sql`SELECT * FROM api_transactions WHERE id = ${params.apiTransactionId} LIMIT 1`);
    apiTx = (r as any)[0]?.[0];
    if (!apiTx) throw new Error("Transação de API não encontrada.");
    if (apiTx.matchedBankTransactionId) {
      const r2 = await db.execute(sql`SELECT * FROM bank_transactions WHERE id = ${apiTx.matchedBankTransactionId} LIMIT 1`);
      bankTx = (r2 as any)[0]?.[0];
    }
  } else {
    throw new Error("Informe bankTransactionId ou apiTransactionId.");
  }

  if (!bankTx || !apiTx) {
    throw new Error("Par não encontrado — a transação não está conciliada.");
  }
  if (bankTx.sessionId !== apiTx.sessionId) {
    throw new Error("As duas transações pertencem a sessões diferentes.");
  }

  const sessionId = bankTx.sessionId;

  // 2. Detecta se este par foi criado por 'Lançar contrapartida'
  //    (uma das transações tem matchType='manual' E foi a criada — heurística:
  //    matchType='manual' nos dois lados E channel='MANUAL' em uma delas)
  const isCounterpart =
    bankTx.matchType === 'manual' && apiTx.matchType === 'manual' &&
    (bankTx.channel === 'MANUAL' || apiTx.channel === 'MANUAL');

  let deletedManualEntry = false;

  if (params.deleteManualEntry && isCounterpart) {
    // Identifica qual lado foi o lançamento manual (geralmente o que tem channel='MANUAL')
    // e apaga essa transação. A outra volta a 'pending' como uma órfã, que vira divergência.
    if (bankTx.channel === 'MANUAL') {
      // Apaga a transação bancária criada manualmente
      await db.execute(sql`DELETE FROM bank_transactions WHERE id = ${bankTx.id}`);
      // A transação da API volta ao estado órfão
      await db.execute(sql`
        UPDATE api_transactions
        SET matchStatus = 'pending', matchType = NULL, matchedBankTransactionId = NULL
        WHERE id = ${apiTx.id}
      `);
      // Cria divergência indicando o lado faltante
      await db.execute(sql`
        INSERT INTO divergences (
          sessionId, divergenceDate, bankName, clientName, divergenceType, amount,
          category, priority, status, apiAmount, transactionType,
          observation, apiTransactionId
        ) VALUES (
          ${sessionId}, ${toMysqlDate(apiTx.transactionDate)}, 'API', ${apiTx.clientName || null},
          'bank_shortage', ${String(apiTx.amount)}, 'outros', 'medium', 'pendente',
          ${String(apiTx.amount)}, ${apiTx.type},
          'Recriada por desconciliação manual — o lançamento de contrapartida foi removido',
          ${apiTx.id}
        )
      `);
      deletedManualEntry = true;
    } else if (apiTx.channel === 'MANUAL') {
      // Apaga a transação da API criada manualmente
      await db.execute(sql`DELETE FROM api_transactions WHERE id = ${apiTx.id}`);
      // A transação do banco volta ao estado órfão
      await db.execute(sql`
        UPDATE bank_transactions
        SET matchStatus = 'pending', matchType = NULL, matchedApiTransactionId = NULL
        WHERE id = ${bankTx.id}
      `);
      await db.execute(sql`
        INSERT INTO divergences (
          sessionId, divergenceDate, bankName, divergenceType, amount,
          category, priority, status, bankAmount, transactionType,
          bankDescription, observation, bankTransactionId
        ) VALUES (
          ${sessionId}, ${toMysqlDate(bankTx.transactionDate)}, ${bankTx.bankName || null},
          'bank_surplus', ${String(bankTx.amount)}, 'outros', 'medium', 'pendente',
          ${String(bankTx.amount)}, ${bankTx.type},
          ${bankTx.description || null},
          'Recriada por desconciliação manual — o lançamento de contrapartida foi removido',
          ${bankTx.id}
        )
      `);
      deletedManualEntry = true;
    }
  } else {
    // Desconciliação simples — os dois lados voltam ao estado pending
    await db.execute(sql`
      UPDATE bank_transactions
      SET matchStatus = 'pending', matchType = NULL, matchedApiTransactionId = NULL
      WHERE id = ${bankTx.id}
    `);
    await db.execute(sql`
      UPDATE api_transactions
      SET matchStatus = 'pending', matchType = NULL, matchedBankTransactionId = NULL
      WHERE id = ${apiTx.id}
    `);

    // Cria divergências para que os dois lados apareçam na fila de pendentes para reanálise
    await db.execute(sql`
      INSERT INTO divergences (
        sessionId, divergenceDate, bankName, divergenceType, amount,
        category, priority, status, bankAmount, transactionType,
        bankDescription, observation, bankTransactionId
      ) VALUES (
        ${sessionId}, ${toMysqlDate(bankTx.transactionDate)}, ${bankTx.bankName || null},
        'bank_surplus', ${String(bankTx.amount)}, 'outros', 'medium', 'pendente',
        ${String(bankTx.amount)}, ${bankTx.type},
        ${bankTx.description || null},
        'Recriada por desconciliação manual — par anterior foi desfeito',
        ${bankTx.id}
      )
    `);
    await db.execute(sql`
      INSERT INTO divergences (
        sessionId, divergenceDate, bankName, clientName, divergenceType, amount,
        category, priority, status, apiAmount, transactionType,
        observation, apiTransactionId
      ) VALUES (
        ${sessionId}, ${toMysqlDate(apiTx.transactionDate)}, 'API', ${apiTx.clientName || null},
        'bank_shortage', ${String(apiTx.amount)}, 'outros', 'medium', 'pendente',
        ${String(apiTx.amount)}, ${apiTx.type},
        'Recriada por desconciliação manual — par anterior foi desfeito',
        ${apiTx.id}
      )
    `);
  }

  // Invalida o cache para que os contadores se atualizem
  _cache.clear();

  return {
    success: true,
    sessionId,
    bankTxId: bankTx.id,
    apiTxId: apiTx.id,
    deletedManualEntry,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── BOLETOS — Compensação diária BB x API ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// Trata o caso específico do BB que credita "cobrança" como valor agregado.
// Cada linha é um dia. A coluna `difference` é ACUMULATIVA entre dias:
//   difference[d] = difference[d-1] + (bankAmount[d] - apiAmount[d])
// Por isso qualquer alteração precisa cascatear para todos os dias seguintes.
// O saldo inicial fica em system_config (key='boleto_initial_balance').

const BOLETO_INITIAL_BALANCE_KEY = 'boleto_initial_balance';

/**
 * Lê o saldo inicial configurado. Esse valor é o ponto de partida para a
 * primeira diferença acumulada — equivalente ao "Saldo Inicial BB x CINQ"
 * do Excel do cliente.
 */
export async function getBoletoInitialBalance(): Promise<number> {
  const cfg = await getSystemConfig(BOLETO_INITIAL_BALANCE_KEY);
  return parseFloat(String(cfg ?? '0'));
}

export async function setBoletoInitialBalance(value: number): Promise<void> {
  await setSystemConfig(
    BOLETO_INITIAL_BALANCE_KEY,
    String(value),
    'Saldo inicial da aba Boletos (BB x API) — base do cálculo acumulado'
  );
  // Saldo inicial mudou → recalcula tudo
  await recalculateBoletoDifferences();
}

/**
 * Recalcula a coluna `difference` em CASCATA, do dia mais antigo ao mais novo.
 *
 * Regra: difference[d] = difference[d-1] + (bankAmount[d] - apiAmount[d])
 *        difference[primeiro_dia] = saldo_inicial + (bank - api)
 *
 * Chamado sempre que: alguém edita uma linha antiga, adiciona uma linha nova,
 * ou muda o saldo inicial. Sem isso, a coluna fica inconsistente.
 */
export async function recalculateBoletoDifferences(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const initialBalance = await getBoletoInitialBalance();
  const rows = await db.select().from(boletoDailyBalances)
    .orderBy(boletoDailyBalances.entryDate);

  let runningDifference = initialBalance;
  for (const row of rows) {
    const bank = parseFloat(String(row.bankAmount));
    const api = parseFloat(String(row.apiAmount));
    runningDifference = runningDifference + (bank - api);
    await db.execute(sql`
      UPDATE boleto_daily_balances
      SET difference = ${runningDifference.toFixed(2)}
      WHERE id = ${row.id}
    `);
  }
  _cache.delete('boleto_daily_balances');
}

/**
 * Lista todas as entradas de boleto, ordenadas por data crescente.
 * Acrescenta o saldo inicial como metadado (útil para o frontend renderizar).
 */
export async function getBoletoDailyBalances(): Promise<{
  initialBalance: number;
  rows: any[];
  totals: { totalBank: number; totalApi: number; currentDifference: number };
}> {
  const db = await getDb();
  if (!db) return { initialBalance: 0, rows: [], totals: { totalBank: 0, totalApi: 0, currentDifference: 0 } };

  const initialBalance = await getBoletoInitialBalance();
  const rows = await db.select().from(boletoDailyBalances)
    .orderBy(boletoDailyBalances.entryDate);

  let totalBank = 0;
  let totalApi = 0;
  for (const r of rows) {
    totalBank += parseFloat(String(r.bankAmount));
    totalApi += parseFloat(String(r.apiAmount));
  }
  const currentDifference = rows.length > 0
    ? parseFloat(String(rows[rows.length - 1].difference))
    : initialBalance;

  return {
    initialBalance,
    rows,
    totals: { totalBank, totalApi, currentDifference },
  };
}

/**
 * Cria ou atualiza uma entrada diária. Se a entrada já existir (mesma data),
 * soma os valores (caso de múltiplas cobranças no mesmo dia). Recalcula
 * difference em cascata ao final.
 *
 * Retorna a linha resultante.
 */
export async function upsertBoletoEntry(params: {
  entryDate: string;
  bankAmount?: number;       // valor a adicionar/setar (ver mode)
  apiAmount?: number;
  bankName?: string;
  observation?: string;
  divergenceIds?: number[];  // origens; serão acumuladas na coluna JSON
  mode?: 'add' | 'set';      // add = soma ao existente; set = substitui
}): Promise<any> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const mode = params.mode ?? 'add';
  const dateStr = toMysqlDate(params.entryDate);

  // Verifica se já existe entrada para este dia
  const existing = await db.select().from(boletoDailyBalances)
    .where(sql`entryDate = ${dateStr}`).limit(1);
  const current = existing[0];

  if (current) {
    // Atualiza a entrada existente
    const newBank = mode === 'add'
      ? parseFloat(String(current.bankAmount)) + (params.bankAmount ?? 0)
      : (params.bankAmount ?? parseFloat(String(current.bankAmount)));
    const newApi = mode === 'add'
      ? parseFloat(String(current.apiAmount)) + (params.apiAmount ?? 0)
      : (params.apiAmount ?? parseFloat(String(current.apiAmount)));

    // Acumula IDs de divergência (sem duplicar)
    let mergedIds: number[] = [];
    try {
      const existingIds = current.originDivergenceIds ? JSON.parse(current.originDivergenceIds) : [];
      mergedIds = Array.from(new Set([...existingIds, ...(params.divergenceIds ?? [])]));
    } catch {
      mergedIds = params.divergenceIds ?? [];
    }

    await db.execute(sql`
      UPDATE boleto_daily_balances
      SET bankAmount = ${newBank.toFixed(2)},
          apiAmount = ${newApi.toFixed(2)},
          originDivergenceIds = ${mergedIds.length > 0 ? JSON.stringify(mergedIds) : null},
          observation = ${params.observation ?? current.observation ?? null}
      WHERE id = ${current.id}
    `);
  } else {
    // Cria nova entrada
    await db.insert(boletoDailyBalances).values({
      entryDate: dateStr,
      bankName: params.bankName ?? 'Banco do Brasil',
      bankAmount: String((params.bankAmount ?? 0).toFixed(2)),
      apiAmount: String((params.apiAmount ?? 0).toFixed(2)),
      difference: '0',  // será calculado pela cascata
      originDivergenceIds: params.divergenceIds && params.divergenceIds.length > 0
        ? JSON.stringify(params.divergenceIds) : null,
      observation: params.observation ?? null,
    } as any);
  }

  // Recalcula em cascata
  await recalculateBoletoDifferences();

  // Retorna a linha resultante
  const result = await db.select().from(boletoDailyBalances)
    .where(sql`entryDate = ${dateStr}`).limit(1);
  return result[0];
}

/**
 * Apaga uma entrada e recalcula em cascata.
 */
export async function deleteBoletoEntry(id: number): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`DELETE FROM boleto_daily_balances WHERE id = ${id}`);
  await recalculateBoletoDifferences();
  return { success: true };
}

/**
 * Move uma ou mais divergências para a aba Boletos.
 * Soma os valores de todas as divergências (mesmo dia ou dias diferentes)
 * agrupando por data, regulariza as divergências e cria/atualiza as
 * entradas diárias correspondentes.
 *
 * Cenário típico: usuário identifica que aquelas linhas de "cobrança" do
 * BB são valores agregados de boletos e clica em "Mover para Boletos".
 */
export async function moveDivergencesToBoleto(params: {
  divergenceIds: number[];
  userName: string;
}): Promise<{
  movedCount: number;
  daysAffected: number;
  totalMoved: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  if (params.divergenceIds.length === 0) {
    throw new Error("Nenhuma divergência selecionada.");
  }

  // Busca as divergências
  const divs = await db.select().from(divergences)
    .where(inArray(divergences.id, params.divergenceIds));
  if (divs.length === 0) throw new Error("Divergências não encontradas.");

  // Agrupa por data
  const byDate = new Map<string, { amount: number; ids: number[]; bankName: string }>();
  let totalMoved = 0;
  for (const div of divs) {
    const dateStr = toMysqlDate(div.divergenceDate);
    const amount = parseFloat(String(div.amount));
    totalMoved += amount;
    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, { amount: 0, ids: [], bankName: div.bankName ?? 'Banco do Brasil' });
    }
    const e = byDate.get(dateStr)!;
    e.amount += amount;
    e.ids.push(div.id);
  }

  // Cria/atualiza as entradas diárias somando ao bankAmount
  for (const [dateStr, info] of Array.from(byDate.entries())) {
    await upsertBoletoEntry({
      entryDate: dateStr,
      bankAmount: info.amount,
      bankName: info.bankName,
      divergenceIds: info.ids,
      mode: 'add',
    });
  }

  // Regulariza as divergências (igual ao fluxo do NID)
  const observation = `Movido para a aba Boletos por ${params.userName}`;
  for (const id of params.divergenceIds) {
    await db.execute(sql`
      UPDATE divergences
      SET status = 'regularizado',
          observation = COALESCE(CONCAT(observation, ' | ', ${observation}), ${observation}),
          actionTaken = 'movido_para_boleto'
      WHERE id = ${id}
    `);
  }

  // Atualiza bank_transactions correspondentes → taxa de matching sobe
  await markResolvedBankTransactions(params.divergenceIds);

  _cache.clear();
  return {
    movedCount: divs.length,
    daysAffected: byDate.size,
    totalMoved,
  };
}

/**
 * Atualiza apenas o valor manual da API de uma entrada existente.
 * Use principalmente para o lançamento diário do usuário.
 */
export async function setBoletoApiAmount(params: {
  entryDate: string;
  apiAmount: number;
}): Promise<any> {
  return upsertBoletoEntry({
    entryDate: params.entryDate,
    apiAmount: params.apiAmount,
    mode: 'set',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVIMENTAÇÕES INTERNAS (Contabilidade — visualização da API Expag)
//
// Aba independente: NÃO afeta DRE, Cash Flow, Receitas, Despesas, Conciliação.
// Importação aceita o formato "Extrato Por Operação" (1 linha = 1 tipo agregado
// do dia, com débito e crédito totais + quantidade de transações).
//
// Regra de negócio: linhas com isTransfer=true (transferência entre contas)
// aparecem nas listagens e nos totais SEPARADAMENTE, mas NÃO somam nem
// subtraem do total geral, porque não é cash-in nem cash-out — é apenas
// movimentação interna entre contas do próprio cliente.
// ═══════════════════════════════════════════════════════════════════════════════

export async function listInternalMovements(filters?: {
  dateFrom?: string;
  dateTo?: string;
  operationType?: string;
  isTransfer?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filters?.dateFrom) conds.push(gte(internalMovements.movementDate, filters.dateFrom as any));
  if (filters?.dateTo) conds.push(lte(internalMovements.movementDate, filters.dateTo as any));
  if (filters?.operationType) conds.push(eq(internalMovements.operationType, filters.operationType));
  if (typeof filters?.isTransfer === 'boolean') conds.push(eq(internalMovements.isTransfer, filters.isTransfer));
  return db.select().from(internalMovements)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(internalMovements.movementDate), desc(internalMovements.creditAmount))
    .limit(2000);
}

export async function createInternalMovement(data: {
  movementDate: string;
  operationType: string;
  processor?: string;
  quantity: number;
  debitAmount: number;
  creditAmount: number;
  isTransfer: boolean;
  notes?: string;
  source?: 'manual' | 'imported';
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(internalMovements).values({
    movementDate: data.movementDate as any,
    operationType: data.operationType,
    processor: data.processor ?? null,
    quantity: data.quantity,
    debitAmount: data.debitAmount.toFixed(2),
    creditAmount: data.creditAmount.toFixed(2),
    isTransfer: data.isTransfer,
    notes: data.notes ?? null,
    source: data.source ?? 'manual',
    createdBy: data.createdBy ?? null,
  });
  return { id: (result as any)[0]?.insertId ?? 0 };
}

export async function updateInternalMovement(id: number, data: Partial<{
  movementDate: string;
  operationType: string;
  processor: string;
  quantity: number;
  debitAmount: number;
  creditAmount: number;
  isTransfer: boolean;
  notes: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const update: any = {};
  if (data.movementDate !== undefined) update.movementDate = data.movementDate;
  if (data.operationType !== undefined) update.operationType = data.operationType;
  if (data.processor !== undefined) update.processor = data.processor || null;
  if (data.quantity !== undefined) update.quantity = data.quantity;
  if (data.debitAmount !== undefined) update.debitAmount = data.debitAmount.toFixed(2);
  if (data.creditAmount !== undefined) update.creditAmount = data.creditAmount.toFixed(2);
  if (data.isTransfer !== undefined) update.isTransfer = data.isTransfer;
  if (data.notes !== undefined) update.notes = data.notes || null;
  await db.update(internalMovements).set(update).where(eq(internalMovements.id, id));
  return { success: true };
}

export async function deleteInternalMovement(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(internalMovements).where(eq(internalMovements.id, id));
  return { success: true };
}

export async function bulkInsertInternalMovements(rows: Array<{
  movementDate: string;
  operationType: string;
  processor?: string | null;
  quantity: number;
  debitAmount: number;
  creditAmount: number;
  isTransfer: boolean;
  source?: 'manual' | 'imported';
  createdBy?: string;
}>): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const values = rows.map(r => ({
    movementDate: r.movementDate as any,
    operationType: r.operationType,
    processor: r.processor ?? null,
    quantity: r.quantity,
    debitAmount: r.debitAmount.toFixed(2),
    creditAmount: r.creditAmount.toFixed(2),
    isTransfer: r.isTransfer,
    source: r.source ?? 'imported',
    createdBy: r.createdBy ?? null,
  }));
  // Insere em chunks pra não estourar limite de packet do MySQL
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await db.insert(internalMovements).values(chunk as any);
    inserted += chunk.length;
  }
  return { inserted };
}

/**
 * Gera movimentações internas a partir das transações da API de uma conciliação.
 *
 * Agrega as transações da API por (data + tipo de operação + processador),
 * contando quantidade e somando débitos/créditos — exatamente o formato da
 * aba "Movimentações Internas".
 *
 * SUBSTITUI as movimentações das MESMAS DATAS que tenham origem automática
 * ('reconciliation') ou importada ('imported'), para a reconciliação ser a
 * fonte de verdade. Movimentações criadas MANUALMENTE (source='manual') são
 * preservadas para não apagar ajustes do usuário.
 *
 * @param apiTxs transações já parseadas da API (com operationType/processedBy)
 */
export async function generateInternalMovementsFromApi(apiTxs: Array<{
  date: string;
  type: "credit" | "debit";
  amount: number;
  operationType?: string;
  processedBy?: string;
  isInternal?: boolean;
}>): Promise<{ inserted: number; replacedDates: string[] }> {
  const db = await getDb();
  if (!db) return { inserted: 0, replacedDates: [] };

  // Agrupa por data + operationType + processedBy
  const groups = new Map<string, {
    movementDate: string; operationType: string; processor: string | null;
    quantity: number; debitAmount: number; creditAmount: number; isTransfer: boolean;
  }>();

  for (const tx of apiTxs) {
    const opType = (tx.operationType ?? "OUTROS").toUpperCase();
    const proc = tx.processedBy ?? null;
    const key = `${tx.date}|${opType}|${proc ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        movementDate: tx.date, operationType: opType, processor: proc,
        quantity: 0, debitAmount: 0, creditAmount: 0,
        isTransfer: tx.isInternal === true || /ENTRE\s+CONTAS/i.test(opType),
      };
      groups.set(key, g);
    }
    g.quantity += 1;
    if (tx.type === "debit") g.debitAmount += tx.amount;
    else g.creditAmount += tx.amount;
  }

  if (groups.size === 0) return { inserted: 0, replacedDates: [] };

  // Datas afetadas — remove movimentações antigas dessas datas (exceto manuais)
  const dates = Array.from(new Set(Array.from(groups.values()).map(g => g.movementDate)));
  for (const d of dates) {
    await db.execute(sql`
      DELETE FROM internal_movements
      WHERE movementDate = ${d} AND source IN ('imported','reconciliation')
    `);
  }

  // Insere os novos agregados
  const values = Array.from(groups.values()).map(g => ({
    movementDate: g.movementDate as any,
    operationType: g.operationType,
    processor: g.processor,
    quantity: g.quantity,
    debitAmount: g.debitAmount.toFixed(2),
    creditAmount: g.creditAmount.toFixed(2),
    isTransfer: g.isTransfer,
    source: 'reconciliation' as any,
    createdBy: 'Conciliação (automático)',
  }));

  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await db.insert(internalMovements).values(chunk as any);
    inserted += chunk.length;
  }
  return { inserted, replacedDates: dates };
}

/**
 * Retorna estatísticas agregadas das movimentações internas.
 *
 * Returns por tipo de operação:
 * - quantidade total de transações
 * - débito total (sempre absoluto/negativo)
 * - crédito total (sempre absoluto/positivo)
 * - liquido = crédito - débito (ignora linhas isTransfer)
 * - flag isTransfer
 *
 * Separa totais gerais em dois grupos:
 * - operacionais (isTransfer=false): somam ao total geral
 * - transferências (isTransfer=true): aparecem mas não somam
 */
export async function getInternalMovementsSummary(filters?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  const db = await getDb();
  if (!db) return { byType: [], totals: { operationalCredits: 0, operationalDebits: 0, operationalNet: 0, transferCredits: 0, transferDebits: 0, totalQuantity: 0 } };

  const conds: any[] = [];
  if (filters?.dateFrom) conds.push(gte(internalMovements.movementDate, filters.dateFrom as any));
  if (filters?.dateTo) conds.push(lte(internalMovements.movementDate, filters.dateTo as any));

  // Agrupado por tipo
  const byType = await db.select({
    operationType: internalMovements.operationType,
    isTransfer: internalMovements.isTransfer,
    quantity: sql<number>`SUM(${internalMovements.quantity})`,
    debit: sql<string>`SUM(${internalMovements.debitAmount})`,
    credit: sql<string>`SUM(${internalMovements.creditAmount})`,
    count: sql<number>`COUNT(*)`,
  })
    .from(internalMovements)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(internalMovements.operationType, internalMovements.isTransfer)
    .orderBy(desc(sql`SUM(${internalMovements.creditAmount} + ${internalMovements.debitAmount} * -1)`));

  // Totais (com e sem transferências)
  let operationalCredits = 0, operationalDebits = 0;
  let transferCredits = 0, transferDebits = 0;
  let totalQuantity = 0;
  for (const row of byType) {
    const credit = parseFloat(String(row.credit ?? '0'));
    const debit = Math.abs(parseFloat(String(row.debit ?? '0')));
    totalQuantity += Number(row.quantity ?? 0);
    if (row.isTransfer) {
      transferCredits += credit;
      transferDebits += debit;
    } else {
      operationalCredits += credit;
      operationalDebits += debit;
    }
  }

  return {
    byType: byType.map(r => ({
      operationType: r.operationType,
      isTransfer: r.isTransfer,
      quantity: Number(r.quantity ?? 0),
      debit: Math.abs(parseFloat(String(r.debit ?? '0'))),
      credit: parseFloat(String(r.credit ?? '0')),
      count: Number(r.count ?? 0),
    })),
    totals: {
      operationalCredits,
      operationalDebits,
      operationalNet: operationalCredits - operationalDebits,
      transferCredits,
      transferDebits,
      totalQuantity,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD EXECUTIVO
//
// Função única que retorna todos os dados de alto nível para apresentação à
// diretoria. Inclui período corrente + período anterior (para comparativo MoM)
// + série de 12 meses (para gráficos de evolução).
//
// Estrutura intencionalmente "achatada" para facilitar consumo no frontend
// sem múltiplas queries paralelas. O cliente envia o período (mês corrente
// por default), backend faz todos os cálculos de uma vez.
// ═══════════════════════════════════════════════════════════════════════════════

type ExecutivePeriodKpis = {
  tpv: number;                 // Total Payment Volume (créditos no internal_movements)
  operationalRevenue: number;  // Receita Operacional
  financialRevenue: number;    // Receita Financeira (juros, rendimentos)
  totalRevenue: number;        // soma das duas
  totalExpenses: number;       // todas as despesas
  netProfit: number;           // totalRevenue - totalExpenses
  margin: number;              // netProfit / operationalRevenue
  transactionCount: number;    // # de movimentações internas no período
};

/**
 * Calcula KPIs agregados para um período específico (entre dateFrom e dateTo).
 * Reutilizada para período corrente e período anterior (comparativo MoM).
 */
async function calculateExecutivePeriodKpis(
  dbConn: any,
  dateFrom: string,
  dateTo: string,
): Promise<ExecutivePeriodKpis> {
  // Receitas separadas por tipo (operacional vs financeira)
  const revRes = await dbConn.execute(sql`
    SELECT
      SUM(CASE WHEN type = 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as financialRevenue,
      SUM(CASE WHEN type != 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as operationalRevenue
    FROM revenues
    WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo}
      AND status = 'realizado'
  `);
  const revRow = (revRes as any)[0]?.[0] ?? {};

  // Despesas
  const expRes = await dbConn.execute(sql`
    SELECT COALESCE(SUM(CAST(amount AS DECIMAL(18,2))), 0) as total
    FROM expenses
    WHERE referenceDate BETWEEN ${dateFrom} AND ${dateTo}
      AND status = 'realizado'
  `);
  const totalExpenses = parseFloat(String((expRes as any)[0]?.[0]?.total ?? 0));

  // TPV — créditos operacionais (exclui transferências entre contas)
  const tpvRes = await dbConn.execute(sql`
    SELECT
      COALESCE(SUM(CAST(creditAmount AS DECIMAL(18,2))), 0) as tpv,
      COALESCE(SUM(quantity), 0) as txCount
    FROM internal_movements
    WHERE movementDate BETWEEN ${dateFrom} AND ${dateTo}
      AND isTransfer = 0
  `);
  const tpvRow = (tpvRes as any)[0]?.[0] ?? {};

  const operationalRevenue = parseFloat(String(revRow.operationalRevenue ?? 0));
  const financialRevenue = parseFloat(String(revRow.financialRevenue ?? 0));
  const totalRevenue = operationalRevenue + financialRevenue;
  const netProfit = totalRevenue - totalExpenses;
  const margin = operationalRevenue > 0 ? (netProfit / operationalRevenue) * 100 : 0;

  return {
    tpv: parseFloat(String(tpvRow.tpv ?? 0)),
    operationalRevenue,
    financialRevenue,
    totalRevenue,
    totalExpenses,
    netProfit,
    margin,
    transactionCount: Number(tpvRow.txCount ?? 0),
  };
}

/**
 * Endpoint principal do Dashboard Executivo.
 *
 * Retorna:
 *  - current: KPIs do período selecionado
 *  - previous: KPIs do período imediatamente anterior (mesmo tamanho) → comparativo MoM
 *  - series12m: 12 meses de evolução (receita, margem, TPV por mês)
 *  - revenueByType: composição da receita do período corrente
 */
export async function getExecutiveDashboard(params: {
  dateFrom: string;
  dateTo: string;
}) {
  const dbConn = await getDb();
  if (!dbConn) {
    return null;
  }

  // ── 1) KPIs do período corrente ──
  const current = await calculateExecutivePeriodKpis(dbConn, params.dateFrom, params.dateTo);

  // ── 2) KPIs do período anterior (mesma duração, deslocada para trás) ──
  const from = new Date(params.dateFrom);
  const to = new Date(params.dateTo);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);  // dia anterior a dateFrom
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  const previous = await calculateExecutivePeriodKpis(
    dbConn,
    prevFrom.toISOString().slice(0, 10),
    prevTo.toISOString().slice(0, 10),
  );

  // ── 3) Série de 12 meses (para gráficos de evolução) ──
  const seriesRes = await dbConn.execute(sql`
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      SUM(CASE WHEN type = 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as financialRevenue,
      SUM(CASE WHEN type != 'receita_financeira' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as operationalRevenue
    FROM revenues
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      AND status = 'realizado'
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
  `);
  const expSeriesRes = await dbConn.execute(sql`
    SELECT
      DATE_FORMAT(referenceDate, '%Y-%m') as month,
      SUM(CAST(amount AS DECIMAL(18,2))) as totalExpenses
    FROM expenses
    WHERE referenceDate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      AND status = 'realizado'
    GROUP BY DATE_FORMAT(referenceDate, '%Y-%m')
  `);
  const tpvSeriesRes = await dbConn.execute(sql`
    SELECT
      DATE_FORMAT(movementDate, '%Y-%m') as month,
      SUM(CAST(creditAmount AS DECIMAL(18,2))) as tpv
    FROM internal_movements
    WHERE movementDate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      AND isTransfer = 0
    GROUP BY DATE_FORMAT(movementDate, '%Y-%m')
  `);

  // Merge dos 3 datasets por mês
  const seriesByMonth: Record<string, any> = {};
  for (const r of ((seriesRes as any)[0] ?? [])) {
    seriesByMonth[r.month] = {
      month: r.month,
      operationalRevenue: parseFloat(String(r.operationalRevenue ?? 0)),
      financialRevenue: parseFloat(String(r.financialRevenue ?? 0)),
      totalExpenses: 0,
      tpv: 0,
    };
  }
  for (const r of ((expSeriesRes as any)[0] ?? [])) {
    if (!seriesByMonth[r.month]) {
      seriesByMonth[r.month] = { month: r.month, operationalRevenue: 0, financialRevenue: 0, totalExpenses: 0, tpv: 0 };
    }
    seriesByMonth[r.month].totalExpenses = parseFloat(String(r.totalExpenses ?? 0));
  }
  for (const r of ((tpvSeriesRes as any)[0] ?? [])) {
    if (!seriesByMonth[r.month]) {
      seriesByMonth[r.month] = { month: r.month, operationalRevenue: 0, financialRevenue: 0, totalExpenses: 0, tpv: 0 };
    }
    seriesByMonth[r.month].tpv = parseFloat(String(r.tpv ?? 0));
  }

  // Garante 12 meses na série (mesmo se vazios) — importante para gráficos
  const months12: string[] = [];
  const baseDate = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    months12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const series12m = months12.map(m => {
    const row = seriesByMonth[m] ?? { month: m, operationalRevenue: 0, financialRevenue: 0, totalExpenses: 0, tpv: 0 };
    const totalRevenue = row.operationalRevenue + row.financialRevenue;
    const netProfit = totalRevenue - row.totalExpenses;
    const margin = row.operationalRevenue > 0 ? (netProfit / row.operationalRevenue) * 100 : 0;
    return { ...row, totalRevenue, netProfit, margin };
  });

  // ── 4) Composição da receita por tipo (período corrente) ──
  const typeRes = await dbConn.execute(sql`
    SELECT type, SUM(CAST(amount AS DECIMAL(18,2))) as total, COUNT(*) as cnt
    FROM revenues
    WHERE referenceDate BETWEEN ${params.dateFrom} AND ${params.dateTo}
      AND status = 'realizado'
    GROUP BY type
    ORDER BY total DESC
  `);
  const revenueByType = ((typeRes as any)[0] ?? []).map((r: any) => ({
    type: String(r.type ?? 'outros'),
    amount: parseFloat(String(r.total ?? 0)),
    count: Number(r.cnt ?? 0),
    percentage: current.totalRevenue > 0
      ? (parseFloat(String(r.total ?? 0)) / current.totalRevenue) * 100
      : 0,
  }));

  // ── 5) Top 10 clientes por volume (período corrente) ──
  // Agrega por clientName ignorando registros sem cliente identificado.
  // YTD = "Year To Date" — acumulado do ano até hoje (usado pra comparativo).
  const topClientsRes = await dbConn.execute(sql`
    SELECT
      COALESCE(NULLIF(clientName, ''), 'Sem identificação') as clientName,
      SUM(CAST(amount AS DECIMAL(18,2))) as totalPeriod,
      COUNT(*) as txCount
    FROM revenues
    WHERE referenceDate BETWEEN ${params.dateFrom} AND ${params.dateTo}
      AND status = 'realizado'
      AND clientName IS NOT NULL
    GROUP BY clientName
    ORDER BY totalPeriod DESC
    LIMIT 10
  `);
  const topClientsRows = (topClientsRes as any)[0] ?? [];

  // YTD do mesmo cliente (acumulado do ano até hoje) — pra mostrar trajetória
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const todayISO = new Date().toISOString().slice(0, 10);
  const ytdRes = topClientsRows.length > 0
    ? await dbConn.execute(sql`
        SELECT
          COALESCE(NULLIF(clientName, ''), 'Sem identificação') as clientName,
          SUM(CAST(amount AS DECIMAL(18,2))) as totalYtd
        FROM revenues
        WHERE referenceDate BETWEEN ${yearStart} AND ${todayISO}
          AND status = 'realizado'
          AND clientName IN (${sql.raw(topClientsRows.map((r: any) => `'${String(r.clientName).replace(/'/g, "''")}'`).join(','))})
        GROUP BY clientName
      `)
    : [[]];
  const ytdByClient: Record<string, number> = {};
  for (const r of ((ytdRes as any)[0] ?? [])) {
    ytdByClient[r.clientName] = parseFloat(String(r.totalYtd ?? 0));
  }

  const topClients = topClientsRows.map((r: any) => ({
    clientName: r.clientName,
    period: parseFloat(String(r.totalPeriod ?? 0)),
    ytd: ytdByClient[r.clientName] ?? 0,
    txCount: Number(r.txCount ?? 0),
    percentage: current.totalRevenue > 0
      ? (parseFloat(String(r.totalPeriod ?? 0)) / current.totalRevenue) * 100
      : 0,
  }));

  // Concentração: % do top 5 e top 10 sobre o total do período
  const concentrationTop5 = topClients.slice(0, 5).reduce((s: number, c: any) => s + c.percentage, 0);
  const concentrationTop10 = topClients.reduce((s: number, c: any) => s + c.percentage, 0);
  const concentrationTop1 = topClients[0]?.percentage ?? 0;

  // ── 6) Carteira de Crédito ──
  const creditTotalsRes = await dbConn.execute(sql`
    SELECT
      COUNT(*) as totalLoans,
      SUM(CASE WHEN status = 'ativo' THEN 1 ELSE 0 END) as activeLoans,
      SUM(CASE WHEN status = 'quitado' THEN 1 ELSE 0 END) as paidLoans,
      SUM(CASE WHEN status = 'inadimplente' THEN 1 ELSE 0 END) as defaultLoans,
      SUM(CASE WHEN status = 'renegociado' THEN 1 ELSE 0 END) as renegotiatedLoans,
      COALESCE(SUM(CAST(outstandingBalance AS DECIMAL(18,2))), 0) as outstandingTotal,
      COALESCE(SUM(CAST(principal AS DECIMAL(18,2))), 0) as principalTotal,
      COALESCE(SUM(CAST(totalInterestEarned AS DECIMAL(18,2))), 0) as totalInterestEarned,
      COALESCE(AVG(CAST(interestRate AS DECIMAL(8,4))), 0) as avgInterestRate
    FROM credit_portfolio
    WHERE status != 'cancelado'
  `);
  const creditRow = (creditTotalsRes as any)[0]?.[0] ?? {};

  // Inadimplência: parcelas vencidas e ainda pendentes
  const overdueRes = await dbConn.execute(sql`
    SELECT
      COUNT(*) as overdueCount,
      COALESCE(SUM(CAST(totalAmount AS DECIMAL(18,2))), 0) as overdueAmount
    FROM credit_installments
    WHERE status IN ('pendente', 'parcial')
      AND dueDate < CURDATE()
  `);
  const overdueRow = (overdueRes as any)[0]?.[0] ?? {};

  // Total de parcelas pendentes (denominador da % de inadimplência)
  const pendingRes = await dbConn.execute(sql`
    SELECT
      COUNT(*) as pendingCount,
      COALESCE(SUM(CAST(totalAmount AS DECIMAL(18,2))), 0) as pendingAmount
    FROM credit_installments
    WHERE status IN ('pendente', 'parcial')
  `);
  const pendingRow = (pendingRes as any)[0]?.[0] ?? {};

  // Juros recebidos no período (a partir de revenues do tipo financeira)
  const interestPeriodRes = await dbConn.execute(sql`
    SELECT COALESCE(SUM(CAST(amount AS DECIMAL(18,2))), 0) as total
    FROM revenues
    WHERE referenceDate BETWEEN ${params.dateFrom} AND ${params.dateTo}
      AND status = 'realizado'
      AND type = 'receita_financeira'
  `);
  const interestPeriod = parseFloat(String((interestPeriodRes as any)[0]?.[0]?.total ?? 0));

  const overdueAmount = parseFloat(String(overdueRow.overdueAmount ?? 0));
  const pendingAmount = parseFloat(String(pendingRow.pendingAmount ?? 0));
  const defaultRate = pendingAmount > 0 ? (overdueAmount / pendingAmount) * 100 : 0;

  const creditPortfolio = {
    totalLoans: Number(creditRow.totalLoans ?? 0),
    activeLoans: Number(creditRow.activeLoans ?? 0),
    paidLoans: Number(creditRow.paidLoans ?? 0),
    defaultLoans: Number(creditRow.defaultLoans ?? 0),
    renegotiatedLoans: Number(creditRow.renegotiatedLoans ?? 0),
    outstandingTotal: parseFloat(String(creditRow.outstandingTotal ?? 0)),
    principalTotal: parseFloat(String(creditRow.principalTotal ?? 0)),
    totalInterestEarned: parseFloat(String(creditRow.totalInterestEarned ?? 0)),
    avgInterestRate: parseFloat(String(creditRow.avgInterestRate ?? 0)),
    overdueCount: Number(overdueRow.overdueCount ?? 0),
    overdueAmount,
    pendingCount: Number(pendingRow.pendingCount ?? 0),
    pendingAmount,
    defaultRate,
    interestPeriod,
  };

  // ── 7) Saúde Operacional ──
  // Taxa de conciliação: média ponderada das sessões dos últimos 90 dias.
  // Ponderada pelo total de transações para que sessões maiores tenham
  // mais peso (uma sessão com 5000 txs vale mais que uma de 50).
  const recConcResRecent = await dbConn.execute(sql`
    SELECT
      COALESCE(SUM(matchedCount), 0) as totalMatched,
      COALESCE(SUM(matchedCount + pendingCount), 0) as totalAll,
      COUNT(*) as sessionCount
    FROM reconciliation_sessions
    WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      AND status = 'completed'
  `);
  const recRow = (recConcResRecent as any)[0]?.[0] ?? {};
  const totalMatched = Number(recRow.totalMatched ?? 0);
  const totalAll = Number(recRow.totalAll ?? 0);
  const reconciliationRate = totalAll > 0 ? (totalMatched / totalAll) * 100 : 0;

  // Divergências críticas abertas (priority high/critical, status não resolvido)
  const criticalDivRes = await dbConn.execute(sql`
    SELECT
      COUNT(*) as critCount,
      COALESCE(SUM(CAST(amount AS DECIMAL(18,2))), 0) as critAmount
    FROM divergences
    WHERE priority IN ('high', 'critical')
      AND status NOT IN ('regularizado', 'reclassificado', 'baixado')
  `);
  const critRow = (criticalDivRes as any)[0]?.[0] ?? {};

  // Total de divergências abertas (qualquer prioridade)
  const allOpenDivRes = await dbConn.execute(sql`
    SELECT COUNT(*) as cnt
    FROM divergences
    WHERE status NOT IN ('regularizado', 'reclassificado', 'baixado')
  `);
  const openDivCount = Number((allOpenDivRes as any)[0]?.[0]?.cnt ?? 0);

  // Saldo de Caixa: vem do último registro de managerial_balances (saldo
  // consolidado informado manualmente na aba Saldo Gerencial). É a fonte
  // mais confiável porque já considera saldos de abertura, dinheiro de
  // clientes vs próprio, e ajustes de divergência.
  //
  // Campos relevantes em managerial_balances:
  //   - realCash:    bankBalance - clientBalance - committedBalance ± divergenceBalance
  //   - freeCash:    parte do realCash que não está comprometida
  //   - bankBalance: saldo bruto nos bancos
  //
  // Usamos realCash (mais completo) e referenceDate para informar ao usuário
  // a data do saldo (relevante quando o último registro não é de hoje).
  const cashRes = await dbConn.execute(sql`
    SELECT realCash, freeCash, bankBalance, referenceDate
    FROM managerial_balances
    ORDER BY referenceDate DESC
    LIMIT 1
  `);
  const cashRow = (cashRes as any)[0]?.[0];
  const cashBalance = cashRow ? parseFloat(String(cashRow.realCash ?? 0)) : 0;
  const cashFreeBalance = cashRow ? parseFloat(String(cashRow.freeCash ?? 0)) : 0;
  const cashReferenceDate: string | null = cashRow?.referenceDate
    ? String(cashRow.referenceDate).slice(0, 10)
    : null;

  // Tempo médio para regularização (em dias)
  // De divergence.createdAt até updatedAt quando status='regularizado'
  const resolutionRes = await dbConn.execute(sql`
    SELECT
      AVG(DATEDIFF(updatedAt, createdAt)) as avgDays,
      COUNT(*) as resolvedCount
    FROM divergences
    WHERE status = 'regularizado'
      AND updatedAt >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  `);
  const resRow = (resolutionRes as any)[0]?.[0] ?? {};
  const avgResolutionDays = parseFloat(String(resRow.avgDays ?? 0));
  const resolvedCount = Number(resRow.resolvedCount ?? 0);

  const operationalHealth = {
    reconciliationRate,
    sessionCount: Number(recRow.sessionCount ?? 0),
    criticalDivergences: Number(critRow.critCount ?? 0),
    criticalAmount: parseFloat(String(critRow.critAmount ?? 0)),
    openDivergences: openDivCount,
    cashBalance,
    cashFreeBalance,
    cashReferenceDate,
    avgResolutionDays,
    resolvedCount,
  };

  return {
    period: { dateFrom: params.dateFrom, dateTo: params.dateTo },
    current,
    previous,
    series12m,
    revenueByType,
    topClients,
    concentration: {
      top1: concentrationTop1,
      top5: concentrationTop5,
      top10: concentrationTop10,
    },
    creditPortfolio,
    operationalHealth,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// APURAÇÃO MANUAL (Modo Emergência)
//
// Tela paralela ao sistema principal para inserir manualmente as categorias
// de receita e despesa de um mês quando a conciliação automática ainda não
// foi concluída. Não afeta DRE, Cash Flow, Receitas, Despesas ou nada do
// sistema principal — é uma estrutura SEPARADA exclusiva para apresentação.
//
// Usa o mesmo formato "mês de referência" (YYYY-MM) para guardar histórico.
// Acumulado YTD = SUM de todos os meses do ano corrente.
// ═══════════════════════════════════════════════════════════════════════════════

export async function listManualApuracao(filters?: {
  referenceMonth?: string;
  kind?: 'receita' | 'despesa';
  apiSource?: 'expag' | 'cinqbank';
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filters?.referenceMonth) conds.push(eq(manualApuracao.referenceMonth, filters.referenceMonth));
  if (filters?.kind) conds.push(eq(manualApuracao.kind, filters.kind));
  if (filters?.apiSource) conds.push(eq(manualApuracao.apiSource, filters.apiSource));
  return db.select().from(manualApuracao)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(manualApuracao.referenceMonth, manualApuracao.apiSource, manualApuracao.kind, manualApuracao.sortOrder, manualApuracao.category);
}

/**
 * Retorna lista de meses únicos com dados (para o seletor de mês).
 */
export async function getManualApuracaoMonths() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT DISTINCT referenceMonth FROM manual_apuracao
    ORDER BY referenceMonth DESC
  `);
  return ((result as any)[0] ?? []).map((r: any) => r.referenceMonth);
}

/**
 * Retorna categorias já usadas pelo usuário, separadas por kind.
 * Ordena por frequência (mais usadas primeiro) para facilitar autocomplete.
 */
export async function getManualApuracaoCategories() {
  const db = await getDb();
  if (!db) return { receita: [], despesa: [] };
  const result = await db.execute(sql`
    SELECT kind, category, COUNT(*) as cnt
    FROM manual_apuracao
    GROUP BY kind, category
    ORDER BY cnt DESC, category ASC
  `);
  const rows = (result as any)[0] ?? [];
  const receita = rows.filter((r: any) => r.kind === 'receita').map((r: any) => String(r.category));
  const despesa = rows.filter((r: any) => r.kind === 'despesa').map((r: any) => String(r.category));
  return { receita, despesa };
}

export async function createManualApuracao(data: {
  referenceMonth: string;
  kind: 'receita' | 'despesa';
  apiSource: 'expag' | 'cinqbank';
  category: string;
  amount: number;
  notes?: string;
  sortOrder?: number;
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(manualApuracao).values({
    referenceMonth: data.referenceMonth,
    apiSource: data.apiSource,
    kind: data.kind,
    category: data.category,
    amount: data.amount.toFixed(2),
    notes: data.notes ?? null,
    sortOrder: data.sortOrder ?? 0,
    createdBy: data.createdBy ?? null,
  });
  return { id: (result as any)[0]?.insertId ?? 0 };
}

export async function updateManualApuracao(id: number, data: Partial<{
  category: string;
  amount: number;
  notes: string;
  sortOrder: number;
  apiSource: 'expag' | 'cinqbank';
}>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const update: any = {};
  if (data.category !== undefined) update.category = data.category;
  if (data.amount !== undefined) update.amount = data.amount.toFixed(2);
  if (data.notes !== undefined) update.notes = data.notes || null;
  if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
  if (data.apiSource !== undefined) update.apiSource = data.apiSource;
  await db.update(manualApuracao).set(update).where(eq(manualApuracao.id, id));
  return { success: true };
}

export async function deleteManualApuracao(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(manualApuracao).where(eq(manualApuracao.id, id));
  return { success: true };
}

/**
 * Resumo agregado para o Dashboard de Apuração Manual.
 *
 * Comportamento:
 *  - referenceMonth: mês específico (YYYY-MM) → retorna dados desse mês
 *  - mode: 'ytd' → retorna acumulado de jan/yyyy até hoje
 *  - mode: 'all' → retorna acumulado total da tabela
 *
 * Sempre devolve duas listas (receitas/despesas) ordenadas por valor decrescente
 * dentro de cada tipo, mais o agregado mensal para gráfico de evolução.
 */
export async function getManualApuracaoSummary(params: {
  mode: 'month' | 'ytd' | 'all';
  referenceMonth?: string;
  apiSource?: 'expag' | 'cinqbank';  // filtra todo o response por uma API específica
}) {
  const db = await getDb();
  if (!db) {
    return {
      mode: params.mode,
      period: null,
      totals: { revenue: 0, expense: 0, result: 0, margin: 0 },
      byApi: {
        expag:    { revenue: 0, expense: 0, result: 0, margin: 0 },
        cinqbank: { revenue: 0, expense: 0, result: 0, margin: 0 },
      },
      revenues: [],
      expenses: [],
      monthlySeries: [],
    };
  }

  // Construir filtros: período + (opcionalmente) API
  const conds: string[] = [];
  let periodLabel = '';
  if (params.mode === 'month' && params.referenceMonth) {
    conds.push(`referenceMonth = '${params.referenceMonth}'`);
    periodLabel = params.referenceMonth;
  } else if (params.mode === 'ytd') {
    const yearStart = `${new Date().getFullYear()}-01`;
    conds.push(`referenceMonth >= '${yearStart}'`);
    periodLabel = `YTD ${new Date().getFullYear()}`;
  } else {
    periodLabel = 'Acumulado total';
  }
  // Filtro de API (se informado, restringe TUDO ao escopo da API)
  if (params.apiSource) {
    conds.push(`apiSource = '${params.apiSource}'`);
  }
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  // Agregado por categoria + kind (já respeita filtro de API quando aplicado)
  const aggRes = await db.execute(sql.raw(`
    SELECT
      kind,
      category,
      SUM(CAST(amount AS DECIMAL(18,2))) as total,
      MIN(sortOrder) as sortOrder,
      COUNT(*) as occurrences
    FROM manual_apuracao
    ${whereClause}
    GROUP BY kind, category
    ORDER BY kind, total DESC
  `));
  const aggRows = (aggRes as any)[0] ?? [];

  const revenues = aggRows
    .filter((r: any) => r.kind === 'receita')
    .map((r: any) => ({
      category: String(r.category),
      amount: parseFloat(String(r.total ?? 0)),
      occurrences: Number(r.occurrences ?? 0),
    }));
  const expenses = aggRows
    .filter((r: any) => r.kind === 'despesa')
    .map((r: any) => ({
      category: String(r.category),
      amount: parseFloat(String(r.total ?? 0)),
      occurrences: Number(r.occurrences ?? 0),
    }));

  const revenueTotal = revenues.reduce((s: number, r: any) => s + r.amount, 0);
  const expenseTotal = expenses.reduce((s: number, r: any) => s + r.amount, 0);
  const result = revenueTotal - expenseTotal;
  const margin = revenueTotal > 0 ? (result / revenueTotal) * 100 : 0;

  // ── Agregado POR API (sempre retorna ambos, mesmo se filtrou por uma só)
  // Usa o mesmo filtro de PERÍODO (sem filtro de API) — assim o cliente pode
  // mostrar split mesmo quando está olhando uma API específica.
  const apiPeriodConds = conds.filter(c => !c.startsWith('apiSource'));
  const apiWhereClause = apiPeriodConds.length > 0 ? `WHERE ${apiPeriodConds.join(' AND ')}` : '';
  const byApiRes = await db.execute(sql.raw(`
    SELECT
      apiSource,
      kind,
      SUM(CAST(amount AS DECIMAL(18,2))) as total
    FROM manual_apuracao
    ${apiWhereClause}
    GROUP BY apiSource, kind
  `));
  const byApiRows = (byApiRes as any)[0] ?? [];
  const byApi = {
    expag:    { revenue: 0, expense: 0, result: 0, margin: 0 },
    cinqbank: { revenue: 0, expense: 0, result: 0, margin: 0 },
  };
  for (const r of byApiRows) {
    const api = String(r.apiSource) as 'expag' | 'cinqbank';
    if (!byApi[api]) continue;
    const value = parseFloat(String(r.total ?? 0));
    if (r.kind === 'receita') byApi[api].revenue = value;
    else if (r.kind === 'despesa') byApi[api].expense = value;
  }
  // Calcula result/margin de cada API
  for (const api of Object.keys(byApi) as Array<'expag' | 'cinqbank'>) {
    byApi[api].result = byApi[api].revenue - byApi[api].expense;
    byApi[api].margin = byApi[api].revenue > 0
      ? (byApi[api].result / byApi[api].revenue) * 100
      : 0;
  }

  // Série mensal (respeita filtro de API se aplicado)
  const seriesRes = await db.execute(sql.raw(`
    SELECT
      referenceMonth,
      SUM(CASE WHEN kind = 'receita' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as revenue,
      SUM(CASE WHEN kind = 'despesa' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END) as expense
    FROM manual_apuracao
    ${params.apiSource ? `WHERE apiSource = '${params.apiSource}'` : ''}
    GROUP BY referenceMonth
    ORDER BY referenceMonth ASC
  `));
  const monthlySeries = ((seriesRes as any)[0] ?? []).map((r: any) => {
    const rev = parseFloat(String(r.revenue ?? 0));
    const exp = parseFloat(String(r.expense ?? 0));
    return {
      month: r.referenceMonth,
      revenue: rev,
      expense: exp,
      result: rev - exp,
    };
  });

  return {
    mode: params.mode,
    period: periodLabel,
    apiSource: params.apiSource ?? null,
    totals: { revenue: revenueTotal, expense: expenseTotal, result, margin },
    byApi,
    revenues,
    expenses,
    monthlySeries,
  };
}
