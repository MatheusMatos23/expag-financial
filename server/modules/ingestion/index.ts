/**
 * Financial Data Ingestion Module
 *
 * Orchestrates the complete intake pipeline for raw financial data:
 * 1. Receive raw rows (from XLSX, CSV, or API)
 * 2. Normalize through the normalization pipeline
 * 3. Remove duplicates via content hashing
 * 4. Return clean, standardized transaction data ready for the engine
 *
 * Future: extend to support direct file parsing (OFX, TXT bank statements)
 * and asynchronous processing via job queues.
 */

import {
  normalizeBatch,
  type NormalizedTransaction,
  type RawTransactionRow,
} from "../normalization";
import { audit } from "../audit/logger";

// ─── INTERFACES ───────────────────────────────────────────────────────────────

export interface IngestionInput {
  sessionId: number;
  userId: number;
  referenceDate: string;
  bankCreditsRaw: RawTransactionRow[];
  bankDebitsRaw: RawTransactionRow[];
  apiCreditsRaw: RawTransactionRow[];
  apiDebitsRaw: RawTransactionRow[];
}

export interface IngestionSourceResult {
  source: string;
  inputCount: number;
  normalizedCount: number;
  duplicateCount: number;
  errorCount: number;
  transactions: NormalizedTransaction[];
  errors: Array<{ row: number; field: string; message: string }>;
}

export interface IngestionOutput {
  bankCredits: NormalizedTransaction[];
  bankDebits: NormalizedTransaction[];
  apiCredits: NormalizedTransaction[];
  apiDebits: NormalizedTransaction[];
  sources: Record<string, IngestionSourceResult>;
  summary: {
    totalInput: number;
    totalNormalized: number;
    totalDuplicates: number;
    totalErrors: number;
    hasErrors: boolean;
  };
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────

function deduplicateWithinBatch(
  transactions: NormalizedTransaction[]
): { unique: NormalizedTransaction[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: NormalizedTransaction[] = [];
  let duplicateCount = 0;

  for (const tx of transactions) {
    if (seen.has(tx.contentHash)) {
      duplicateCount++;
    } else {
      seen.add(tx.contentHash);
      unique.push(tx);
    }
  }

  return { unique, duplicateCount };
}

// ─── SOURCE PROCESSOR ─────────────────────────────────────────────────────────

function processSource(
  sessionId: number,
  raw: RawTransactionRow[],
  inputType: "credit" | "debit",
  sourceName: string
): IngestionSourceResult {
  if (raw.length === 0) {
    return {
      source: sourceName,
      inputCount: 0,
      normalizedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      transactions: [],
      errors: [],
    };
  }

  const batchResult = normalizeBatch(sessionId, raw, inputType);
  const { unique, duplicateCount } = deduplicateWithinBatch(batchResult.normalized);

  const flatErrors = batchResult.errors.flatMap(({ row, errors: errs }) =>
    errs.map((e) => ({ row, field: e.field, message: e.message }))
  );

  return {
    source: sourceName,
    inputCount: raw.length,
    normalizedCount: unique.length,
    duplicateCount,
    errorCount: flatErrors.length,
    transactions: unique,
    errors: flatErrors,
  };
}

// ─── MAIN INGESTION FUNCTION ──────────────────────────────────────────────────

export function processIngestion(input: IngestionInput): IngestionOutput {
  const t0 = Date.now();

  audit({
    action: "ingestion.start",
    sessionId: input.sessionId,
    userId: input.userId,
    metadata: {
      referenceDate: input.referenceDate,
      rawCounts: {
        bankCredits: input.bankCreditsRaw.length,
        bankDebits: input.bankDebitsRaw.length,
        apiCredits: input.apiCreditsRaw.length,
        apiDebits: input.apiDebitsRaw.length,
      },
    },
  });

  const bankCreditsResult = processSource(
    input.sessionId,
    input.bankCreditsRaw,
    "credit",
    "bankCredits"
  );
  const bankDebitsResult = processSource(
    input.sessionId,
    input.bankDebitsRaw,
    "debit",
    "bankDebits"
  );
  const apiCreditsResult = processSource(
    input.sessionId,
    input.apiCreditsRaw,
    "credit",
    "apiCredits"
  );
  const apiDebitsResult = processSource(
    input.sessionId,
    input.apiDebitsRaw,
    "debit",
    "apiDebits"
  );

  const sources: Record<string, IngestionSourceResult> = {
    bankCredits: bankCreditsResult,
    bankDebits: bankDebitsResult,
    apiCredits: apiCreditsResult,
    apiDebits: apiDebitsResult,
  };

  const totalInput = Object.values(sources).reduce((s, r) => s + r.inputCount, 0);
  const totalNormalized = Object.values(sources).reduce((s, r) => s + r.normalizedCount, 0);
  const totalDuplicates = Object.values(sources).reduce((s, r) => s + r.duplicateCount, 0);
  const totalErrors = Object.values(sources).reduce((s, r) => s + r.errorCount, 0);

  // Log duplicate removals
  if (totalDuplicates > 0) {
    audit({
      action: "ingestion.duplicate_removed",
      sessionId: input.sessionId,
      userId: input.userId,
      metadata: { duplicateCount: totalDuplicates },
    });
  }

  // Log validation errors
  if (totalErrors > 0) {
    audit({
      action: "ingestion.validation_error",
      sessionId: input.sessionId,
      userId: input.userId,
      metadata: {
        errorCount: totalErrors,
        errorSample: Object.values(sources)
          .flatMap((r) => r.errors.slice(0, 2))
          .slice(0, 5),
      },
    });
  }

  audit({
    action: "ingestion.complete",
    sessionId: input.sessionId,
    userId: input.userId,
    durationMs: Date.now() - t0,
    metadata: { totalInput, totalNormalized, totalDuplicates, totalErrors },
  });

  return {
    bankCredits: bankCreditsResult.transactions,
    bankDebits: bankDebitsResult.transactions,
    apiCredits: apiCreditsResult.transactions,
    apiDebits: apiDebitsResult.transactions,
    sources,
    summary: {
      totalInput,
      totalNormalized,
      totalDuplicates,
      totalErrors,
      hasErrors: totalErrors > 0,
    },
  };
}
