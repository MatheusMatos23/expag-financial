import { ParsedTransaction } from "./parsers";

export interface MatchResult {
  bankTx: ParsedTransaction;
  apiTx?: ParsedTransaction;
  status: "matched" | "divergent" | "unmatched_bank" | "unmatched_api";
  matchType?: "exact_e2e" | "exact_value_date" | "approximate" | "ambiguous";
  difference?: number; // valor da divergência
  confidence: number; // 0-100
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
  };
}

const AMOUNT_TOLERANCE = 0.01; // R$ 0,01 de tolerância

export function reconcile(
  bankTxs: ParsedTransaction[],
  apiTxs: ParsedTransaction[],
  useE2E: boolean = true
): ReconciliationResult {
  const matches: MatchResult[] = [];
  const usedApiIds = new Set<number>();

  // ── Passo 1: Match por END2END (JD ↔ API) ─────────────────────────────────
  if (useE2E) {
    const apiByE2E = new Map<string, { tx: ParsedTransaction; idx: number }>();
    apiTxs.forEach((tx, idx) => {
      if (tx.externalId) apiByE2E.set(tx.externalId.toUpperCase(), { tx, idx });
    });

    for (const bankTx of bankTxs) {
      if (!bankTx.externalId) continue;
      const key = bankTx.externalId.toUpperCase();
      const apiMatch = apiByE2E.get(key);
      if (!apiMatch || usedApiIds.has(apiMatch.idx)) continue;

      usedApiIds.add(apiMatch.idx);
      const diff = Math.abs(bankTx.amount - apiMatch.tx.amount);

      if (diff <= AMOUNT_TOLERANCE && bankTx.type === apiMatch.tx.type) {
        matches.push({ bankTx, apiTx: apiMatch.tx, status: "matched", matchType: "exact_e2e", confidence: 100, difference: 0 });
      } else {
        matches.push({ bankTx, apiTx: apiMatch.tx, status: "divergent", matchType: "exact_e2e", confidence: 90, difference: diff });
      }
      apiByE2E.delete(key);
    }
  }

  // ── Passo 2: Match por Data + Valor + Tipo (BB, SICOB) ────────────────────
  const matchedBankE2Es = new Set(matches.map(m => m.bankTx.externalId).filter(Boolean));
  const unmatchedBank = bankTxs.filter(tx => !matchedBankE2Es.has(tx.externalId));

  // Índice da API: date+type → lista de transações
  const apiIndex = new Map<string, Array<{ tx: ParsedTransaction; idx: number }>>();
  apiTxs.forEach((tx, idx) => {
    if (usedApiIds.has(idx)) return;
    const key = `${tx.date}|${tx.type}`;
    if (!apiIndex.has(key)) apiIndex.set(key, []);
    apiIndex.get(key)!.push({ tx, idx });
  });

  for (const bankTx of unmatchedBank) {
    const key = `${bankTx.date}|${bankTx.type}`;
    const candidates = apiIndex.get(key) ?? [];

    // Exact value match
    const exactIdx = candidates.findIndex(c => !usedApiIds.has(c.idx) && Math.abs(c.tx.amount - bankTx.amount) <= AMOUNT_TOLERANCE);
    if (exactIdx >= 0) {
      const { tx: apiTx, idx } = candidates[exactIdx];
      usedApiIds.add(idx);
      candidates.splice(exactIdx, 1);
      matches.push({ bankTx, apiTx, status: "matched", matchType: "exact_value_date", confidence: 95, difference: 0 });
      continue;
    }

    // Approximate match (mesmo dia, mesmo tipo, valor até R$1 de diferença)
    const approxIdx = candidates.findIndex(c => !usedApiIds.has(c.idx) && Math.abs(c.tx.amount - bankTx.amount) <= 1.0);
    if (approxIdx >= 0) {
      const { tx: apiTx, idx } = candidates[approxIdx];
      usedApiIds.add(idx);
      candidates.splice(approxIdx, 1);
      const diff = Math.abs(bankTx.amount - apiTx.amount);
      matches.push({ bankTx, apiTx, status: diff > AMOUNT_TOLERANCE ? "divergent" : "matched", matchType: "approximate", confidence: 75, difference: diff });
      continue;
    }

    // No match
    matches.push({ bankTx, status: "unmatched_bank", confidence: 0 });
  }

  // ── Passo 3: API sem par ───────────────────────────────────────────────────
  const unmatchedApi = apiTxs.filter((_, idx) => !usedApiIds.has(idx));

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalBankCredits  = bankTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalBankDebits   = bankTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalApiCredits   = apiTxs.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalApiDebits    = apiTxs.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  return {
    matches,
    unmatchedApi,
    summary: {
      totalBankCredits, totalBankDebits, totalApiCredits, totalApiDebits,
      matchedCount:        matches.filter(m => m.status === "matched").length,
      divergentCount:      matches.filter(m => m.status === "divergent").length,
      unmatchedBankCount:  matches.filter(m => m.status === "unmatched_bank").length,
      unmatchedApiCount:   unmatchedApi.length,
      differenceCredits:   totalBankCredits - totalApiCredits,
      differenceDebits:    totalBankDebits - totalApiDebits,
    },
  };
}
