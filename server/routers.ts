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
import { parseStatement, parseStatementResilient } from "./reconciliation/parsers";
import { sql } from "drizzle-orm";

// ─── CONCILIAÇÃO ROUTER ───────────────────────────────────────────────────────

// ── Helper: recalcula pendingCount da sessão após regularizações ──────────────
async function updateSessionPendingCount(sessionId: number | undefined, divergenceIds?: number[]) {
  const dbConn = await db.getDb();
  if (!dbConn) return;
  const { sql: sqlTag, eq: eqOp } = await import("drizzle-orm");
  const { reconciliationSessions } = await import("../drizzle/schema");

  // Se sessionId não foi fornecido, tenta descobrir a partir das divergências.
  // Isso resolve o caso em que o frontend opera na tela global de Divergências
  // e não passa sessionId — antes, a atualização era silenciosamente pulada.
  let sid = sessionId;
  if (!sid && divergenceIds && divergenceIds.length > 0) {
    const rows = await dbConn.execute(sqlTag`
      SELECT DISTINCT sessionId FROM divergences
      WHERE id IN (${sqlTag.raw(divergenceIds.join(","))}) AND sessionId IS NOT NULL
      LIMIT 5
    `);
    const sessionIds = ((rows as any)[0] ?? []).map((r: any) => r.sessionId).filter(Boolean);
    // Se todas as divergências são da mesma sessão, atualiza essa sessão.
    // Se múltiplas sessões → atualiza todas (raro, mas correto).
    for (const s of sessionIds) {
      await updateSessionPendingCount(s);
    }
    if (sessionIds.length > 0) return; // já processou recursivamente
  }

  if (!sid) return; // sem sessionId e sem divergenceIds → nada a fazer

  const pending = await dbConn.execute(sqlTag`
    SELECT COUNT(*) as cnt FROM divergences
    WHERE sessionId = ${sid}
    AND status NOT IN ('regularizado','reclassificado','baixado')
  `);
  const matched = await dbConn.execute(sqlTag`
    SELECT COUNT(*) as cnt FROM bank_transactions
    WHERE sessionId = ${sid} AND matchStatus IN ('matched','manual')
  `);
  const pendingCount = parseInt(String((pending as any)[0]?.[0]?.cnt ?? 0));
  const matchedCount = parseInt(String((matched as any)[0]?.[0]?.cnt ?? 0));
  await dbConn.update(reconciliationSessions)
    .set({ pendingCount, matchedCount })
    .where(eqOp(reconciliationSessions.id, sid));
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB DE CONCILIAÇÃO — processamento em segundo plano
// Recebe a sessão já criada (status 'processing') e executa parse + engine +
// persistência. Em caso de erro, faz rollback completo (atomicidade).
// ═══════════════════════════════════════════════════════════════════════════
async function processReconciliationJob(
  sessionId: number,
  input: {
    referenceDate: string;
    apiFileBase64: string;
    banks: Array<{ parserType: "sicoob" | "bb" | "jd" | "generic"; displayName: string; fileBase64: string }>;
  },
  ctx: any,
): Promise<void> {
  const t0 = Date.now();
  try {
    const apiBuffer = Buffer.from(input.apiFileBase64, "base64");
    const allApiTxsRaw = parseStatement(apiBuffer, "api");

    // ── CONTAS DEDICADAS (COD 220/221) ──────────────────────────────────────
    // Regra de negócio: certas contas da API são usadas SÓ para pagamento.
    // Tudo que SAI (débito) dessas contas é despesa direta — não entra na
    // conciliação. Tudo que ENTRA (crédito) é inesperado → vira divergência
    // para o usuário justificar.
    //
    // COD 220 → Despesas Gerais (categoria operacional)
    // COD 221 → Folha de Pagamento (categoria folha)
    //
    // (Futuramente isso vira uma tela de configuração — por ora chumbado.)
    const DEDICATED_ACCOUNTS: Record<string, { category: string; label: string }> = {
      "220": { category: "operacional", label: "Despesas Gerais" },
      "221": { category: "folha",       label: "Folha de Pagamento" },
    };

    const dedicatedDebits: Array<{ tx: any; cfg: { category: string; label: string } }> = [];
    const dedicatedCredits: Array<{ tx: any; cfg: { category: string; label: string } }> = [];
    // Diagnóstico: conta quantas transações vieram com cada COD
    const codDistribution: Record<string, number> = {};
    const allApiTxs = allApiTxsRaw.filter(tx => {
      // Normaliza COD: remove decimais (Excel pode trazer "220.0") e espaços
      const code = String(tx.accountCode ?? "").trim().split(".")[0].split(",")[0];
      codDistribution[code || "(vazio)"] = (codDistribution[code || "(vazio)"] ?? 0) + 1;
      const cfg = DEDICATED_ACCOUNTS[code];
      if (!cfg) return true; // não é conta dedicada → fluxo normal

      // É conta dedicada — separa do fluxo de conciliação
      if (tx.type === "debit") {
        dedicatedDebits.push({ tx, cfg });
      } else {
        dedicatedCredits.push({ tx, cfg });
      }
      return false; // remove do fluxo normal de conciliação
    });
    console.log(`[CONTA DEDICADA] CODs no arquivo:`, JSON.stringify(codDistribution));
    console.log(`[CONTA DEDICADA] ${dedicatedDebits.length} débitos → despesas, ${dedicatedCredits.length} créditos → divergências`);

      // Parse cada banco — parser resiliente (fallback p/ genérico se layout mudou)
      const parsedBanks = input.banks.map(b => {
        const buffer = Buffer.from(b.fileBase64, "base64");
        const txs = parseStatementResilient(buffer, b.parserType);
        // END2END habilita matching exato — JD sempre, demais quando o extrato traz E2E
        const hasE2E = txs.some(t => t.externalId && /^E[A-Z0-9]{28,}$/i.test(t.externalId));
        return {
          name: b.displayName,
          txs,
          useE2E: b.parserType === "jd" || hasE2E,
        };
      });

      // Detectar datas presentes nos extratos bancários (expandido para ±2 dias de lag de liquidação)
      // Antes era ±1, mas Sicoob e BB podem ter lag de 2 dias úteis em TED/DOC.
      const bankDatesRaw = new Set(parsedBanks.flatMap(b => b.txs.map(t => t.date)));
      const bankDates = new Set<string>();
      for (const d of Array.from(bankDatesRaw)) {
        bankDates.add(d);
        const dt = new Date(d + "T12:00:00Z");
        for (const offset of [-2, -1, 1, 2]) {
          const shifted = new Date(dt);
          shifted.setUTCDate(dt.getUTCDate() + offset);
          bankDates.add(shifted.toISOString().slice(0, 10));
        }
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

      // Filtrar API: remove internos, tarifas, depósitos por boleto e filtra datas
      // isTariff=true NUNCA deve entrar no engine — vai direto para receitas
      // isInternal=true são transferências entre contas próprias
      // isBoletoDeposit=true são depósitos por boleto (movimento interno da API)
      const apiTxsForEngine = allApiTxs.filter(t =>
        bankDates.has(t.date) && !t.isInternal && !t.isTariff && !t.isBoletoDeposit
      );
      // Tarifas separadas para criar receitas depois (sem passar pelo engine)
      const apiTariffTxs = allApiTxs.filter(t =>
        bankDates.has(t.date) && !t.isInternal && t.isTariff && !t.isBoletoDeposit
      );
      // ── Transferências internas (TRANSFERÊNCIA ENTRE CONTAS) ──────────────
      // São movimento interno (soma zero) — não conciliam, não viram divergência.
      // Ficam numa lista separada para a aba "Transferências Internas".
      // NÃO inclui as de conta dedicada (COD 220/221) — essas já viraram despesa.
      const apiInternalTxs = allApiTxs.filter(t =>
        bankDates.has(t.date) && t.isInternal && !t.isTariff && !t.isBoletoDeposit
      );
      // ── Depósitos por boleto ──────────────────────────────────────────────
      // Movimento interno da API (não tem par no banco). Não conciliam, não
      // viram divergência. Ficam na aba "Depósito por Boleto" para bater valor.
      const apiBoletoTxs = allApiTxs.filter(t =>
        bankDates.has(t.date) && t.isBoletoDeposit
      );
      const apiTxs = apiTxsForEngine; // alias para manter compatibilidade

      // Rodar conciliação multi-banco (SEM as tarifas bancárias)
      const { reconcileMultiBank } = await import("./reconciliation/engine");
      const result = reconcileMultiBank(parsedBanksClean, apiTxs);

      // Sessão já criada pela mutation (recebida como parâmetro)

      // ── BATCH INSERT: banco + API (104x mais rápido que loop individual) ─────
      const matchedExternalIds = new Set<string>();
      const matchedApiExternalIds = new Set<string>();
      // Mapa de date+amount+type → matched para fallback sem externalId
      const matchedByDat = new Set<string>();

      // CORREÇÃO CRÍTICA: incluir TODOS os pares encontrados pelo engine,
      // não só os "matched" exatos. Quando o engine encontra um par com
      // diferença (status="divergent"), o par EXISTE — a divergência rastreia
      // a diferença de centavos, mas a bank_transaction é CONCILIADA.
      // Antes, só status="matched" entrava no set, e pares com diff > R$1
      // ficavam como matchStatus="divergent" no BD → taxa nunca subia.
      for (const match of result.matches) {
        if (match.status !== "matched" && match.status !== "divergent") continue;
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
          // Tarifas que passaram pelo pre-filtro mas são reconhecidas por isBankTariff
          // → manual (não geram divergência, contam como conciliadas)
          const isTariffFallback = !isMatched && isBankTariff(tx.description);
          bankRows.push({
            sessionId, type: tx.type, transactionDate: tx.date,
            description: tx.description, amount: tx.amount.toFixed(2),
            channel: tx.channel, bankName: bank.name, externalId: tx.externalId,
            matchStatus: isMatched ? "matched" : (isTariffFallback ? "manual" : "divergent"),
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
      // Transferências internas: channel especial + matchStatus 'manual'
      // Não conciliam, não viram divergência — ficam na aba "Transferências Internas".
      for (const tx of apiInternalTxs as any[]) {
        apiRows.push({
          sessionId, type: tx.type, transactionDate: tx.date,
          description: tx.description, amount: tx.amount.toFixed(2),
          channel: "TRANSFERENCIA_INTERNA", clientName: tx.clientName, externalId: tx.externalId,
          matchStatus: "manual",
        });
      }
      // Depósitos por boleto: channel especial + matchStatus 'manual'
      // Movimento interno da API — ficam na aba "Depósito por Boleto".
      for (const tx of apiBoletoTxs as any[]) {
        apiRows.push({
          sessionId, type: tx.type, transactionDate: tx.date,
          description: tx.description, amount: tx.amount.toFixed(2),
          channel: "DEPOSITO_BOLETO", clientName: tx.clientName, externalId: tx.externalId,
          matchStatus: "manual",
        });
      }
      await db.insertApiTransactionsBatch(apiRows);

      // ── GERAR MOVIMENTAÇÕES INTERNAS (automático) ──────────────────────────
      // Agrega TODAS as transações da API por data+operação+processador e
      // popula a aba "Movimentações Internas". Substitui as movimentações
      // automáticas/importadas das mesmas datas (mantém as manuais).
      // Usa allApiTxsRaw (todas as operações, incl. tarifas/transferências).
      try {
        const imResult = await db.generateInternalMovementsFromApi(
          (allApiTxsRaw as any[]).map(tx => ({
            date: tx.date, type: tx.type, amount: tx.amount,
            operationType: tx.operationType, processedBy: tx.processedBy,
            isInternal: tx.isInternal,
          }))
        );
        console.log(`[MOV. INTERNAS] ${imResult.inserted} movimentações geradas da API (datas: ${imResult.replacedDates.join(", ")})`);
      } catch (e) {
        console.error("[MOV. INTERNAS] Erro ao gerar movimentações da API:", e);
      }

      // ── LINK MATCHED PAIRS ─────────────────────────────────────────────────
      // Após os batch inserts, as transações têm IDs do BD mas NÃO têm
      // matchedApiTransactionId/matchedBankTransactionId preenchidos.
      // Este bloco liga os pares para que getMatchedPairs (usado na tab
      // "✓ Conciliados") consiga fazer o JOIN e mostrar os pares.
      //
      // Estratégia: o engine casou por externalId. Usamos o mesmo critério
      // para linkar os IDs do BD.
      const safetyLink = await db.getDb();
      if (safetyLink) {
        // 1) Link por externalId (mais confiável — E2E único)
        await safetyLink.execute(sql`
          UPDATE bank_transactions bt
          INNER JOIN api_transactions at
            ON at.sessionId = bt.sessionId
            AND at.externalId = bt.externalId
            AND bt.externalId IS NOT NULL
            AND at.externalId IS NOT NULL
          SET bt.matchedApiTransactionId = at.id,
              at.matchedBankTransactionId = bt.id
          WHERE bt.sessionId = ${sessionId}
            AND bt.matchStatus IN ('matched', 'manual')
            AND at.matchStatus IN ('matched', 'manual')
            AND bt.matchedApiTransactionId IS NULL
        `);

        // 2) Fallback: link por data + amount + type para pares sem externalId
        await safetyLink.execute(sql`
          UPDATE bank_transactions bt
          INNER JOIN api_transactions at
            ON at.sessionId = bt.sessionId
            AND at.transactionDate = bt.transactionDate
            AND CAST(at.amount AS DECIMAL(18,2)) = CAST(bt.amount AS DECIMAL(18,2))
            AND at.type = bt.type
          SET bt.matchedApiTransactionId = at.id,
              at.matchedBankTransactionId = bt.id
          WHERE bt.sessionId = ${sessionId}
            AND bt.matchStatus IN ('matched', 'manual')
            AND at.matchStatus IN ('matched', 'manual')
            AND bt.matchedApiTransactionId IS NULL
            AND at.matchedBankTransactionId IS NULL
        `);

        // Log resultado
        const [linkCount] = await safetyLink.execute(sql`
          SELECT COUNT(*) as cnt FROM bank_transactions
          WHERE sessionId = ${sessionId}
            AND matchStatus IN ('matched','manual')
            AND matchedApiTransactionId IS NOT NULL
        `) as any;
        console.log(`[RECONCILIATION] Linked ${(linkCount as any)[0]?.cnt ?? 0} matched pairs (bank→api)`);
      }

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

      // ── CONTAS DEDICADAS (COD 220/221) → despesas + divergências ────────────
      // Débitos viram despesas direto. Créditos viram divergências (entrada
      // inesperada numa conta de pagamento → usuário precisa justificar).
      if (dbConn) {
        try { await dbConn.execute(sql`DELETE FROM expenses WHERE sessionId = ${sessionId} AND origin = 'auto_conta_dedicada'`); } catch {}
      }
      const dedicatedExpenseRows = dedicatedDebits.map(({ tx, cfg }) => ({
        referenceDate: tx.date,
        category: cfg.category,
        subcategory: cfg.label,
        description: tx.description || `${cfg.label} — ${tx.clientName ?? "conta dedicada"}`,
        amount: tx.amount.toFixed(2),
        supplier: tx.clientName ?? undefined,
        sessionId,
        origin: "auto_conta_dedicada",
        createdByName: "Conta Dedicada (automático)",
      }));
      if (dedicatedExpenseRows.length > 0) {
        await db.insertExpensesBatch(dedicatedExpenseRows);
        autoDespesaCount += dedicatedExpenseRows.length;
      }
      for (const { tx, cfg } of dedicatedCredits) {
        divRows.push({
          sessionId, divergenceDate: tx.date,
          bankName: "API",
          clientName: tx.clientName,
          divergenceType: "bank_shortage",
          amount: tx.amount.toFixed(2),
          apiAmount: tx.amount.toFixed(2),
          externalId: tx.externalId,
          apiDescription: tx.description,
          category: "outros",
          priority: "high",
          transactionType: tx.type,
          observation: `Crédito inesperado na conta dedicada de ${cfg.label} (COD ${tx.accountCode}) — justifique a entrada.`,
        });
      }

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

      // ════════════════════════════════════════════════════════════════════════
      // ── SAFETY NET: garante consistência entre bank_transactions e divergences
      //
      // Problema histórico: insertDivergencesBatch não inclui bankTransactionId,
      // e o engine pode produzir bank_transactions 'divergent' sem divergência
      // correspondente (orphans). Isso faz os números não baterem entre telas.
      //
      // Este bloco pós-insert resolve tudo de uma vez via SQL:
      // 1) Linka divergências existentes às bank_transactions pela externalId
      // 2) Cria divergências faltantes para orphan bank_transactions
      // 3) Conta os números reais a partir do estado final do BD
      // ════════════════════════════════════════════════════════════════════════
      const safetyDb = await db.getDb();
      if (safetyDb) {
        // 1) LINK: divergências sem bankTransactionId → achar pela externalId ou data+amount
        await safetyDb.execute(sql`
          UPDATE divergences d
          JOIN bank_transactions bt
            ON bt.sessionId = d.sessionId
            AND bt.externalId = d.externalId
            AND bt.externalId IS NOT NULL
            AND d.externalId IS NOT NULL
          SET d.bankTransactionId = bt.id
          WHERE d.sessionId = ${sessionId}
            AND d.bankTransactionId IS NULL
        `);

        // Fallback: link por data + amount + bankName para txs sem externalId
        await safetyDb.execute(sql`
          UPDATE divergences d
          JOIN bank_transactions bt
            ON bt.sessionId = d.sessionId
            AND bt.transactionDate = d.divergenceDate
            AND CAST(bt.amount AS DECIMAL(18,2)) = CAST(d.bankAmount AS DECIMAL(18,2))
            AND bt.bankName = d.bankName
          SET d.bankTransactionId = bt.id
          WHERE d.sessionId = ${sessionId}
            AND d.bankTransactionId IS NULL
            AND d.divergenceType = 'bank_surplus'
            AND d.bankAmount IS NOT NULL
        `);

        // 2) ORPHANS: bank_transactions divergent sem divergência → criar automaticamente
        //
        // CORREÇÃO CRÍTICA: a detecção anterior usava "bt.id NOT IN (bankTransactionId)".
        // Mas quando há transações IDÊNTICAS (mesmo valor/data/banco, sem externalId —
        // ex: vários PIX MESMA TITULARIDADE de R$ 14.999,96 no mesmo dia), o link 1:1
        // via JOIN falha (casa cruzado ou parcial), deixando bank_transactions sem
        // bankTransactionId mesmo JÁ EXISTINDO divergência pra elas. O safety net então
        // criava divergências DUPLICADAS (categoria "outros", sem cliente).
        //
        // Nova lógica: um bank_transaction só é "orphan" se o número de divergências
        // com o MESMO (data, valor, banco) for MENOR que o número de bank_transactions
        // divergentes com esse mesmo (data, valor, banco). Compara por GRUPO, não por ID.
        const [orphanRows] = await safetyDb.execute(sql`
          SELECT bt.id, bt.transactionDate, bt.bankName, bt.amount, bt.description, bt.type, bt.externalId
          FROM bank_transactions bt
          WHERE bt.sessionId = ${sessionId}
            AND bt.matchStatus NOT IN ('matched', 'manual')
            AND bt.id NOT IN (
              SELECT COALESCE(bankTransactionId, 0) FROM divergences WHERE sessionId = ${sessionId}
            )
            -- Só é orphan de verdade se NÃO há divergência suficiente para este grupo
            -- (data + valor + banco). Evita duplicar quando há transações idênticas.
            AND (
              SELECT COUNT(*) FROM divergences d2
              WHERE d2.sessionId = ${sessionId}
                AND d2.divergenceDate = bt.transactionDate
                AND CAST(d2.bankAmount AS DECIMAL(18,2)) = CAST(bt.amount AS DECIMAL(18,2))
                AND COALESCE(d2.bankName,'') = COALESCE(bt.bankName,'')
            ) < (
              SELECT COUNT(*) FROM bank_transactions bt2
              WHERE bt2.sessionId = ${sessionId}
                AND bt2.transactionDate = bt.transactionDate
                AND CAST(bt2.amount AS DECIMAL(18,2)) = CAST(bt.amount AS DECIMAL(18,2))
                AND COALESCE(bt2.bankName,'') = COALESCE(bt.bankName,'')
                AND bt2.matchStatus NOT IN ('matched','manual')
            )
        `) as any;

        if (orphanRows && orphanRows.length > 0) {
          console.log(`[RECONCILIATION] Safety net: criando ${orphanRows.length} divergências para orphan bank_transactions`);
          const orphanDivRows = orphanRows.map((bt: any) => ({
            sessionId,
            divergenceDate: bt.transactionDate,
            bankName: bt.bankName,
            divergenceType: "bank_surplus",
            amount: String(bt.amount),
            bankAmount: String(bt.amount),
            origin: bt.externalId,
            externalId: bt.externalId,
            bankDescription: bt.description,
            category: "outros",
            priority: "medium",
            transactionType: bt.type,
            observation: "Criado automaticamente — bank_transaction sem divergência correspondente",
          }));
          await db.insertDivergencesBatch(orphanDivRows);

          // Link os recém-criados
          await safetyDb.execute(sql`
            UPDATE divergences d
            JOIN bank_transactions bt
              ON bt.sessionId = d.sessionId
              AND bt.transactionDate = d.divergenceDate
              AND CAST(bt.amount AS DECIMAL(18,2)) = CAST(d.bankAmount AS DECIMAL(18,2))
              AND COALESCE(bt.bankName,'') = COALESCE(d.bankName,'')
            SET d.bankTransactionId = bt.id
            WHERE d.sessionId = ${sessionId}
              AND d.bankTransactionId IS NULL
              AND d.divergenceType = 'bank_surplus'
          `);
        }

        // 3) CONTAGENS REAIS do BD (fonte de verdade final)
        const [matchedRes] = await safetyDb.execute(sql`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN matchStatus IN ('matched','manual') THEN 1 ELSE 0 END) as matched
          FROM bank_transactions WHERE sessionId = ${sessionId}
        `) as any;
        const [divCountRes] = await safetyDb.execute(sql`
          SELECT COUNT(*) as cnt FROM divergences
          WHERE sessionId = ${sessionId}
          AND status NOT IN ('regularizado','reclassificado','baixado')
        `) as any;

        const realTotalBank    = parseInt(String(matchedRes[0]?.total ?? 0));
        const realMatchedCount = parseInt(String(matchedRes[0]?.matched ?? 0));
        const realDivergentCount = parseInt(String(divCountRes[0]?.cnt ?? 0));
        const realMatchRate    = realTotalBank > 0 ? Math.round((realMatchedCount / realTotalBank) * 100) : 0;

        console.log(`[RECONCILIATION] ═══ Sessão #${sessionId} — Números finais ═══`);
        console.log(`[RECONCILIATION] banco: ${realMatchedCount} matched + ${realTotalBank - realMatchedCount} divergent = ${realTotalBank} total`);
        console.log(`[RECONCILIATION] divergências ativas: ${realDivergentCount}`);
        console.log(`[RECONCILIATION] taxa: ${realMatchRate}%`);
        console.log(`[RECONCILIATION] orphans criados pelo safety net: ${orphanRows?.length ?? 0}`);

        // Atualizar sessão com números do BD (não das variáveis JS)
        await db.updateReconciliationSession(sessionId, {
          status: "completed",
          totalBankCredits: result.summary.totalBankCredits.toFixed(2),
          totalBankDebits:  result.summary.totalBankDebits.toFixed(2),
          totalApiCredits:  result.summary.totalApiCredits.toFixed(2),
          totalApiDebits:   result.summary.totalApiDebits.toFixed(2),
          matchedCount:     realMatchedCount,
          divergentCount:   realDivergentCount,
          pendingCount:     realDivergentCount,
        });
      } else {
        // Fallback se dbConn não disponível
        const realDivergentCount = divRows.length;
        const realMatchedCount = bankRows.filter(r => r.matchStatus === 'matched' || r.matchStatus === 'manual').length;
        await db.updateReconciliationSession(sessionId, {
          status: "completed",
          totalBankCredits: result.summary.totalBankCredits.toFixed(2),
          totalBankDebits:  result.summary.totalBankDebits.toFixed(2),
          totalApiCredits:  result.summary.totalApiCredits.toFixed(2),
          totalApiDebits:   result.summary.totalApiDebits.toFixed(2),
          matchedCount:     realMatchedCount,
          divergentCount:   realDivergentCount,
          pendingCount:     realDivergentCount,
        });
      }

      db.invalidateReconciliationCache(); // atualiza cache após nova conciliação
      db.generateSystemAlerts().catch(() => {}); // gera alertas em background
      // Job concluído com sucesso — status já gravado como 'completed' acima
  } catch (err) {
    // ── ATOMICIDADE: limpa dados parciais e marca a sessão como erro ──
    await db.cleanupFailedSession(sessionId).catch(() => {
      console.error(`[RECONCILIATION] Falha ao limpar sessão ${sessionId} após erro`);
    });
    await db.updateReconciliationSession(sessionId, { status: 'error' }).catch(() => {});
    db.invalidateReconciliationCache();
    await audit(ctx, {
      action: "reconciliation.error", category: "conciliacao",
      entityType: "session", entityId: sessionId,
      summary: `Erro ao processar conciliação de ${input.referenceDate} — dados parciais removidos (rollback)`,
      metadata: { error: String(err) },
    });
  }
}

const reconciliationRouter = router({
  // Remove divergências duplicadas de uma sessão (bug de transações idênticas)
  dedupDivergences: adminProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.dedupSessionDivergences(input.sessionId);
      db.invalidateReconciliationCache();
      if (result.removed > 0) {
        await audit(ctx, {
          action: "reconciliation.dedup", category: "conciliacao",
          entityType: "session", entityId: input.sessionId,
          summary: `Removeu ${result.removed} divergências duplicadas da sessão #${input.sessionId}`,
        });
      }
      return result;
    }),

  getSessions: protectedProcedure.query(async () => {
    return db.getReconciliationSessions(30);
  }),

  // Verifica se já existem conciliações com a mesma data de referência.
  // O frontend chama isso antes de conciliar para avisar sobre duplicatas.
  checkDuplicateSessions: protectedProcedure
    .input(z.object({ referenceDate: z.string() }))
    .query(async ({ input }) => {
      const sessions = await db.getSessionsByReferenceDate(input.referenceDate);
      return { sessions, hasDuplicates: sessions.length > 0 };
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
      bank: z.enum(["sicoob", "bb", "jd", "api", "generic"]),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      // Parser resiliente: tenta o específico do banco, cai para o genérico se falhar
      const transactions = parseStatementResilient(buffer, input.bank);
      return { transactions, count: transactions.length };
    }),

  // ── Novo: conciliar múltiplos bancos vs API ────────────────────────────────
  runReconciliation: protectedProcedure
    .input(z.object({
      referenceDate: z.string(),
      apiFileBase64: z.string(),
      banks: z.array(z.object({
        // parserType: qual parser usar. 'generic' aceita qualquer banco.
        parserType: z.enum(["sicoob", "bb", "jd", "generic"]),
        // displayName: rótulo do banco (ex: "Itaú", "Bradesco"), usado nas divergências
        displayName: z.string().min(1).max(60),
        fileBase64: z.string(),
      })).min(1).max(8),
    }))
    .mutation(async ({ input, ctx }) => {
      // ── CONCILIAÇÃO ASSÍNCRONA ──────────────────────────────────────────────
      // Cria a sessão como 'processing' e retorna imediatamente. O processamento
      // pesado (parse + engine + persistência) roda em segundo plano, evitando
      // timeout em arquivos grandes. O frontend acompanha pelo status da sessão.
      const sessionId = await db.createReconciliationSession({
        userId: ctx.user.id,
        referenceDate: input.referenceDate,
      });

      // Dispara o processamento detached (sem await) — o erro é tratado internamente
      processReconciliationJob(sessionId, input, ctx).catch((err) => {
        console.error(`[RECONCILIATION] Job ${sessionId} falhou:`, err);
      });

      // Retorna na hora — sessão fica como 'processing' até o job terminar
      return { sessionId, status: "processing" as const };
    }),

  // ── Verifica o status de uma conciliação em andamento ──────────────────────
  getReconciliationStatus: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const session = await db.getReconciliationSessionById(input.sessionId);
      if (!session) return { status: "not_found" as const };
      return {
        status: session.status as "processing" | "completed" | "error",
        matchedCount: session.matchedCount ?? 0,
        divergentCount: session.divergentCount ?? 0,
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

        // Reconta matchedCount direto do banco usando a regra única do sistema:
        // conciliado = matchStatus IN ('matched','manual'). Isso garante que o
        // valor gravado inclui as tarifas batidas automaticamente — consistente
        // com getSessionStats e recalculateSessionStats.
        let finalMatchedCount = engineResult.stats.matched;
        try {
          const dbConnFin = await db.getDb();
          if (dbConnFin) {
            const { sql: sqlFin } = await import("drizzle-orm");
            const mRes = await dbConnFin.execute(sqlFin`
              SELECT COUNT(*) as cnt FROM bank_transactions
              WHERE sessionId = ${sessionId} AND matchStatus IN ('matched','manual')
            `);
            finalMatchedCount = parseInt(String((mRes as any)[0]?.[0]?.cnt ?? engineResult.stats.matched));
          }
        } catch { /* mantém o valor do engine como fallback */ }

        await db.updateReconciliationSession(sessionId, {
          status: 'completed',
          totalBankCredits: totalBankCredits.toFixed(2),
          totalBankDebits: totalBankDebits.toFixed(2),
          totalApiCredits: totalApiCredits.toFixed(2),
          totalApiDebits: totalApiDebits.toFixed(2),
          matchedCount: finalMatchedCount,
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
        // ── ATOMICIDADE: limpa todos os dados parciais para evitar estado inconsistente ──
        // Conciliação é tudo-ou-nada: se falhou no meio, remove transações/divergências órfãs.
        await db.cleanupFailedSession(sessionId).catch(() => {
          console.error(`[RECONCILIATION] Falha ao limpar sessão ${sessionId} após erro`);
        });
        await db.updateReconciliationSession(sessionId, { status: 'error' }).catch(() => {});
        db.invalidateReconciliationCache();
        await audit(ctx, {
          action: "reconciliation.error", category: "conciliacao",
          entityType: "session", entityId: sessionId,
          summary: `Erro ao processar conciliação de ${input.referenceDate} — dados parciais removidos (rollback)`,
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
      includeResolved: z.boolean().optional(),
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
      // Conciliado = matchStatus IN ('matched','manual') — regra única do sistema
      // (tarifa batida automaticamente conta como conciliada)
      const [totalRes, matchedRes, pendingRes, totalDivRes] = await Promise.all([
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id}`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id} AND matchStatus IN ('matched','manual')`),
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

      // Conta transações reais do banco + divergências abertas + breakdown
      const [totalAllRes, matchedRes, pendingRes, surplusRes, shortageRes, sessionRes] = await Promise.all([
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id}`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${input.id} AND matchStatus IN ('matched','manual')`),
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id} AND status NOT IN ('regularizado','reclassificado','baixado')`),
        // bank_surplus = transação só existe no banco (não tem par na API)
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id} AND divergenceType = 'bank_surplus' AND status NOT IN ('regularizado','reclassificado','baixado')`),
        // bank_shortage = transação só existe na API (não tem par no banco)
        dbConn.execute(sqlTag`SELECT COUNT(*) as cnt FROM divergences WHERE sessionId = ${input.id} AND divergenceType = 'bank_shortage' AND status NOT IN ('regularizado','reclassificado','baixado')`),
        dbConn.execute(sqlTag`SELECT matchedCount, divergentCount, pendingCount FROM reconciliation_sessions WHERE id = ${input.id} LIMIT 1`),
      ]);

      const totalAllTxs     = parseInt(String((totalAllRes  as any)[0]?.[0]?.cnt ?? 0));
      const matchedBankTxs  = parseInt(String((matchedRes   as any)[0]?.[0]?.cnt ?? 0));
      const pendingDivs     = parseInt(String((pendingRes   as any)[0]?.[0]?.cnt ?? 0));
      const surplusDivs     = parseInt(String((surplusRes   as any)[0]?.[0]?.cnt ?? 0));
      const shortageDivs    = parseInt(String((shortageRes  as any)[0]?.[0]?.cnt ?? 0));
      const sessionRow      = (sessionRes as any)[0]?.[0];
      const sessionMatched  = parseInt(String(sessionRow?.matchedCount   ?? 0));
      const sessionDivergent= parseInt(String(sessionRow?.divergentCount ?? 0));

      // ── Fórmula ÚNICA e consistente para matchRate (todo o sistema) ──────────
      // Conciliado = matchStatus IN ('matched','manual'). Tarifa batida
      // automaticamente CONTA como conciliada.
      // Denominador = total de bank_transactions da sessão.
      // Fallback para sessões legacy sem bank_transactions no banco.
      let effectiveMatched: number;
      let effectiveTotal: number;

      if (totalAllTxs > 0) {
        effectiveMatched = matchedBankTxs;
        effectiveTotal   = totalAllTxs;
      } else {
        effectiveMatched = sessionMatched;
        effectiveTotal   = sessionMatched + sessionDivergent;
      }

      const matchRate     = effectiveTotal > 0 ? Math.round((effectiveMatched / effectiveTotal) * 100) : 0;
      // unmatchedBankCount = bank transactions sem par (subset das divergências)
      const unmatchedBankCount = Math.max(0, effectiveTotal - effectiveMatched);

      return {
        // Universo BANCO (tudo fecha: matchedCount + unmatchedBankCount = totalCount)
        totalCount:         effectiveTotal,
        matchedCount:       effectiveMatched,
        unmatchedBankCount,
        matchRate,
        // Universo DIVERGÊNCIAS (diferente! inclui API-only + bank-only + diferenças)
        // pendingCount >= unmatchedBankCount porque inclui divergências de API sem par
        divergenceCount:    pendingDivs,
        surplusDivCount:    surplusDivs,   // banco sem par na API
        shortageDivCount:   shortageDivs,  // API sem par no banco
        // Legacy (mantido para compatibilidade com ReconciliationSession.tsx)
        pendingCount:       pendingDivs,
        divergentCount:     unmatchedBankCount,
      };
    }),

  // ── Fechamento da sessão: "Total API = Conciliado + Divergências + Transferências + Tarifas" ──
  // Retorna contagem e volume (R$) de cada categoria da API para validar que
  // os números fecham. Transferências internas têm channel='TRANSFERENCIA_INTERNA'.
  getSessionClosure: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) return null;
      const { sql: s } = await import("drizzle-orm");

      const [totalRes, matchedRes, divergentRes, internalRes, boletoRes, tariffRes] = await Promise.all([
        // Total de transações API da sessão
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId}`),
        // Conciliadas (matched) — exclui transferências e tarifas
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId} AND matchStatus = 'matched'`),
        // Divergentes (API sem par)
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId} AND matchStatus = 'divergent'`),
        // Transferências internas
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId} AND channel = 'TRANSFERENCIA_INTERNA'`),
        // Depósitos por boleto
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId} AND channel = 'DEPOSITO_BOLETO'`),
        // Tarifas (manual mas não transferência nem boleto)
        dbConn.execute(s`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as vol FROM api_transactions WHERE sessionId = ${input.sessionId} AND matchStatus = 'manual' AND (channel IS NULL OR channel NOT IN ('TRANSFERENCIA_INTERNA','DEPOSITO_BOLETO'))`),
      ]);

      const parse = (r: any) => ({
        count: parseInt(String((r as any)[0]?.[0]?.cnt ?? 0)),
        volume: parseFloat(String((r as any)[0]?.[0]?.vol ?? 0)),
      });

      const total = parse(totalRes);
      const matched = parse(matchedRes);
      const divergent = parse(divergentRes);
      const internal = parse(internalRes);
      const boleto = parse(boletoRes);
      const tariff = parse(tariffRes);

      // Soma das partes (deve bater com total)
      const sumCount = matched.count + divergent.count + internal.count + boleto.count + tariff.count;
      const sumVolume = matched.volume + divergent.volume + internal.volume + boleto.volume + tariff.volume;
      const balanced = sumCount === total.count;

      // ── Breakdown por BANCO ──────────────────────────────────────────────
      // Para cada banco: conferência (créditos/débitos) + decomposição
      // (conciliado/divergente). Tudo derivado das bank_transactions já no BD.
      const bankRes = await dbConn.execute(s`
        SELECT
          bankName,
          COUNT(*) as totalCnt,
          COALESCE(SUM(CAST(amount AS DECIMAL(18,2))),0) as totalVol,
          SUM(CASE WHEN type='credit' THEN 1 ELSE 0 END) as creditCnt,
          COALESCE(SUM(CASE WHEN type='credit' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END),0) as creditVol,
          SUM(CASE WHEN type='debit' THEN 1 ELSE 0 END) as debitCnt,
          COALESCE(SUM(CASE WHEN type='debit' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END),0) as debitVol,
          SUM(CASE WHEN matchStatus IN ('matched','manual') THEN 1 ELSE 0 END) as matchedCnt,
          COALESCE(SUM(CASE WHEN matchStatus IN ('matched','manual') THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END),0) as matchedVol,
          SUM(CASE WHEN matchStatus = 'divergent' THEN 1 ELSE 0 END) as divergentCnt,
          COALESCE(SUM(CASE WHEN matchStatus = 'divergent' THEN CAST(amount AS DECIMAL(18,2)) ELSE 0 END),0) as divergentVol
        FROM bank_transactions
        WHERE sessionId = ${input.sessionId}
        GROUP BY bankName
        ORDER BY totalVol DESC
      `);
      const banks = ((bankRes as any)[0] ?? []).map((b: any) => {
        const totalCnt     = parseInt(String(b.totalCnt ?? 0));
        const matchedCnt   = parseInt(String(b.matchedCnt ?? 0));
        const divergentCnt = parseInt(String(b.divergentCnt ?? 0));
        return {
          bankName: String(b.bankName ?? "—"),
          total:     { count: totalCnt, volume: parseFloat(String(b.totalVol ?? 0)) },
          credits:   { count: parseInt(String(b.creditCnt ?? 0)), volume: parseFloat(String(b.creditVol ?? 0)) },
          debits:    { count: parseInt(String(b.debitCnt ?? 0)),  volume: parseFloat(String(b.debitVol ?? 0)) },
          matched:   { count: matchedCnt,   volume: parseFloat(String(b.matchedVol ?? 0)) },
          divergent: { count: divergentCnt, volume: parseFloat(String(b.divergentVol ?? 0)) },
          // Conferência: créditos + débitos = total | Decomposição: conciliado + divergente = total
          balanced: (matchedCnt + divergentCnt) === totalCnt,
          matchRate: totalCnt > 0 ? Math.round((matchedCnt / totalCnt) * 100) : 0,
        };
      });

      return {
        total, matched, divergent, internal, boleto, tariff,
        sumCount, sumVolume, balanced,
        banks,
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
      await updateSessionPendingCount(input.sessionId, input.ids);
      await audit(ctx, {
        action: "divergence.manual_reconcile", category: "divergencia",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Conciliou manualmente ${input.ids.length} divergência(s)`,
        metadata: { ids: input.ids, note: input.note },
      });
      return result;
    }),

  // ── Pares conciliados (visão dedicada com filtros e paginação) ──────────
  getMatchedPairs: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      search: z.string().optional(),
      amount: z.number().optional(),
      amountTolerance: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      type: z.enum(['credit', 'debit']).optional(),
      bankName: z.string().optional(),
      matchType: z.string().optional(),
      exactOnly: z.boolean().optional(),
      sortBy: z.enum(['amount_desc', 'amount_asc', 'date_desc', 'date_asc']).optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return db.getMatchedPairs(input);
    }),

  // ── Bancos distintos numa sessão (para popular o dropdown de filtro) ──
  getSessionBanks: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      return db.getSessionBanks(input.sessionId);
    }),

  // ── Desconciliar par: desfaz uma conciliação para reanálise manual ─────────
  // ── Desconciliar a partir de uma divergência (caso "diferença de centavos") ──
  // Recebe o ID da divergência, encontra o par conciliado correspondente,
  // desfaz o vínculo, e cria duas divergências limpas (Sobra + Falta).
  // A divergência original é removida.
  unmatchFromDivergence: protectedProcedure
    .input(z.object({ divergenceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.unmatchFromDivergence(input.divergenceId);
      await audit(ctx, {
        action: "divergence.unmatch", category: "divergencia",
        entityType: "divergence", entityId: String(input.divergenceId),
        summary: `Desconciliou par a partir da divergência #${input.divergenceId} — geradas ${result.newDivergenceIds.length} novas divergências limpas`,
        metadata: { divergenceId: input.divergenceId, newDivergenceIds: result.newDivergenceIds },
      });
      return result;
    }),

  unmatchPair: protectedProcedure
    .input(z.object({
      bankTransactionId: z.number().optional(),
      apiTransactionId: z.number().optional(),
      deleteManualEntry: z.boolean().optional().default(false),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.bankTransactionId && !input.apiTransactionId) {
        throw new Error("Informe a transação bancária ou da API a ser desconciliada.");
      }
      const result = await db.unmatchPair({
        bankTransactionId: input.bankTransactionId,
        apiTransactionId: input.apiTransactionId,
        deleteManualEntry: input.deleteManualEntry,
      });
      // Recalcula contadores da sessão para refletir a desconciliação na taxa
      await updateSessionPendingCount(result.sessionId);
      await audit(ctx, {
        action: "reconciliation.unmatch", category: "conciliacao",
        entityType: "transaction_pair",
        entityId: `bank:${result.bankTxId},api:${result.apiTxId}`,
        summary: result.deletedManualEntry
          ? `Desconciliou par e removeu lançamento manual de contrapartida (sessão #${result.sessionId})`
          : `Desconciliou par para reanálise (sessão #${result.sessionId})`,
        metadata: {
          sessionId: result.sessionId,
          bankTransactionId: result.bankTxId,
          apiTransactionId: result.apiTxId,
          deletedManualEntry: result.deletedManualEntry,
          reason: input.reason,
        },
      });
      return result;
    }),

  // ── Busca pares já conciliados que possam estar errados ─────────────────
  // Útil quando uma divergência parece ter um par certo em outro lugar do
  // sistema. Retorna pares com valor próximo (até R$ 2,00) e data próxima
  // (±3 dias) ao da divergência informada, dentro da mesma sessão.
  findSuspiciousPairsForDivergence: protectedProcedure
    .input(z.object({ divergenceId: z.number() }))
    .query(async ({ input }) => {
      return db.findSuspiciousPairsForDivergence(input.divergenceId);
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // ─── BOLETOS — Compensação diária BB x API (Camada 1) ──────────────────
  // ═════════════════════════════════════════════════════════════════════════

  getBoletoDaily: protectedProcedure.query(async () => {
    return db.getBoletoDailyBalances();
  }),

  setBoletoInitialBalance: protectedProcedure
    .input(z.object({ value: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.setBoletoInitialBalance(input.value);
      await audit(ctx, {
        action: "boleto.set_initial_balance", category: "conciliacao",
        entityType: "boleto", entityId: "initial_balance",
        summary: `Definiu o saldo inicial dos Boletos para R$ ${input.value.toFixed(2)}`,
        metadata: { value: input.value },
      });
      return { success: true };
    }),

  setBoletoApiAmount: protectedProcedure
    .input(z.object({
      entryDate: z.string(),
      apiAmount: z.number().min(0, "O valor não pode ser negativo."),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.setBoletoApiAmount({
        entryDate: input.entryDate,
        apiAmount: input.apiAmount,
      });
      await audit(ctx, {
        action: "boleto.set_api_amount", category: "conciliacao",
        entityType: "boleto", entityId: input.entryDate,
        summary: `Lançou saldo API de R$ ${input.apiAmount.toFixed(2)} para ${input.entryDate}`,
        metadata: { entryDate: input.entryDate, apiAmount: input.apiAmount },
      });
      return result;
    }),

  deleteBoletoEntry: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.deleteBoletoEntry(input.id);
      await audit(ctx, {
        action: "boleto.delete_entry", category: "conciliacao",
        entityType: "boleto", entityId: String(input.id),
        summary: `Excluiu entrada #${input.id} da aba Boletos`,
      });
      return result;
    }),

  moveDivergencesToBoleto: protectedProcedure
    .input(z.object({
      divergenceIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.moveDivergencesToBoleto({
        divergenceIds: input.divergenceIds,
        userName: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "boleto.move_from_divergences", category: "conciliacao",
        entityType: "boleto", entityId: input.divergenceIds.join(","),
        summary: `Moveu ${result.movedCount} divergência(s) para a aba Boletos (R$ ${result.totalMoved.toFixed(2)} em ${result.daysAffected} dia(s))`,
        metadata: {
          divergenceIds: input.divergenceIds,
          totalMoved: result.totalMoved,
          daysAffected: result.daysAffected,
        },
      });
      return result;
    }),

  // ── Lançar contrapartida: cria a transação que faltava e concilia ──────────
  postCounterpart: protectedProcedure
    .input(z.object({
      divergenceId: z.number(),
      side: z.enum(["bank", "api"]),
      amount: z.number().positive("O valor deve ser maior que zero."),
      transactionDate: z.string().min(1, "Informe a data."),
      description: z.string().min(1, "Informe uma descrição."),
      channel: z.string().optional(),
      bankName: z.string().optional(),
      clientName: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.postCounterpartEntry({
        divergenceId: input.divergenceId,
        side: input.side,
        amount: input.amount,
        transactionDate: input.transactionDate,
        description: input.description,
        channel: input.channel,
        bankName: input.bankName,
        clientName: input.clientName,
        createdByName: ctx.user?.name ?? ctx.user?.email ?? "Usuário",
      });
      // Recalcula os contadores da sessão para a taxa refletir o lançamento
      if (result.sessionId) {
        await updateSessionPendingCount(result.sessionId);
      }
      await audit(ctx, {
        action: "divergence.post_counterpart", category: "divergencia",
        entityType: "divergence", entityId: input.divergenceId,
        summary: `Lançou contrapartida manual (${input.side === "api" ? "API" : "Banco"}) de R$ ${input.amount.toFixed(2)} para a divergência #${input.divergenceId}`,
        metadata: {
          side: input.side, amount: input.amount,
          transactionDate: input.transactionDate, description: input.description,
        },
      });
      return result;
    }),

  // ── Saldo diário dos bancos ───────────────────────────────────────────────
  getDailyBankBalances: protectedProcedure
    .query(async () => db.getDailyBankBalances()),

  getBankBalancesByBank: protectedProcedure
    .query(async () => db.getBankBalancesByBank()),

  // ── Resolver NID (identificar cliente) ───────────────────────────────────
  resolveNid: protectedProcedure
    .input(z.object({
      id: z.number(),
      clientName: z.string().min(1),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const r = await db.resolveNid(input.id, {
        clientName: input.clientName,
        description: input.description ?? '',
        createdByName: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "ndi.resolve", category: "nid",
        entityType: "divergence", entityId: input.id,
        summary: `Identificou NID #${input.id} — cliente: ${input.clientName}`,
        metadata: { clientName: input.clientName },
      });
      return r;
    }),

  // ── NID — Não Identificados ───────────────────────────────────────────────
  // ── Editar NID (nota, data encontrada) ───────────────────────────────────
  updateNid: protectedProcedure
    .input(z.object({
      id: z.number(),
      nidNote: z.string().optional(),
      nidFoundDate: z.string().optional(),   // data em que o valor foi identificado
      nidClientName: z.string().optional(),  // cliente suspeito (sem confirmar)
      priority: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { sql: sqlTag } = await import("drizzle-orm");
      await dbConn.execute(sqlTag`
        UPDATE divergences SET
          nidNote       = ${input.nidNote ?? null},
          nidFoundDate  = ${input.nidFoundDate ?? null},
          nidClientName = ${input.nidClientName ?? null},
          priority      = ${input.priority as any ?? 'high'}
        WHERE id = ${input.id}
      `);
      return { success: true };
    }),

  markAsNid: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1),
      nidNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.markDivergencesAsNid(input.ids, input.nidNote);
      await audit(ctx, {
        action: "ndi.mark", category: "nid",
        entityType: "divergence", entityId: input.ids.join(","),
        summary: `Marcou ${input.ids.length} divergência(s) como NID`,
        metadata: { ids: input.ids },
      });
      return { success: true };
    }),

  unmarkNid: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.unmarkNid(input.id);
      return { success: true };
    }),

  getNidDivergences: protectedProcedure
    .query(async () => db.getNidDivergences()),

  // Lista candidatos (divergências bank_shortage) para conciliar com uma NID
  getNidReconcileCandidates: protectedProcedure
    .input(z.object({ nidId: z.number() }))
    .query(async ({ input }) => db.getNidReconcileCandidates(input.nidId)),

  // Concilia NID com divergência bank_shortage existente em outra sessão
  reconcileNidWithDivergence: protectedProcedure
    .input(z.object({
      nidId: z.number(),
      targetDivergenceId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.reconcileNidWithDivergence({
        nidId: input.nidId,
        targetDivergenceId: input.targetDivergenceId,
        createdByName: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "nid.reconcile", category: "nid",
        entityType: "divergence", entityId: `${input.nidId},${input.targetDivergenceId}`,
        summary: `Conciliou NID #${input.nidId} com divergência #${input.targetDivergenceId}`,
        metadata: { nidId: input.nidId, targetDivergenceId: input.targetDivergenceId },
      });
      return result;
    }),

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
      await updateSessionPendingCount(input.sessionId, input.ids);
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
      await updateSessionPendingCount(input.sessionId, input.ids);
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

  // Registrar pagamento de parcela da carteira de crédito.
  //
  // Contabilmente correto: APENAS juros + multa viram Receita Financeira.
  // Amortização (principalAmount) NÃO vira receita — é só devolução do
  // capital que foi emprestado. Aparece no Balanço como redução do ativo
  // "empréstimos concedidos", não no DRE.
  //
  // Idempotência: se a parcela já tinha pagamento registrado antes
  // (interestRevenueId/penaltyRevenueId preenchidos), as revenues antigas
  // são DELETADAS antes de criar novas. Isso evita duplicação contábil
  // quando o usuário edita um pagamento existente.
  recordInstallmentPayment: protectedProcedure
    .input(z.object({
      installmentId: z.number(),
      creditId: z.number(),
      paidAmount:    z.string(),
      paidDate:      z.string(),
      paidPrincipal: z.string().optional(),
      paidInterest:  z.string().optional(),
      paidPenalty:   z.string().optional(),
      notes:         z.string().optional(),
      clientName:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dbConn = await db.getDb();
      if (!dbConn) throw new Error("DB unavailable");
      const { eq: eqOp } = await import("drizzle-orm");
      const { creditInstallments, creditPortfolio, revenues } = await import("../drizzle/schema");

      const installments = await dbConn.select().from(creditInstallments)
        .where(eqOp(creditInstallments.id, input.installmentId)).limit(1);
      const inst = installments[0];
      if (!inst) throw new Error("Parcela não encontrada");

      const realInterest  = parseFloat(input.paidInterest  ?? String(inst.interestAmount  ?? 0));
      const realPrincipal = parseFloat(input.paidPrincipal ?? String(inst.principalAmount ?? 0));
      const realPenalty   = parseFloat(input.paidPenalty   ?? "0");
      const realTotal     = parseFloat(input.paidAmount);
      const creditName    = input.clientName ?? `Parcela #${inst.installmentNumber}`;

      // ── REVERSÃO IDEMPOTENTE ─────────────────────────────────────────
      // Se a parcela já tinha revenues vinculadas (pagamento prévio),
      // apaga as antigas antes de criar novas. Sem isso, editar um
      // pagamento duplicaria a receita no DRE.
      if (inst.interestRevenueId) {
        await dbConn.delete(revenues).where(eqOp(revenues.id, inst.interestRevenueId));
      }
      if (inst.penaltyRevenueId) {
        await dbConn.delete(revenues).where(eqOp(revenues.id, inst.penaltyRevenueId));
      }

      let newInterestRevenueId: number | null = null;
      let newPenaltyRevenueId: number | null = null;

      // ── JUROS → Receita Financeira ───────────────────────────────────
      if (realInterest > 0) {
        const r = await dbConn.insert(revenues).values({
          referenceDate: input.paidDate as unknown as Date,
          type: 'receita_financeira' as any,
          description: `Juros parcela ${inst.installmentNumber}${input.notes ? ` — ${input.notes}` : ''}`,
          amount: realInterest.toFixed(2),
          clientId: String(input.creditId),
          clientName: creditName,
          status: 'realizado' as any,
          createdByName: ctx.user?.name ?? 'Sistema',
          origin: 'manual',
        });
        newInterestRevenueId = (r as any)[0]?.insertId ?? null;
      }

      // ── MULTA/MORA → Receita Financeira ──────────────────────────────
      if (realPenalty > 0) {
        const r = await dbConn.insert(revenues).values({
          referenceDate: input.paidDate as unknown as Date,
          type: 'receita_financeira' as any,
          description: `Multa/mora parcela ${inst.installmentNumber}`,
          amount: realPenalty.toFixed(2),
          clientId: String(input.creditId),
          clientName: creditName,
          status: 'realizado' as any,
          createdByName: ctx.user?.name ?? 'Sistema',
          origin: 'manual',
        });
        newPenaltyRevenueId = (r as any)[0]?.insertId ?? null;
      }

      // ── AMORTIZAÇÃO NÃO vira receita ─────────────────────────────────
      // Principal pago reduz o saldo devedor (outstandingBalance no
      // credit_portfolio), mas não é resultado contábil — é só devolução
      // do dinheiro que a empresa havia emprestado.
      if (realPrincipal > 0) {
        await dbConn.execute(sql`
          UPDATE credit_portfolio
          SET outstandingBalance = GREATEST(0, CAST(outstandingBalance AS DECIMAL(18,2)) - ${realPrincipal.toFixed(2)})
          WHERE id = ${input.creditId}
        `);
      }

      // Marca parcela como paga e salva IDs das revenues criadas
      await dbConn.update(creditInstallments)
        .set({
          status: 'pago',
          paidDate:   input.paidDate as unknown as Date,
          paidAmount: input.paidAmount,
          interestRevenueId: newInterestRevenueId,
          penaltyRevenueId: newPenaltyRevenueId,
        })
        .where(eqOp(creditInstallments.id, input.installmentId));

      // Verifica se todas as parcelas foram pagas → crédito = quitado
      const allInstallments = await dbConn.select().from(creditInstallments)
        .where(eqOp(creditInstallments.creditId, input.creditId));
      const allPaid = allInstallments.every(i => i.status === 'pago' || i.id === input.installmentId);
      if (allPaid) {
        await dbConn.update(creditPortfolio)
          .set({ status: 'quitado' })
          .where(eqOp(creditPortfolio.id, input.creditId));
      }

      await audit(ctx, {
        action: "installment.pay", category: "carteira",
        entityType: "credit_installment", entityId: String(input.installmentId),
        summary: `Pagamento parcela #${inst.installmentNumber}: juros R$ ${realInterest.toFixed(2)}, principal R$ ${realPrincipal.toFixed(2)}, multa R$ ${realPenalty.toFixed(2)}`,
        metadata: { realInterest, realPrincipal, realPenalty, realTotal },
      });

      return { success: true, realTotal, realInterest, realPrincipal, realPenalty };
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
      netRevenue: z.string().optional(),
      financialRevenue: z.string().optional(),
      financialCosts: z.string().optional(),
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

  // ── Movimentações Internas (Contabilidade — API Expag) ──────────────────
  // Aba independente, não afeta DRE/CashFlow/Receitas/Despesas/Conciliação.
  listInternalMovements: protectedProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      operationType: z.string().optional(),
      isTransfer: z.boolean().optional(),
    }))
    .query(async ({ input }) => db.listInternalMovements(input)),

  getInternalMovementsSummary: protectedProcedure
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => db.getInternalMovementsSummary(input)),

  createInternalMovement: protectedProcedure
    .input(z.object({
      movementDate: z.string(),
      operationType: z.string().min(1),
      processor: z.string().optional(),
      quantity: z.number().int().min(1).default(1),
      debitAmount: z.number().default(0),
      creditAmount: z.number().default(0),
      isTransfer: z.boolean().default(false),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createInternalMovement({
        ...input,
        createdBy: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "internal_movement.create", category: "contabilidade",
        entityType: "internal_movement", entityId: String(result.id),
        summary: `Movimentação interna criada: ${input.operationType} ${input.movementDate} (R$ ${input.creditAmount.toFixed(2)} crédito, R$ ${input.debitAmount.toFixed(2)} débito)`,
      });
      return result;
    }),

  updateInternalMovement: protectedProcedure
    .input(z.object({
      id: z.number(),
      movementDate: z.string().optional(),
      operationType: z.string().optional(),
      processor: z.string().optional(),
      quantity: z.number().int().min(1).optional(),
      debitAmount: z.number().optional(),
      creditAmount: z.number().optional(),
      isTransfer: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.updateInternalMovement(id, data);
      await audit(ctx, {
        action: "internal_movement.update", category: "contabilidade",
        entityType: "internal_movement", entityId: String(id),
        summary: `Movimentação interna #${id} atualizada`,
      });
      return { success: true };
    }),

  deleteInternalMovement: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteInternalMovement(input.id);
      await audit(ctx, {
        action: "internal_movement.delete", category: "contabilidade",
        entityType: "internal_movement", entityId: String(input.id),
        summary: `Movimentação interna #${input.id} excluída`,
      });
      return { success: true };
    }),

  // Importa do arquivo "Extrato Por Operação" — cliente envia o conteúdo
  // já parseado (array de linhas). O parser fica no frontend pra evitar
  // que o backend precise lidar com upload de arquivo binário.
  importInternalMovements: protectedProcedure
    .input(z.object({
      rows: z.array(z.object({
        movementDate: z.string(),
        operationType: z.string(),
        processor: z.string().nullable().optional(),
        quantity: z.number().int().min(1),
        debitAmount: z.number(),
        creditAmount: z.number(),
        isTransfer: z.boolean(),
      })).min(1).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.bulkInsertInternalMovements(
        input.rows.map(r => ({
          ...r,
          source: 'imported' as const,
          createdBy: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
        }))
      );
      await audit(ctx, {
        action: "internal_movement.import", category: "contabilidade",
        entityType: "internal_movement",
        summary: `Importou ${result.inserted} movimentação(ões) interna(s) de planilha`,
        metadata: { count: result.inserted },
      });
      return result;
    }),

  // ── Dashboard Executivo (interno — diretoria) ────────────────────────────
  // ── Apuração Manual (modo emergência — independente do sistema principal) ──
  listManualApuracao: protectedProcedure
    .input(z.object({
      referenceMonth: z.string().optional(),
      kind: z.enum(['receita', 'despesa']).optional(),
      apiSource: z.enum(['expag', 'cinqbank']).optional(),
    }))
    .query(async ({ input }) => db.listManualApuracao(input)),

  getManualApuracaoMonths: protectedProcedure
    .query(async () => db.getManualApuracaoMonths()),

  getManualApuracaoCategories: protectedProcedure
    .query(async () => db.getManualApuracaoCategories()),

  getManualApuracaoSummary: protectedProcedure
    .input(z.object({
      mode: z.enum(['month', 'ytd', 'all']),
      referenceMonth: z.string().optional(),
      apiSource: z.enum(['expag', 'cinqbank']).optional(),
    }))
    .query(async ({ input }) => db.getManualApuracaoSummary(input)),

  createManualApuracao: protectedProcedure
    .input(z.object({
      referenceMonth: z.string(),
      kind: z.enum(['receita', 'despesa']),
      apiSource: z.enum(['expag', 'cinqbank']),
      category: z.string().min(1),
      amount: z.number(),
      notes: z.string().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createManualApuracao({
        ...input,
        createdBy: ctx.user?.name ?? ctx.user?.email ?? 'Usuário',
      });
      await audit(ctx, {
        action: "manual_apuracao.create", category: "contabilidade",
        entityType: "manual_apuracao", entityId: String(result.id),
        summary: `Apuração manual: ${input.apiSource}/${input.kind} ${input.category} R$ ${input.amount.toFixed(2)} em ${input.referenceMonth}`,
      });
      return result;
    }),

  updateManualApuracao: protectedProcedure
    .input(z.object({
      id: z.number(),
      category: z.string().optional(),
      amount: z.number().optional(),
      notes: z.string().optional(),
      sortOrder: z.number().int().optional(),
      apiSource: z.enum(['expag', 'cinqbank']).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.updateManualApuracao(id, data);
      await audit(ctx, {
        action: "manual_apuracao.update", category: "contabilidade",
        entityType: "manual_apuracao", entityId: String(id),
        summary: `Apuração manual #${id} atualizada`,
      });
      return { success: true };
    }),

  deleteManualApuracao: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteManualApuracao(input.id);
      await audit(ctx, {
        action: "manual_apuracao.delete", category: "contabilidade",
        entityType: "manual_apuracao", entityId: String(input.id),
        summary: `Apuração manual #${input.id} excluída`,
      });
      return { success: true };
    }),

  getExecutiveDashboard: protectedProcedure
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
    }))
    .query(async ({ input }) => db.getExecutiveDashboard(input)),

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


  // ── Backup completo dos dados (somente admin) ──────────────────────────────
  exportBackup: adminProcedure
    .mutation(async ({ ctx }) => {
      const backup = await db.exportFullBackup();
      await audit(ctx, {
        action: "system.backup", category: "usuario",
        entityType: "system",
        summary: `Exportou backup completo dos dados (${backup.meta.totalRecords} registros)`,
        metadata: { totalRecords: backup.meta.totalRecords, tableCount: backup.meta.tableCount },
      });
      return backup;
    }),

  // ── Importar backup (restore) — somente admin ───────────────────────────────
  // SUBSTITUI os dados operacionais pelos do backup. Preserva usuários/senhas.
  // Exige a frase de confirmação exata por ser destrutivo e irreversível.
  importBackup: adminProcedure
    .input(z.object({
      confirmation: z.string(),
      backup: z.object({
        meta: z.any().optional(),
        tables: z.record(z.string(), z.array(z.any())),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.confirmation !== "IMPORTAR BACKUP") {
        throw new Error("Confirmação inválida. Digite exatamente: IMPORTAR BACKUP");
      }
      const result = await db.importFullBackup(input.backup);
      await audit(ctx, {
        action: "system.restore", category: "usuario",
        entityType: "system",
        summary: `Importou backup — ${result.totalRecords} registros restaurados em ${result.restoredTables.length} tabelas`,
        metadata: { totalRecords: result.totalRecords, restoredTables: result.restoredTables, skipped: result.skipped },
      });
      return result;
    }),

  // ── Limpar dados operacionais (somente admin) ──────────────────────────────
  // Operação destrutiva: zera o banco para entrada de dados reais.
  // Exige a frase de confirmação exata para evitar acionamento acidental.
  clearOperationalData: adminProcedure
    .input(z.object({
      confirmation: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.confirmation !== "LIMPAR TUDO") {
        throw new Error("Confirmação inválida. Digite exatamente: LIMPAR TUDO");
      }
      const result = await db.clearOperationalData();
      await audit(ctx, {
        action: "system.clear_data", category: "usuario",
        entityType: "system",
        summary: `Limpou todos os dados operacionais (${result.totalRows} registros removidos de ${result.clearedTables.length} tabelas)`,
        metadata: { clearedTables: result.clearedTables, totalRows: result.totalRows },
      });
      return result;
    }),

  factoryReset: adminProcedure
    .input(z.object({
      confirmation: z.string(),
    }))
    .mutation(async ({ input }) => {
      if (input.confirmation !== "RESETAR SISTEMA") {
        throw new Error("Confirmação inválida. Digite exatamente: RESETAR SISTEMA");
      }
      // Não grava audit porque a tabela audit_logs também é apagada
      const result = await db.factoryReset();
      return result;
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
