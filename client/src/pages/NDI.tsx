import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import { AlertCircle, Building2, Calendar, CheckCircle2, DollarSign, Eye, Hash, X, FileSearch, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function daysOpen(dateStr: string) {
  const d = new Date(String(dateStr).slice(0, 10));
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function NdiDetailModal({ div, onClose, onUnmark, onResolve }: { div: any; onClose: () => void; onUnmark: () => void; onResolve: (clientName: string, description: string) => void }) {
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-card border-l border-border flex flex-col shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <div>
              <h3 className="text-sm font-bold text-foreground">NDI #{div.id}</h3>
              <p className="text-[10px] text-muted-foreground">{formatDate(div.divergenceDate)} · {daysOpen(div.divergenceDate)}d em aberto</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4 flex-1">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground">Valor não identificado</p>
            <p className="text-2xl font-bold font-mono text-orange-400">{formatCurrency(div.amount)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{div.bankName} · Entrada não identificada na API</p>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Banco</span><span>{div.bankName ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Descrição</span><span className="text-right max-w-[60%]">{div.bankDescription ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span>{div.clientName ?? "—"}</span></div>
            {div.externalId && <div className="flex justify-between"><span className="text-muted-foreground">END2END</span><span className="font-mono text-[10px]">{div.externalId.slice(-16)}</span></div>}
          </div>
          {div.ndiNote && (
            <div className="bg-accent/20 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground mb-1">Anotação NDI</p>
              <p className="text-xs text-foreground">{div.ndiNote}</p>
            </div>
          )}
        </div>
        {resolveOpen ? (
          <div className="px-5 py-4 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-foreground">Identificar cliente deste valor</p>
            <div>
              <label className="text-[10px] text-muted-foreground">Nome do cliente</label>
              <input className="mt-1 w-full text-xs rounded-md border border-border bg-background px-3 py-1.5" placeholder="Nome do cliente ou empresa" value={clientName} onChange={e => setClientName(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Descrição (opcional)</label>
              <input className="mt-1 w-full text-xs rounded-md border border-border bg-background px-3 py-1.5" placeholder="Ex: Pagamento referente a contrato X" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="flex-1 text-xs border border-border rounded-md py-1.5 text-muted-foreground hover:bg-accent/10" onClick={() => setResolveOpen(false)}>Cancelar</button>
              <button
                className="flex-1 text-xs bg-emerald-600 text-white rounded-md py-1.5 disabled:opacity-50"
                disabled={!clientName.trim()}
                onClick={() => { onResolve(clientName, description); }}
              >Confirmar → Receita</button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-border flex gap-2">
            <Button className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => setResolveOpen(true)}>
              <UserCheck className="w-3.5 h-3.5" /> Identificar Cliente
            </Button>
            <Button variant="outline" size="sm" className="text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10" onClick={onUnmark}>
              Remover NDI
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NDI() {
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");

  const { data: rawData, refetch, isLoading } = trpc.reconciliation.getNdiDivergences.useQuery();
  const unmarkMutation = trpc.reconciliation.unmarkNdi.useMutation({
    onSuccess: () => { toast.success("NDI removido."); setSelected(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const resolveNdiMutation = trpc.reconciliation.resolveNdi.useMutation({
    onSuccess: () => { toast.success("NDI identificado — receita criada!"); setSelected(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const items = ((rawData as any) ?? []) as any[];

  const filtered = items.filter(d => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [d.bankDescription, d.clientName, d.bankName, d.externalId, d.ndiNote]
      .some(v => v && String(v).toLowerCase().includes(s));
  });

  const totalAmount = filtered.reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? 0)), 0);
  const avgDays = filtered.length > 0
    ? Math.round(filtered.reduce((s: number, d: any) => s + daysOpen(d.divergenceDate), 0) / filtered.length)
    : 0;

  const byBank = filtered.reduce((acc: Record<string, number>, d: any) => {
    const k = d.bankName ?? "Outro";
    acc[k] = (acc[k] ?? 0) + parseFloat(String(d.amount ?? 0));
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <h1 className="text-2xl font-bold text-foreground">Não Identificados (NDI)</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Entradas bancárias sem correspondência na API — aguardando identificação
          </p>
        </div>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por banco, descrição, cliente..."
          className="h-8 text-xs w-64"
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total NDI",   value: filtered.length,        sub: "divergências",    color: "text-orange-400", icon: Hash },
          { label: "Valor Total", value: formatCurrency(totalAmount), sub: "em aberto", color: "text-yellow-400",  icon: DollarSign },
          { label: "Média Dias",  value: `${avgDays}d`,          sub: "em investigação", color: avgDays > 15 ? "text-red-400" : "text-muted-foreground", icon: Calendar },
          { label: "Bancos",      value: Object.keys(byBank).length, sub: "com NDI",    color: "text-blue-400",   icon: Building2 },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Por banco */}
      {Object.keys(byBank).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(byBank).map(([bank, total]) => (
            <div key={bank} className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-foreground">{bank}</p>
              <p className="text-lg font-bold font-mono text-orange-400 mt-1">{formatCurrency(total)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {filtered.filter(d => d.bankName === bank).length} entrada{filtered.filter(d => d.bankName === bank).length !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando NDIs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <FileSearch className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm font-semibold text-foreground">
            {items.length === 0 ? "Nenhum NDI registrado" : "Nenhum resultado para a busca"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {items.length === 0
              ? "Marque divergências como NDI na página de Divergências para acompanhá-las aqui."
              : "Tente outro termo de busca."}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Data","Dias","Banco","Descrição","Cliente","END2END","Valor","Anotação",""].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((d: any) => {
                  const days = daysOpen(d.divergenceDate);
                  return (
                    <tr key={d.id}
                      className="hover:bg-accent/10 cursor-pointer transition-colors"
                      onClick={() => setSelected(d)}
                    >
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(d.divergenceDate)}</td>
                      <td className={cn("px-3 py-2 font-semibold whitespace-nowrap", days > 15 ? "text-red-400" : days > 7 ? "text-yellow-400" : "text-muted-foreground")}>{days}d</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{d.bankName ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate text-foreground" title={d.bankDescription ?? ""}>{d.bankDescription ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[130px] truncate text-muted-foreground">{d.clientName ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{d.externalId ? `...${d.externalId.slice(-10)}` : "—"}</td>
                      <td className="px-3 py-2 font-mono font-bold text-orange-400 whitespace-nowrap">{formatCurrency(d.amount)}</td>
                      <td className="px-3 py-2 max-w-[150px] truncate text-muted-foreground" title={d.ndiNote ?? ""}>{d.ndiNote || "—"}</td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={e => { e.stopPropagation(); setSelected(d); }}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-accent/5 border-t border-border">
                  <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground font-semibold">Total</td>
                  <td className="px-3 py-2 font-mono font-bold text-orange-400">{formatCurrency(totalAmount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <NdiDetailModal
          div={selected}
          onClose={() => setSelected(null)}
          onUnmark={() => unmarkMutation.mutate({ id: selected.id })}
          onResolve={(clientName, description) => resolveNdiMutation.mutate({ id: selected.id, clientName, description })}
        />
      )}
    </div>
  );
}
