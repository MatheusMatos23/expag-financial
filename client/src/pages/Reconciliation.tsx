import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState, useRef } from "react";
import {
  Upload, CheckCircle, AlertTriangle, XCircle, ArrowRight,
  FileSpreadsheet, RefreshCw, ChevronDown, ChevronUp, Info,
  Trash2, Eye, ArrowLeft, X, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BANK_OPTIONS = [
  { value: "jd",     label: "JD (Expag)",       color: "text-blue-400",   bg: "bg-blue-500/10" },
  { value: "sicoob", label: "Sicoob",            color: "text-green-400",  bg: "bg-green-500/10" },
  { value: "bb",     label: "Banco do Brasil",   color: "text-yellow-400", bg: "bg-yellow-500/10" },
];

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
  const s = String(val);
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

function UploadZone({ label, file, onFile, onRemove, color }: {
  label: string; file: File | null; onFile: (f: File) => void; onRemove: () => void; color: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div className={cn("relative rounded-xl border-2 border-dashed p-4 transition-all",
      drag ? "border-primary bg-primary/5" : file ? "border-emerald-500/40 bg-emerald-500/5" : "border-border hover:border-primary/30"
    )}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-emerald-400 truncate">{file.name}</p>
            <p className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onRemove}><X className="w-3.5 h-3.5" /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => ref.current?.click()}>
          <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
          <div>
            <p className={cn("text-xs font-semibold", color)}>{label}</p>
            <p className="text-[10px] text-muted-foreground">Clique ou arraste • .xlsx</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session Detail ────────────────────────────────────────────────────────────
function SessionDetail({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const [expanded, setExpanded] = useState<string | null>("divs");
  const { data, isLoading, refetch } = trpc.reconciliation.getSessionTransactions.useQuery({ id: sessionId });

  const deleteDivMutation = trpc.reconciliation.deleteDivergence.useMutation({
    onSuccess: () => { toast.success("Divergência removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const updateDivMutation = trpc.reconciliation.updateDivergence.useMutation({
    onSuccess: () => { toast.success("Status atualizado."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground text-sm">Carregando sessão...</div>;
  if (!data) return <div className="text-center py-12 text-muted-foreground text-sm">Sessão não encontrada.</div>;

  const { session, bankTxs, apiTxs, divs } = data as any;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </Button>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Sessão #{session.id} — {formatDate(session.referenceDate)}</h2>
          <p className="text-xs text-muted-foreground">{session.matchedCount} conciliados · {session.divergentCount} divergentes</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Entradas Banco", value: session.totalBankCredits, color: "text-emerald-400" },
          { label: "Saídas Banco",   value: session.totalBankDebits,  color: "text-red-400" },
          { label: "Entradas API",   value: session.totalApiCredits,  color: "text-blue-400" },
          { label: "Saídas API",     value: session.totalApiDebits,   color: "text-orange-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={cn("text-base font-bold font-mono", color)}>{formatCurrency(value ?? 0)}</p>
          </div>
        ))}
      </div>

      {[
        { key: "divs",  label: `Divergências (${(divs ?? []).length})`,         items: divs ?? [] },
        { key: "bank",  label: `Transações Banco (${(bankTxs ?? []).length})`,  items: bankTxs ?? [] },
        { key: "api",   label: `Transações API (${(apiTxs ?? []).length})`,     items: apiTxs ?? [] },
      ].map(sec => (
        <div key={sec.key} className="bg-card border border-border rounded-xl overflow-hidden">
          <button className="w-full flex items-center justify-between px-5 py-3 border-b border-border hover:bg-accent/20"
            onClick={() => setExpanded(expanded === sec.key ? null : sec.key)}>
            <span className="text-sm font-semibold text-foreground">{sec.label}</span>
            {expanded === sec.key ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {expanded === sec.key && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-accent/10">
                    {sec.key === "divs"  && ["Data","Banco","Tipo","Categoria","Valor","Status",""].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                    {sec.key === "bank"  && ["Data","Banco","Descrição","Canal","Tipo","Valor"].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                    {sec.key === "api"   && ["Data","Cliente","Descrição","Tipo","Valor"].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sec.items.slice(0, 300).map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-accent/20">
                      {sec.key === "divs" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.divergenceDate)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{item.bankName}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.divergenceType === "bank_surplus" ? "bg-orange-500/10 text-orange-400" : "bg-red-500/10 text-red-400")}>{item.divergenceType === "bank_surplus" ? "Sobra" : "Falta"}</span></td>
                        <td className="px-4 py-2 text-muted-foreground max-w-[140px] truncate">{item.category}</td>
                        <td className="px-4 py-2 font-mono text-yellow-400">{formatCurrency(item.amount)}</td>
                        <td className="px-4 py-2">
                          <Select value={item.status} onValueChange={v => updateDivMutation.mutate({ id: item.id, status: v })}>
                            <SelectTrigger className="h-6 text-[10px] w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["pendente","em_analise","resolvido","ignorado"].map(s => <SelectItem key={s} value={s} className="text-[10px]">{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                            onClick={() => { if (confirm("Remover?")) deleteDivMutation.mutate({ id: item.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </>}
                      {sec.key === "bank" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.transactionDate)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{item.bankName}</td>
                        <td className="px-4 py-2 max-w-[160px] truncate">{item.description}</td>
                        <td className="px-4 py-2 text-muted-foreground">{item.channel}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                        <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-emerald-400" : "text-red-400")}>{formatCurrency(item.amount)}</td>
                      </>}
                      {sec.key === "api" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.transactionDate)}</td>
                        <td className="px-4 py-2 max-w-[140px] truncate text-muted-foreground">{item.clientName}</td>
                        <td className="px-4 py-2 max-w-[160px] truncate">{item.description}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                        <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-blue-400" : "text-orange-400")}>{formatCurrency(item.amount)}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sec.items.length > 300 && <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">Mostrando 300 de {sec.items.length}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Reconciliation() {
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().split("T")[0]);
  const [apiFile, setApiFile] = useState<File | null>(null);
  const [bankFiles, setBankFiles] = useState<Record<string, File | null>>({ jd: null, sicoob: null, bb: null });
  const [liveResult, setLiveResult] = useState<any>(null);
  const [liveMeta, setLiveMeta] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>("matched");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [uploadCollapsed, setUploadCollapsed] = useState(false);

  const { data: sessions, refetch: refetchSessions } = trpc.reconciliation.getSessions.useQuery();

  // Auto-carrega a sessão mais recente quando não há resultado ao vivo
  const latestSessionId = (sessions as any[])?.[0]?.id ?? null;
  const { data: latestSessionData } = trpc.reconciliation.getSessionTransactions.useQuery(
    { id: latestSessionId! },
    { enabled: !!latestSessionId && !liveResult && selectedSession === null }
  );

  const deleteSessionMutation = trpc.reconciliation.deleteSession.useMutation({
    onSuccess: () => { toast.success("Sessão removida."); refetchSessions(); setSelectedSession(null); },
    onError: (e) => toast.error(e.message),
  });

  const reconcileMutation = trpc.reconciliation.runReconciliation.useMutation({
    onSuccess: (data) => {
      setLiveResult(data.result);
      setLiveMeta(data);
      setUploadCollapsed(true);
      const s = data.result.summary;
      toast.success(`Concluído! ✅ ${s.matchedCount} · ⚠️ ${s.divergentCount} · ❓ ${s.unmatchedBankCount + s.unmatchedApiCount}`);
      refetchSessions();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleRun = async () => {
    const activeBanks = BANK_OPTIONS.filter(b => bankFiles[b.value]);
    if (activeBanks.length === 0) { toast.error("Selecione ao menos 1 extrato bancário."); return; }
    if (!apiFile) { toast.error("Selecione o arquivo API Clientes."); return; }
    if (!referenceDate) { toast.error("Informe a data de referência."); return; }
    try {
      const apiB64 = await fileToBase64(apiFile);
      const banks = await Promise.all(activeBanks.map(async b => ({
        name: b.value as "sicoob" | "bb" | "jd",
        fileBase64: await fileToBase64(bankFiles[b.value]!),
      })));
      reconcileMutation.mutate({ referenceDate, apiFileBase64: apiB64, banks });
    } catch { toast.error("Erro ao ler os arquivos."); }
  };

  if (selectedSession !== null) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conciliação Bancária</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 1 · Detalhe da sessão</p>
        </div>
        <SessionDetail sessionId={selectedSession} onBack={() => setSelectedSession(null)} />
      </div>
    );
  }

  // Usa resultado ao vivo OU dados da sessão mais recente do DB
  const displaySession = liveResult ? null : (latestSessionData as any);
  const displaySummary = liveResult?.summary ?? null;
  const displayMatches = liveResult?.matches ?? [];
  const displayUnmatchedApi = liveResult?.unmatchedApi ?? [];

  const s = displaySummary;
  const matches = displayMatches;
  const unmatchedApi = displayUnmatchedApi;
  const conciliados = matches.filter((m: any) => m.status === "matched");
  const divergentes = matches.filter((m: any) => m.status === "divergent");
  const semParBanco = matches.filter((m: any) => m.status === "unmatched_bank");

  const SECTIONS = [
    { key: "matched",   label: "Conciliados",  items: conciliados,  color: "text-emerald-400", icon: CheckCircle },
    { key: "divergent", label: "Divergentes",  items: divergentes,  color: "text-yellow-400",  icon: AlertTriangle },
    { key: "bank_only", label: "Só no Banco",  items: semParBanco,  color: "text-orange-400",  icon: XCircle },
    { key: "api_only",  label: "Só na API",    items: unmatchedApi.map((tx: any) => ({ apiTx: tx, status: "unmatched_api" })), color: "text-red-400", icon: XCircle },
  ].filter(sec => sec.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conciliação Bancária</h1>
        <p className="text-sm text-muted-foreground mt-1">Categoria 1 · Importação diária de extratos</p>
      </div>

      {/* Upload Panel */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button className="w-full flex items-center justify-between px-5 py-3 hover:bg-accent/20"
          onClick={() => setUploadCollapsed(!uploadCollapsed)}>
          <h2 className="text-sm font-semibold text-foreground">
            {uploadCollapsed ? "📥 Nova Conciliação" : "Importar Extratos"}
          </h2>
          {uploadCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        </button>

        {!uploadCollapsed && (
        <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">

        {/* Data */}
        <div className="flex items-end gap-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Data de Referência *</Label>
            <Input type="date" value={referenceDate} onChange={e => setReferenceDate(e.target.value)} className="h-9 text-xs w-44" />
          </div>
        </div>

        {/* Bancos */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Extratos Bancários (selecione 1 a 3)</Label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {BANK_OPTIONS.map(b => (
              <UploadZone
                key={b.value}
                label={b.label}
                color={b.color}
                file={bankFiles[b.value]}
                onFile={f => setBankFiles(prev => ({ ...prev, [b.value]: f }))}
                onRemove={() => setBankFiles(prev => ({ ...prev, [b.value]: null }))}
              />
            ))}
          </div>
        </div>

        {/* API */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">API Clientes Expag *</Label>
          <UploadZone
            label="API Clientes (Expag)"
            color="text-purple-400"
            file={apiFile}
            onFile={setApiFile}
            onRemove={() => setApiFile(null)}
          />
        </div>

        {/* Info */}
        {liveMeta && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              Bancos: <span className="font-semibold">{liveMeta.banksProcessed?.map((b: any) => `${b.name} (${b.count})`).join(" · ")}</span>
              {" · "}API filtrada: <span className="font-semibold">{liveMeta.apiFilteredCount} transações</span>
              {" · "}Datas: <span className="font-semibold">{liveMeta.bankDates?.join(", ")}</span>
            </p>
          </div>
        )}

        <Button
          onClick={handleRun}
          disabled={!apiFile || Object.values(bankFiles).every(f => !f) || reconcileMutation.isPending}
          className="w-full gap-2"
        >
          {reconcileMutation.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processando...</>
            : <><ArrowRight className="w-4 h-4" /> Conciliar</>}
        </Button>
        </div>
        )}
      </div>

      {/* Sessão mais recente do DB (quando não há resultado ao vivo) */}
      {!liveResult && displaySession && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Última Conciliação — {formatDate(displaySession.session.referenceDate)}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Sessão #{displaySession.session.id} · {displaySession.session.matchedCount} conciliados · {displaySession.session.divergentCount} divergentes</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setSelectedSession(latestSessionId)}>
              <Eye className="w-3.5 h-3.5" /> Ver detalhes
            </Button>
          </div>

          {/* KPIs da sessão */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Conciliados", value: displaySession.session.matchedCount,  color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle },
              { label: "Divergentes", value: displaySession.session.divergentCount, color: "text-yellow-400",  bg: "bg-yellow-500/10",  icon: AlertTriangle },
              { label: "Entradas Banco", value: null, amount: displaySession.session.totalBankCredits, color: "text-blue-400", bg: "bg-blue-500/10", icon: CheckCircle },
              { label: "Saídas Banco",   value: null, amount: displaySession.session.totalBankDebits,  color: "text-red-400",  bg: "bg-red-500/10",  icon: XCircle },
            ].map(({ label, value, amount, color, bg, icon: Icon }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}><Icon className={cn("w-4 h-4", color)} /></div>
                <p className={cn("text-xl font-bold font-mono", color)}>
                  {value != null ? value : formatCurrency(amount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Transações do banco */}
          {[
            { key: "bank", label: `Transações Banco (${displaySession.bankTxs?.length ?? 0})`, items: displaySession.bankTxs ?? [] },
            { key: "api",  label: `Transações API (${displaySession.apiTxs?.length ?? 0})`,    items: displaySession.apiTxs ?? [] },
            { key: "divs", label: `Divergências (${displaySession.divs?.length ?? 0})`,         items: displaySession.divs ?? [] },
          ].map(sec => (
            <div key={sec.key} className="bg-card border border-border rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-3 border-b border-border hover:bg-accent/20"
                onClick={() => setExpanded(expanded === sec.key ? null : sec.key)}>
                <span className="text-sm font-semibold text-foreground">{sec.label}</span>
                {expanded === sec.key ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {expanded === sec.key && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-accent/10">
                        {sec.key === "bank" && ["Data","Banco","Descrição","Canal","Tipo","Valor"].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                        {sec.key === "api"  && ["Data","Cliente","Descrição","Tipo","Valor"].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                        {sec.key === "divs" && ["Data","Banco","Tipo","Valor","Status"].map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sec.items.slice(0, 100).map((item: any, i: number) => (
                        <tr key={i} className="hover:bg-accent/20">
                          {sec.key === "bank" && <>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.transactionDate)}</td>
                            <td className="px-4 py-2 text-muted-foreground">{item.bankName}</td>
                            <td className="px-4 py-2 max-w-[160px] truncate">{item.description}</td>
                            <td className="px-4 py-2 text-muted-foreground">{item.channel}</td>
                            <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                            <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-emerald-400" : "text-red-400")}>{formatCurrency(item.amount)}</td>
                          </>}
                          {sec.key === "api" && <>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.transactionDate)}</td>
                            <td className="px-4 py-2 max-w-[140px] truncate text-muted-foreground">{item.clientName}</td>
                            <td className="px-4 py-2 max-w-[160px] truncate">{item.description}</td>
                            <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                            <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-blue-400" : "text-orange-400")}>{formatCurrency(item.amount)}</td>
                          </>}
                          {sec.key === "divs" && <>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{safeDate(item.divergenceDate)}</td>
                            <td className="px-4 py-2 text-muted-foreground">{item.bankName}</td>
                            <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.divergenceType === "bank_surplus" ? "bg-orange-500/10 text-orange-400" : "bg-red-500/10 text-red-400")}>{item.divergenceType === "bank_surplus" ? "Sobra" : "Falta"}</span></td>
                            <td className="px-4 py-2 font-mono text-yellow-400">{formatCurrency(item.amount)}</td>
                            <td className="px-4 py-2 text-muted-foreground">{item.status}</td>
                          </>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sec.items.length > 100 && <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">Mostrando 100 de {sec.items.length}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Live Results */}
      {liveResult && s && (
        <div className="space-y-4">
          {/* Por banco */}
          {Object.keys(s.byBank ?? {}).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(s.byBank).map(([name, stats]: any) => (
                <div key={name} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground uppercase">{name}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Entradas</span><span className="font-mono text-emerald-400">{formatCurrency(stats.credits)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Saídas</span><span className="font-mono text-red-400">{formatCurrency(stats.debits)}</span></div>
                    <div className="flex justify-between pt-1 border-t border-border/40"><span className="text-muted-foreground">Conciliados</span><span className="text-emerald-400">{stats.matched}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Divergentes</span><span className="text-yellow-400">{stats.divergent}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sem par</span><span className="text-orange-400">{stats.unmatched}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KPIs totais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Conciliados", value: s.matchedCount,       color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle },
              { label: "Divergentes", value: s.divergentCount,     color: "text-yellow-400",  bg: "bg-yellow-500/10",  icon: AlertTriangle },
              { label: "Só no Banco", value: s.unmatchedBankCount, color: "text-orange-400",  bg: "bg-orange-500/10",  icon: XCircle },
              { label: "Só na API",   value: s.unmatchedApiCount,  color: "text-red-400",     bg: "bg-red-500/10",     icon: XCircle },
            ].map(({ label, value, color, bg, icon: Icon }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}><Icon className={cn("w-4 h-4", color)} /></div>
                <p className={cn("text-2xl font-bold", color)}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Tabelas */}
          {SECTIONS.map(sec => (
            <div key={sec.key} className="bg-card border border-border rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-3 border-b border-border hover:bg-accent/20"
                onClick={() => setExpanded(expanded === sec.key ? null : sec.key)}>
                <div className="flex items-center gap-2">
                  <sec.icon className={cn("w-4 h-4", sec.color)} />
                  <span className={cn("text-sm font-semibold", sec.color)}>{sec.label}</span>
                  <span className="text-xs text-muted-foreground">({sec.items.length})</span>
                </div>
                {expanded === sec.key ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {expanded === sec.key && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-accent/10">
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Data</th>
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Banco</th>
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Descrição</th>
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Cliente</th>
                        <th className="text-center px-4 py-2 text-muted-foreground font-medium">Tipo</th>
                        <th className="text-right px-4 py-2 text-muted-foreground font-medium">Banco</th>
                        <th className="text-right px-4 py-2 text-muted-foreground font-medium">API</th>
                        {sec.key === "divergent" && <th className="text-right px-4 py-2 text-muted-foreground font-medium">Diferença</th>}
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sec.items.slice(0, 200).map((item: any, i: number) => {
                        const bk = item.bankTx; const ap = item.apiTx; const tx = bk ?? ap;
                        return (
                          <tr key={i} className="hover:bg-accent/20">
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{tx?.date}</td>
                            <td className="px-4 py-2 text-muted-foreground">{item.bankName ?? "—"}</td>
                            <td className="px-4 py-2 max-w-[140px] truncate">{bk?.description ?? ap?.description}</td>
                            <td className="px-4 py-2 max-w-[120px] truncate text-muted-foreground">{ap?.clientName ?? "—"}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", tx?.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                                {tx?.type === "credit" ? "C" : "D"}
                              </span>
                            </td>
                            <td className={cn("px-4 py-2 font-mono text-right", bk?.type === "credit" ? "text-emerald-400" : "text-red-400")}>{bk ? formatCurrency(bk.amount) : "—"}</td>
                            <td className={cn("px-4 py-2 font-mono text-right", ap?.type === "credit" ? "text-blue-400" : "text-orange-400")}>{ap ? formatCurrency(ap.amount) : "—"}</td>
                            {sec.key === "divergent" && <td className="px-4 py-2 font-mono text-right text-yellow-400 font-semibold">{item.difference != null ? formatCurrency(item.difference) : "—"}</td>}
                            <td className="px-4 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/40 text-muted-foreground">{item.matchType ?? "—"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sec.items.length > 200 && <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">Mostrando 200 de {sec.items.length}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Histórico */}
      {(sessions ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Histórico de Conciliações</h2>
            <span className="text-xs text-muted-foreground">{(sessions as any[]).length} sessões</span>
          </div>
          <div className="divide-y divide-border">
            {(sessions as any[]).slice(0, 30).map((sess: any) => {
              const isCurrent = liveMeta?.sessionId === sess.id;
              return (
                <div key={sess.id}
                  className={cn("flex items-center gap-3 px-5 py-3 hover:bg-accent/20 text-xs cursor-pointer", isCurrent && "bg-primary/5 border-l-2 border-primary")}
                  onClick={() => setSelectedSession(sess.id)}
                >
                  <div className={cn("w-2 h-2 rounded-full shrink-0", sess.divergentCount > 0 ? "bg-yellow-400" : "bg-emerald-400")} />
                  <span className="text-muted-foreground w-24 shrink-0">{formatDate(sess.referenceDate)}</span>
                  <span className="text-emerald-400 shrink-0">✅ {sess.matchedCount}</span>
                  <span className="text-yellow-400 shrink-0">⚠️ {sess.divergentCount}</span>
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">atual</span>}
                  <div className="flex items-center gap-1 ml-auto" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                      onClick={() => setSelectedSession(sess.id)}>
                      <Eye className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                      onClick={() => { if (confirm(`Remover sessão #${sess.id}?`)) deleteSessionMutation.mutate({ id: sess.id }); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
