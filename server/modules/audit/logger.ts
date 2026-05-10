/**
 * Financial Operations Audit Logger
 *
 * Provides structured audit trails for all critical financial operations.
 * Compliant with financial institution logging requirements.
 *
 * In production: extend to persist to a dedicated audit table or external
 * SIEM system (Splunk, Datadog, CloudWatch, etc.)
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "ingestion.start"
  | "ingestion.complete"
  | "ingestion.validation_error"
  | "ingestion.duplicate_removed"
  | "reconciliation.start"
  | "reconciliation.complete"
  | "reconciliation.error"
  | "divergence.created"
  | "divergence.updated"
  | "divergence.escalated"
  | "alert.created"
  | "alert.acknowledged"
  | "alert.resolved"
  | "balance.updated"
  | "cashflow.updated"
  | "dre.updated"
  | "revenue.created"
  | "expense.created"
  | "payable.paid"
  | "credit.created";

export type AuditLevel = "info" | "warning" | "error" | "critical";

export interface AuditEntry {
  id: string;
  timestamp: string;           // ISO 8601
  action: AuditAction;
  level: AuditLevel;
  sessionId?: number;
  userId?: number;
  metadata: Record<string, unknown>;
  durationMs?: number;
}

// ─── SIMPLE ID GENERATOR ─────────────────────────────────────────────────────

let sequence = 0;
function generateAuditId(): string {
  sequence = (sequence + 1) % 100000;
  return `AUD-${Date.now().toString(36).toUpperCase()}-${sequence.toString().padStart(5, "0")}`;
}

// ─── IN-MEMORY STORE ─────────────────────────────────────────────────────────
// In production: replace with persistent DB table or external service

const MAX_ENTRIES = 2000;
const entries: AuditEntry[] = [];

// ─── LOG LEVELS ───────────────────────────────────────────────────────────────

const ACTION_LEVELS: Record<AuditAction, AuditLevel> = {
  "ingestion.start": "info",
  "ingestion.complete": "info",
  "ingestion.validation_error": "warning",
  "ingestion.duplicate_removed": "info",
  "reconciliation.start": "info",
  "reconciliation.complete": "info",
  "reconciliation.error": "error",
  "divergence.created": "warning",
  "divergence.updated": "info",
  "divergence.escalated": "critical",
  "alert.created": "warning",
  "alert.acknowledged": "info",
  "alert.resolved": "info",
  "balance.updated": "info",
  "cashflow.updated": "info",
  "dre.updated": "info",
  "revenue.created": "info",
  "expense.created": "info",
  "payable.paid": "info",
  "credit.created": "info",
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export function audit(params: {
  action: AuditAction;
  sessionId?: number;
  userId?: number;
  metadata?: Record<string, unknown>;
  durationMs?: number;
}): string {
  const entry: AuditEntry = {
    id: generateAuditId(),
    timestamp: new Date().toISOString(),
    action: params.action,
    level: ACTION_LEVELS[params.action] ?? "info",
    sessionId: params.sessionId,
    userId: params.userId,
    metadata: params.metadata ?? {},
    durationMs: params.durationMs,
  };

  // Persist in memory
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  // Structured console output (compatible with log aggregators)
  const logFn = entry.level === "error" || entry.level === "critical"
    ? console.error
    : entry.level === "warning"
    ? console.warn
    : console.info;

  logFn(
    JSON.stringify({
      audit: true,
      id: entry.id,
      ts: entry.timestamp,
      action: entry.action,
      level: entry.level,
      ...(entry.sessionId !== undefined && { sessionId: entry.sessionId }),
      ...(entry.userId !== undefined && { userId: entry.userId }),
      ...(entry.durationMs !== undefined && { durationMs: entry.durationMs }),
      ...entry.metadata,
    })
  );

  return entry.id;
}

export function getAuditEntries(filter?: {
  sessionId?: number;
  action?: AuditAction;
  level?: AuditLevel;
  limit?: number;
}): AuditEntry[] {
  let result = [...entries];

  if (filter?.sessionId !== undefined) {
    result = result.filter((e) => e.sessionId === filter.sessionId);
  }
  if (filter?.action) {
    result = result.filter((e) => e.action === filter.action);
  }
  if (filter?.level) {
    result = result.filter((e) => e.level === filter.level);
  }

  const limit = filter?.limit ?? 100;
  return result.slice(-limit).reverse(); // Most recent first
}

export function clearAuditLog(): void {
  entries.length = 0;
}
