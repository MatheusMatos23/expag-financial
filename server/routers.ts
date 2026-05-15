import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { notifyOwner } from "./_core/notification";
import * as db from "./db";
import { processIngestion } from "./modules/ingestion";
import { runReconciliationEngine } from "./modules/reconciliation/engine";
import { classifyDivergence } from "./modules/divergence/classifier";
import { audit } from "./modules/audit/logger";
import { parseStatement } from "./reconciliation/parsers";
import { sql } from "drizzle-orm";

// ─── CONCILIAÇÃO ROUTER ───────────────────────────────────────────────────────
const reconciliationRouter = router({
  getSessions: protectedProcedure.query(async () => {
    return db.getReconciliationSessions(30);
  }),

  deleteSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteReconciliationSession(input.id);
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
        return { name: b.name, txs, useE2E: b.name === "jd" };
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

      // Filtrar API: remove internos e filtra datas
      const apiTxs = allApiTxs.filter(t => bankDates.has(t.date) && !t.isInternal);

      // Rodar conciliação multi-banco (SEM as tarifas bancárias)
      const { reconcileMultiBank } = await import("./reconciliation/engine");
      const result = reconcileMultiBank(parsedBanksClean, apiTxs);

      // Salvar sessão
      const sessionId = await db.createReconciliationSession({
        userId: ctx.user.id,
        referenceDate: input.referenceDate,
      });

      // Persistir transações de cada banco
      for (const bank of parsedBanks) {
        for (const tx of bank.txs) {
          await db.createBankTransaction({
            sessionId, type: tx.type,
            transactionDate: tx.date, description: tx.description,
            amount: tx.amount.toFixed(2), channel: tx.channel,
            bankName: bank.name, externalId: tx.externalId,
          });
        }
      }

      // Persistir transações da API
      for (const tx of apiTxs) {
        await db.createApiTransaction({
          sessionId, type: tx.type,
          transactionDate: tx.date, description: tx.description,
          amount: tx.amount.toFixed(2), channel: tx.channel,
          clientName: tx.clientName, externalId: tx.externalId,
        });
      }

      // Criar divergências — com classificação inteligente por tipo
      const BANK_LABELS: Record<string, string> = { sicoob: "Sicoob", bb: "Banco do Brasil", jd: "JD" };

      for (const match of result.matches) {
        if (match.status === "divergent") {
          await db.createDivergence({
            sessionId, divergenceDate: match.bankTx.date,
            bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName,
            clientName: match.apiTx?.clientName ?? match.bankTx.clientName,
            divergenceType: match.bankTx.amount > (match.apiTx?.amount ?? 0) ? "bank_surplus" : "bank_shortage",
            amount: String(match.difference?.toFixed(2) ?? "0"),
            origin: match.bankTx.externalId,
            externalId: match.bankTx.externalId,
            category: "liquidacao_divergente", priority: "high",
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

      for (const { bankName, tx } of bankTariffTxs) {
        await db.createExpense({
          referenceDate: tx.date,
          category: "bancaria",
          subcategory: "tarifa_bancaria",
          description: tx.description,
          amount: tx.amount.toFixed(2),
          supplier: BANK_LABELS[bankName] ?? bankName,
          status: "realizado",
          sessionId,
          origin: "auto_tariff",
          createdByName: "Conciliação Automática",
        });
        autoDespesaCount++;
      }

      // ── Tarifas na API (isTariff=true, unmatched) ─────────────────────────
      // → Lança automaticamente como RECEITA e não cria divergência
      for (const tx of result.unmatchedApi) {
        const isTariff = tx.isTariff ?? tx.channel === "TARIFA";

        if (isTariff) {
          await db.createRevenue({
            referenceDate: tx.date,
            type: "receita_operacional",
            description: tx.description || tx.channel,
            amount: tx.amount.toFixed(2),
            clientName: tx.clientName,
            status: "realizado",
            sessionId,
            origin: "auto_tariff",
            createdByName: "Conciliação Automática",
          });
          autoReceitaCount++;
          continue; // não cria divergência
        }

        // Transações reais sem par → divergência normal
        const category = tx.type === "credit" ? "receita_nao_lancada" : "despesa_nao_lancada";
        const priority = tx.amount > 1000 ? "high" : "medium";

        await db.createDivergence({
          sessionId, divergenceDate: tx.date,
          bankName: "API",
          clientName: tx.clientName,
          divergenceType: "bank_shortage",
          amount: tx.amount.toFixed(2),
          apiAmount: tx.amount.toFixed(2),
          origin: tx.externalId,
          externalId: tx.externalId,
          apiDescription: tx.description,
          category,
          priority,
          transactionType: tx.type,
        });
      }

      // ── Divergências do banco (unmatched_bank sem tarifa) ─────────────────
      // As entradas com tarifa já foram lançadas como despesa acima — pular
      for (const match of result.matches) {
        if (match.status !== "unmatched_bank") continue;
        if (isBankTariff(match.bankTx.description)) continue; // já tratado acima

        await db.createDivergence({
          sessionId, divergenceDate: match.bankTx.date,
          bankName: BANK_LABELS[match.bankName ?? ""] ?? match.bankName,
          clientName: match.bankTx.clientName,
          divergenceType: "bank_surplus",
          amount: match.bankTx.amount.toFixed(2),
          bankAmount: match.bankTx.amount.toFixed(2),
          origin: match.bankTx.externalId,
          externalId: match.bankTx.externalId,
          bankDescription: match.bankTx.description,
          category: match.bankTx.type === "credit" ? "receita_nao_lancada" : "despesa_nao_lancada",
          priority: match.bankTx.amount > 1000 ? "high" : "medium",
          transactionType: match.bankTx.type,
          observation: match.possibleMatchNote ?? undefined,
        });
      }

      // Atualizar sessão
      await db.updateReconciliationSession(sessionId, {
        status: "completed",
        totalBankCredits: result.summary.totalBankCredits.toFixed(2),
        totalBankDebits:  result.summary.totalBankDebits.toFixed(2),
        totalApiCredits:  result.summary.totalApiCredits.toFixed(2),
        totalApiDebits:   result.summary.totalApiDebits.toFixed(2),
        matchedCount:     result.summary.matchedCount,
        divergentCount:   result.summary.divergentCount + result.summary.unmatchedBankCount + result.summary.unmatchedApiCount,
        pendingCount:     0,
      });

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

      audit({ action: 'reconciliation.start', sessionId, userId: ctx.user.id,
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

          audit({ action: 'divergence.created', sessionId,
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

          audit({ action: 'divergence.created', sessionId,
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
        audit({ action: 'reconciliation.complete', sessionId, userId: ctx.user.id, durationMs: processingMs,
          metadata: { ...engineResult.stats, criticalDivergences, totalDivergenceAmount, ingestionSummary: ingested.summary } });

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
        audit({ action: 'reconciliation.error', sessionId, userId: ctx.user.id,
          metadata: { error: String(err) } });
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

  deleteDivergence: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: sqlTag } = await import("drizzle-orm");
      await dbConn.execute(sqlTag`DELETE FROM divergences WHERE id = ${input.id}`);
      return { success: true };
    }),

  // ── NDI — Não Identificados ───────────────────────────────────────────────
  markAsNdi: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      ndiNote: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.markDivergencesAsNdi(input.ids, input.ndiNote);
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

  deleteRevenue: protectedProcedure
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

  deleteExpense: protectedProcedure
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

  deletePayable: protectedProcedure
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
    .mutation(async ({ input }) => {
      await db.updatePayableStatus(input.id, 'pago', input.paidDate ?? new Date().toISOString().split('T')[0]);
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

  deleteLoan: protectedProcedure
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

  deleteManagerialBalance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteManagerialBalance(input.id); return { success: true }; }),

  deleteDRE: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await db.deleteDRE(input.id); return { success: true }; }),

  deleteCashFlow: protectedProcedure
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

  deleteCostCenter: protectedProcedure
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

  acknowledgeAlert: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.acknowledgeAlert(input.id, ctx.user.id);
      return { success: true };
    }),

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
