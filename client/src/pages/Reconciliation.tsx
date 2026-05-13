import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertTriangle, XCircle, ArrowRight, FileSpreadsheet, RefreshCw, ChevronDown, ChevronUp, Info } from "lucide-react";
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
          <p className="text-xs font-semibold text-green-400 text-center truncate max-w-full px-2">{file.name}</p>
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

export default function Reconciliation() {
  const [bank, setBank] = useState("jd");
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [apiFile, setApiFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>("matched");

  const { data: sessions, refetch: refetchSessions } = trpc.reconciliation.getSessions.useQuery();

  const reconcileMutation = trpc.reconciliation.runReconciliation.useMutation({
    onSuccess: (data) => {
      setResult(data.result);
      setMeta({ bankDates: data.bankDates, apiFilteredCount: data.apiFilteredCount });
      const s = data.result.summary;
      toast.success(`Concluído! ✅ ${s.matchedCount} conciliados · ⚠️ ${s.divergentCount} divergentes · ❓ ${s.unmatchedBankCount + s.unmatchedApiCount} sem par`);
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

  const s = result?.summary;
  const matches = result?.matches ?? [];
  const unmatchedApi = result?.unmatchedApi ?? [];
  const conciliados = matches.filter((m: any) => m.status === "matched");
  const divergentes = matches.filter((m: any) => m.status === "divergent");
  const semParBanco = matches.filter((m: any) => m.status === "unmatched_bank");

  const SECTIONS = [
    { key: "matched",   label: "Conciliados",   items: conciliados,  color: "text-emerald-400", icon: CheckCircle },
    { key: "divergent", label: "Divergentes",   items: divergentes,  color: "text-yellow-400",  icon: AlertTriangle },
    { key: "bank_only", label: "Só no Banco",   items: semParBanco,  color: "text-orange-400",  icon: XCircle },
    { key: "api_only",  label: "Só na API",     items: unmatchedApi.map((tx: any) => ({ apiTx: tx, status: "unmatched_api" })), color: "text-red-400", icon: XCircle },
  ].filter(sec => sec.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conciliação Bancária</h1>
        <p className="text-sm text-muted-foreground mt-1">Categoria 1 · Importação e cruzamento de extratos diários</p>
      </div>

      {/* Upload Panel */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Importar Extratos do Dia</h2>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Banco *</label>
          <Select value={bank} onValueChange={v => { setBank(v); setBankFile(null); setResult(null); }}>
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
            <UploadZone label="API Clientes (Expag)" file={apiFile} onFile={setApiFile} />
          </div>
        </div>
        {meta && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-300">
              Extrato bancário: {meta.bankDates?.sort().join(", ")} · API filtrada para {meta.apiFilteredCount} transações do mesmo período
            </p>
          </div>
        )}
        <Button onClick={handleRun} disabled={!bankFile || !apiFile || reconcileMutation.isPending} className="w-full gap-2">
          {reconcileMutation.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processando...</>
            : <><ArrowRight className="w-4 h-4" /> Conciliar</>}
        </Button>
      </div>

      {/* Results */}
      {result && s && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Conciliados",  value: s.matchedCount,                                  color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle },
              { label: "Divergentes",  value: s.divergentCount,                                color: "text-yellow-400",  bg: "bg-yellow-500/10",  icon: AlertTriangle },
              { label: "Só no Banco",  value: s.unmatchedBankCount,                            color: "text-orange-400",  bg: "bg-orange-500/10",  icon: XCircle },
              { label: "Só na API",    value: s.unmatchedApiCount,                             color: "text-red-400",     bg: "bg-red-500/10",     icon: XCircle },
            ].map(({ label, value, color, bg, icon: Icon }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}>
                  <Icon className={cn("w-4 h-4", color)} />
                </div>
                <p className={cn("text-2xl font-bold", color)}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Totais */}
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

          {/* Diferença */}
          {(Math.abs(s.differenceCredits) > 0.01 || Math.abs(s.differenceDebits) > 0.01) && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
              <div className="text-xs text-yellow-300">
                <span className="font-semibold">Diferença detectada: </span>
                Entradas: {formatCurrency(Math.abs(s.differenceCredits))} · Saídas: {formatCurrency(Math.abs(s.differenceDebits))}
              </div>
            </div>
          )}

          {/* Tabelas */}
          {SECTIONS.map(sec => (
            <div key={sec.key} className="bg-card border border-border rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-3 border-b border-border hover:bg-accent/20"
                onClick={() => setExpanded(expanded === sec.key ? null : sec.key)}>
                <div className="flex items-center gap-2">
                  <sec.icon className={cn("w-4 h-4", sec.color)} />
                  <span className={cn("text-sm font-semibold", sec.color)}>{sec.label}</span>
                  <span className="text-xs text-muted-foreground">({sec.items.length} transações)</span>
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
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Cliente (API)</th>
                        <th className="text-center px-4 py-2 text-muted-foreground font-medium">Tipo</th>
                        <th className="text-right px-4 py-2 text-muted-foreground font-medium">Banco</th>
                        <th className="text-right px-4 py-2 text-muted-foreground font-medium">API</th>
                        {sec.key === "divergent" && <th className="text-right px-4 py-2 text-muted-foreground font-medium">Diferença</th>}
                        <th className="text-left px-4 py-2 text-muted-foreground font-medium">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sec.items.slice(0, 200).map((item: any, i: number) => {
                        const bk = item.bankTx;
                        const ap = item.apiTx;
                        const tx = bk ?? ap;
                        return (
                          <tr key={i} className="hover:bg-accent/20">
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{tx?.date}</td>
                            <td className="px-4 py-2 max-w-[160px] truncate text-foreground">{bk?.description ?? ap?.description}</td>
                            <td className="px-4 py-2 max-w-[140px] truncate text-muted-foreground">{ap?.clientName ?? "—"}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold",
                                tx?.type === "credit" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                              )}>{tx?.type === "credit" ? "C" : "D"}</span>
                            </td>
                            <td className={cn("px-4 py-2 font-mono text-right", bk?.type === "credit" ? "text-emerald-400" : "text-red-400")}>
                              {bk ? formatCurrency(bk.amount) : "—"}
                            </td>
                            <td className={cn("px-4 py-2 font-mono text-right", ap?.type === "credit" ? "text-blue-400" : "text-orange-400")}>
                              {ap ? formatCurrency(ap.amount) : "—"}
                            </td>
                            {sec.key === "divergent" && (
                              <td className="px-4 py-2 font-mono text-right text-yellow-400 font-semibold">
                                {item.difference != null ? formatCurrency(item.difference) : "—"}
                              </td>
                            )}
                            <td className="px-4 py-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/40 text-muted-foreground">
                                {item.matchType ?? "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sec.items.length > 200 && (
                    <p className="text-center text-xs text-muted-foreground py-2 border-t border-border">
                      Mostrando 200 de {sec.items.length} transações
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Histórico */}
      {(sessions ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Histórico de Conciliações</h2>
          </div>
          <div className="divide-y divide-border">
            {(sessions as any[]).slice(0, 15).map((s: any) => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-2.5 hover:bg-accent/20 text-xs">
                <div className={cn("w-2 h-2 rounded-full shrink-0", s.divergentCount > 0 ? "bg-yellow-400" : "bg-emerald-400")} />
                <span className="text-muted-foreground w-24 shrink-0">{formatDate(s.referenceDate)}</span>
                <span className="text-emerald-400">{s.matchedCount} ✅</span>
                <span className="text-yellow-400">{s.divergentCount} ⚠️</span>
                <span className="text-muted-foreground ml-auto">#{s.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
