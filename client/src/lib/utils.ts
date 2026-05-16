import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ─── CLASSNAMES ───────────────────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── FORMATAÇÃO MONETÁRIA ─────────────────────────────────────────────────────
export function formatCurrency(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

export function formatCurrencyCompact(value: number | string | null | undefined): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "R$ 0,00";
  const abs = Math.abs(num);
  // Só abrevia para valores >= R$1 bilhão (extremamente raros em uso normal)
  if (abs >= 1_000_000_000) {
    const sign = num < 0 ? "-" : "";
    return `${sign}R$ ${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  return formatCurrency(num);
}


export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  // MySQL DATE type comes back as Date object — use ISO to avoid locale string issues
  let iso: string;
  if (date instanceof Date) {
    iso = date.toISOString().slice(0, 10);
  } else {
    const s = String(date);
    // If already ISO (2026-04-17), use directly
    iso = s.length >= 10 && s[4] === "-" ? s.slice(0, 10) : s;
  }
  const [y, m, d_] = iso.split("-");
  if (!y || !m || !d_) return String(date);
  return `${d_}/${m}/${y}`;
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleString("pt-BR");
}

export function formatDateISO(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

// ─── FORMATAÇÃO PERCENTUAL ────────────────────────────────────────────────────
export function formatPercent(
  value: number | string | null | undefined,
  decimals = 2
): string {
  const num = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(num)) return "0,00%";
  // Se o valor já é entre -1 e 1, multiplica por 100 (ex: 0.15 → 15%)
  const pct = Math.abs(num) <= 1 ? num * 100 : num;
  return `${pct.toFixed(decimals).replace(".", ",")}%`;
}

// ─── RANGES DE DATA ───────────────────────────────────────────────────────────
export function getCurrentMonthRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    dateFrom: start.toISOString().split("T")[0],
    dateTo: end.toISOString().split("T")[0],
  };
}

export function getLastNDaysRange(days: number): { dateFrom: string; dateTo: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  return {
    dateFrom: start.toISOString().split("T")[0],
    dateTo: end.toISOString().split("T")[0],
  };
}

// ─── BADGES DE STATUS ─────────────────────────────────────────────────────────
const STATUS_BADGE_MAP: Record<string, string> = {
  // Conciliação
  pendente: "badge-warning",
  em_analise: "badge-info",
  identificado: "badge-info",
  regularizado: "badge-success",
  reclassificado: "badge-success",
  baixado: "badge-neutral",
  em_aberto: "badge-warning",
  escalado_diretoria: "badge-danger",
  // Pagamentos / Receitas
  previsto: "badge-info",
  realizado: "badge-success",
  cancelado: "badge-neutral",
  // Payables
  pago: "badge-success",
  vencido: "badge-danger",
  // Match
  matched: "badge-success",
  divergent: "badge-danger",
  manual: "badge-info",
  // Sessions
  processing: "badge-info",
  completed: "badge-success",
  error: "badge-danger",
  // Alerts
  active: "badge-warning",
  acknowledged: "badge-neutral",
  resolved: "badge-success",
  // Credit
  ativo: "badge-success",
  inadimplente: "badge-danger",
  quitado: "badge-neutral",
  renegociado: "badge-warning",
  // Severity
  critical: "badge-danger",
  warning: "badge-warning",
  info: "badge-info",
  // Priority
  low: "badge-neutral",
  medium: "badge-warning",
  high: "badge-danger",
};

export function getStatusBadge(status: string | null | undefined): string {
  if (!status) return "badge-neutral";
  return STATUS_BADGE_MAP[status] ?? "badge-neutral";
}

// ─── LABELS DE STATUS ─────────────────────────────────────────────────────────
const STATUS_LABEL_MAP: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em Análise",
  identificado: "Identificado",
  regularizado: "Regularizado",
  reclassificado: "Reclassificado",
  baixado: "Baixado",
  em_aberto: "Em Aberto",
  escalado_diretoria: "Escalado Diretoria",
  previsto: "Previsto",
  realizado: "Realizado",
  cancelado: "Cancelado",
  pago: "Pago",
  vencido: "Vencido",
  matched: "Conciliado",
  divergent: "Divergente",
  manual: "Manual",
  pending: "Pendente",
  processing: "Processando",
  completed: "Concluído",
  error: "Erro",
  active: "Ativo",
  acknowledged: "Visto",
  resolved: "Resolvido",
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  quitado: "Quitado",
  renegociado: "Renegociado",
  bank_surplus: "Sobra no Banco",
  bank_shortage: "Falta no Banco",
  critical: "Crítico",
  warning: "Atenção",
  info: "Info",
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export function getStatusLabel(status: string | null | undefined): string {
  if (!status) return "-";
  return STATUS_LABEL_MAP[status] ?? status;
}

// ─── PRIORIDADE NUMÉRICA ──────────────────────────────────────────────────────
export function getPriorityOrder(priority: string): number {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return order[priority] ?? 99;
}

// ─── NÚMERO SEGURO ────────────────────────────────────────────────────────────
export function safeNumber(value: string | number | null | undefined, fallback = 0): number {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? fallback);
  return isNaN(n) ? fallback : n;
}

// ─── VARIAÇÃO (delta) ─────────────────────────────────────────────────────────
export function calcVariation(
  current: number | string | null | undefined,
  previous: number | string | null | undefined
): { value: number; isPositive: boolean; isNeutral: boolean } {
  const cur = safeNumber(current);
  const prev = safeNumber(previous);
  if (prev === 0) return { value: 0, isPositive: true, isNeutral: true };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { value: pct, isPositive: pct >= 0, isNeutral: pct === 0 };
}
