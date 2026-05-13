import { ParsedTransaction } from "./parsers";

export interface MatchResult {
  bankTx: ParsedTransaction;
  apiTx?: ParsedTransaction;
  status: "matched" | "divergent" | "unmatched_bank" | "unmatched_api";
  matchType?: "exact_e2e" | "exact_value_date" | "approximate" | "ambiguous";
  difference?: number;
  confidence: number;
  bankName?: string;
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

const AMOUNT_TOLERANCE = 0.01;

export function reconcileMultiBank(
  banks: Array<{ name: string; txs: ParsedTransaction[]; useE2E: boolean }>,
  apiTxs: ParsedTransaction[]
): ReconciliationResult {
  const allMatches: MatchResult[] = [];
  const usedApiIds = new Set<number>();
  const byBank: Record<string, any> = {};

  // ── Para cada banco, roda o matching ──────────────────────────────────────
  for (const bank of banks) {
    byBank[bank.name] = { credits: 0, debits: 0, matched: 0, divergent: 0, unmatched: 0 };

    // Acumular totais do banco
    for (const tx of bank.txs) {
      if (tx.type === "credit") byBank[bank.name].credits += tx.amount;
      else byBank[bank.name].debits += tx.amount;
    }

    // Passo 1: match por END2END (JD)
    if (bank.useE2E) {
      const apiByE2E = new Map<string, { tx: ParsedTransaction; idx: number }>();
      apiTxs.forEach((tx, idx) => {
        if (tx.externalId && !usedApiIds.has(idx)) {
          apiByE2E.set(tx.externalId.toUpperCase(), { tx, idx });
        }
      });

      for (const bankTx of bank.txs) {
        if (!bankTx.externalId) continue;
        const key = bankTx.externalId.toUpperCase();
        const apiMatch = apiByE2E.get(key);
        if (!apiMatch || usedApiIds.has(apiMatch.idx)) continue;

        usedApiIds.add(apiMatch.idx);
        apiByE2E.delete(key);
        const diff = Math.abs(bankTx.amount - apiMatch.tx.amount);
        const status = diff <= AMOUNT_TOLERANCE && bankTx.type === apiMatch.tx.type ? "matched" : "divergent";
        allMatches.push({ bankTx, apiTx: apiMatch.tx, status, matchType: "exact_e2e", confidence: 100, difference: diff, bankName: bank.name });
        if (status === "matched") byBank[bank.name].matched++;
        else byBank[bank.name].divergent++;
      }
    }

    // Passo 2: match por data + valor + tipo (BB, Sicoob — e JD sem E2E)
    const matchedE2Es = new Set(allMatches.filter(m => m.bankName === bank.name).map(m => m.bankTx.externalId));
    const unmatchedBankTxs = bank.txs.filter(tx => !matchedE2Es.has(tx.externalId) || !bank.useE2E);

    // Índice da API disponível
    const apiIndex = new Map<string, Array<{ tx: ParsedTransaction; idx: number }>>();
    apiTxs.forEach((tx, idx) => {
      if (usedApiIds.has(idx)) return;
      const key = `${tx.date}|${tx.type}`;
      if (!apiIndex.has(key)) apiIndex.set(key, []);
      apiIndex.get(key)!.push({ tx, idx });
    });

    for (const bankTx of unmatchedBankTxs) {
      if (bank.useE2E && matchedE2Es.has(bankTx.externalId)) continue; // já conciliado por E2E
      const key = `${bankTx.date}|${bankTx.type}`;
      const candidates = (apiIndex.get(key) ?? []).filter(c => !usedApiIds.has(c.idx));

      const exactIdx = candidates.findIndex(c => Math.abs(c.tx.amount - bankTx.amount) <= AMOUNT_TOLERANCE);
      if (exactIdx >= 0) {
        const { tx: apiTx, idx } = candidates[exactIdx];
        usedApiIds.add(idx);
        candidates.splice(exactIdx, 1);
        allMatches.push({ bankTx, apiTx, status: "matched", matchType: "exact_value_date", confidence: 95, difference: 0, bankName: bank.name });
        byBank[bank.name].matched++;
        continue;
      }

      const approxIdx = candidates.findIndex(c => Math.abs(c.tx.amount - bankTx.amount) <= 1.0);
      if (approxIdx >= 0) {
        const { tx: apiTx, idx } = candidates[approxIdx];
        usedApiIds.add(idx);
        candidates.splice(approxIdx, 1);
        const diff = Math.abs(bankTx.amount - apiTx.amount);
        const status = diff > AMOUNT_TOLERANCE ? "divergent" : "matched";
        allMatches.push({ bankTx, apiTx, status, matchType: "approximate", confidence: 75, difference: diff, bankName: bank.name });
        if (status === "matched") byBank[bank.name].matched++;
        else byBank[bank.name].divergent++;
        continue;
      }

      allMatches.push({ bankTx, status: "unmatched_bank", confidence: 0, bankName: bank.name });
      byBank[bank.name].unmatched++;
    }
  }

  // API sem par
  const unmatchedApi = apiTxs.filter((_, idx) => !usedApiIds.has(idx));

  // Totais gerais
  const allBankTxs = banks.flatMap(b => b.txs);
  const totalBankCredits = allBankTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalBankDebits  = allBankTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalApiCredits  = apiTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalApiDebits   = apiTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  return {
    matches: allMatches,
    unmatchedApi,
    summary: {
      totalBankCredits, totalBankDebits, totalApiCredits, totalApiDebits,
      matchedCount:       allMatches.filter(m => m.status === "matched").length,
      divergentCount:     allMatches.filter(m => m.status === "divergent").length,
      unmatchedBankCount: allMatches.filter(m => m.status === "unmatched_bank").length,
      unmatchedApiCount:  unmatchedApi.length,
      differenceCredits:  totalBankCredits - totalApiCredits,
      differenceDebits:   totalBankDebits - totalApiDebits,
      byBank,
    },
  };
}

// Compatibilidade com o engine antigo
export function reconcile(
  bankTxs: ParsedTransaction[],
  apiTxs: ParsedTransaction[],
  useE2E: boolean = true
) {
  return reconcileMultiBank([{ name: "banco", txs: bankTxs, useE2E }], apiTxs);
}
