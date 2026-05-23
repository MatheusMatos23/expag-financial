import { ParsedTransaction } from "./parsers";

export interface MatchResult {
  bankTx: ParsedTransaction;
  apiTx?: ParsedTransaction;
  status: "matched" | "divergent" | "unmatched_bank" | "unmatched_api";
  matchType?: "exact_e2e" | "exact_value_date" | "approximate" | "ambiguous";
  difference?: number;
  confidence: number;
  bankName?: string;
  /** Sugestão de possível correspondência quando o valor bate mas não foi possível confirmar */
  possibleMatchNote?: string;
}

export interface ReconciliationResult {
  matches: MatchResult[];
  unmatchedApi: ParsedTransaction[];
  summary: {
    totalBankCredits: number;
    totalBankDebits: number;
    totalApiCredits: number;
    totalApiDebits: number;
    matchedCount: number;
    divergentCount: number;
    unmatchedBankCount: number;
    unmatchedApiCount: number;
    differenceCredits: number;
    differenceDebits: number;
    byBank: Record<string, { credits: number; debits: number; matched: number; divergent: number; unmatched: number }>;
  };
}

// Tolerância exata: diferenças ≤ R$1,00 são consideradas "matched" (arredondamento,
// centavos de tarifa absorvida, etc). Antes era R$0,01 o que gerava divergências
// para diferenças de centavos que na prática são arredondamento.
const AMOUNT_TOLERANCE = 1.00;

// Tolerância aproximada: o engine ainda ENCONTRA o par correto para diferenças de
// até R$5,00 (mesmo que marque como divergent se > AMOUNT_TOLERANCE). Sem isso,
// transações com diff de R$2-5 ficam como "unmatched" sem nem encontrar o par.
const APPROX_TOLERANCE = 5.00;

/** Returns an ISO date string offset by `days` days */
function offsetDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build an index key for date+type matching.
 * Returns ALL candidate keys for a given bank transaction (same-day + D±2)
 * to handle settlement lag. Expandido de D±1 para D±2 porque Sicoob e BB
 * podem ter lag de 2 dias úteis em liquidações de TED/DOC.
 */
function dateTypeKeys(date: string, type: string): string[] {
  return [
    `${date}|${type}`,
    `${offsetDate(date, -1)}|${type}`,
    `${offsetDate(date, +1)}|${type}`,
    `${offsetDate(date, -2)}|${type}`,
    `${offsetDate(date, +2)}|${type}`,
  ];
}

export function reconcileMultiBank(
  banks: Array<{ name: string; txs: ParsedTransaction[]; useE2E: boolean }>,
  apiTxs: ParsedTransaction[]
): ReconciliationResult {
  const allMatches: MatchResult[] = [];
  const usedApiIds = new Set<number>();
  const byBank: Record<string, any> = {};

  // ── Para cada banco, roda o matching ────────────────────────────────────────
  for (const bank of banks) {
    byBank[bank.name] = { credits: 0, debits: 0, matched: 0, divergent: 0, unmatched: 0 };

    for (const tx of bank.txs) {
      if (tx.type === "credit") byBank[bank.name].credits += tx.amount;
      else                      byBank[bank.name].debits  += tx.amount;
    }

    // ── Passo 1: match por END2END (apenas JD — externalId format E+32 chars) ──
    //
    // CORREÇÃO: quando múltiplas transações API têm o mesmo E2E (ex: o valor
    // real do PIX + a tarifa cobrada), o Map guardava só a última e podia casar
    // a tarifa (R$ 5,50) com o PIX do banco (R$ 427), ignorando o valor real.
    //
    // Agora: agrupa TODAS as API txs por E2E, e na hora de casar escolhe a
    // de valor mais próximo ao banco. Se a melhor opção ainda tiver diferença
    // > 50% do valor do banco, rejeita o match (vai pra unmatched/divergência).
    if (bank.useE2E) {
      // Agrupa API txs por E2E (pode ter mais de uma com mesmo código)
      const apiByE2E = new Map<string, Array<{ tx: ParsedTransaction; idx: number }>>();
      apiTxs.forEach((tx, idx) => {
        if (tx.externalId && !usedApiIds.has(idx)) {
          const key = tx.externalId.toUpperCase();
          if (!apiByE2E.has(key)) apiByE2E.set(key, []);
          apiByE2E.get(key)!.push({ tx, idx });
        }
      });

      for (const bankTx of bank.txs) {
        if (!bankTx.externalId) continue;
        const key = bankTx.externalId.toUpperCase();
        const candidates = apiByE2E.get(key);
        if (!candidates || candidates.length === 0) continue;

        // Filtra candidatos já usados
        const available = candidates.filter(c => !usedApiIds.has(c.idx));
        if (available.length === 0) continue;

        // Escolhe o candidato com valor mais próximo ao banco
        let best = available[0];
        let bestDiff = Math.abs(bankTx.amount - best.tx.amount);
        for (let i = 1; i < available.length; i++) {
          const d = Math.abs(bankTx.amount - available[i].tx.amount);
          if (d < bestDiff) { best = available[i]; bestDiff = d; }
        }

        // REJEITAR se a diferença for > 50% do valor do banco.
        // Isso evita casar R$ 427 (banco) com R$ 5,50 (tarifa da API).
        // O limite de 50% é generoso — na prática a diferença entre
        // tarifa e valor real é sempre > 90%.
        const maxAmount = Math.max(bankTx.amount, best.tx.amount);
        if (maxAmount > 0 && (bestDiff / maxAmount) > 0.50) {
          // E2E bate mas valores muito diferentes — NÃO conciliar.
          // Vai cair no Passo 2 (data+valor) ou virar unmatched.
          continue;
        }

        usedApiIds.add(best.idx);
        const diff = bestDiff;
        const status =
          diff <= AMOUNT_TOLERANCE && bankTx.type === best.tx.type
            ? "matched"
            : "divergent";
        allMatches.push({
          bankTx, apiTx: best.tx, status,
          matchType: "exact_e2e", confidence: 100,
          difference: diff, bankName: bank.name,
        });
        if (status === "matched") byBank[bank.name].matched++;
        else                      byBank[bank.name].divergent++;
      }
    }

    // ── Passo 2: match por data + valor + tipo — com tolerância D±1 ──────────
    //
    // D±1 cobre lag de liquidação: um PIX recebido em 17/04 na API
    // pode aparecer em 18/04 no extrato bancário (D+1 settlement).
    //
    const matchedE2Es = new Set(
      allMatches.filter(m => m.bankName === bank.name).map(m => m.bankTx.externalId)
    );
    const unmatchedBankTxs = bank.txs.filter(
      tx => !bank.useE2E || !matchedE2Es.has(tx.externalId)
    );

    // Build multi-date index: cada transação API aparece em 3 chaves (D-1, D, D+1)
    const apiIndex = new Map<string, Array<{ tx: ParsedTransaction; idx: number }>>();
    apiTxs.forEach((tx, idx) => {
      if (usedApiIds.has(idx)) return;
      // Index under D-1, D, D+1 so bank D can find API D-1 and D+1 too
      for (const key of dateTypeKeys(tx.date, tx.type)) {
        if (!apiIndex.has(key)) apiIndex.set(key, []);
        apiIndex.get(key)!.push({ tx, idx });
      }
    });

    for (const bankTx of unmatchedBankTxs) {
      // Collect all candidates across D-1, D, D+1 — dedup by idx
      const seen = new Set<number>();
      const candidates: Array<{ tx: ParsedTransaction; idx: number }> = [];
      for (const key of dateTypeKeys(bankTx.date, bankTx.type)) {
        for (const c of apiIndex.get(key) ?? []) {
          if (!usedApiIds.has(c.idx) && !seen.has(c.idx)) {
            seen.add(c.idx);
            candidates.push(c);
          }
        }
      }

      // Priority 1: exact value match (tolerance R$0.01)
      const exactIdx = candidates.findIndex(
        c => Math.abs(c.tx.amount - bankTx.amount) <= AMOUNT_TOLERANCE
      );
      if (exactIdx >= 0) {
        const { tx: apiTx, idx } = candidates[exactIdx];
        usedApiIds.add(idx);
        for (const key of dateTypeKeys(apiTx.date, apiTx.type)) {
          const arr = apiIndex.get(key);
          if (arr) {
            const pos = arr.findIndex(c => c.idx === idx);
            if (pos >= 0) arr.splice(pos, 1);
          }
        }
        const matchedOnSameDay = apiTx.date === bankTx.date;
        const confidence = matchedOnSameDay ? 100 : 85;
        const matchType  = matchedOnSameDay ? "exact_value_date" : "approximate";
        // FIX 6: difference=0 sempre é matched, mesmo com type diferente
        // (ex: banco registra como credit, API como debit em alguns casos de estorno)
        const diff = Math.abs(bankTx.amount - apiTx.amount);
        const typeMatch = bankTx.type === apiTx.type;
        const status = (diff <= AMOUNT_TOLERANCE && (typeMatch || diff === 0)) ? "matched" : "divergent";
        allMatches.push({
          bankTx, apiTx, status, matchType,
          confidence: typeMatch ? confidence : confidence - 15,
          difference: diff, bankName: bank.name,
          possibleMatchNote: !typeMatch ? `Tipo divergente: banco=${bankTx.type}, API=${apiTx.type}` : undefined,
        });
        if (status === "matched") byBank[bank.name].matched++;
        else                      byBank[bank.name].divergent++;
        continue;
      }

      // Priority 1b: para valores altos (>R$10k), tenta match cross-type (FIX 5)
      // Alguns bancos registram estornos/devoluções com type invertido
      if (bankTx.amount >= 10000) {
        const crossTypeIdx = candidates.findIndex(
          c => Math.abs(c.tx.amount - bankTx.amount) <= AMOUNT_TOLERANCE && c.tx.type !== bankTx.type
        );
        if (crossTypeIdx >= 0) {
          const { tx: apiTx, idx } = candidates[crossTypeIdx];
          usedApiIds.add(idx);
          for (const key of dateTypeKeys(apiTx.date, apiTx.type)) {
            const arr = apiIndex.get(key);
            if (arr) { const pos = arr.findIndex(c => c.idx === idx); if (pos >= 0) arr.splice(pos, 1); }
          }
          allMatches.push({
            bankTx, apiTx, status: "divergent", matchType: "approximate",
            confidence: 60, difference: 0, bankName: bank.name,
            possibleMatchNote: `Tipo invertido: banco=${bankTx.type}, API=${apiTx.type} — verificar se é estorno`,
          });
          byBank[bank.name].divergent++;
          continue;
        }
      }

      // Priority 2: approximate value match (tolerance R$1.00)
      const approxIdx = candidates.findIndex(
        c => Math.abs(c.tx.amount - bankTx.amount) <= APPROX_TOLERANCE
      );
      if (approxIdx >= 0) {
        const { tx: apiTx, idx } = candidates[approxIdx];
        usedApiIds.add(idx);
        for (const key of dateTypeKeys(apiTx.date, apiTx.type)) {
          const arr = apiIndex.get(key);
          if (arr) {
            const pos = arr.findIndex(c => c.idx === idx);
            if (pos >= 0) arr.splice(pos, 1);
          }
        }
        const diff = Math.abs(bankTx.amount - apiTx.amount);
        const status = diff > AMOUNT_TOLERANCE ? "divergent" : "matched";
        allMatches.push({
          bankTx, apiTx, status, matchType: "approximate",
          confidence: 70, difference: diff, bankName: bank.name,
        });
        if (status === "matched") byBank[bank.name].matched++;
        else                      byBank[bank.name].divergent++;
        continue;
      }

      // No match found
      allMatches.push({
        bankTx, status: "unmatched_bank", confidence: 0, bankName: bank.name,
      });
      byBank[bank.name].unmatched++;
    }
  }

  // ── API sem par ──────────────────────────────────────────────────────────────
  const unmatchedApi = apiTxs.filter((_, idx) => !usedApiIds.has(idx));

  // ── Detecção de possíveis correspondências entre não-conciliados ─────────────
  //
  // Quando um tx do banco não encontrou par na API (ou vice-versa),
  // verificamos se existe um tx do lado oposto com o mesmo valor e tipo
  // dentro de D±3 dias. Se sim, anotamos como "possível correspondência"
  // para ajudar a investigação manual.

  // Index unmatched API by amount+type for fast lookup
  const unmatchedApiByAmountType = new Map<string, ParsedTransaction[]>();
  for (const tx of unmatchedApi) {
    if (tx.isTariff || tx.isInternal) continue; // tarifas não geram sugestão
    const key = `${tx.amount.toFixed(2)}|${tx.type}`;
    if (!unmatchedApiByAmountType.has(key)) unmatchedApiByAmountType.set(key, []);
    unmatchedApiByAmountType.get(key)!.push(tx);
  }

  for (const match of allMatches) {
    if (match.status !== "unmatched_bank") continue;
    const key = `${match.bankTx.amount.toFixed(2)}|${match.bankTx.type}`;
    const candidates = unmatchedApiByAmountType.get(key) ?? [];
    // Find API tx within D±3
    const suggestion = candidates.find(c => {
      const diffDays = Math.abs(
        (new Date(match.bankTx.date).getTime() - new Date(c.date).getTime()) /
        86_400_000
      );
      return diffDays <= 3;
    });
    if (suggestion) {
      match.possibleMatchNote = `Possível correspondência na API: R$ ${suggestion.amount.toFixed(2)} em ${suggestion.date}${suggestion.clientName ? ` (${suggestion.clientName})` : ""}`;
    }
  }

  // ── Totais ───────────────────────────────────────────────────────────────────
  const allBankTxs = banks.flatMap(b => b.txs);
  const totalBankCredits = allBankTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalBankDebits  = allBankTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalApiCredits  = apiTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalApiDebits   = apiTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  return {
    matches: allMatches,
    unmatchedApi,
    summary: {
      totalBankCredits, totalBankDebits,
      totalApiCredits,  totalApiDebits,
      matchedCount:        allMatches.filter(m => m.status === "matched").length,
      divergentCount:      allMatches.filter(m => m.status === "divergent").length,
      unmatchedBankCount:  allMatches.filter(m => m.status === "unmatched_bank").length,
      unmatchedApiCount:   unmatchedApi.length,
      differenceCredits:   totalBankCredits - totalApiCredits,
      differenceDebits:    totalBankDebits  - totalApiDebits,
      byBank,
    },
  };
}

/** Compat wrapper para uso legado */
export function reconcile(
  bankTxs: ParsedTransaction[],
  apiTxs: ParsedTransaction[],
  useE2E = true
) {
  return reconcileMultiBank([{ name: "banco", txs: bankTxs, useE2E }], apiTxs);
}
