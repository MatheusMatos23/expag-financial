import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import {
  Upload, CheckCircle, AlertTriangle, XCircle, ArrowRight, FileSpreadsheet,
  RefreshCw, ChevronDown, ChevronUp, Trash2, Eye, ArrowLeft, X,
  Building2, TrendingUp, TrendingDown, Scale, Info, BarChart2, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const BANK_OPTIONS = [
  { value: "jd",     label: "JD (Expag)",       parserType: "jd",     color: "text-blue-400",   border: "border-blue-500/30",   bg: "bg-blue-500/5" },
  { value: "sicoob", label: "Sicoob",            parserType: "sicoob", color: "text-green-400",  border: "border-green-500/30",  bg: "bg-green-500/5" },
  { value: "bb",     label: "Banco do Brasil",   parserType: "bb",     color: "text-yellow-400", border: "border-yellow-500/30", bg: "bg-yellow-500/5" },
];

// Banco genérico — para qualquer instituição não cadastrada.
// Usa o parser inteligente que detecta as colunas automaticamente.
type CustomBank = { id: string; name: string; file: File | null };

// ── Utils ─────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function safeDate(val: any): string {
  if (!val) return "—";
  return String(val).slice(0, 10);
}

function diffColor(diff: number): string {
  if (Math.abs(diff) < 0.01) return "text-emerald-400";
  if (Math.abs(diff) < 100) return "text-yellow-400";
  return "text-red-400";
}

// ── Upload Zone ────────────────────────────────────────────────────────────────

function UploadZone({ label, file, onFile, onRemove, color, border, bg }: {
  label: string; file: File | null; onFile: (f: File) => void;
  onRemove: () => void; color: string; border: string; bg: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={cn("relative rounded-xl border-2 border-dashed p-3 transition-all cursor-pointer",
        drag ? "border-primary bg-primary/5" : file ? `${border} ${bg}` : "border-border hover:border-primary/30"
      )}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => !file && ref.current?.click()}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-emerald-400 truncate">{file.name}</p>
            <p className="text-[10px] text-muted-foreground">{(file.size/1024).toFixed(0)} KB</p>
          </div>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0"
            onClick={e => { e.stopPropagation(); onRemove(); }}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
          <div>
            <p className={cn("text-xs font-semibold", color)}>{label}</p>
            <p className="text-[10px] text-muted-foreground">Clique ou arraste .xlsx</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Balance Bar ───────────────────────────────────────────────────────────────

function BalanceBar({ bankVal, apiVal, label }: { bankVal: number; apiVal: number; label: string }) {
  const diff = bankVal - apiVal;
  const max = Math.max(bankVal, apiVal, 1);
  const bankPct = (bankVal / max) * 100;
  const apiPct  = (apiVal  / max) * 100;
  const balanced = Math.abs(diff) < 0.01;
  return (
    <div className="card-premium rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className={cn("text-xs font-bold font-mono", balanced ? "text-emerald-400" : "text-yellow-400")}>
          {balanced ? "✓ Balanceado" : `Δ ${formatCurrency(Math.abs(diff))}`}
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-8 text-right">Banco</span>
          <div className="flex-1 bg-border rounded-full h-2">
            <div className="h-2 rounded-full bg-blue-400 transition-all" style={{ width: `${bankPct}%` }} />
          </div>
          <span className="text-[10px] font-mono text-blue-400 w-24 text-right">{formatCurrency(bankVal)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-8 text-right">API</span>
          <div className="flex-1 bg-border rounded-full h-2">
            <div className="h-2 rounded-full bg-purple-400 transition-all" style={{ width: `${apiPct}%` }} />
          </div>
          <span className="text-[10px] font-mono text-purple-400 w-24 text-right">{formatCurrency(apiVal)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Session Detail ────────────────────────────────────────────────────────────

function SessionDetail({ sessionId, onBack, onDelete }: {
  sessionId: number; onBack: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<"conciliados"|"divergentes"|"banco"|"api"|"divs">("divs");
  const { data, isLoading, refetch } = trpc.reconciliation.getSessionTransactions.useQuery({ id: sessionId });

  const deleteDivMutation = trpc.reconciliation.deleteDivergence.useMutation({
    onSuccess: () => { toast.success("Removido."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const updateDivMutation = trpc.reconciliation.updateDivergence.useMutation({
    onSuccess: () => { toast.success("Atualizado."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (!data) return <div className="text-center py-12 text-muted-foreground text-sm">Sessão não encontrada.</div>;

  const { session: sess, bankTxs, apiTxs, divs } = data as any;
  // matchRate calculado sobre pendingCount real (não divergentCount inflado)
  // session.pendingCount = divergências reais pendentes na tabela
  const realTotal = sess.matchedCount + (sess.pendingCount ?? sess.divergentCount ?? 0);
  const matchRate = realTotal > 0
    ? Math.round((sess.matchedCount / realTotal) * 100)
    : 0;
  const totalDivValue = (divs ?? []).reduce((s: number, d: any) => s + parseFloat(d.amount ?? 0), 0);
  const pendingDivs = (divs ?? []).filter((d: any) => d.status === "pendente" || d.status === "em_analise");
  const bankCredits = (bankTxs ?? []).filter((t: any) => t.type === "credit").reduce((s: number, t: any) => s + parseFloat(t.amount ?? 0), 0);
  const bankDebits  = (bankTxs ?? []).filter((t: any) => t.type === "debit").reduce((s: number, t: any) => s + parseFloat(t.amount ?? 0), 0);
  const apiCredits  = (apiTxs ?? []).filter((t: any) => t.type === "credit").reduce((s: number, t: any) => s + parseFloat(t.amount ?? 0), 0);
  const apiDebits   = (apiTxs ?? []).filter((t: any) => t.type === "debit").reduce((s: number, t: any) => s + parseFloat(t.amount ?? 0), 0);

  const TABS = [
    { key: "divs",       label: "Divergências",     count: (divs ?? []).length,    color: "text-yellow-400" },
    { key: "banco",      label: "Transações Banco", count: (bankTxs ?? []).length, color: "text-blue-400" },
    { key: "api",        label: "Transações API",   count: (apiTxs ?? []).length,  color: "text-purple-400" },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" /> Sessões
          </Button>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Sessão #{sess.id} — {formatDate(sess.referenceDate)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {(bankTxs ?? []).length} transações banco · {(apiTxs ?? []).length} transações API
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
          onClick={() => { if (confirm("Remover sessão e todos os dados?")) onDelete(); }}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* KPIs superiores */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card-premium rounded-xl p-4 col-span-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Taxa Matching</p>
          <p className={cn("text-2xl font-bold", matchRate >= 90 ? "text-emerald-400" : matchRate >= 70 ? "text-yellow-400" : "text-red-400")}>
            {matchRate}%
          </p>
          <div className="mt-2 bg-border rounded-full h-1.5">
            <div className={cn("h-1.5 rounded-full", matchRate >= 90 ? "bg-emerald-400" : "bg-yellow-400")}
              style={{ width: `${matchRate}%` }} />
          </div>
        </div>
        <div className="card-premium rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Conciliados</p>
          <p className="text-2xl font-bold text-emerald-400">{sess.matchedCount}</p>
        </div>
        <div className="card-premium rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Divergentes</p>
          <p className="text-2xl font-bold text-yellow-400">{(divs ?? []).length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{pendingDivs.length} pendentes</p>
        </div>
        <div className="card-premium rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Valor em Aberto</p>
          <p className="text-lg font-bold font-mono text-yellow-400">{formatCurrency(totalDivValue)}</p>
        </div>
        <div className={cn("bg-card border rounded-xl p-4", Math.abs(bankCredits - apiCredits) < 0.01 && Math.abs(bankDebits - apiDebits) < 0.01 ? "border-emerald-500/30" : "border-yellow-500/30")}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Saldo</p>
          <p className={cn("text-sm font-bold", Math.abs(bankCredits - apiCredits) < 0.01 && Math.abs(bankDebits - apiDebits) < 0.01 ? "text-emerald-400" : "text-yellow-400")}>
            {Math.abs(bankCredits - apiCredits) < 0.01 && Math.abs(bankDebits - apiDebits) < 0.01 ? "Balanceado" : "Divergente"}
          </p>
        </div>
      </div>

      {/* Barras de Equilíbrio */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BalanceBar bankVal={bankCredits} apiVal={apiCredits} label="Créditos — Banco vs API" />
        <BalanceBar bankVal={bankDebits}  apiVal={apiDebits}  label="Débitos — Banco vs API" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-accent/20 p-1 rounded-xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={cn("flex-1 text-xs py-1.5 px-2 rounded-lg font-medium transition-all",
              tab === t.key ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            <span className={cn(tab === t.key ? t.color : "")}>{t.label}</span>
            <span className="ml-1 text-[10px] opacity-60">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card-premium rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {/* Divergências */}
          {tab === "divs" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-accent/10">
                  {["Data","Banco","Tipo","Descrição","Cliente","END2END","Vlr Banco","Vlr API","Δ Diferença","Categoria","Prior.","Status",""].map(c => (
                    <th key={c} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(divs ?? []).length === 0 && (
                  <tr><td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">Nenhuma divergência nesta sessão.</td></tr>
                )}
                {(divs ?? []).slice(0, 500).map((d: any, i: number) => (
                  <tr key={i} className={cn("hover:bg-accent/20",
                    d.status === "pendente" ? "border-l-2 border-l-yellow-500/40" :
                    d.status === "resolvido" ? "opacity-60" : ""
                  )}>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{safeDate(d.divergenceDate)}</td>
                    <td className="px-3 py-2 text-xs font-medium">{d.bankName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold",
                        d.divergenceType === "bank_surplus"
                          ? "bg-orange-500/10 text-orange-400"
                          : "bg-red-500/10 text-red-400"
                      )}>
                        {d.divergenceType === "bank_surplus" ? "↑ Banco" : "↓ API"}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate" title={d.bankDescription ?? ""}>{d.bankDescription ?? d.category ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[130px] truncate text-muted-foreground" title={d.clientName ?? d.apiDescription ?? ""}>{d.clientName ?? d.apiDescription ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[100px] truncate font-mono text-[10px] text-muted-foreground" title={d.externalId ?? ""}>
                      {d.externalId ? `...${d.externalId.slice(-12)}` : "—"}
                    </td>
                    <td className={cn("px-3 py-2 font-mono whitespace-nowrap", d.transactionType === "credit" ? "text-emerald-400" : "text-red-400")}>
                      {d.bankAmount ? formatCurrency(d.bankAmount) : "—"}
                    </td>
                    <td className={cn("px-3 py-2 font-mono whitespace-nowrap", d.transactionType === "credit" ? "text-blue-400" : "text-orange-400")}>
                      {d.apiAmount ? formatCurrency(d.apiAmount) : "—"}
                    </td>
                    <td className={cn("px-3 py-2 font-mono font-bold whitespace-nowrap", diffColor(parseFloat(d.amount ?? 0)))}>
                      {formatCurrency(d.amount)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-[10px] max-w-[100px] truncate">{d.category?.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold",
                        d.priority === "critical" ? "bg-red-500/10 text-red-400" :
                        d.priority === "high"     ? "bg-orange-500/10 text-orange-400" :
                        d.priority === "medium"   ? "bg-yellow-500/10 text-yellow-400" :
                                                    "bg-muted/20 text-muted-foreground"
                      )}>{d.priority}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Select value={d.status} onValueChange={v => updateDivMutation.mutate({ id: d.id, status: v })}>
                        <SelectTrigger className="h-6 text-[10px] w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["pendente","em_analise","identificado","regularizado","baixado","escalado_diretoria"].map(s => (
                            <SelectItem key={s} value={s} className="text-[10px]">{s.replace(/_/g, " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => { if (confirm("Remover divergência?")) deleteDivMutation.mutate({ id: d.id }); }}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Banco */}
          {tab === "banco" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-accent/10">
                  {["Data","Banco","Tipo","C/D","Descrição","Canal","END2END","Valor"].map(c => (
                    <th key={c} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(bankTxs ?? []).slice(0, 500).map((t: any, i: number) => (
                  <tr key={i} className="hover:bg-accent/20">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{safeDate(t.transactionDate)}</td>
                    <td className="px-3 py-2 font-medium">{t.bankName}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold",
                        t.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                      )}>{t.type === "credit" ? "Crédito" : "Débito"}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("font-bold text-xs", t.type === "credit" ? "text-emerald-400" : "text-red-400")}>
                        {t.type === "credit" ? "C" : "D"}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={t.description ?? ""}>{t.description ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.channel}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={t.externalId ?? ""}>
                      {t.externalId ? `...${t.externalId.slice(-16)}` : "—"}
                    </td>
                    <td className={cn("px-3 py-2 font-mono font-semibold whitespace-nowrap", t.type === "credit" ? "text-emerald-400" : "text-red-400")}>
                      {t.type === "credit" ? "+" : "-"}{formatCurrency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* API */}
          {tab === "api" && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-accent/10">
                  {["Data","C/D","Cliente","Descrição","END2END","Canal","Valor"].map(c => (
                    <th key={c} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(apiTxs ?? []).slice(0, 500).map((t: any, i: number) => (
                  <tr key={i} className="hover:bg-accent/20">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{safeDate(t.transactionDate)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("font-bold text-xs", t.type === "credit" ? "text-blue-400" : "text-orange-400")}>
                        {t.type === "credit" ? "C" : "D"}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[140px] truncate text-muted-foreground" title={t.clientName ?? ""}>{t.clientName ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={t.description ?? ""}>{t.description ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={t.externalId ?? ""}>
                      {t.externalId ? `...${t.externalId.slice(-16)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{t.channel}</td>
                    <td className={cn("px-3 py-2 font-mono font-semibold whitespace-nowrap", t.type === "credit" ? "text-blue-400" : "text-orange-400")}>
                      {t.type === "credit" ? "+" : "-"}{formatCurrency(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {tab === "divs" && (divs ?? []).length > 500 && (
          <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">Mostrando 500 de {(divs ?? []).length}</p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function Reconciliation() {
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().split("T")[0]);
  const [apiFile, setApiFile] = useState<File | null>(null);
  const [bankFiles, setBankFiles] = useState<Record<string, File | null>>({ jd: null, sicoob: null, bb: null });
  const [customBanks, setCustomBanks] = useState<CustomBank[]>([]);
  const [liveResult, setLiveResult] = useState<any>(null);
  const [liveMeta, setLiveMeta] = useState<any>(null);
  const [expanded, setExpanded] = useState<string>("matched");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualBack, setManualBack] = useState(false);

  const { data: sessions, refetch: refetchSessions } = trpc.reconciliation.getSessions.useQuery();
  const latestSessionId = (sessions as any[])?.[0]?.id ?? null;

  // Auto-abre última sessão ao entrar na página
  useEffect(() => {
    if (!liveResult && latestSessionId && selectedSession === null && !manualBack) {
      setSelectedSession(latestSessionId);
    }
  }, [latestSessionId, liveResult, manualBack]);

  const deleteSessionMutation = trpc.reconciliation.deleteSession.useMutation({
    onSuccess: () => {
      toast.success("Sessão removida.");
      refetchSessions();
      setSelectedSession(null);
      setManualBack(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const reconcileMutation = trpc.reconciliation.runReconciliation.useMutation({
    onSuccess: (data) => {
      // Conciliação assíncrona: a sessão entra como 'processing' e é processada
      // em segundo plano. Abrimos a sessão — a tela de detalhe acompanha o status.
      setUploadOpen(false);
      setManualBack(false);
      setLiveResult(null);
      setLiveMeta(null);
      toast.success("Conciliação iniciada — processando em segundo plano...");
      refetchSessions();
      setSelectedSession(data.sessionId);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleRun = async () => {
    const activeKnown = BANK_OPTIONS.filter(b => bankFiles[b.value]);
    const activeCustom = customBanks.filter(b => b.file && b.name.trim());
    const totalBanks = activeKnown.length + activeCustom.length;
    if (totalBanks === 0) { toast.error("Selecione ao menos 1 extrato bancário."); return; }
    if (totalBanks > 8) { toast.error("Máximo de 8 bancos por conciliação."); return; }
    if (!apiFile) { toast.error("Selecione o arquivo API Clientes."); return; }
    if (!referenceDate) { toast.error("Informe a data de referência."); return; }
    // Valida nomes de bancos personalizados
    const customWithoutName = customBanks.filter(b => b.file && !b.name.trim());
    if (customWithoutName.length > 0) { toast.error("Dê um nome a todos os bancos adicionados."); return; }
    try {
      const apiB64 = await fileToBase64(apiFile);
      const knownBanks = await Promise.all(activeKnown.map(async b => ({
        parserType: b.parserType as "sicoob" | "bb" | "jd" | "generic",
        displayName: b.label,
        fileBase64: await fileToBase64(bankFiles[b.value]!),
      })));
      const customParsed = await Promise.all(activeCustom.map(async b => ({
        parserType: "generic" as const,
        displayName: b.name.trim(),
        fileBase64: await fileToBase64(b.file!),
      })));
      reconcileMutation.mutate({
        referenceDate,
        apiFileBase64: apiB64,
        banks: [...knownBanks, ...customParsed],
      });
    } catch { toast.error("Erro ao ler os arquivos."); }
  };

  // Detail view
  if (selectedSession !== null) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conciliação Bancária</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Categoria 1 · Detalhe da sessão</p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => { setUploadOpen(true); setSelectedSession(null); setManualBack(true); }}>
            <Upload className="w-3.5 h-3.5" /> Nova Conciliação
          </Button>
        </div>
        <SessionDetail
          sessionId={selectedSession}
          onBack={() => { setSelectedSession(null); setManualBack(true); }}
          onDelete={() => { deleteSessionMutation.mutate({ id: selectedSession }); }}
        />

        {/* Histórico compacto */}
        {(sessions as any[])?.length > 1 && (
          <div className="card-premium rounded-xl overflow-hidden">
            <div className="px-5 py-2.5 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outras sessões</p>
            </div>
            <div className="divide-y divide-border">
              {(sessions as any[]).filter((s: any) => s.id !== selectedSession).slice(0, 10).map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent/20 text-xs cursor-pointer"
                  onClick={() => setSelectedSession(s.id)}>
                  <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.divergentCount > 0 ? "bg-yellow-400" : "bg-emerald-400")} />
                  <span className="text-muted-foreground w-24 shrink-0">{formatDate(s.referenceDate)}</span>
                  <span className="text-emerald-400">✅ {s.matchedCount}</span>
                  <span className="text-yellow-400">⚠️ {s.pendingCount ?? s.divergentCount ?? 0} pend.</span>
                  <span className="text-muted-foreground ml-auto text-[10px]">#{s.id}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main list view
  const s = liveResult?.summary;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conciliação Bancária</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Categoria 1 · Importação e cruzamento de extratos diários</p>
        </div>
        <Button className="gap-2" onClick={() => setUploadOpen(!uploadOpen)}>
          <Upload className="w-4 h-4" /> Nova Conciliação
        </Button>
      </div>

      {/* Upload Panel */}
      {uploadOpen && (
        <div className="card-premium rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Importar Extratos</h2>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setUploadOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-end gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Data de Referência *</Label>
              <Input type="date" value={referenceDate} onChange={e => setReferenceDate(e.target.value)} className="h-9 text-xs w-44" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Extratos Bancários (até 8 bancos)</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {BANK_OPTIONS.map(b => (
                <UploadZone key={b.value} label={b.label} color={b.color} border={b.border} bg={b.bg}
                  file={bankFiles[b.value]}
                  onFile={f => setBankFiles(p => ({ ...p, [b.value]: f }))}
                  onRemove={() => setBankFiles(p => ({ ...p, [b.value]: null }))} />
              ))}
            </div>

            {/* Bancos personalizados — qualquer instituição via parser inteligente */}
            {customBanks.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                {customBanks.map((cb) => (
                  <div key={cb.id} className="rounded-lg border border-border bg-card p-2 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={cb.name}
                        onChange={e => setCustomBanks(prev =>
                          prev.map(b => b.id === cb.id ? { ...b, name: e.target.value } : b))}
                        placeholder="Nome do banco (ex: Itaú)"
                        className="h-7 text-xs flex-1"
                      />
                      <button
                        onClick={() => setCustomBanks(prev => prev.filter(b => b.id !== cb.id))}
                        title="Remover banco"
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <UploadZone
                      label={cb.name.trim() || "Extrato bancário"}
                      color="text-violet-400" border="border-violet-500/30" bg="bg-violet-500/5"
                      file={cb.file}
                      onFile={f => setCustomBanks(prev =>
                        prev.map(b => b.id === cb.id ? { ...b, file: f } : b))}
                      onRemove={() => setCustomBanks(prev =>
                        prev.map(b => b.id === cb.id ? { ...b, file: null } : b))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Botão adicionar banco */}
            {(BANK_OPTIONS.length + customBanks.length) < 8 && (
              <button
                onClick={() => setCustomBanks(prev => [
                  ...prev,
                  { id: `cb-${Date.now()}-${prev.length}`, name: "", file: null },
                ])}
                className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/40 rounded-lg px-3 py-2 transition-colors w-full justify-center"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar outro banco
              </button>
            )}
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Bancos adicionais usam leitura inteligente — o sistema detecta as colunas automaticamente, independente do layout da planilha.
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">API Clientes Expag *</Label>
            <UploadZone label="API Clientes (Expag)" color="text-purple-400"
              border="border-purple-500/30" bg="bg-purple-500/5"
              file={apiFile} onFile={setApiFile} onRemove={() => setApiFile(null)} />
          </div>
          {liveMeta && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-300">
                Último: <span className="font-semibold">{liveMeta.banksProcessed?.map((b: any) => `${b.name} (${b.count})`).join(" · ")}</span>
                {" · "}API filtrada: <span className="font-semibold">{liveMeta.apiFilteredCount}</span>
                {" · "}Datas: <span className="font-semibold">{liveMeta.bankDates?.join(", ")}</span>
              </p>
            </div>
          )}
          <Button onClick={handleRun}
            disabled={!apiFile || (Object.values(bankFiles).every(f => !f) && customBanks.every(b => !b.file)) || reconcileMutation.isPending}
            className="w-full gap-2">
            {reconcileMutation.isPending
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processando...</>
              : <><ArrowRight className="w-4 h-4" /> Conciliar Agora</>}
          </Button>
        </div>
      )}

      {/* Histórico de sessões */}
      {(sessions as any[])?.length > 0 ? (
        <div className="card-premium rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Sessões de Conciliação</h2>
            <span className="text-xs text-muted-foreground">{(sessions as any[]).length} sessões</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-accent/10">
                  {["Data Ref.","Conciliados","Divergências","Entradas Banco","Saídas Banco","Entradas API","Saídas API","Taxa",""].map(c => (
                    <th key={c} className="text-left px-4 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(sessions as any[]).map((sess: any) => {
                  const realT = sess.matchedCount + (sess.pendingCount ?? sess.divergentCount ?? 0);
                  const rate = realT > 0
                    ? Math.round((sess.matchedCount / realT) * 100)
                    : 0;
                  return (
                    <tr key={sess.id} className="hover:bg-accent/20 cursor-pointer" onClick={() => setSelectedSession(sess.id)}>
                      <td className="px-4 py-3 font-medium">{formatDate(sess.referenceDate)}</td>
                      <td className="px-4 py-3 text-emerald-400 font-semibold">{sess.matchedCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("font-semibold", (sess.pendingCount ?? 0) > 0 ? "text-yellow-400" : "text-emerald-400")}>
                            {sess.pendingCount ?? sess.divergentCount ?? 0}
                          </span>
                          {sess.divergentCount > (sess.pendingCount ?? 0) * 3 && sess.pendingCount !== undefined && (
                            <span title="Sessão pode ter dados duplicados — abra para corrigir" className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1 cursor-help">fix</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-blue-400">{formatCurrency(sess.totalBankCredits ?? 0)}</td>
                      <td className="px-4 py-3 font-mono text-red-400">{formatCurrency(sess.totalBankDebits ?? 0)}</td>
                      <td className="px-4 py-3 font-mono text-purple-400">{formatCurrency(sess.totalApiCredits ?? 0)}</td>
                      <td className="px-4 py-3 font-mono text-orange-400">{formatCurrency(sess.totalApiDebits ?? 0)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-border rounded-full h-1.5">
                            <div className={cn("h-1.5 rounded-full", rate >= 90 ? "bg-emerald-400" : rate >= 70 ? "bg-yellow-400" : "bg-red-400")}
                              style={{ width: `${rate}%` }} />
                          </div>
                          <span className={cn("font-semibold", rate >= 90 ? "text-emerald-400" : rate >= 70 ? "text-yellow-400" : "text-red-400")}>
                            {rate}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                            onClick={e => { e.stopPropagation(); setSelectedSession(sess.id); }}>
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                            onClick={e => { e.stopPropagation(); if (confirm(`Remover sessão #${sess.id}?`)) deleteSessionMutation.mutate({ id: sess.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card-premium rounded-xl p-16 text-center">
          <Scale className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-sm font-semibold text-foreground">Nenhuma conciliação realizada</p>
          <p className="text-xs text-muted-foreground mt-1">Clique em "Nova Conciliação" para começar.</p>
        </div>
      )}
    </div>
  );
}
