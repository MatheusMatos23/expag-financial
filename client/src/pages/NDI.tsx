import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import {
  AlertCircle, Building2, Calendar, CheckCircle2, DollarSign,
  Hash, X, FileSearch, UserCheck, Edit2, Clock, Tag,
  ArrowRight, Search, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function toISO(val: any): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  return s.length >= 10 && s[4] === "-" ? s.slice(0, 10) : s.slice(0, 10);
}

function daysOpen(dateStr: any): number {
  const iso = toISO(dateStr);
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso + "T12:00:00Z").getTime()) / 86400000);
}

// ── NDI Detail Sidebar ────────────────────────────────────────────────────────
function NdiSidebar({ div, onClose, onUpdate, onUnmark, onResolve }: {
  div: any;
  onClose: () => void;
  onUpdate: (data: { ndiNote?: string; ndiFoundDate?: string; ndiClientName?: string; priority?: string }) => void;
  onUnmark: () => void;
  onResolve: (clientName: string, description: string) => void;
}) {
  const [note,        setNote]        = useState(div.ndiNote ?? "");
  const [foundDate,   setFoundDate]   = useState(toISO(div.ndiFoundDate) ?? "");
  const [clientGuess, setClientGuess] = useState(div.ndiClientName ?? div.clientName ?? "");
  const [priority,    setPriority]    = useState(div.priority ?? "high");
  const [tab, setTab] = useState<"info" | "edit" | "resolve">("info");
  const [confirmName, setConfirmName] = useState("");
  const [confirmDesc, setConfirmDesc] = useState("");

  const days = daysOpen(div.divergenceDate);
  const isOld = days > 30;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-[420px] bg-card border-l border-border flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", isOld ? "bg-red-400 animate-pulse" : "bg-orange-400 animate-pulse")} />
            <div>
              <p className="text-sm font-bold text-foreground">NDI #{div.id}</p>
              <p className="text-[10px] text-muted-foreground">
                {formatDate(div.divergenceDate)} · <span className={isOld ? "text-red-400 font-semibold" : ""}>{days}d em aberto</span>
                {isOld && " ⚠ vencido"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Value card */}
        <div className="px-5 pt-4 shrink-0">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground">Valor não identificado no banco</p>
            <p className="text-2xl font-bold font-mono text-orange-400">{formatCurrency(div.amount)}</p>
            <div className="flex items-center gap-2 mt-1">
              <Building2 className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">{div.bankName} · entrada sem correspondência na API</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {[
            { key: "info",    label: "Detalhes" },
            { key: "edit",    label: "Editar NDI" },
            { key: "resolve", label: "Identificar" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={cn("flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/20"
              )}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── TAB: INFO ─────────────────────────────────────────────────── */}
          {tab === "info" && (
            <>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: "Banco",      value: div.bankName },
                  { label: "Descrição",  value: div.bankDescription },
                  { label: "Cliente",    value: div.clientName },
                  { label: "END2END",    value: div.externalId ? `...${div.externalId.slice(-16)}` : null, mono: true },
                  { label: "Prioridade", value: div.priority },
                  { label: "Status",     value: div.status },
                ].filter(r => r.value).map(({ label, value, mono }) => (
                  <div key={label} className="flex justify-between items-start gap-4">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className={cn("text-right text-foreground", mono && "font-mono text-[10px]")}>{value}</span>
                  </div>
                ))}
              </div>

              {(div.ndiNote || div.ndiClientName || div.ndiFoundDate) && (
                <div className="bg-accent/10 border border-border rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Investigação NDI</p>
                  {div.ndiClientName && (
                    <div className="flex items-center gap-2 text-xs">
                      <UserCheck className="w-3 h-3 text-orange-400 shrink-0" />
                      <span className="text-foreground">Suspeito: <strong>{div.ndiClientName}</strong></span>
                    </div>
                  )}
                  {div.ndiFoundDate && (
                    <div className="flex items-center gap-2 text-xs">
                      <Calendar className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="text-muted-foreground">Encontrado em: <span className="text-foreground">{formatDate(div.ndiFoundDate)}</span></span>
                    </div>
                  )}
                  {div.ndiNote && (
                    <p className="text-xs text-foreground whitespace-pre-wrap">{div.ndiNote}</p>
                  )}
                </div>
              )}

              {/* Connection with reconciliation */}
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] text-blue-400 font-medium">Impacto na Conciliação</p>
                <p className="text-[10px] text-muted-foreground">
                  Este valor está no saldo do banco mas não na API. Permanece como
                  <span className="text-orange-400"> sobra bancária</span> até ser identificado.
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Ao identificar: cria transação na API → ambos os lados conciliam →
                  <span className="text-emerald-400"> matching ↑</span>
                </p>
              </div>
            </>
          )}

          {/* ── TAB: EDIT ─────────────────────────────────────────────────── */}
          {tab === "edit" && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Anotação / Investigação</Label>
                <Textarea
                  className="mt-1.5 text-xs resize-none h-24"
                  placeholder="Detalhes da investigação, suspeitas, contatos realizados..."
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Cliente suspeito (para rastreio)</Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Nome do cliente ou empresa"
                  value={clientGuess}
                  onChange={e => setClientGuess(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Suspeita — não confirma a receita ainda</p>
              </div>
              <div>
                <Label className="text-xs">Data encontrada</Label>
                <Input
                  type="date"
                  className="mt-1.5 h-8 text-xs"
                  value={foundDate}
                  onChange={e => setFoundDate(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Data em que o valor foi localizado no extrato</p>
              </div>
              <div>
                <Label className="text-xs">Prioridade</Label>
                <select
                  className="mt-1.5 w-full text-xs rounded-md border border-border bg-background px-3 py-2"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                >
                  <option value="critical">Crítico — resolver hoje</option>
                  <option value="high">Alta — resolver essa semana</option>
                  <option value="medium">Média</option>
                  <option value="low">Baixa</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 text-xs gap-1.5"
                  onClick={() => onUpdate({ ndiNote: note, ndiFoundDate: foundDate || undefined, ndiClientName: clientGuess || undefined, priority })}
                >
                  <Edit2 className="w-3.5 h-3.5" /> Salvar
                </Button>
                <Button
                  variant="outline"
                  className="text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                  onClick={onUnmark}
                >
                  Remover NDI
                </Button>
              </div>
            </div>
          )}

          {/* ── TAB: RESOLVE ──────────────────────────────────────────────── */}
          {tab === "resolve" && (
            <div className="space-y-4">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-1.5 text-xs">
                <p className="text-emerald-400 font-semibold">O que acontece ao confirmar:</p>
                <div className="space-y-1 text-muted-foreground">
                  <p>1. Cria transação na API com o valor {formatCurrency(div.amount)}</p>
                  <p>2. O banco e a API ficam conciliados (matching ↑)</p>
                  <p>3. NDI removido das pendências</p>
                  <p>4. Receita criada automaticamente no módulo financeiro</p>
                </div>
              </div>
              <div>
                <Label className="text-xs">Nome do cliente <span className="text-red-400">*</span></Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Nome do cliente ou empresa"
                  value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                  defaultValue={div.ndiClientName ?? ""}
                />
              </div>
              <div>
                <Label className="text-xs">Descrição do pagamento</Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Ex: PIX referente a contrato X — período Y"
                  value={confirmDesc}
                  onChange={e => setConfirmDesc(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Certifique-se de que o cliente confirmou o pagamento antes de identificar.
              </p>
              <Button
                className="w-full text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                disabled={!confirmName.trim()}
                onClick={() => onResolve(confirmName, confirmDesc)}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Confirmar Identificação → Conciliar
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NDI() {
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: rawData, refetch, isLoading } = trpc.reconciliation.getNdiDivergences.useQuery(
    undefined, { refetchInterval: 15000 }
  );

  const updateMutation = trpc.reconciliation.updateNdi.useMutation({
    onSuccess: () => { toast.success("NDI atualizado."); refetch(); setSelected((s: any) => s ? { ...s, _refresh: Date.now() } : s); },
    onError: (e: any) => toast.error(e.message),
  });

  const unmarkMutation = trpc.reconciliation.unmarkNdi.useMutation({
    onSuccess: () => { toast.success("NDI removido."); setSelected(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const resolveNdiMutation = trpc.reconciliation.resolveNdi.useMutation({
    onSuccess: () => { toast.success("NDI identificado — conciliado e receita criada!"); setSelected(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const items = ((rawData as any) ?? []) as any[];

  const filtered = items.filter(d => {
    const s = search.toLowerCase();
    const matchSearch = !s || [d.bankDescription, d.clientName, d.bankName, d.externalId, d.ndiNote, d.ndiClientName]
      .some((v: any) => v && String(v).toLowerCase().includes(s));
    const matchPriority = priorityFilter === "all" || d.priority === priorityFilter;
    return matchSearch && matchPriority;
  });

  const totalAmount = filtered.reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? 0)), 0);
  const avgDays     = filtered.length > 0 ? Math.round(filtered.reduce((s: number, d: any) => s + daysOpen(d.divergenceDate), 0) / filtered.length) : 0;
  const overdue     = filtered.filter((d: any) => daysOpen(d.divergenceDate) > 30).length;
  const byBank      = filtered.reduce((acc: Record<string, number>, d: any) => { acc[d.bankName ?? "Outro"] = (acc[d.bankName ?? "Outro"] ?? 0) + parseFloat(String(d.amount ?? 0)); return acc; }, {});

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <h1 className="text-2xl font-bold text-foreground">Não Identificados (NDI)</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Entradas bancárias sem correspondência na API — aguardando identificação para conciliar
          </p>
        </div>
        <div className="flex gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar banco, descrição, cliente..." className="h-8 text-xs w-52" />
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total NDI",       value: `${filtered.length}`,         sub: "divergências",        color: "text-orange-400" },
          { label: "Valor Total",     value: formatCurrency(totalAmount),  sub: "pendente de id.",     color: "text-yellow-400" },
          { label: "Dias Médios",     value: `${avgDays}d`,                sub: "em investigação",     color: avgDays > 30 ? "text-red-400" : "text-muted-foreground" },
          { label: "Vencidos +30d",  value: `${overdue}`,                 sub: "requerem atenção",    color: overdue > 0 ? "text-red-400" : "text-emerald-400" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Por banco */}
      {Object.keys(byBank).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(byBank).map(([bank, total]) => (
            <div key={bank} className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3">
              <p className="text-xs font-semibold text-foreground">{bank}</p>
              <p className="text-lg font-bold font-mono text-orange-400">{formatCurrency(total)}</p>
              <p className="text-[10px] text-muted-foreground">{filtered.filter((d: any) => d.bankName === bank).length} entrada{filtered.filter((d: any) => d.bankName === bank).length !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>
      )}

      {/* Priority filter */}
      <div className="flex gap-1">
        {[
          { key: "all",      label: `Todos (${filtered.length})` },
          { key: "critical", label: "Crítico" },
          { key: "high",     label: "Alta" },
          { key: "medium",   label: "Média" },
        ].map(f => (
          <button key={f.key} onClick={() => setPriorityFilter(f.key)}
            className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
              priorityFilter === f.key
                ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                : "text-muted-foreground border-border hover:border-orange-500/30"
            )}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando NDIs...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <FileSearch className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-sm font-semibold text-foreground">
            {items.length === 0 ? "Nenhum NDI registrado" : "Nenhum resultado"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Marque divergências como NDI na página de Divergências para acompanhá-las aqui.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Data","Dias","Banco","Descrição","Suspeito","END2END","Valor","Prior.","Status",""].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((d: any) => {
                  const days = daysOpen(d.divergenceDate);
                  const isOld = days > 30;
                  const hasInvestigation = d.ndiNote || d.ndiClientName || d.ndiFoundDate;
                  return (
                    <tr key={d.id}
                      className="hover:bg-accent/10 cursor-pointer transition-colors"
                      onClick={() => setSelected(d)}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(d.divergenceDate)}</td>
                      <td className={cn("px-3 py-2.5 font-semibold whitespace-nowrap", isOld ? "text-red-400" : days > 15 ? "text-yellow-400" : "text-muted-foreground")}>{days}d</td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{d.bankName ?? "—"}</td>
                      <td className="px-3 py-2.5 max-w-[160px] truncate text-foreground" title={d.bankDescription ?? ""}>{d.bankDescription ?? "—"}</td>
                      <td className="px-3 py-2.5 max-w-[120px] truncate">
                        {d.ndiClientName ? (
                          <span className="text-orange-400 font-medium">{d.ndiClientName}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{d.externalId ? `...${d.externalId.slice(-10)}` : "—"}</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-orange-400 whitespace-nowrap">{formatCurrency(d.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold",
                          d.priority === "critical" ? "text-red-400 bg-red-500/10 border-red-500/30" :
                          d.priority === "high" ? "text-orange-400 bg-orange-500/10 border-orange-500/30" :
                          "text-muted-foreground border-border"
                        )}>{d.priority ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          {hasInvestigation && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Em investigação" />}
                          <span className="text-[10px] text-muted-foreground capitalize">{d.status ?? "pendente"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button className="text-orange-400 hover:text-orange-300" onClick={e => { e.stopPropagation(); setSelected(d); }}>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-accent/5 border-t border-border">
                  <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground font-semibold">Total</td>
                  <td className="px-3 py-2 font-mono font-bold text-orange-400">{formatCurrency(totalAmount)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Sidebar */}
      {selected && (
        <NdiSidebar
          div={selected}
          onClose={() => setSelected(null)}
          onUpdate={(data) => { updateMutation.mutate({ id: selected.id, ...data }); }}
          onUnmark={() => unmarkMutation.mutate({ id: selected.id })}
          onResolve={(clientName, description) => resolveNdiMutation.mutate({ id: selected.id, clientName, description })}
        />
      )}
    </div>
  );
}
