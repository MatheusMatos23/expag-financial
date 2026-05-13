import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState, useRef } from "react";
import {
  Upload, CheckCircle, AlertTriangle, XCircle, ArrowRight,
  FileSpreadsheet, RefreshCw, ChevronDown, ChevronUp, Info,
  Trash2, Eye, ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BANKS = [
  { value: "sicoob", label: "Sicoob" },
  { value: "bb",     label: "Banco do Brasil" },
  { value: "jd",     label: "JD (Expag)" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function UploadZone({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-all",
        drag ? "border-primary bg-primary/5" : file ? "border-green-500/40 bg-green-500/5" : "border-border hover:border-primary/40 hover:bg-accent/20"
      )}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <>
          <FileSpreadsheet className="w-6 h-6 text-green-400" />
          <p className="text-xs font-semibold text-green-400 truncate max-w-full px-2">{file.name}</p>
          <p className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
        </>
      ) : (
        <>
          <Upload className="w-6 h-6 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">Arraste ou clique • .xlsx</p>
        </>
      )}
    </div>
  );
}

// ── Session Detail View ────────────────────────────────────────────────────────
function SessionDetail({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const [expanded, setExpanded] = useState<string | null>("bank");
  const { data, isLoading, refetch } = trpc.reconciliation.getSessionTransactions.useQuery({ id: sessionId });
  const deleteDivMutation = trpc.reconciliation.deleteDivergence.useMutation({
    onSuccess: () => { toast.success("Divergência removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const updateDivMutation = trpc.reconciliation.updateDivergence.useMutation({
    onSuccess: () => { toast.success("Divergência atualizada."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-center py-10 text-muted-foreground text-sm">Carregando...</div>;
  if (!data) return <div className="text-center py-10 text-muted-foreground text-sm">Sessão não encontrada.</div>;

  const { session, bankTxs, apiTxs, divs } = data as any;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Button>
        <div>
          <h2 className="text-base font-semibold text-foreground">Sessão #{session.id} — {formatDate(session.referenceDate)}</h2>
          <p className="text-xs text-muted-foreground">{session.matchedCount} conciliados · {session.divergentCount} divergentes</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Banco Entradas", value: session.totalBankCredits, color: "text-emerald-400" },
          { label: "Total Banco Saídas",   value: session.totalBankDebits,  color: "text-red-400" },
          { label: "Total API Entradas",   value: session.totalApiCredits,  color: "text-blue-400" },
          { label: "Total API Saídas",     value: session.totalApiDebits,   color: "text-orange-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={cn("text-base font-bold font-mono", color)}>{formatCurrency(value ?? 0)}</p>
          </div>
        ))}
      </div>

      {/* Sections */}
      {[
        { key: "bank",  label: `Transações Banco (${bankTxs?.length ?? 0})`, items: bankTxs ?? [], cols: ["Data", "Descrição", "Canal", "Tipo", "Valor"] },
        { key: "api",   label: `Transações API (${apiTxs?.length ?? 0})`,   items: apiTxs ?? [],  cols: ["Data", "Cliente", "Descrição", "Tipo", "Valor"] },
        { key: "divs",  label: `Divergências (${divs?.length ?? 0})`,        items: divs ?? [],    cols: ["Data", "Tipo", "Categoria", "Valor", "Status", "Ações"] },
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
                    {sec.cols.map(c => <th key={c} className="text-left px-4 py-2 text-muted-foreground font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sec.items.slice(0, 200).map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-accent/20">
                      {sec.key === "bank" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{item.transactionDate?.slice(0,10)}</td>
                        <td className="px-4 py-2 max-w-xs truncate">{item.description}</td>
                        <td className="px-4 py-2 text-muted-foreground">{item.channel}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                        <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-emerald-400" : "text-red-400")}>{formatCurrency(item.amount)}</td>
                      </>}
                      {sec.key === "api" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{item.transactionDate?.slice(0,10)}</td>
                        <td className="px-4 py-2 max-w-[140px] truncate text-muted-foreground">{item.clientName}</td>
                        <td className="px-4 py-2 max-w-xs truncate">{item.description}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.type === "credit" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400")}>{item.type === "credit" ? "C" : "D"}</span></td>
                        <td className={cn("px-4 py-2 font-mono", item.type === "credit" ? "text-blue-400" : "text-orange-400")}>{formatCurrency(item.amount)}</td>
                      </>}
                      {sec.key === "divs" && <>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{item.divergenceDate?.slice(0,10)}</td>
                        <td className="px-4 py-2"><span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", item.divergenceType === "bank_surplus" ? "bg-orange-500/10 text-orange-400" : "bg-red-500/10 text-red-400")}>{item.divergenceType === "bank_surplus" ? "Sobra Banco" : "Falta Banco"}</span></td>
                        <td className="px-4 py-2 text-muted-foreground">{item.category}</td>
                        <td className="px-4 py-2 font-mono text-yellow-400">{formatCurrency(item.amount)}</td>
                        <td className="px-4 py-2">
                          <Select value={item.status} onValueChange={v => updateDivMutation.mutate({ id: item.id, status: v })}>
                            <SelectTrigger className="h-6 text-[10px] w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["pendente","em_analise","resolvido","ignorado"].map(s => <SelectItem key={s} value={s} className="text-[10px]">{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                            onClick={() => { if (confirm("Remover esta divergência?")) deleteDivMutation.mutate({ id: item.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sec.items.length > 200 && <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">Mostrando 200 de {sec.items.length}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Reconciliation() {
  const [bank, setBank] = useState("jd");
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [apiFile, setApiFile] = useState<File | null>(null);
  const [liveResult, setLiveResult] = useState<any>(null);
  const [liveMeta, setLiveMeta] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>("matched");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  const { data: sessions, refetch: refetchSessions } = trpc.reconciliation.getSessions.useQuery();

  const deleteSessionMutation = trpc.reconciliation.deleteSession.useMutation({
    onSuccess: () => { toast.success("Sessão removida."); refetchSessions(); setSelectedSession(null); },
    onError: (e) => toast.error(e.message),
  });

  const reconcileMutation = trpc.reconciliation.runReconciliation.useMutation({
    onSuccess: (data) => {
      setLiveResult(data.result);
      setLiveMeta({ bankDates: data.bankDates, apiFilteredCount: data.apiFilteredCount, sessionId: data.sessionId });
      const s = data.result.summary;
      toast.success(`Concluído! ✅ ${s.matchedCount} · ⚠️ ${s.divergentCount} · ❓ ${s.unmatchedBankCount + s.unmatchedApiCount}`);
      refetchSessions();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleRun = async () => {
    if (!bankFile || !apiFile) { toast.error("Selecione os dois arquivos."); return; }
    try {
      const [bankB64, apiB64] = await Promise.all([fileToBase64(bankFile), fileToBase64(apiFile)]);
      const today = new Date().toISOString().split("T")[0];
      reconcileMutation.mutate({ referenceDate: today, bankFileBase64: bankB64, apiFileBase64: apiB64, bank: bank as any });
    } catch { toast.error("Erro ao ler os arquivos."); }
  };

  // Session detail view
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

  const s = liveResult?.summary;
  const matches = liveResult?.matches ?? [];
  const unmatchedApi = liveResult?.unmatchedApi ?? [];
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
        <p className="text-sm text-muted-foreground mt-1">Categoria 1 · Importação e cruzamento de extratos diários</p>
      </div>

      {/* Upload */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Importar Extratos do Dia</h2>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Banco *</label>
          <Select value={bank} onValueChange={v => { setBank(v); setBankFile(null); setLiveResult(null); }}>
            <SelectTrigger className="h-9 text-xs w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{BANKS.map(b => <SelectItem key={b.value} value={b.value} className="text-xs">{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Extrato {BANKS.find(b => b.value === bank)?.label}</label>
            <UploadZone label={`Extrato ${BANKS.find(b => b.value === bank)?.label}`} file={bankFile} onFile={setBankFile} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">API Clientes (Expag)</label>
            <UploadZone label="API Clientes" file={apiFile} onFile={setApiFile} />
          </div>
        </div>
        {liveMeta && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              Datas detectadas: <span className="font-semibold">{liveMeta.bankDates?.sort().join(", ")}</span> · API filtrada: <span className="font-semibold">{liveMeta.apiFilteredCount} transações</span>
            </p>
          </div>
        )}
        <Button onClick={handleRun} disabled={!bankFile || !apiFile || reconcileMutation.isPending} className="w-full gap-2">
          {reconcileMutation.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processando...</> : <><ArrowRight className="w-4 h-4" /> Conciliar</>}
        </Button>
      </div>

      {/* Live Results */}
      {liveResult && s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Conciliados", value: s.matchedCount, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle },
              { label: "Divergentes", value: s.divergentCount, color: "text-yellow-400", bg: "bg-yellow-500/10", icon: AlertTriangle },
              { label: "Só no Banco", value: s.unmatchedBankCount, color: "text-orange-400", bg: "bg-orange-500/10", icon: XCircle },
              { label: "Só na API",   value: s.unmatchedApiCount, color: "text-red-400", bg: "bg-red-500/10", icon: XCircle },
            ].map(({ label, value, color, bg, icon: Icon }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}><Icon className={cn("w-4 h-4", color)} /></div>
                <p className={cn("text-2xl font-bold", color)}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Entradas Banco", value: s.totalBankCredits, color: "text-emerald-400" },
              { label: "Saídas Banco",   value: s.totalBankDebits,  color: "text-red-400" },
              { label: "Entradas API",   value: s.totalApiCredits,  color: "text-blue-400" },
              { label: "Saídas API",     value: s.totalApiDebits,   color: "text-orange-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className={cn("text-base font-bold font-mono", color)}>{formatCurrency(value)}</p>
              </div>
            ))}
          </div>
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
                            <td className="px-4 py-2 max-w-[160px] truncate">{bk?.description ?? ap?.description}</td>
                            <td className="px-4 py-2 max-w-[130px] truncate text-muted-foreground">{ap?.clientName ?? "—"}</td>
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
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => { if (liveMeta?.sessionId) setSelectedSession(liveMeta.sessionId); }}>
              <Eye className="w-3.5 h-3.5" /> Ver sessão salva
            </Button>
          </div>
        </div>
      )}

      {/* Histórico */}
      {(sessions ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Histórico de Conciliações</h2>
          </div>
          <div className="divide-y divide-border">
            {(sessions as any[]).slice(0, 20).map((sess: any) => (
              <div key={sess.id} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/20 text-xs">
                <div className={cn("w-2 h-2 rounded-full shrink-0", sess.divergentCount > 0 ? "bg-yellow-400" : "bg-emerald-400")} />
                <span className="text-muted-foreground w-24 shrink-0">{formatDate(sess.referenceDate)}</span>
                <span className="text-emerald-400 shrink-0">✅ {sess.matchedCount}</span>
                <span className="text-yellow-400 shrink-0">⚠️ {sess.divergentCount}</span>
                <span className="text-muted-foreground">#{sess.id}</span>
                <div className="flex items-center gap-1 ml-auto">
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
