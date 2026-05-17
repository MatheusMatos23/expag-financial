import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  formatCurrency, formatDate, formatDateTime,
  getStatusBadge, getStatusLabel, safeNumber,
} from "@/lib/utils";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, CheckCircle, AlertTriangle, Activity, ExternalLink,
  Hash, Link2, Unlink, TrendingUp, BarChart3, Search, RefreshCw, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { generateReconciliationPdf, downloadPdf, type ReconciliationReportData } from "@/lib/reconciliationReport";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  background: "var(--popover)", border: "1px solid #1a2d50",
  borderRadius: "8px", fontSize: "11px", color: "var(--foreground)",
};

// ─── BADGES ───────────────────────────────────────────────────────────────────

function MatchBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; dot?: string }> = {
    matched:  { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Conciliado", dot: "bg-emerald-400" },
    divergent:{ cls: "bg-amber-500/15  text-amber-400  border-amber-500/30",  label: "Divergente", dot: "bg-amber-400 animate-pulse" },
    pending:  { cls: "bg-sky-500/15    text-sky-400    border-sky-500/30",    label: "Pendente",   dot: "bg-sky-400" },
    manual:   { cls: "bg-violet-500/15 text-violet-400 border-violet-500/30", label: "Manual",     dot: "bg-violet-400" },
  };
  const m = map[status] ?? map.pending;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", m.cls)}>
      {m.dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", m.dot)} />}
      {m.label}
    </span>
  );
}

function MatchTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const map: Record<string, string> = {
    exact: "text-emerald-400 bg-emerald-500/10",
    partial: "text-sky-400 bg-sky-500/10",
    approximate: "text-amber-400 bg-amber-500/10",
    manual: "text-violet-400 bg-violet-500/10",
  };
  const labels: Record<string, string> = {
    exact: "Exato", partial: "Parcial", approximate: "Aprox.", manual: "Manual",
  };
  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", map[type] ?? "text-muted-foreground bg-muted/30")}>
      {labels[type] ?? type}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn(
      "text-[10px] font-medium px-1.5 py-0.5 rounded",
      type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
    )}>
      {type === "credit" ? "Crédito" : "Débito"}
    </span>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────

function KPI({ label, value, sub, color = "text-foreground", highlight = false }: {
  label: string; value: string | number; sub?: string; color?: string; highlight?: boolean;
}) {
  return (
    <div className={cn(
      "border rounded-xl p-4",
      highlight ? "bg-primary/5 border-primary/20" : "bg-card border-border"
    )}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className={cn("text-2xl font-bold font-mono", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ─── DIFF ROW ─────────────────────────────────────────────────────────────────

function DiffRow({ label, bank, api }: { label: string; bank: number; api: number }) {
  const diff = bank - api;
  const ok = Math.abs(diff) < 0.01;
  return (
    <div className="grid grid-cols-4 gap-2 py-2.5 border-b border-border/40 last:border-0 text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="font-mono text-right text-emerald-400 font-semibold">{formatCurrency(bank)}</span>
      <span className="font-mono text-right text-sky-400 font-semibold">{formatCurrency(api)}</span>
      <span className={cn("font-mono font-bold text-right", ok ? "text-emerald-400" : "text-red-400")}>
        {ok ? "✓ Zerado" : (diff > 0 ? "+" : "") + formatCurrency(diff)}
      </span>
    </div>
  );
}

// ─── MATCH QUALITY BAR ───────────────────────────────────────────────────────

function MatchQualityBar({ matched, divergent, total }: {
  matched: number; divergent: number; total: number;
}) {
  const matchPct    = total > 0 ? (matched / total) * 100 : 0;
  const divergePct  = total > 0 ? (divergent / total) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Qualidade do Matching</span>
        <span className={cn("font-bold", matchPct >= 90 ? "text-emerald-400" : matchPct >= 70 ? "text-amber-400" : "text-red-400")}>
          {matchPct.toFixed(1)}%
        </span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-border/40 gap-0.5">
        <div className="bg-emerald-500 rounded-l-full transition-all duration-700" style={{ width: `${matchPct}%` }} />
        <div className="bg-amber-500 transition-all duration-700" style={{ width: `${divergePct}%` }} />
        <div className="bg-border/60 flex-1 rounded-r-full" />
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{matched} conciliados</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{divergent} divergentes</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-border" />{total - matched - divergent} pendentes</span>
      </div>
    </div>
  );
}

// ─── PAIRED VIEW ─────────────────────────────────────────────────────────────

function PairedTransactionRow({ bank, api }: { bank: any; api?: any }) {
  const hasMatch = !!api;
  const amountMatch = hasMatch && Math.abs(safeNumber(bank.amount) - safeNumber(api.amount)) < 0.01;

  return (
    <div className={cn(
      "grid grid-cols-2 gap-3 p-3 rounded-lg border transition-colors",
      hasMatch
        ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/8"
        : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/8"
    )}>
      {/* Bank side */}
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Banco</span>
          <TypeBadge type={bank.type} />
        </div>
        <p className="text-xs font-medium text-foreground truncate">{bank.description || "Sem descrição"}</p>
        <div className="flex items-center gap-2">
          <span className={cn("font-mono text-sm font-bold", bank.type === "credit" ? "text-emerald-400" : "text-red-400")}>
            {formatCurrency(bank.amount)}
          </span>
          {bank.channel && (
            <span className="text-[10px] text-muted-foreground bg-muted/30 px-1 rounded">{bank.channel}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">{formatDate(bank.transactionDate)}</p>
      </div>

      {/* API side / divergent */}
      {hasMatch ? (
        <div className="space-y-1 min-w-0 border-l border-border/40 pl-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">API</span>
            <MatchTypeBadge type={bank.matchType} />
          </div>
          <p className="text-xs font-medium text-foreground truncate">{api.description || "Sem descrição"}</p>
          <div className="flex items-center gap-2">
            <span className={cn("font-mono text-sm font-bold", amountMatch ? "text-emerald-400" : "text-amber-400")}>
              {formatCurrency(api.amount)}
            </span>
            {!amountMatch && (
              <span className="text-[10px] text-amber-400">
                Δ {formatCurrency(Math.abs(safeNumber(bank.amount) - safeNumber(api.amount)))}
              </span>
            )}
          </div>
          {api.clientName && (
            <p className="text-[10px] text-muted-foreground truncate">{api.clientName}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center border-l border-border/40 pl-3">
          <div className="text-center space-y-1">
            <Unlink className="w-4 h-4 text-amber-400/50 mx-auto" />
            <p className="text-[10px] text-amber-400 font-medium">Sem par na API</p>
            <p className="text-[10px] text-muted-foreground">Divergência gerada</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ReconciliationSession() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user: me } = useAuth();
  const [view, setView] = useState<"table" | "pairs">("table");
  const [activeTab, setActiveTab] = useState<"all" | "credits" | "debits" | "matched" | "divergent">("all");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const id = parseInt(params.id ?? "0");

  const { data, isLoading, refetch } = trpc.reconciliation.getSessionById.useQuery(
    { id },
    {
      // Enquanto a conciliação está processando, atualiza a cada 3s para
      // detectar quando o job em segundo plano termina.
      refetchInterval: (query) => {
        const s = (query.state.data as any)?.session?.status;
        return s === "processing" ? 3000 : false;
      },
    },
  );
  const recalcMutation = trpc.reconciliation.recalculateSessionStats.useMutation({
    onSuccess: (r) => {
      toast.success(`Stats recalculados: ${r.matchedCount} conciliados · ${r.divergentCount} divergentes · ${r.matchRate}% taxa`);
      refetch(); refetchStats();
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: liveStats, refetch: refetchStats } = trpc.reconciliation.getSessionStats.useQuery(
    { id },
    { refetchInterval: 5000 } // auto-refresh every 5s
  );
  const { data: sessionDivs } = trpc.reconciliation.getDivergences.useQuery(
    { sessionId: id },
    { refetchInterval: 8000 }
  );

  // ── Todos os hooks DEVEM ficar antes de qualquer return condicional ──
  const { session, bankCredits = [], bankDebits = [], apiCredits = [], apiDebits = [] } =
    (data as any) ?? {};

  const allBank = useMemo(() => [...(bankCredits as any[]), ...(bankDebits as any[])], [bankCredits, bankDebits]);
  const allApi  = useMemo(() => [...(apiCredits as any[]), ...(apiDebits as any[])], [apiCredits, apiDebits]);

  const matchedBank   = useMemo(() => allBank.filter((t: any) => ["matched","manual"].includes(t.matchStatus)), [allBank]);
  const divergentBank = useMemo(() => allBank.filter((t: any) => !["matched","manual"].includes(t.matchStatus) && t.matchStatus != null), [allBank]);
  // Para sessões antigas sem matchStatus, usa session.matchedCount como referência

  const matchTypeData = useMemo(() => {
    const counts = { exact: 0, partial: 0, approximate: 0, manual: 0 };
    for (const t of matchedBank as any[]) {
      const k = t.matchType as keyof typeof counts;
      if (k in counts) counts[k]++;
    }
    return [
      { name: "Exato",   value: counts.exact,       color: "#10b981" },
      { name: "Parcial", value: counts.partial,      color: "#38bdf8" },
      { name: "Aprox.",  value: counts.approximate,  color: "#f59e0b" },
      { name: "Manual",  value: counts.manual,       color: "#8b5cf6" },
    ].filter(d => d.value > 0);
  }, [matchedBank]);

  const apiById = useMemo(() => {
    const m = new Map<number, any>();
    for (const t of allApi as any[]) m.set(t.id, t);
    return m;
  }, [allApi]);

  const filteredRows = useMemo(() => {
    switch (activeTab) {
      case "credits":   return bankCredits as any[];
      case "debits":    return bankDebits as any[];
      case "matched":   return allBank.filter((t: any) => ["matched","manual"].includes(t.matchStatus));
      case "divergent": return allBank.filter((t: any) => !["matched","manual"].includes(t.matchStatus));
      default:          return allBank;
    }
  }, [activeTab, bankCredits, bankDebits, allBank]);

  // ── Agora sim os returns condicionais ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-medium text-muted-foreground">Sessão não encontrada.</p>
        <button onClick={() => setLocation("/conciliacao")}
          className="mt-3 text-xs text-primary hover:underline">← Voltar</button>
      </div>
    );
  }

  // ── Tela de processamento — conciliação rodando em segundo plano ──
  if (session?.status === "processing") {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="relative">
            <div className="w-14 h-14 border-[3px] border-primary/20 border-t-primary rounded-full animate-spin" />
            <Activity className="w-5 h-5 text-primary absolute inset-0 m-auto" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Processando conciliação</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Os extratos estão sendo lidos e cruzados com a API. Isto pode levar alguns
              instantes para arquivos grandes — a tela atualiza sozinha quando terminar.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Sessão #{session.id} · {formatDate(session.referenceDate)}
          </div>
          <button onClick={() => setLocation("/conciliacao")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Voltar para conciliações
          </button>
        </div>
      </div>
    );
  }

  // ── Tela de erro — conciliação falhou ──
  if (session?.status === "error") {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Falha no processamento</h2>
            <p className="text-sm text-muted-foreground mt-1">
              A conciliação não pôde ser concluída. Os dados parciais foram removidos
              automaticamente. Verifique os arquivos e tente novamente.
            </p>
          </div>
          <button onClick={() => setLocation("/conciliacao")}
            className="text-xs text-primary hover:underline">
            ← Voltar e tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // ── Totals ──
  const totalBankCred = (bankCredits as any[]).reduce((s, t) => s + safeNumber(t.amount), 0);
  const totalBankDeb  = (bankDebits as any[]).reduce((s, t) => s + safeNumber(t.amount), 0);
  const totalApiCred  = (apiCredits as any[]).reduce((s, t) => s + safeNumber(t.amount), 0);
  const totalApiDeb   = (apiDebits as any[]).reduce((s, t) => s + safeNumber(t.amount), 0);
  // Use live stats from DB (updated after manual reconciliations) when available
  // Live stats from DB (updates every 5s after manual reconciliations)
  const matchRate        = liveStats?.matchRate     ?? (allBank.length > 0 ? Math.round((matchedBank.length / allBank.length) * 100) : 0);
  const liveMatchedCount = liveStats?.matchedCount  ?? matchedBank.length;
  const livePendingCount = liveStats?.pendingCount  ?? session?.pendingCount ?? 0;
  const liveDivergentCount = liveStats?.divergentCount ?? ((liveStats?.totalCount ?? allBank.length) - liveMatchedCount);
  const liveTotal        = liveStats?.totalCount    ?? allBank.length;
  const totalDiff     = (totalBankCred + totalBankDeb) - (totalApiCred + totalApiDeb);

  // ── Geração do relatório PDF ──
  const handleGeneratePdf = async () => {
    setGeneratingPdf(true);
    try {
      const openDivs = ((sessionDivs ?? []) as any[])
        .filter(d => !["regularizado", "reclassificado", "baixado"].includes(d.status));

      const reportData: ReconciliationReportData = {
        sessionId: session.id,
        referenceDate: session.referenceDate,
        status: getStatusLabel(session.status),
        createdAt: session.createdAt,
        generatedBy: me?.name ?? me?.email ?? "Usuário",
        matchRate,
        totalTransactions: liveTotal,
        matchedCount: liveMatchedCount,
        divergentCount: liveDivergentCount,
        pendingCount: livePendingCount,
        totalBankCredits: totalBankCred,
        totalBankDebits: totalBankDeb,
        totalApiCredits: totalApiCred,
        totalApiDebits: totalApiDeb,
        totalDifference: totalDiff,
        openDivergences: openDivs.map(d => ({
          id: d.id,
          type: d.divergenceType ?? "—",
          description: d.bankDescription ?? "",
          amount: safeNumber(d.amount),
          priority: d.priority ?? "medium",
          bankName: d.bankName ?? undefined,
        })),
        matchBreakdown: matchTypeData.map(m => ({ name: m.name, value: m.value })),
      };

      const bytes = await generateReconciliationPdf(reportData);
      downloadPdf(bytes, `relatorio-conciliacao-${session.id}`);
      toast.success("Relatório PDF gerado com sucesso.");
    } catch (err) {
      console.error("[PDF] Erro ao gerar relatório:", err);
      toast.error("Erro ao gerar o relatório PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  // ── Table columns ──
  const columns: ColumnDef<any>[] = [
    {
      key: "transactionDate", header: "Data", sortable: true, width: "90px",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.transactionDate)}</span>,
    },
    {
      key: "type", header: "Tipo", width: "70px",
      cell: (r) => <TypeBadge type={r.type} />,
    },
    {
      key: "description", header: "Descrição", searchable: true, minWidth: "180px",
      cell: (r) => (
        <span className="text-xs text-foreground truncate block max-w-[220px]">
          {r.description || <span className="text-muted-foreground/40 italic">Sem descrição</span>}
        </span>
      ),
    },
    {
      key: "channel", header: "Canal", width: "80px",
      cell: (r) => r.channel
        ? <span className="text-[10px] text-muted-foreground font-medium bg-muted/30 px-1 rounded">{r.channel}</span>
        : <span className="text-muted-foreground/40">—</span>,
    },
    {
      key: "bankName", header: "Banco", width: "100px",
      cell: (r) => r.bankName
        ? <span className="text-[10px] text-muted-foreground truncate block max-w-[100px]">{r.bankName}</span>
        : <span className="text-muted-foreground/40">—</span>,
    },
    {
      key: "amount", header: "Valor", sortable: true, align: "right", width: "115px",
      cell: (r) => (
        <span className={cn("font-mono text-sm font-bold",
          r.type === "credit" ? "text-emerald-400" : "text-red-400"
        )}>
          {r.type === "debit" ? "−" : ""}{formatCurrency(r.amount)}
        </span>
      ),
    },
    {
      key: "matchStatus", header: "Status", width: "120px",
      cell: (r) => <MatchBadge status={r.matchStatus ?? "pending"} />,
    },
    {
      key: "matchType", header: "Match", width: "90px",
      cell: (r) => <MatchTypeBadge type={r.matchType} />,
    },
  ];

  const TABS = [
    { key: "all",       label: `Todas (${allBank.length})`, color: "" },
    { key: "credits",   label: `Créditos (${bankCredits.length})`, color: "" },
    { key: "debits",    label: `Débitos (${bankDebits.length})`, color: "" },
    { key: "matched",   label: `✓ Conciliados (${liveMatchedCount})`, color: "text-emerald-400" },
    { key: "divergent", label: `⚠ Divergentes (${liveDivergentCount})`, color: "text-amber-400" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setLocation("/conciliacao")}
          className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-accent transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">
              Conciliação · {formatDate(session.referenceDate)}
            </h1>
            <span className={getStatusBadge(session.status)}>
              {getStatusLabel(session.status)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            ID #{session.id} · {formatDateTime(session.createdAt)}
          </p>
        </div>
        <button
          onClick={handleGeneratePdf}
          disabled={generatingPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-card border border-border rounded-lg hover:bg-accent transition-colors shrink-0 disabled:opacity-60"
        >
          <FileDown className="w-3.5 h-3.5" />
          {generatingPdf ? "Gerando..." : "Relatório PDF"}
        </button>
        <button
          onClick={() => setLocation("/divergencias")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors shrink-0"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Ver Divergências
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* ── Recalcular stats para sessões antigas ── */}
      {/* Botão de recalcular — sempre visível para sessões completadas */}
      {session?.status === 'completed' && (
        <div className="flex items-center justify-between bg-[rgba(255,180,0,0.04)] border border-amber-500/20 rounded-xl px-4 py-2.5 mb-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-amber-300/80 font-medium truncate">
                {matchRate}% · {liveMatchedCount.toLocaleString()} conciliados · {allBank.length.toLocaleString()} txs banco
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Se não bater com o dashboard, clique para recalcular e corrigir.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline"
            className="h-7 text-xs gap-1.5 border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0 ml-3 whitespace-nowrap"
            onClick={() => recalcMutation.mutate({ id })}
            disabled={recalcMutation.isPending}
          >
            <RefreshCw className={`w-3 h-3 ${recalcMutation.isPending ? 'animate-spin' : ''}`} />
            {recalcMutation.isPending ? 'Corrigindo...' : 'Recalcular'}
          </Button>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Conciliados"   value={liveMatchedCount}   color="text-emerald-400" sub="transações" highlight />
        <KPI label="Divergências"  value={livePendingCount}  color="text-amber-400" sub={`${liveDivergentCount} total · ${liveMatchedCount} conciliados`} />
        <KPI label="Taxa Matching"
          value={`${matchRate}%`}
          color={matchRate >= 90 ? "text-emerald-400" : matchRate >= 70 ? "text-amber-400" : "text-red-400"}
          sub="banco vs API" />
        <KPI label="Total Banco"   value={formatCurrency(totalBankCred + totalBankDeb)} sub="créditos + débitos" />
        <KPI label="Total API"     value={formatCurrency(totalApiCred + totalApiDeb)}   sub="créditos + débitos" />
        <KPI label="Diferença"
          value={(() => {
            const pendingDivs = ((sessionDivs ?? []) as any[]).filter(d => !["regularizado","reclassificado","baixado"].includes(d.status));
            const pendingVal = pendingDivs.reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? 0)), 0);
            return formatCurrency(pendingVal);
          })()}
          color={livePendingCount === 0 ? "text-emerald-400" : "text-red-400"}
          sub={livePendingCount === 0 ? "✓ Zerado" : `${livePendingCount} pendentes`} />
      </div>

      {/* ── Match Quality Bar ── */}
      <div className="card-premium rounded-xl p-5">
        <MatchQualityBar
          matched={liveMatchedCount}
          divergent={liveDivergentCount}
          total={liveTotal}
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Comparativo */}
        <div className="card-premium rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Comparativo Banco × API
          </h3>
          <div className="grid grid-cols-4 gap-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-1">
            <span>Categoria</span>
            <span className="text-right text-emerald-400">Banco</span>
            <span className="text-right text-sky-400">API</span>
            <span className="text-right">Δ Diferença</span>
          </div>
          <DiffRow label="Créditos" bank={totalBankCred} api={totalApiCred} />
          <DiffRow label="Débitos"  bank={totalBankDeb}  api={totalApiDeb}  />
          <DiffRow label="Total"    bank={totalBankCred + totalBankDeb} api={totalApiCred + totalApiDeb} />

          {/* Bar chart visual */}
          <div className="mt-5">
            <ResponsiveContainer width="100%" height={130}>
              <BarChart
                data={[
                  { name: "Créditos", banco: totalBankCred, api: totalApiCred },
                  { name: "Débitos",  banco: totalBankDeb,  api: totalApiDeb },
                ]}
                margin={{ left: -10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5c7099" }} />
                <YAxis tick={{ fontSize: 9, fill: "#5c7099" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="banco" fill="#10b981" name="Banco" radius={[3,3,0,0]} opacity={0.85} />
                <Bar dataKey="api"   fill="#38bdf8" name="API"   radius={[3,3,0,0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Match type distribution */}
        <div className="card-premium rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Distribuição por Tipo de Match
          </h3>
          {matchTypeData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={matchTypeData} cx="50%" cy="50%" innerRadius={40} outerRadius={62}
                    paddingAngle={3} dataKey="value">
                    {matchTypeData.map((e, i) => <Cell key={i} fill={e.color} opacity={0.88} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
                {matchTypeData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-[11px] text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border/40 space-y-2">
                {matchTypeData.map((d) => {
                  const pct = matchedBank.length > 0 ? Math.round((d.value / matchedBank.length) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground w-12 shrink-0">{d.name}</span>
                      <div className="flex-1 bg-border/40 rounded-full h-1 overflow-hidden">
                        <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: d.color }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Nenhum match processado
            </div>
          )}
        </div>
      </div>

      {/* ── Transaction Explorer ── */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            Explorador de Transações
          </h3>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center p-0.5 bg-muted/30 rounded-lg">
              <button
                onClick={() => setView("table")}
                className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Tabela
              </button>
              <button
                onClick={() => setView("pairs")}
                className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  view === "pairs" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Link2 className="w-3 h-3 inline mr-1" />
                Pares
              </button>
            </div>
          </div>
        </div>

        {/* Tab filter */}
        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg mb-4 flex-wrap">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                activeTab === tab.key
                  ? cn("bg-card shadow-sm", (tab as any).color || "text-foreground")
                  : cn("text-muted-foreground hover:text-foreground", (tab as any).color ? "hover:" + (tab as any).color.replace("text-","text-") : "")
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table view */}
        {view === "table" && (
          <DataTable
            data={filteredRows}
            columns={columns}
            searchPlaceholder="Buscar por descrição, banco, canal..."
            exportFilename={`conciliacao-${session.id}`}
            emptyTitle="Nenhuma transação encontrada"
            defaultPageSize={25}
            compact
            rowClassName={(row: any) => {
              if (row.matchStatus === "divergent" || row.matchStatus === "pending") return "bg-amber-500/5";
              return undefined;
            }}
          />
        )}

        {/* Pairs view */}
        {view === "pairs" && (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-2 gap-3 px-1 pb-1 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Banco</span>
              </div>
              <div className="flex items-center gap-2 pl-3">
                <div className="w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">API / Par Conciliado</span>
              </div>
            </div>

            {/* Matched pairs first */}
            {(activeTab === "all" || activeTab === "matched") && matchedBank.map((bt: any) => {
              const apiTx = apiById.get(bt.matchedApiTransactionId);
              return <PairedTransactionRow key={bt.id} bank={bt} api={apiTx} />;
            })}

            {/* Divergent (no pair) */}
            {(activeTab === "all" || activeTab === "divergent") && divergentBank.map((bt: any) => (
              <PairedTransactionRow key={bt.id} bank={bt} />
            ))}

            {filteredRows.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Nenhuma transação para exibir neste filtro.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
