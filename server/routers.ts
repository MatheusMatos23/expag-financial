import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, adminProcedure, publicProcedure, router } from "./_core/trpc";
import { audit } from "./_core/auditHelper";
import { notifyOwner } from "./_core/notification";
import * as db from "./db";
import { processIngestion } from "./modules/ingestion";
import { runReconciliationEngine } from "./modules/reconciliation/engine";
import { classifyDivergence } from "./modules/divergence/classifier";
import { audit as auditLog } from "./modules/audit/logger";
import { parseStatement } from "./reconciliation/parsers";
import { sql } from "drizzle-orm";

// ─── CONCILIAÇÃO ROUTER ───────────────────────────────────────────────────────

// ── Helper: recalcula pendingCount da sessão após regularizações ──────────────
async function updateSessionPendingCount(sessionId: number | undefined) {
  if (!sessionId) return;
  const dbConn = await db.getDb();
  if (!dbConn) return;
  const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
  const { reconciliationSessions } = await import("../drizzle/schema");
  const pending = await dbConn.execute(sqlTag`
    SELECT COUNT(*) as cnt FROM divergences
    WHERE sessionId = ${sessionId}
    AND status NOT IN ('regularizado','reclassificado','baixado')
  `);
  const matched = await dbConn.execute(sqlTag`
    SELECT COUNT(*) as cnt FROM bank_transactions
    WHERE sessionId = ${sessionId} AND matchStatus IN ('matched','manual')
  `);
  const pendingCount = parseInt(String((pending as any)[0]?.[0]?.cnt ?? 0));
  const matchedCount = parseInt(String((matched as any)[0]?.[0]?.cnt ?? 0));
  await dbConn.update(reconciliationSessions)
    .set({ pendingCount, matchedCount })
    .where(eqOp(reconciliationSessions.id, sessionId));
}

const reconciliationRouter = router({
  getSessions: protectedProcedure.query(async () => {
    return db.getReconciliationSessions(30);
  }),

  deleteSession: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteReconciliationSession(input.id);
      db.invalidateReconciliationCache(); // limpa cache de saldo por banco
      await audit(ctx, {
        action: "reconciliation.delete", category: "conciliacao",
        entityType: "session", entityId: input.id,
        summary: `Excluiu a sessão de conciliação #${input.id}`,
      });
      return { success: true };
    }),

  getSessionTransactions: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const session = await db.getReconciliationSessionById(input.id);
      if (!session) return null;
      const [bankTxs, apiTxs, divs] = await Promise.all([
        db.getBankTransactionsBySession(input.id),
        db.getApiTransactionsBySession(input.id),
        db.getDivergences({ sessionId: input.id }),
      ]);
      return { session, bankTxs, apiTxs, divs };
    }),

  // ── Novo: parse de extrato bancário (base64 XLSX) ──────────────────────────
  parseStatementFile: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      bank: z.enum(["sicoob", "bb", "jd", "api"]),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const transactions = parseStatement(buffer, input.bank);
      return { transactions, count: transactions.length };
    }),

  // ── Novo: conciliar múltiplos bancos vs API ────────────────────────────────
  runReconciliation: protectedProcedure
    .input(z.object({
      referenceDate: z.string(),
      apiFileBase64: z.string(),
      banks: z.array(z.object({
        name: z.enum(["sicoob", "bb", "jd"]),
        fileBase64: z.string(),
      })).min(1).max(3),
    }))
    .mutation(async ({ input, ctx }) => {
      const apiBuffer = Buffer.from(input.apiFileBase64, "base64");
      const allApiTxs = parseStatement(apiBuffer, "api");

      // Parse cada banco
      const parsedBanks = input.banks.map(b => {
        const buffer = Buffer.from(b.fileBase64, "base64");
        const txs = parseStatement(buffer, b.name);
        // Sicoob também tem END2END em alguns PIX — habilita E2E quando disponível
      const hasE2E = txs.some(t => t.externalId && /^E[A-Z0-9]{28,}$/i.test(t.externalId));
      return { name: b.name, txs, useE2E: b.name === "jd" || (b.name === "sicoob" && hasE2E) };
      });

      // Detectar datas presentes nos extratos bancários (expandido para ±1 dia de lag de liquidação)
      const bankDatesRaw = new Set(parsedBanks.flatMap(b => b.txs.map(t => t.date)));
      const bankDates = new Set<string>();
      for (const d of Array.from(bankDatesRaw)) {
        bankDates.add(d);
        // D-1 e D+1 para cobrir lag de liquidação
        const dt = new Date(d + "T12:00:00Z");
        const dm1 = new Date(dt); dm1.setUTCDate(dt.getUTCDate() - 1);
        const dp1 = new Date(dt); dp1.setUTCDate(dt.getUTCDate() + 1);
        bankDates.add(dm1.toISOString().slice(0, 10));
        bankDates.add(dp1.toISOString().slice(0, 10));
      }

      // ── Palavras-chave de tarifa bancária ────────────────────────────────────
      // Tarifas do banco NUNCA devem ser matcheadas com a API — vão direto para Despesas
      const BANK_TARIFF_KEYWORDS = [
        "tarifa", "taxa", "manutenção", "manutencao", "anuidade",
        "iof", "cpmf", "comissão bancária", "comissao bancaria",
        "encargo", "serviço bancário", "servico bancario",
        "débito serviço cobrança", "debito servico cobranca",
        "tar doc/ted", "tar doc ted", "ted eletronico", "ted eletrônico",
        "cobrança bancária", "cobranca bancaria",
        "tarifa guia", "cod barra", "cód barra", "guia cobrança",
        "tarifa boleto", "emissão boleto", "emissao boleto",
        "tarifa pix", "tarifa ted", "tarifa manut",
      ];
      const isBankTariff = (desc: string) =>
        BANK_TARIFF_KEYWORDS.some(k => desc.toLowerCase().includes(k));

      // ── Pre-filtro: separa tarifas bancárias ANTES do engine ──────────────
      // Tarifas identificadas aqui nunca entram no engine → nunca são matcheadas com API
      const bankTariffTxs: Array<{ bankName: string; tx: any }> = [];
      const parsedBanksClean = parsedBanks.map(bank => ({
        ...bank,
        txs: bank.txs.filter(tx => {
          if (isBankTariff(tx.description)) {
            bankTariffTxs.push({ bankName: bank.name, tx });
            return false; // remove do engine
          }
          return true;
        }),
      }));

      // Filtrar API: remove internos, tarifas e filtra datas
      // isTariff=true NUNCA deve entrar no engine — vai direto para receitas
      // isInternal=true são transferências entre contas próprias
      const apiTxsForEngine = allApiTxs.filter(t =>
        bankDates.has(t.date) && !t.isInternal && !t.isTariff
      );
      // Tarifas separadas para criar receitas depois (sem passar pelo engine)
      const apiTariffTxs = allApiTxs.filter(t =>
        bankDates.has(t.date) && !t.isInternal && t.isTariff
      );
      const apiTxs = apiTxsForEngine; // alias para manter compatibilidade

      // Rodar conciliação multi-banco (SEM as tarifas bancárias)
      const { reconcileMultiBank } = await import("./reconciliation/engine");
      const result = reconcileMultiBank(parsedBanksClean, apiTxs);

      // Salvar sessão
      const sessionId = await db.createReconciliationSession({
        userId: ctx.user.id,
        referenceDate: input.referenceDate,
      });

      // ── BATCH INSERT: banco + API (104x mais rápido que loop individual) ─────
      const matchedExternalIds = new Set<string>();
      const matchedApiExternalIds = new Set<string>();
      // Mapa de date+amount+type → matched para fallback sem externalId
      const matchedByDat = new Set<string>();
      for (const match of result.matches) {
        if (match.status !== "matched") continue;
        if (match.bankTx.externalId) matchedExternalIds.add(match.bankTx.externalId);
        else matchedByDat.add(`${match.bankTx.date}|${match.bankTx.amount.toFixed(2)}|${match.bankTx.type}|${match.bankName ?? ""}`);
        if (match.apiTx?.externalId) matchedApiExternalIds.add(match.apiTx.externalId);
      }

      // ── BANK TRANSACTIONS BATCH ───────────────────────────────────────────────
      // IMPORTANTE: usar parsedBanksClean (sem tarifas) + bankTariffTxs separadas
      // parsedBanks inclui tarifas → se usar parsedBanks aqui AND bankTariffTxs abaixo
      // as tarifas são contadas em dobro (bug: 1880+105 = 1985 em vez de 1880)
      const bankRows: Parameters<typeof db.insertBankTransactionsBatch>[0] = [];

      // Transações reais (sem tarifas) — matchStatus do engine
      for (const bank of parsedBanksClean) {
        for (const tx of bank.txs) {
          const key = `${tx.date}|${tx.amount.toFixed(2)}|${tx.type}|${bank.name}`;
          const isMatched = (tx.externalId && matchedExternalIds.has(tx.externalId)) || matchedByDat.has(key);
          bankRows.push({
            sessionId, type: tx.type, transactionDate: tx.date,
            description: tx.description, amount: tx.amount.toFixed(2),
            channel: tx.channel, bankName: bank.name, externalId: tx.externalId,
            matchStatus: isMatched ? "matched" : "divergent",
          });
        }
      }
      // Tarifas bancárias — adicionadas uma única vez com matchStatus='manual'
      for (const { bankName, tx } of bankTariffTxs) {
        bankRows.push({
          sessionId, type: tx.type, transactionDate: tx.date,
          description: tx.description, amount: tx.amount.toFixed(2),
          channel: tx.channel, bankName, externalId: tx.externalId,
          matchStatus: "manual",
        });
      }
      await db.insertBankTransactionsBatch(bankRows);

      const apiRows: Parameters<typeof db.insertApiTransactionsBatch>[0] = [];
      // Engine txs: com matchStatus real
      for (const tx of apiTxsForEngine) {
        const isMatched = tx.externalId ? matchedApiExternalIds.has(tx.externalId) : false;
        apiRows.push({
          sessionId, type: tx.type, transactionDate: tx.date,
          description: tx.description, amount: tx.amount.toFixed(2),
          channel: tx.channel, clientName: tx.clientName, externalId: tx.externalId,
          matchStatus: isMatched ? "matched" : "divergent",
        });
      }
      // Tarifas API: sempre manual (auto-classificadas como receita)
      for (const tx of apiTariffTxs as any[]) {
        apiRows.push({
          sessionId, type: tx.type, transactionDate: tx.date,
          description: tx.description, amount: tx.amount.toFixed(2),
          channel: tx.channel, clientName: tx.clientName, externalId: tx.externalId,
          matchStatus: "manual",
        });
      }
      await db.insertApiTransactionsBatch(apiRows);

      // ── BATCH INSERT: divergências ────────────────────────────────────────────
      const BANK_LABELS: Record<string, string> = { sicoob: "Sicoob", bb: "Banco do Brasil", jd: "JD" };
      const divRows: Parameters<typeof db.insertDivergencesBatch>[0] = [];

      for (const match of result.matches) {
        if (match.status === "divergent") {
          const divType = match.bankTx.amount > (match.apiTx?.amount ?? 0) ? "bank_surplus" : "bank_shortage";
          const classified = classifyDivergence({
            divergenceType: divType,
            amount: String(match.difference?.toFixed(2) ?? "0"),
            description: match.bankTx.description,
            channel: match.bankTx.channel ?? null,
            bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName ?? null,
            clientId: null,
            clientName: match.apiTx?.clientName ?? match.bankTx.clientName ?? null,
            referenceDate: match.bankTx.date,
          });
          divRows.push({
            sessionId, divergenceDate: match.bankTx.date,
            bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName,
            clientName: match.apiTx?.clientName ?? match.bankTx.clientName,
            divergenceType: divType,
            amount: String(match.difference?.toFixed(2) ?? "0"),
            origin: match.bankTx.externalId,
            externalId: match.bankTx.externalId,
            category: classified.category,
            priority: classified.priority,
            observation: classified.suggestedAction,
            bankDescription: match.bankTx.description,
            apiDescription: match.apiTx?.description,
            bankAmount: match.bankTx.amount.toFixed(2),
            apiAmount: match.apiTx?.amount.toFixed(2),
            transactionType: match.bankTx.type,
          });
        }
      }

      // ── Dedup: limpa auto-tarifas anteriores desta sessão antes de recriar ──
      const dbConn = await db.getDb();
      if (dbConn) {
        try { await dbConn.execute(sql`DELETE FROM expenses WHERE sessionId = ${sessionId} AND origin = 'auto_tariff'`); } catch {}
        try { await dbConn.execute(sql`DELETE FROM revenues WHERE sessionId = ${sessionId} AND origin = 'auto_tariff'`); } catch {}
      }

      // ── Tarifas bancárias (pré-filtradas antes do engine) ─────────────────
      // → Lança automaticamente como DESPESA sem criar divergência
      let autoDespesaCount = 0;
      let autoReceitaCount = 0;

      // ── BATCH: tarifas bancárias → despesas ──────────────────────────────────
      const tariffExpenseRows = bankTariffTxs.map(({ bankName, tx }) => ({
        referenceDate: tx.date,
        category: "bancaria",
        subcategory: "tarifa_bancaria",
        description: tx.description,
        amount: tx.amount.toFixed(2),
        supplier: BANK_LABELS[bankName] ?? bankName,
        sessionId,
        origin: "auto_tariff",
        createdByName: "Conciliação Automática",
      }));
      await db.insertExpensesBatch(tariffExpenseRows);
      autoDespesaCount = tariffExpenseRows.length;

      // ── BATCH: tarifas API → receitas (pré-separadas antes do engine) ─────────
      // result.unmatchedApi já não contém tarifas (filtradas em apiTxsForEngine)
      const tariffRevRows: Parameters<typeof db.insertRevenuesBatch>[0] = apiTariffTxs.map((tx: any) => ({
        referenceDate: tx.date, type: "receita_operacional",
        description: tx.description || tx.channel,
        amount: tx.amount.toFixed(2), clientName: tx.clientName,
        sessionId, origin: "auto_tariff", createdByName: "Conciliação Automática",
      }));

      // Não-tarifas sem par no engine → divergências
      for (const tx of result.unmatchedApi) {
        const classified3 = classifyDivergence({
          divergenceType: "bank_shortage",
          amount: tx.amount.toFixed(2),
          description: tx.description,
          channel: tx.channel ?? null,
          bankName: "API",
          clientId: null,
          clientName: tx.clientName ?? null,
          referenceDate: tx.date,
        });
        divRows.push({
          sessionId, divergenceDate: tx.date,
          bankName: "API",
          clientName: tx.clientName,
          divergenceType: "bank_shortage",
          amount: tx.amount.toFixed(2),
          apiAmount: tx.amount.toFixed(2),
          origin: tx.externalId,
          externalId: tx.externalId,
          apiDescription: tx.description,
          category: classified3.category,
          priority: classified3.priority,
          transactionType: tx.type,
          observation: classified3.suggestedAction,
        });
      }

      // ── FLUSH: receitas de tarifa + divergências em batch ──────────────────
      await db.insertRevenuesBatch(tariffRevRows);
      autoReceitaCount = tariffRevRows.length;

      // ── unmatched_bank → divergências (sem tarifa, com classifier) ──────────
      for (const match of result.matches) {
        if (match.status !== "unmatched_bank") continue;
        if (isBankTariff(match.bankTx.description)) continue;
        const classified2 = classifyDivergence({
          divergenceType: "bank_surplus",
          amount: match.bankTx.amount.toFixed(2),
          description: match.bankTx.description,
          channel: match.bankTx.channel ?? null,
          bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName ?? null,
          clientId: null,
          clientName: match.bankTx.clientName ?? null,
          referenceDate: match.bankTx.date,
        });
        divRows.push({
          sessionId, divergenceDate: match.bankTx.date,
          bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName,
          clientName: match.bankTx.clientName,
          divergenceType: "bank_surplus",
          amount: match.bankTx.amount.toFixed(2),
          bankAmount: match.bankTx.amount.toFixed(2),
          origin: match.bankTx.externalId,
          externalId: match.bankTx.externalId,
          bankDescription: match.bankTx.description,
          category: classified2.category,
          priority: classified2.priority,
          transactionType: match.bankTx.type,
          observation: match.possibleMatchNote ?? classified2.suggestedAction ?? undefined,
        });
      }

      // ── FLUSH FINAL: todas as divergências em batch ───────────────────────
      await db.insertDivergencesBatch(divRows);

      // ── Contagens reais após todos os inserts ─────────────────────────────
      // realDivergentCount = divergências reais criadas (não tarifas)
      // realMatchedCount   = transações matchadas pelo engine
      // realTotalBank      = total de bank_transactions (sem duplicatas)
      const realDivergentCount = divRows.length;
      const realMatchedCount   = result.summary.matchedCount;
      const realTotalBank      = bankRows.length; // parsedBanksClean + tarifas (correto)

      // Atualizar sessão
      await db.updateReconciliationSession(sessionId, {
        status: "completed",
        totalBankCredits: result.summary.totalBankCredits.toFixed(2),
        totalBankDebits:  result.summary.totalBankDebits.toFixed(2),
        totalApiCredits:  result.summary.totalApiCredits.toFixed(2),
        totalApiDebits:   result.summary.totalApiDebits.toFixed(2),
        matchedCount:     realMatchedCount,
        divergentCount:   realDivergentCount,   // conta real da tabela divergences
        pendingCount:     realDivergentCount,    // igual ao criado inicialmente
      });

      db.invalidateReconciliationCache(); // atualiza cache após nova conciliação
      db.generateSystemAlerts().catch(() => {}); // gera alertas em background
      return {
        sessionId, result,
        bankDates: Array.from(bankDates).sort(),
        apiFilteredCount: apiTxs.length,
        banksProcessed: parsedBanks.map(b => ({ name: b.name, count: b.txs.length })),
      };
    }),

  getSessionById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const session = await db.getReconciliationSessionById(input.id);
      if (!session) return null;
      const [bankCredits, bankDebits, apiCredits, apiDebits] = await Promise.all([
        db.getBankTransactionsBySession(input.id, 'credit'),
        db.getBankTransactionsBySession(input.id, 'debit'),
        db.getApiTransactionsBySession(input.id, 'credit'),
        db.getApiTransactionsBySession(input.id, 'debit'),
      ]);
      return { session, bankCredits, bankDebits, apiCredits, apiDebits };
    }),

  processExcel: protectedProcedure
    .input(z.object({
      referenceDate: z.string(),
      bankCreditsData: z.array(z.record(z.string(), z.unknown())),
      bankDebitsData: z.array(z.record(z.string(), z.unknown())),
      apiCreditsData: z.array(z.record(z.string(), z.unknown())),
      apiDebitsData: z.array(z.record(z.string(), z.unknown())),
    }))
    .mutation(async ({ input, ctx }) => {
      const t0 = Date.now();

      // ── 1. Create session ──
      const sessionId = await db.createReconciliationSession({
        userId: ctx.user.id,
        referenceDate: input.referenceDate,
      });

      auditLog({ action: 'reconciliation.start', sessionId, userId: ctx.user.id,
        metadata: { referenceDate: input.referenceDate } });

      try {
        // ── 2. Ingestion: normalize, validate, deduplicate ──
        const ingested = processIngestion({
          sessionId,
          userId: ctx.user.id,
          referenceDate: input.referenceDate,
          bankCreditsRaw: input.bankCreditsData,
          bankDebitsRaw: input.bankDebitsData,
          apiCreditsRaw: input.apiCreditsData,
          apiDebitsRaw: input.apiDebitsData,
        });

        // ── 3. Persist normalized transactions ──
        const toBank = (tx: typeof ingested.bankCredits[0], type: 'credit' | 'debit') => ({
          sessionId, type, transactionDate: tx.transactionDate,
          description: tx.description, amount: tx.amount,
          channel: tx.channel ?? undefined,
          bankName: tx.bankName ?? undefined,
          externalId: tx.externalId ?? undefined,
        });
        const toApi = (tx: typeof ingested.apiCredits[0], type: 'credit' | 'debit') => ({
          sessionId, type, transactionDate: tx.transactionDate,
          description: tx.description, amount: tx.amount,
          channel: tx.channel ?? undefined,
          clientId: tx.clientId ?? undefined,
          clientName: tx.clientName ?? undefined,
          externalId: tx.externalId ?? undefined,
        });

        await Promise.all([
          ingested.bankCredits.length > 0 && db.insertBankTransactions(ingested.bankCredits.map(t => toBank(t, 'credit'))),
          ingested.bankDebits.length > 0  && db.insertBankTransactions(ingested.bankDebits.map(t => toBank(t, 'debit'))),
          ingested.apiCredits.length > 0  && db.insertApiTransactions(ingested.apiCredits.map(t => toApi(t, 'credit'))),
          ingested.apiDebits.length > 0   && db.insertApiTransactions(ingested.apiDebits.map(t => toApi(t, 'debit'))),
        ]);

        // ── 4. Load persisted transactions (with auto-generated IDs) ──
        const [bankCredits, bankDebits, apiCredits, apiDebits] = await Promise.all([
          db.getBankTransactionsBySession(sessionId, 'credit'),
          db.getBankTransactionsBySession(sessionId, 'debit'),
          db.getApiTransactionsBySession(sessionId, 'credit'),
          db.getApiTransactionsBySession(sessionId, 'debit'),
        ]);

        // ── 5. Run high-performance reconciliation engine ──
        const bankAll = [...bankCredits, ...bankDebits];
        const apiAll  = [...apiCredits, ...apiDebits];

        const engineResult = runReconciliationEngine(bankAll, apiAll);

        // ── 6. Batch-update matched transactions ──
        await Promise.all(
          engineResult.matches.map(async (match) => {
            await Promise.all([
              db.updateBankTransactionMatch(match.bankId, {
                matchStatus: 'matched',
                matchedApiTransactionId: match.apiId,
                matchType: match.matchType,
              }),
              db.updateApiTransactionMatch(match.apiId, {
                matchStatus: 'matched',
                matchedBankTransactionId: match.bankId,
                matchType: match.matchType,
              }),
            ]);
          })
        );

        // ── 7. Create divergences with enhanced auto-classification ──
        let criticalDivergences = 0;
        let totalDivergenceAmount = 0;

        // Unmatched bank transactions → bank_surplus
        const bankMap = new Map(bankAll.map(t => [t.id, t]));
        const apiMap  = new Map(apiAll.map(t => [t.id, t]));

        for (const bankId of engineResult.unmatchedBankIds) {
          const bt = bankMap.get(bankId)!;
          const classified = classifyDivergence({
            divergenceType: 'bank_surplus',
            amount: String(bt.amount),
            description: bt.description,
            channel: bt.channel,
            bankName: bt.bankName,
            referenceDate: input.referenceDate,
          });

          await db.createDivergence({
            sessionId, divergenceDate: input.referenceDate,
            bankName: bt.bankName ?? undefined,
            divergenceType: 'bank_surplus', amount: String(bt.amount),
            origin: bt.channel ?? undefined, category: classified.category,
            priority: classified.priority, slaDeadline: classified.slaDeadline,
            bankTransactionId: bt.id,
          });

          const amount = parseFloat(String(bt.amount));
          totalDivergenceAmount += amount;
          if (classified.priority === 'critical') criticalDivergences++;

          auditLog({ action: 'divergence.created', sessionId,
            metadata: { type: 'bank_surplus', bankId, amount, category: classified.category, priority: classified.priority } });
        }

        // Unmatched API transactions → bank_shortage
        for (const apiId of engineResult.unmatchedApiIds) {
          const at = apiMap.get(apiId)!;
          const classified = classifyDivergence({
            divergenceType: 'bank_shortage',
            amount: String(at.amount),
            description: at.description,
            channel: at.channel,
            bankName: null,
            clientId: at.clientId,
            clientName: at.clientName,
            referenceDate: input.referenceDate,
          });

          await db.createDivergence({
            sessionId, divergenceDate: input.referenceDate,
            clientId: at.clientId ?? undefined, clientName: at.clientName ?? undefined,
            divergenceType: 'bank_shortage', amount: String(at.amount),
            origin: at.channel ?? undefined, category: classified.category,
            priority: classified.priority, slaDeadline: classified.slaDeadline,
            apiTransactionId: at.id,
          });

          const amount = parseFloat(String(at.amount));
          totalDivergenceAmount += amount;
          if (classified.priority === 'critical') criticalDivergences++;

          auditLog({ action: 'divergence.created', sessionId,
            metadata: { type: 'bank_shortage', apiId, amount, category: classified.category, priority: classified.priority } });
        }

        // ── 8. Update session summary ──
        const totalBankCredits = bankCredits.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const totalBankDebits  = bankDebits.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const totalApiCredits  = apiCredits.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
        const totalApiDebits   = apiDebits.reduce((s, t) => s + parseFloat(String(t.amount)), 0);

        await db.updateReconciliationSession(sessionId, {
          status: 'completed',
          totalBankCredits: totalBankCredits.toFixed(2),
          totalBankDebits: totalBankDebits.toFixed(2),
          totalApiCredits: totalApiCredits.toFixed(2),
          totalApiDebits: totalApiDebits.toFixed(2),
          matchedCount: engineResult.stats.matched,
          divergentCount: engineResult.unmatchedBankIds.length + engineResult.unmatchedApiIds.length,
          pendingCount: 0,
        });

        // ── 9. Alerts for critical divergences ──
        if (criticalDivergences > 0) {
          await notifyOwner({
            title: `⚠️ Divergências Críticas Detectadas`,
            content: `Conciliação de ${input.referenceDate}: ${criticalDivergences} divergências críticas totalizando R$ ${totalDivergenceAmount.toFixed(2)}.`,
          });
          await db.createAlert({
            type: 'critical_divergence',
            title: 'Divergências Críticas na Conciliação',
            message: `${criticalDivergences} divergências críticas na conciliação de ${input.referenceDate} — R$ ${totalDivergenceAmount.toFixed(2)}`,
            severity: 'critical',
            referenceId: sessionId,
            referenceType: 'reconciliation_session',
          });
        }

        const processingMs = Date.now() - t0;
        await audit(ctx, {
          action: "reconciliation.create", category: "conciliacao",
          entityType: "session", entityId: sessionId,
          summary: `Processou a conciliação de ${input.referenceDate} — ${engineResult.stats.matched} conciliados, ${engineResult.stats.matchRate}% de taxa`,
          metadata: { ...engineResult.stats, criticalDivergences, totalDivergenceAmount, processingMs },
        });

        return {
          sessionId,
          matchedCount: engineResult.stats.matched,
          divergentCount: engineResult.unmatchedBankIds.length + engineResult.unmatchedApiIds.length,
          pendingCount: 0,
          criticalDivergences,
          totalDivergenceAmount,
          matchRate: engineResult.stats.matchRate,
          avgConfidence: engineResult.stats.avgConfidence,
          engine: engineResult.stats,
          ingestion: ingested.summary,
          processingMs,
        };

      } catch (err) {
        await db.updateReconciliationSession(sessionId, { status: 'error' });
        await audit(ctx, {
          action: "reconciliation.error", category: "conciliacao",
          entityType: "session", entityId: sessionId,
          summary: `Erro ao processar conciliação de ${input.referenceDate}`,
          metadata: { error: String(err) },
        });
        throw err;
      }
    }),

  getDivergences: protectedProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getDivergences(input);
    }),

  updateDivergence: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.string(),
      responsible: z.string().optional(),
      observation: z.string().optional(),
      actionTaken: z.string().optional(),
      slaDeadline: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.updateDivergenceStatus(input.id, input);
      return { success: true };
    }),

  deleteDivergence: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
      const { reconciliationSessions } = await import("../drizzle/schema");
      // Busca sessão antes de deletar
      const divData = await dbConn.execute(sqlTag`SELECT sessionId, bankTransactionId, externalId FROM divergences WHERE id = ${input.id} LIMIT 1`);
      const div = (divData as any)[0]?.[0];
      await dbConn.execute(sqlTag`DELETE FROM divergences WHERE id = ${input.id}`);
      // Atualiza bank_transaction para divergent (não mais matched)
      if (div?.bankTransactionId) {
        await dbConn.execute(sqlTag`UPDATE bank_transactions SET matchStatus = 'divergent' WHERE id = ${div.bankTransactionId}`);
      }
      // Recalcula stats da sessão
      if (div?.sessionId) {
        const pending = await dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${div.sessionId} AND status NOT IN ('regularizado','reclassificado','baixado')`);
        const pendingCount = parseInt(String((pending as any)[0]?.[0]?.cnt ?? 0));
        const matched = await dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${div.sessionId} AND matchStatus IN ('matched','manual')`);
        const matchedCount = parseInt(String((matched as any)[0]?.[0]?.cnt ?? 0));
        await dbConn.update(reconciliationSessions).set({ pendingCount, matchedCount }).where(eqOp(reconciliationSessions.id, div.sessionId));
      }
      return { success: true };
    }),

  // ── Recalcula e corrige stats + remove tarifas duplicadas (sessões antigas) ──
  recalculateSessionStats: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: sqlTag } = await import("drizzle-orm");
      const { reconciliationSessions } = await import("../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Detecta duplicatas: mesmo sessionId + bankName + amount + date
      // Uma com matchStatus='manual' (tarifa adicionada duas vezes) e outra 'divergent'
      // Mantém a cópia 'manual' (correta) e remove a 'divergent' duplicada
      const dupCheck = await dbConn.execute(sqlTag`
        SELECT COUNT(*) as cnt FROM bank_transactions t1
        INNER JOIN bank_transactions t2
          ON t1.sessionId = t2.sessionId
          AND t1.bankName = t2.bankName
          AND t1.amount = t2.amount
          AND CAST(t1.transactionDate AS DATE) = CAST(t2.transactionDate AS DATE)
          AND t1.id != t2.id
          AND t1.matchStatus = 'divergent'
          AND t2.matchStatus = 'manual'
        WHERE t1.sessionId = ${input.id}
      `);
      const dupCount = parseInt(String((dupCheck as any)[0]?.[0]?.cnt ?? 0));

      if (dupCount > 0) {
        // Remove as cópias 'divergent' de tarifas duplicadas
        await dbConn.execute(sqlTag`
          DELETE t1 FROM bank_transactions t1
          INNER JOIN bank_transactions t2
            ON t1.sessionId = t2.sessionId
            AND t1.bankName = t2.bankName
            AND t1.amount = t2.amount
            AND CAST(t1.transactionDate AS DATE) = CAST(t2.transactionDate AS DATE)
            AND t1.id > t2.id
            AND t1.matchStatus = 'divergent'
            AND t2.matchStatus = 'manual'
          WHERE t1.sessionId = ${input.id}
        `);
      }

      // Recontar após limpeza
      const [totalRes, matchedRes, pendingRes, totalDivRes] = await Promise.all([
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id}`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id} AND matchStatus = 'matched'`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id} AND status NOT IN ('regularizado','reclassificado','baixado')`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id}`),
      ]);

      const totalBank   = parseInt(String((totalRes   as any)[0]?.[0]?.cnt ?? 0));
      const matchedBank = parseInt(String((matchedRes as any)[0]?.[0]?.cnt ?? 0));
      const pending     = parseInt(String((pendingRes as any)[0]?.[0]?.cnt ?? 0));
      const totalDivs   = parseInt(String((totalDivRes as any)[0]?.[0]?.cnt ?? 0));
      const matchRate   = totalBank > 0 ? Math.round((matchedBank / totalBank) * 100) : 0;

      await dbConn.update(reconciliationSessions)
        .set({ matchedCount: matchedBank, divergentCount: totalDivs, pendingCount: pending })
        .where(eqOp(reconciliationSessions.id, input.id));

      return { matchedCount: matchedBank, divergentCount: totalDivs, pendingCount: pending, matchRate, totalBank, fixedDuplicates: dupCount };
    }),

  // ── Stats em tempo real da sessão ────────────────────────────────────────────
  getSessionStats: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) return null;
      const { sql: sqlTag } = await import("drizzle-orm");

      // Conta transações reais (excluindo tarifas 'manual' do denominador para matchRate correto)
      const [totalRealRes, totalAllRes, matchedRes, pendingRes, sessionRes] = await Promise.all([
        // Transações reais = não são tarifas auto (matchStatus != 'manual' OU channel != 'TARIFA')
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id} AND (matchStatus != 'manual' OR matchType IS NULL)`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id}`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id} AND matchStatus IN ('matched','manual')`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id} AND status NOT IN ('regularizado','reclassificado','baixado')`),
        dbConn.execute(sqlTag`SELECT matchedCount, divergentCount, pendingCount FROM reconciliation_sessions WHERE id = ${input.id} LIMIT 1`),
      ]);

      const totalRealTxs    = parseInt(String((totalRealRes as any)[0]?.[0]?.cnt ?? 0));
      const totalAllTxs     = parseInt(String((totalAllRes  as any)[0]?.[0]?.cnt ?? 0));
      const matchedBankTxs  = parseInt(String((matchedRes   as any)[0]?.[0]?.cnt ?? 0));
      const pendingDivs     = parseInt(String((pendingRes   as any)[0]?.[0]?.cnt ?? 0));
      const sessionRow      = (sessionRes as any)[0]?.[0];
      const sessionMatched  = parseInt(String(sessionRow?.matchedCount   ?? 0));
      const sessionDivergent= parseInt(String(sessionRow?.divergentCount ?? 0));

      // matchRate correto:
      // - Numerador: matched (pelo engine) — NÃO inclui tarifas auto
      // - Denominador: transações reais (sem tarifas) — para refletir qualidade real do matching
      // Para sessões novas: matchedRealTxs = matched (sem manual/tarifa) / totalRealTxs
      const matchedRealTxs = await dbConn.execute(sqlTag`
        SELECT COUNT(*) as cnt FROM bank_transactions
        WHERE sessionId = ${input.id} AND matchStatus = 'matched'
      `);
      const matchedOnlyReal = parseInt(String((matchedRealTxs as any)[0]?.[0]?.cnt ?? 0));

      // ── Fórmula ÚNICA e consistente para matchRate ───────────────────────────
      // Numerador: matchStatus='matched' (apenas engine matches, sem tarifas auto)
      // Denominador: total de bank_transactions da sessão (após remoção de duplicatas)
      // Fallback para sessões sem bank_transactions (legacy pré-sistema novo)
      let effectiveMatched: number;
      let effectiveTotal: number;

      if (totalAllTxs > 0) {
        effectiveMatched = matchedOnlyReal;       // apenas engine-matched
        effectiveTotal   = totalAllTxs;           // total real no banco
      } else {
        // Legacy: sem bank_transactions no DB
        effectiveMatched = sessionMatched;
        effectiveTotal   = sessionMatched + sessionDivergent;
      }

      const matchRate     = effectiveTotal > 0 ? Math.round((effectiveMatched / effectiveTotal) * 100) : 0;
      const realDivergent = effectiveTotal - effectiveMatched;

      return {
        totalCount:    effectiveTotal,
        matchedCount:  effectiveMatched,
        pendingCount:  pendingDivs,
        matchRate,
        divergentCount: Math.max(0, realDivergent),
      };
    }),

  // ── Conciliação Manual ────────────────────────────────────────────────────
  manualReconcile: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      note: z.string().min(1),
      sessionId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.manualReconcileDivergences(
        input.ids,
        input.note,
        ctx.user?.name ?? ctx.user?.email ?? 'Usuário'
      );
      await updateSessionPendingCount(input.sessionId);
      await audit(ctx, {
        action: "divergence.manual_reconcile", category: "divergencia",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Conciliou manualmente ${input.ids.length} divergência(s)`,
        metadata: { ids: input.ids, note: input.note },
      });
      return result;
    }),

  // ── Saldo diário dos bancos ───────────────────────────────────────────────
  getDailyBankBalances: protectedProcedure
    .query(async () => db.getDailyBankBalances()),

  getBankBalancesByBank: protectedProcedure
    .query(async () => db.getBankBalancesByBank()),

  // ── Resolver NDI (identificar cliente) ───────────────────────────────────
  resolveNdi: protectedProcedure
    .input(z.object({
      id: z.number(),
      clientName: z.string().min(1),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const r = await db.resolveNdi(input.id, {
        clientName: input.clientName,
        description: input.description ?? '',
        createdByName: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "ndi.resolve", category: "ndi",
        entityType: "divergence", entityId: input.id,
        summary: `Identificou NDI #${input.id} — cliente: ${input.clientName}`,
        metadata: { clientName: input.clientName },
      });
      return r;
    }),

  // ── NDI — Não Identificados ───────────────────────────────────────────────
  // ── Editar NDI (nota, data encontrada) ───────────────────────────────────
  updateNdi: protectedProcedure
    .input(z.object({
      id: z.number(),
      ndiNote: z.string().optional(),
      ndiFoundDate: z.string().optional(),   // data em que o valor foi identificado
      ndiClientName: z.string().optional(),  // cliente suspeito (sem confirmar)
      priority: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: sqlTag } = await import("drizzle-orm");
      await dbConn.execute(sqlTag`
        UPDATE divergences SET
          ndiNote       = ${input.ndiNote ?? null},
          ndiFoundDate  = ${input.ndiFoundDate ?? null},
          ndiClientName = ${input.ndiClientName ?? null},
          priority      = ${input.priority as any ?? 'high'}
        WHERE id = ${input.id}
      `);
      return { success: true };
    }),

  markAsNdi: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      ndiNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.markDivergencesAsNdi(input.ids, input.ndiNote);
      await audit(ctx, {
        action: "ndi.mark", category: "ndi",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Marcou ${input.ids.length} divergência(s) como NDI`,
        metadata: { ids: input.ids },
      });
      return { success: true };
    }),

  unmarkNdi: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.unmarkNdi(input.id);
      return { success: true };
    }),

  getNdiDivergences: protectedProcedure
    .query(async () => db.getNdiDivergences()),

  // ── Ajuste Manual de Saldo ────────────────────────────────────────────────
  createManualAdjustment: protectedProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      description: z.string(),
      adjustmentType: z.enum(['bank_split','api_split','rounding','manual']).optional(),
      apiAmount: z.string(),
      bankAmounts: z.array(z.number()).min(1),
      divergenceIds: z.array(z.number()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createManualAdjustment({
        ...input,
        createdByName: ctx.user?.name ?? ctx.user?.email ?? 'Sistema',
      });
      return { success: true, id };
    }),

  getManualAdjustments: protectedProcedure
    .input(z.object({ sessionId: z.number().optional() }))
    .query(async ({ input }) => db.getManualAdjustments(input.sessionId)),

  // ── Mover divergências para Receitas (bulk) ──────────────────────────────
  moveDivergencesToRevenue: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      type: z.string(),
      description: z.string().optional(),
      clientName: z.string().optional(),
      sessionId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const revenueIds = await db.moveDivergencesToRevenue(input.ids, {
        type: input.type,
        description: input.description,
        clientName: input.clientName,
        sessionId: input.sessionId,
        createdByName: ctx.user?.name ?? 'Sistema',
      });
      await updateSessionPendingCount(input.sessionId);
      await audit(ctx, {
        action: "divergence.move_to_revenue", category: "divergencia",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Moveu ${input.ids.length} divergência(s) para Receitas (${input.type})`,
        metadata: { ids: input.ids, type: input.type },
      });
      return { success: true, revenueIds };
    }),

  // ── Mover divergências para Despesas (bulk) ───────────────────────────────
  moveDivergencesToExpense: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      category: z.string(),
      subcategory: z.string().optional(),
      description: z.string().optional(),
      supplier: z.string().optional(),
      sessionId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const expenseIds = await db.moveDivergencesToExpense(input.ids, {
        category: input.category,
        subcategory: input.subcategory,
        description: input.description,
        supplier: input.supplier,
        sessionId: input.sessionId,
        createdByName: ctx.user?.name ?? 'Sistema',
      });
      await updateSessionPendingCount(input.sessionId);
      await audit(ctx, {
        action: "divergence.move_to_expense", category: "divergencia",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Moveu ${input.ids.length} divergência(s) para Despesas (${input.category})`,
        metadata: { ids: input.ids, category: input.category },
      });
      return { success: true, expenseIds };
    }),

  getManagerialBalance: protectedProcedure.query(async () => {
    return db.getLatestManagerialBalance();
  }),

  getManagerialBalanceHistory: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => {
      return db.getManagerialBalances(input.days);
    }),

  upsertManagerialBalance: protectedProcedure
    .input(z.object({
      referenceDate: z.string(),
      bankBalance: z.string(),
      clientBalance: z.string(),
      committedBalance: z.string(),
      divergenceBalance: z.string(),
      thirdPartyResources: z.string().optional(),
      futureObligations: z.string().optional(),
      fundingNeeded: z.string().optional(),
      openDivergences: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.upsertManagerialBalance(input);
      // Check for low cash alert
      const balance = parseFloat(input.bankBalance) - parseFloat(input.clientBalance) - parseFloat(input.committedBalance);
      const minCash = parseFloat(await db.getSystemConfig('min_cash_threshold') ?? '10000');
      if (balance < minCash) {
        await notifyOwner({
          title: `🚨 Caixa Real Abaixo do Limite Mínimo`,
          content: `Caixa Real atual: R$ ${balance.toFixed(2)} - Limite mínimo configurado: R$ ${minCash.toFixed(2)}`,
        });
        await db.createAlert({
          type: 'cash_shortage', severity: 'critical',
          title: 'Caixa Real Abaixo do Limite Mínimo',
          message: `Caixa Real: R$ ${balance.toFixed(2)} (Mínimo: R$ ${minCash.toFixed(2)})`,
        });
      }
      return { success: true };
    }),
});

// ─── CONTROLADORIA ROUTER ─────────────────────────────────────────────────────
const controllershipRouter = router({
  getRevenues: protectedProcedure
    .input(z.object({
      dateFrom: z.string().optional(), dateTo: z.string().optional(),
      type: z.string().optional(), status: z.string().optional(),
      origin: z.string().optional(),
    }))
    .query(async ({ input }) => db.getRevenues(input)),

  createRevenue: protectedProcedure
    .input(z.object({
      referenceDate: z.string(), type: z.string(), description: z.string().optional(),
      amount: z.string(), clientId: z.string().optional(), clientName: z.string().optional(),
      status: z.string().optional(), costCenterId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createRevenue({ ...input, createdByName: ctx.user.name ?? ctx.user.email ?? undefined });
      return { id };
    }),

  updateRevenue: protectedProcedure
    .input(z.object({
      id: z.number(), referenceDate: z.string().optional(), type: z.string().optional(),
      description: z.string().optional(), amount: z.string().optional(),
      clientName: z.string().optional(), status: z.string().optional(),
    }))
    .mutation(async ({ input }) => { await db.updateRevenue(input.id, input); return { success: true }; }),

  deleteRevenue: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteRevenue(input.id); return { success: true }; }),

  getExpenses: protectedProcedure
    .input(z.object({
      dateFrom: z.string().optional(), dateTo: z.string().optional(),
      category: z.string().optional(), status: z.string().optional(),
      origin: z.string().optional(),
    }))
    .query(async ({ input }) => db.getExpenses(input)),

  createExpense: protectedProcedure
    .input(z.object({
      referenceDate: z.string(), category: z.string(), subcategory: z.string().optional(),
      description: z.string().optional(), amount: z.string(), supplier: z.string().optional(),
      status: z.string().optional(), costCenterId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createExpense({ ...input, createdByName: ctx.user.name ?? ctx.user.email ?? undefined });
      return { id };
    }),

  updateExpense: protectedProcedure
    .input(z.object({
      id: z.number(), referenceDate: z.string().optional(), category: z.string().optional(),
      description: z.string().optional(), amount: z.string().optional(),
      supplier: z.string().optional(), status: z.string().optional(),
    }))
    .mutation(async ({ input }) => { await db.updateExpense(input.id, input); return { success: true }; }),

  deleteExpense: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteExpense(input.id); return { success: true }; }),

  getPayables: protectedProcedure
    .input(z.object({
      status: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => db.getPayables(input)),

  createPayable: protectedProcedure
    .input(z.object({
      description: z.string(), supplier: z.string().optional(), category: z.string(),
      amount: z.string(), dueDate: z.string(), recurrent: z.boolean().optional(),
      recurrenceDay: z.number().optional(), notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createPayable({ ...input, createdByName: ctx.user.name ?? ctx.user.email ?? undefined });
      return { id };
    }),

  updatePayableStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.string(), paidDate: z.string().optional() }))
    .mutation(async ({ input }) => {
      await db.updatePayableStatus(input.id, input.status, input.paidDate);
      return { success: true };
    }),

  deletePayable: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deletePayable(input.id);
      return { success: true };
    }),
  updatePayable: protectedProcedure
    .input(z.object({
      id: z.number(), dueDate: z.string().optional(), description: z.string().optional(),
      category: z.string().optional(), amount: z.string().optional(),
      supplier: z.string().optional(), notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => { await db.updatePayable(input.id, input); return { success: true }; }),

  markPayablePaid: protectedProcedure
    .input(z.object({ id: z.number(), paidDate: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const paidDate = input.paidDate ?? new Date().toISOString().split('T')[0];
      await db.updatePayableStatus(input.id, 'pago', paidDate);

      // Gera despesa automaticamente ao marcar como pago
      const dbConn = await db.getDb();
      if (dbConn) {
        const { payables } = await import("../drizzle/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        const payableData = await dbConn.select().from(payables).where(eqOp(payables.id, input.id)).limit(1);
        const p = payableData[0];
        if (p && parseFloat(String(p.amount ?? 0)) > 0) {
          await db.createExpense({
            referenceDate: paidDate,
            category: 'operacional',
            subcategory: 'conta_a_pagar',
            description: String(p.description ?? p.category ?? 'Conta a pagar').slice(0, 200),
            amount: String(p.amount),
            supplier: String(p.supplier ?? ''),
            status: 'realizado',
            createdByName: ctx.user?.name ?? 'Sistema',
            origin: 'manual',
          });
        }
      }
      return { success: true };
    }),
  updateLoan: protectedProcedure
    .input(z.object({
      id: z.number(), status: z.string().optional(), outstandingBalance: z.string().optional(),
      paidInstallments: z.number().optional(), notes: z.string().optional(),
      principal: z.string().optional(), interestRate: z.string().optional(),
      totalInstallments: z.number().optional(), expectedEndDate: z.string().optional(),
      fundingSource: z.string().optional(),
    }))
    .mutation(async ({ input }) => { await db.updateCreditPortfolio(input.id, input); return { success: true }; }),

  deleteLoan: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteCreditPortfolio(input.id); return { success: true }; }),

  getLoans: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => db.getCreditPortfolio(input)),
  getLoanSummary: protectedProcedure
    .query(async () => {
      const credits = await db.getCreditPortfolio({});
      const total = credits.reduce((s: number, c: any) => s + parseFloat(c.principal ?? '0'), 0);
      const active = credits.filter((c: any) => c.status === 'ativo').length;
      return { total: total.toFixed(2), active, count: credits.length };
    }),
  createLoan: protectedProcedure
    .input(z.object({
      clientId: z.string(), clientName: z.string(), principal: z.string(),
      interestRate: z.string(), totalInstallments: z.number(),
      startDate: z.string(), expectedEndDate: z.string(),
      fundingSource: z.string().optional(), notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const creditId = await db.createCreditEntry(input);
      const principal = parseFloat(input.principal);
      const rate = parseFloat(input.interestRate) / 100;
      const n = input.totalInstallments;
      const monthlyPayment = rate > 0
        ? principal * (rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1)
        : principal / n;
      const startDate = new Date(input.startDate);
      const installments = [];
      let balance = principal;
      for (let i = 1; i <= n; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        const interest = balance * rate;
        const principalPart = monthlyPayment - interest;
        balance -= principalPart;
        installments.push({ creditId, installmentNumber: i, dueDate: dueDate.toISOString().split('T')[0], principalAmount: principalPart.toFixed(2), interestAmount: interest.toFixed(2), totalAmount: monthlyPayment.toFixed(2) });
      }
      await db.createCreditInstallments(installments);
      return { creditId };
    }),

  getCreditPortfolio: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => db.getCreditPortfolio(input)),

  // Registrar pagamento de parcela da carteira de crédito
  recordInstallmentPayment: protectedProcedure
    .input(z.object({
      installmentId: z.number(),
      creditId: z.number(),
      paidAmount:    z.string(),           // valor total pago pelo cliente
      paidDate:      z.string(),
      paidPrincipal: z.string().optional(), // amortização real (pode diferir da calculada)
      paidInterest:  z.string().optional(), // juros reais (pode diferir do calculado)
      paidPenalty:   z.string().optional(), // multa/mora por atraso
      notes:         z.string().optional(),
      clientName:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { eq: eqOp } = await import("drizzle-orm");
      const { creditInstallments, creditPortfolio, revenues } = await import("../drizzle/schema");

      // Busca parcela original para referência
      const installments = await dbConn.select().from(creditInstallments)
        .where(eqOp(creditInstallments.id, input.installmentId)).limit(1);
      const inst = installments[0];
      if (!inst) throw new Error("Parcela não encontrada");

      // Valores reais do pagamento (usa os editados pelo usuário ou os calculados)
      const realInterest  = parseFloat(input.paidInterest  ?? String(inst.interestAmount  ?? 0));
      const realPrincipal = parseFloat(input.paidPrincipal ?? String(inst.principalAmount ?? 0));
      const realPenalty   = parseFloat(input.paidPenalty   ?? "0");
      const realTotal     = parseFloat(input.paidAmount);
      const creditName    = input.clientName ?? String(inst.installmentNumber);

      // Marca parcela como paga com valores reais
      await dbConn.update(creditInstallments)
        .set({
          status: 'pago',
          paidDate:   input.paidDate as unknown as Date,
          paidAmount: input.paidAmount,
        })
        .where(eqOp(creditInstallments.id, input.installmentId));

      // Cria receita de juros (valor real)
      if (realInterest > 0) {
        await dbConn.insert(revenues).values({
          referenceDate: input.paidDate as unknown as Date,
          type: 'receita_financeira' as any,
          description: `Juros parcela #${inst.installmentNumber}${input.notes ? ` — ${input.notes}` : ''}`,
          amount: realInterest.toFixed(2),
          clientId: String(input.creditId),
          clientName: creditName,
          status: 'realizado' as any,
          createdByName: ctx.user?.name ?? 'Sistema',
          origin: 'manual',
        });
      }

      // Cria receita de amortização (valor real)
      if (realPrincipal > 0) {
        await dbConn.insert(revenues).values({
          referenceDate: input.paidDate as unknown as Date,
          type: 'receita_financeira' as any,
          description: `Amortização parcela #${inst.installmentNumber}${input.notes ? ` — ${input.notes}` : ''}`,
          amount: realPrincipal.toFixed(2),
          clientId: String(input.creditId),
          clientName: creditName,
          status: 'realizado' as any,
          createdByName: ctx.user?.name ?? 'Sistema',
          origin: 'manual',
        });
      }

      // Cria receita de multa/mora se houver
      if (realPenalty > 0) {
        await dbConn.insert(revenues).values({
          referenceDate: input.paidDate as unknown as Date,
          type: 'receita_financeira' as any,
          description: `Multa/mora parcela #${inst.installmentNumber}`,
          amount: realPenalty.toFixed(2),
          clientId: String(input.creditId),
          clientName: creditName,
          status: 'realizado' as any,
          createdByName: ctx.user?.name ?? 'Sistema',
          origin: 'manual',
        });
      }

      // Verifica se todas as parcelas foram pagas → crédito = quitado
      const allInstallments = await dbConn.select().from(creditInstallments)
        .where(eqOp(creditInstallments.creditId, input.creditId));
      const allPaid = allInstallments.every(i => i.status === 'pago' || i.id === input.installmentId);
      if (allPaid) {
        await dbConn.update(creditPortfolio)
          .set({ status: 'quitado' })
          .where(eqOp(creditPortfolio.id, input.creditId));
      }

      return { success: true, realTotal, realInterest, realPrincipal };
    }),

  getCreditInstallments: protectedProcedure
    .input(z.object({ creditId: z.number() }))
    .query(async ({ input }) => db.getCreditInstallments(input.creditId)),

   getControllershipDashboard: protectedProcedure
    .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
    .query(async ({ input }) => db.getControllershipDashboard(input.dateFrom, input.dateTo)),

  getRevenueSummary: protectedProcedure
    .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
    .query(async ({ input }) => {
      const rawData = await db.getRevenueSummary(input.dateFrom, input.dateTo);
      const byType = Array.isArray(rawData) ? rawData : (rawData as any).byType ?? [];
      const allRevenues = await db.getRevenues({ dateFrom: input.dateFrom, dateTo: input.dateTo });
      const total    = byType.reduce((s: number, r: any) => s + parseFloat(r.total ?? '0'), 0);
      const count    = byType.reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);
      const received = (allRevenues as any[]).filter(r => r.status === 'realizado').reduce((s, r) => s + parseFloat(r.amount ?? '0'), 0);
      const pending  = (allRevenues as any[]).filter(r => r.status === 'previsto').reduce((s, r) => s + parseFloat(r.amount ?? '0'), 0);
      return { byType, total: total.toFixed(2), received: received.toFixed(2), pending: pending.toFixed(2), count };
    }),
  getExpenseSummary: protectedProcedure
    .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
    .query(async ({ input }) => {
      const rawData = await db.getExpenseSummary(input.dateFrom, input.dateTo);
      const byCategory = Array.isArray(rawData) ? rawData : (rawData as any).byCategory ?? [];
      const allExpenses = await db.getExpenses({ dateFrom: input.dateFrom, dateTo: input.dateTo });
      const total   = byCategory.reduce((s: number, r: any) => s + parseFloat(r.total ?? '0'), 0);
      const count   = byCategory.reduce((s: number, r: any) => s + Number(r.count ?? 0), 0);
      const paid    = (allExpenses as any[]).filter(e => e.status === 'realizado').reduce((s, e) => s + parseFloat(e.amount ?? '0'), 0);
      const pending = (allExpenses as any[]).filter(e => e.status === 'previsto').reduce((s, e) => s + parseFloat(e.amount ?? '0'), 0);
      return { byCategory, total: total.toFixed(2), paid: paid.toFixed(2), pending: pending.toFixed(2), count };
    }),
});

// ─── CONTABILIDADE ROUTER ─────────────────────────────────────────────────────
const accountingRouter = router({
  getDRE: protectedProcedure
    .input(z.object({ months: z.number().default(12) }))
    .query(async ({ input }) => db.getDRE(input.months)),

  upsertDRE: protectedProcedure
    .input(z.object({
      referenceMonth: z.string(), grossRevenue: z.string().optional(),
      netRevenue: z.string().optional(), financialCosts: z.string().optional(),
      operationalCosts: z.string().optional(), adminExpenses: z.string().optional(),
      commercialExpenses: z.string().optional(), taxes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.upsertDRE(input);
      return { success: true };
    }),

  getCashFlow: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => db.getCashFlow(input.days)),

  upsertCashFlow: protectedProcedure
    .input(z.object({
      referenceDate: z.string(), openingBalance: z.string().optional(),
      projectedInflows: z.string().optional(), realizedInflows: z.string().optional(),
      projectedOutflows: z.string().optional(), realizedOutflows: z.string().optional(),
      fundingNeeded: z.string().optional(),
      projectionD7: z.string().optional(), projectionD15: z.string().optional(), projectionD30: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.upsertCashFlow(input);
      // Check funding need
      const opening = parseFloat(input.openingBalance ?? '0');
      const realIn = parseFloat(input.realizedInflows ?? '0');
      const realOut = parseFloat(input.realizedOutflows ?? '0');
      const closing = opening + realIn - realOut;
      if (closing < 0) {
        await notifyOwner({
          title: `🚨 Funding Insuficiente`,
          content: `Fluxo de caixa de ${input.referenceDate} indica necessidade de funding de R$ ${Math.abs(closing).toFixed(2)}`,
        });
        await db.createAlert({
          type: 'insufficient_funding', severity: 'critical',
          title: 'Funding Insuficiente',
          message: `Necessidade de funding de R$ ${Math.abs(closing).toFixed(2)} em ${input.referenceDate}`,
        });
      }
      return { success: true };
    }),

  deleteManagerialBalance: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteManagerialBalance(input.id); return { success: true }; }),

  deleteDRE: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteDRE(input.id); return { success: true }; }),

  deleteCashFlow: adminProcedure
    .input(z.object({ referenceDate: z.string() }))
    .mutation(async ({ input }) => { await db.deleteCashFlow(input.referenceDate); return { success: true }; }),

  getCostCenters: protectedProcedure.query(async () => db.getCostCenters()),

  getCostCenterSummary: protectedProcedure
    .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
    .query(async ({ input }) => db.getCostCenterSummary(input.dateFrom, input.dateTo)),

  createCostCenter: protectedProcedure
    .input(z.object({ name: z.string(), type: z.string(), description: z.string().optional(), budget: z.string().optional() }))
    .mutation(async ({ input }) => {
      const id = await db.createCostCenter(input);
      return { id };
    }),

  updateCostCenter: protectedProcedure
    .input(z.object({ id: z.number(), name: z.string().optional(), type: z.string().optional(), description: z.string().optional(), budget: z.string().optional() }))
    .mutation(async ({ input }) => { await db.updateCostCenter(input.id, input); return { success: true }; }),

  deleteCostCenter: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteCostCenter(input.id);
      return { success: true };
    }),
});

// ─── DASHBOARD ROUTER ─────────────────────────────────────────────────────────
const dashboardRouter = router({
  getSummary: protectedProcedure
    .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
    .query(async ({ input }) => db.getDashboardSummary(input.dateFrom, input.dateTo)),

  getAlerts: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => db.getAlerts(input.status)),

  // Gera alertas automáticos verificando estado geral do sistema
  generateAlerts: protectedProcedure
    .mutation(async () => {
      const result = await db.generateSystemAlerts();
      return result;
    }),

  acknowledgeAlert: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.acknowledgeAlert(input.id, ctx.user.id);
      return { success: true };
    }),

  dismissAlert: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: s } = await import("drizzle-orm");
      await dbConn.execute(s`UPDATE alerts SET status = 'resolved' WHERE id = ${input.id}`);
      return { success: true };
    }),



  // ── Log de Auditoria ──────────────────────────────────────────────────────
  getAuditLogs: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      userId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => db.getAuditLogs(input)),

  getAuditStats: protectedProcedure
    .query(async () => db.getAuditStats()),

  getSystemConfig: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => db.getSystemConfig(input.key)),

  setSystemConfig: protectedProcedure
    .input(z.object({ key: z.string(), value: z.string(), description: z.string().optional() }))
    .mutation(async ({ input }) => {
      await db.setSystemConfig(input.key, input.value, input.description);
      return { success: true };
    }),
});

// ─── APP ROUTER ───────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  reconciliation: reconciliationRouter,
  controllership: controllershipRouter,
  accounting: accountingRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
