/**
 * Financial Reconciliation Engine
 *
 * High-performance O(n log n) matching algorithm with confidence scoring.
 * Designed to handle thousands of transactions efficiently.
 *
 * Algorithm:
 * 1. Index API transactions by quantized amount bucket → O(n)
 * 2. For each bank transaction, find candidates in nearby buckets → O(1) amortized
 * 3. Score each candidate across 4 dimensions (amount, date, description, channel) → O(k)
 * 4. Sort all candidates by confidence → O(m log m) where m = total candidates
 * 5. Greedy assignment (best score first, no conflicts) → O(m)
 *
 * Total: O(n log n) dominated by the sort step.
 *
 * Confidence Tiers:
 * - EXACT  (90-100): Same amount + same date
 * - HIGH   (75-89):  Same amount + D±1, or exact + channel match
 * - MEDIUM (55-74):  Same amount + D±3, or ±0.01 + same date
 * - LOW    (35-54):  Approximate match with multiple signals
 * - REJECT (< 35):  Insufficient evidence — not matched
 */

// ─── INTERFACES ───────────────────────────────────────────────────────────────

export interface EngineTransaction {
  id: number;
  amount: string | number;
  transactionDate: string | Date;
  description: string | null;
  channel: string | null;
}

export type MatchTier = "exact" | "high" | "medium" | "low";

export interface ScoreBreakdown {
  amount: number;   // 0-50
  date: number;     // 0-30
  description: number; // 0-15
  channel: number;  // 0-5
}

export interface MatchResult {
  bankId: number;
  apiId: number;
  confidence: number;                          // 0-100
  tier: MatchTier;
  matchType: "exact" | "partial" | "approximate"; // DB-compatible enum
  breakdown: ScoreBreakdown;
}

export interface EngineStats {
  totalBank: number;
  totalApi: number;
  matched: number;
  unmatchedBank: number;
  unmatchedApi: number;
  matchRate: number;          // 0-100%
  avgConfidence: number;      // 0-100
  exactMatches: number;
  highMatches: number;
  mediumMatches: number;
  lowMatches: number;
  processingMs: number;
}

export interface EngineOutput {
  matches: MatchResult[];
  unmatchedBankIds: number[];
  unmatchedApiIds: number[];
  stats: EngineStats;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE = 35;
const CENTS_PRECISION = 100; // Quantize amounts to 1 cent = R$0.01

// Max tolerance in cents for bucket search (1% of amount or R$5.00, whichever is smaller)
const MAX_BUCKET_TOLERANCE = 500; // R$5.00
const BUCKET_TOLERANCE_PCT = 0.01; // 1%

// ─── SCORING FUNCTIONS ────────────────────────────────────────────────────────

function scoreAmount(bankCents: number, apiCents: number): number {
  const diffCents = Math.abs(bankCents - apiCents);
  const diffPct = bankCents > 0 ? diffCents / bankCents : Infinity;

  if (diffCents === 0) return 50;      // Perfect match
  if (diffCents <= 1) return 45;       // R$0.01 rounding
  if (diffCents <= 10) return 38;      // R$0.10 rounding
  if (diffCents <= 100) return 28;     // R$1.00 minor difference
  if (diffPct < 0.001) return 22;      // < 0.1% difference
  if (diffPct < 0.005) return 15;      // < 0.5% difference
  if (diffPct < 0.01) return 8;        // < 1% difference (weak)
  return 0;                             // Too different — no match
}

function scoreDate(bankDate: Date, apiDate: Date): number {
  const diffMs = Math.abs(bankDate.getTime() - apiDate.getTime());
  const diffDays = diffMs / 86_400_000;

  if (diffDays === 0) return 30;
  if (diffDays <= 1) return 22;   // D+1 (settlement lag)
  if (diffDays <= 2) return 16;   // D+2
  if (diffDays <= 3) return 10;   // D+3
  if (diffDays <= 7) return 4;    // Up to 1 week (weak signal)
  return -15;                      // Penalize — large gap unlikely to be same tx
}

// Sørensen–Dice coefficient on character trigrams
function trigramSimilarity(a: string, b: string): number {
  if (!a || !b || a.length < 3 || b.length < 3) return 0;

  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const clean = s.toLowerCase().replace(/\s+/g, " ").trim();
    for (let i = 0; i <= clean.length - 3; i++) {
      set.add(clean.slice(i, i + 3));
    }
    return set;
  };

  const setA = trigrams(a);
  const setB = trigrams(b);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of Array.from(setA)) if (setB.has(t)) intersection++;

  return (2 * intersection) / (setA.size + setB.size);
}

function scoreDescription(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const sim = trigramSimilarity(a, b);
  return Math.round(sim * 15);
}

function scoreChannel(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return a.toUpperCase().trim() === b.toUpperCase().trim() ? 5 : 0;
}

function getTier(confidence: number): MatchTier {
  if (confidence >= 90) return "exact";
  if (confidence >= 75) return "high";
  if (confidence >= 55) return "medium";
  return "low";
}

function getMatchType(tier: MatchTier): MatchResult["matchType"] {
  if (tier === "exact") return "exact";
  if (tier === "high") return "partial";
  return "approximate";
}

// ─── MAIN SCORE FUNCTION ──────────────────────────────────────────────────────

function computeScore(
  bt: EngineTransaction,
  at: EngineTransaction,
  bankCents: number,
  apiCents: number
): { confidence: number; breakdown: ScoreBreakdown } | null {
  const amountScore = scoreAmount(bankCents, apiCents);

  // Early exit: amount too different
  if (amountScore === 0) return null;

  const bankDate = new Date(bt.transactionDate);
  const apiDate = new Date(at.transactionDate);
  const dateScore = scoreDate(bankDate, apiDate);

  // Early exit: date penalty makes overall score impossible
  if (dateScore < 0 && amountScore < 22) return null;

  const descScore = scoreDescription(bt.description, at.description);
  const chanScore = scoreChannel(bt.channel, at.channel);

  const rawScore = amountScore + dateScore + descScore + chanScore;
  const confidence = Math.min(100, Math.max(0, rawScore));

  if (confidence < MIN_CONFIDENCE) return null;

  return {
    confidence,
    breakdown: {
      amount: amountScore,
      date: Math.max(0, dateScore),
      description: descScore,
      channel: chanScore,
    },
  };
}

// ─── MAIN ENGINE ──────────────────────────────────────────────────────────────

export function runReconciliationEngine(
  bankTxs: EngineTransaction[],
  apiTxs: EngineTransaction[]
): EngineOutput {
  const t0 = Date.now();

  if (bankTxs.length === 0 && apiTxs.length === 0) {
    return emptyOutput(t0);
  }

  // ── Step 1: Index API transactions by quantized amount bucket ──
  const apiIndex = new Map<number, Array<{ tx: EngineTransaction; cents: number }>>();

  for (const at of apiTxs) {
    const cents = Math.round(parseFloat(String(at.amount)) * CENTS_PRECISION);
    if (!apiIndex.has(cents)) apiIndex.set(cents, []);
    apiIndex.get(cents)!.push({ tx: at, cents });
  }

  // ── Step 2: Generate all candidates with confidence scores ──
  const candidates: MatchResult[] = [];

  for (const bt of bankTxs) {
    const bankCents = Math.round(parseFloat(String(bt.amount)) * CENTS_PRECISION);
    const tolerance = Math.min(
      MAX_BUCKET_TOLERANCE,
      Math.max(1, Math.round(bankCents * BUCKET_TOLERANCE_PCT))
    );

    // Collect buckets to check: exact + neighbors within tolerance
    const bucketsToCheck = new Set<number>();
    bucketsToCheck.add(bankCents);
    for (let delta = 1; delta <= tolerance; delta++) {
      bucketsToCheck.add(bankCents + delta);
      bucketsToCheck.add(bankCents - delta);
    }

    for (const bucket of Array.from(bucketsToCheck)) {
      const apiCandidates = apiIndex.get(bucket);
      if (!apiCandidates) continue;

  for (const { tx: at, cents: apiCents } of Array.from(apiCandidates)) {
        const result = computeScore(bt, at, bankCents, apiCents);
        if (result) {
          const tier = getTier(result.confidence);
          candidates.push({
            bankId: bt.id,
            apiId: at.id,
            confidence: result.confidence,
            tier,
            matchType: getMatchType(tier),
            breakdown: result.breakdown,
          });
        }
      }
    }
  }

  // ── Step 3: Sort by confidence (O(m log m)) ──
  candidates.sort((a, b) => b.confidence - a.confidence);

  // ── Step 4: Greedy assignment — best score first, conflict-free ──
  const usedBank = new Set<number>();
  const usedApi = new Set<number>();
  const matches: MatchResult[] = [];

  for (const c of candidates) {
    if (!usedBank.has(c.bankId) && !usedApi.has(c.apiId)) {
      matches.push(c);
      usedBank.add(c.bankId);
      usedApi.add(c.apiId);
    }
  }

  // ── Step 5: Collect unmatched IDs ──
  const unmatchedBankIds = bankTxs
    .filter((bt) => !usedBank.has(bt.id))
    .map((bt) => bt.id);

  const unmatchedApiIds = apiTxs
    .filter((at) => !usedApi.has(at.id))
    .map((at) => at.id);

  const avgConfidence =
    matches.length > 0
      ? Math.round(
          matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
        )
      : 0;

  const tierCounts = { exact: 0, high: 0, medium: 0, low: 0 };
  for (const m of matches) tierCounts[m.tier]++;

  return {
    matches,
    unmatchedBankIds,
    unmatchedApiIds,
    stats: {
      totalBank: bankTxs.length,
      totalApi: apiTxs.length,
      matched: matches.length,
      unmatchedBank: unmatchedBankIds.length,
      unmatchedApi: unmatchedApiIds.length,
      matchRate:
        bankTxs.length > 0
          ? Math.round((matches.length / bankTxs.length) * 100)
          : 0,
      avgConfidence,
      exactMatches: tierCounts.exact,
      highMatches: tierCounts.high,
      mediumMatches: tierCounts.medium,
      lowMatches: tierCounts.low,
      processingMs: Date.now() - t0,
    },
  };
}

function emptyOutput(t0: number): EngineOutput {
  return {
    matches: [],
    unmatchedBankIds: [],
    unmatchedApiIds: [],
    stats: {
      totalBank: 0,
      totalApi: 0,
      matched: 0,
      unmatchedBank: 0,
      unmatchedApi: 0,
      matchRate: 0,
      avgConfidence: 0,
      exactMatches: 0,
      highMatches: 0,
      mediumMatches: 0,
      lowMatches: 0,
      processingMs: Date.now() - t0,
    },
  };
}
