import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import {
  AlertTriangle, Clock, DollarSign, Hash, CheckCircle2,
  Edit2, Trash2, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight,
  Building2, User, Calendar, FileText, Link2, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Labels e constantes ───────────────────────────────────────────────────────
const CAT_LABELS: Record<string, string> = {
  receita_nao_lancada: "Receita não lançada",
  pix_sem_cliente: "PIX sem cliente",
  ted_orfa: "TED órfã",
  estorno: "Estorno",
  devolucao: "Devolução",
  receita_financeira: "Receita financeira",
  tarifa_nao_apropriada: "Tarifa não apropriada",
  emprestimo_operacional: "Empréstimo operacional",
  uso_saldo_clientes: "Uso saldo clientes",
  receita_operacional: "Receita operacional",
  despesa_nao_lancada: "Despesa não lançada",
  tarifa_bancaria: "Tarifa bancária",
  imposto: "Imposto/IOF",
  repasse_externo: "Repasse externo",
  saida_operacional: "Saída operacional",
  liquidacao_divergente: "Liquidação divergente",
  ajuste_manual: "Ajuste manual",
  outros: "Outros",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente", em_analise: "Em análise", identificado: "Identificado",
  regularizado: "Regularizado", reclassificado: "Reclassificado",
  baixado: "Baixado", escalado_diretoria: "Escalado", resolvido: "Resolvido", ignorado: "Ignorado",
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  em_analise: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  identificado: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  regularizado: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  reclassificado: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  baixado: "text-gray-400 bg-gray-500/10 border-gray-500/20",
  escalado_diretoria: "text-red-400 bg-red-500/10 border-red-500/20",
  resolvido: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  ignorado: "text-gray-400 bg-gray-500/10 border-gray-500/20",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  low: "text-gray-400 bg-gray-500/10 border-gray-500/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa",
};

function daysOpen(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(String(dateStr).slice(0, 10));
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
function DivergencePanel({ div: d, onClose, onUpdate, onDelete }: {
  div: any; onClose: () => void;
  onUpdate: (data: any) => void;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState(d.status ?? "pendente");
  const [responsible, setResponsible] = useState(d.responsible ?? "");
  const [observation, setObservation] = useState(d.observation ?? "");
  const [action, setAction] = useState(d.actionTaken ?? "");
  const [sla, setSla] = useState(d.slaDeadline ? String(d.slaDeadline).slice(0, 10) : "");
  const [priority, setPriority] = useState(d.priority ?? "medium");

  const isSurplus = d.divergenceType === "bank_surplus";
  const days = daysOpen(d.divergenceDate);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-card border-l border-border flex flex-col shadow-2xl overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className={cn("w-2 h-2 rounded-full", d.priority === "critical" ? "bg-red-400 animate-pulse" : d.priority === "high" ? "bg-orange-400" : "bg-yellow-400")} />
            <div>
              <h3 className="text-sm font-bold text-foreground">Divergência #{d.id}</h3>
              <p className="text-[10px] text-muted-foreground">{formatDate(d.divergenceDate)} · {days} dia{days !== 1 ? "s" : ""} em aberto</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 space-y-5 flex-1">

          {/* Tipo e valor */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-accent/20 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground mb-1">Tipo</p>
              <div className="flex items-center gap-1.5">
                {isSurplus
                  ? <ArrowUpRight className="w-4 h-4 text-orange-400" />
                  : <ArrowDownRight className="w-4 h-4 text-red-400" />}
                <span className={cn("text-sm font-bold", isSurplus ? "text-orange-400" : "text-red-400")}>
                  {isSurplus ? "Sobra no Banco" : "Falta no Banco"}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{isSurplus ? "Banco > API" : "API > Banco"}</p>
            </div>
            <div className="bg-accent/20 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground mb-1">Diferença</p>
              <p className="text-lg font-bold font-mono text-yellow-400">{formatCurrency(d.amount)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{d.transactionType === "credit" ? "Crédito" : "Débito"}</p>
            </div>
          </div>

          {/* Transação no Banco */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-accent/10 border-b border-border flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">{d.bankName ?? "Banco"}</span>
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor</span>
                <span className={cn("font-mono font-semibold", d.bankAmount ? (d.transactionType === "credit" ? "text-emerald-400" : "text-red-400") : "text-muted-foreground/40")}>
                  {d.bankAmount ? formatCurrency(d.bankAmount) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Descrição</span>
                <span className="text-foreground text-right">{d.bankDescription ?? "—"}</span>
              </div>
              {d.externalId && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0 flex items-center gap-1"><Link2 className="w-3 h-3" />END2END</span>
                  <span className="font-mono text-[10px] text-muted-foreground text-right break-all">{d.externalId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Transação na API */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-accent/10 border-b border-border flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">API Expag</span>
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor</span>
                <span className={cn("font-mono font-semibold", d.apiAmount ? (d.transactionType === "credit" ? "text-blue-400" : "text-orange-400") : "text-muted-foreground/40")}>
                  {d.apiAmount ? formatCurrency(d.apiAmount) : "—"}
                </span>
              </div>
              {d.clientName && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0 flex items-center gap-1"><User className="w-3 h-3" />Cliente</span>
                  <span className="text-foreground text-right">{d.clientName}</span>
                </div>
              )}
              {d.apiDescription && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Descrição</span>
                  <span className="text-foreground text-right">{d.apiDescription}</span>
                </div>
              )}
              {!d.apiAmount && !d.clientName && !d.apiDescription && (
                <p className="text-muted-foreground/40 italic">Sem correspondência na API</p>
              )}
            </div>
          </div>

          {/* Categoria e prioridade */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground mb-1">Categoria</p>
              <p className="font-medium text-foreground">{CAT_LABELS[d.category] ?? d.category}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Banco</p>
              <p className="font-medium text-foreground">{d.bankName ?? "—"}</p>
            </div>
          </div>

          {/* Form de atualização */}
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold text-foreground">Tratativa</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([v, l]) =>
                      <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Prioridade</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([v, l]) =>
                      <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Responsável</Label>
              <Input value={responsible} onChange={e => setResponsible(e.target.value)}
                className="mt-1 h-8 text-xs" placeholder="Nome do responsável" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">SLA — Prazo</Label>
              <Input type="date" value={sla} onChange={e => setSla(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Observação / Análise</Label>
              <Textarea value={observation} onChange={e => setObservation(e.target.value)}
                className="mt-1 text-xs min-h-16 resize-none" placeholder="Descreva a análise..." />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Ação Tomada</Label>
              <Textarea value={action} onChange={e => setAction(e.target.value)}
                className="mt-1 text-xs min-h-16 resize-none" placeholder="O que foi feito para resolver..." />
            </div>

            <div className="flex gap-2 pt-1">
              <Button className="flex-1 text-xs"
                onClick={() => onUpdate({ status, responsible, observation, actionTaken: action, slaDeadline: sla, priority })}>
                Salvar Tratativa
              </Button>
              <Button variant="outline" size="sm" className="text-red-400 border-red-500/30 hover:bg-red-500/10 text-xs gap-1.5"
                onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Divergences() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [bankFilter, setBankFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>("pendente");
  const [search, setSearch] = useState("");

  const { data: divergences, refetch, isLoading } = trpc.reconciliation.getDivergences.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
  });

  const updateMutation = trpc.reconciliation.updateDivergence.useMutation({
    onSuccess: () => { toast.success("Divergência atualizada!"); refetch(); setSelected(null); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.reconciliation.deleteDivergence.useMutation({
    onSuccess: () => { toast.success("Divergência removida."); refetch(); setSelected(null); },
    onError: (e) => toast.error(e.message),
  });

  const rows = ((divergences ?? []) as any[]).filter(d => {
    if (typeFilter !== "all" && d.divergenceType !== typeFilter) return false;
    if (bankFilter !== "all" && d.bankName !== bankFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return [d.bankDescription, d.apiDescription, d.clientName, d.externalId, d.bankName, CAT_LABELS[d.category]]
        .some(v => v && String(v).toLowerCase().includes(s));
    }
    return true;
  });

  // Stats
  const totalAmount = rows.reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? "0")), 0);
  const surplusTotal = rows.filter((d: any) => d.divergenceType === "bank_surplus").reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? "0")), 0);
  const shortageTotal = rows.filter((d: any) => d.divergenceType === "bank_shortage").reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? "0")), 0);
  const pendingCount = rows.filter((d: any) => d.status === "pendente").length;
  const criticalCount = rows.filter((d: any) => d.priority === "critical").length;

  // Bancos únicos para filtro
  const banks = [...new Set(((divergences ?? []) as any[]).map((d: any) => d.bankName).filter(Boolean))];

  // Agrupar por status para exibição
  const grouped = rows.reduce((acc: Record<string, any[]>, d: any) => {
    const k = d.status ?? "pendente";
    if (!acc[k]) acc[k] = [];
    acc[k].push(d);
    return acc;
  }, {});

  const STATUS_ORDER = ["pendente", "em_analise", "identificado", "escalado_diretoria", "regularizado", "reclassificado", "baixado", "resolvido", "ignorado"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Divergências</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 1 · Motor de divergências — sobras e faltas mapeadas automaticamente</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por descrição, cliente, END2END..."
            className="h-8 text-xs w-64"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os tipos</SelectItem>
              <SelectItem value="bank_surplus" className="text-xs">Sobra no Banco</SelectItem>
              <SelectItem value="bank_shortage" className="text-xs">Falta no Banco</SelectItem>
            </SelectContent>
          </Select>
          <Select value={bankFilter} onValueChange={setBankFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Banco" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os bancos</SelectItem>
              {banks.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todas prioridades</SelectItem>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: rows.length, sub: "divergências", color: "text-foreground", icon: Hash },
          { label: "Volume Total", value: formatCurrency(totalAmount), sub: "em divergência", color: "text-yellow-400", icon: DollarSign },
          { label: "Sobra Banco", value: formatCurrency(surplusTotal), sub: "banco > API", color: "text-orange-400", icon: ArrowUpRight },
          { label: "Falta Banco", value: formatCurrency(shortageTotal), sub: "API > banco", color: "text-red-400", icon: ArrowDownRight },
          { label: "Pendentes", value: pendingCount, sub: `${criticalCount} críticas`, color: pendingCount > 0 ? "text-yellow-400" : "text-emerald-400", icon: Clock },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn("text-lg font-bold font-mono", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Conteúdo por status */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando divergências...</div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-semibold text-foreground">Nenhuma divergência encontrada</p>
          <p className="text-xs text-muted-foreground mt-1">Processe uma conciliação para gerar divergências automaticamente.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {STATUS_ORDER.filter(s => grouped[s]?.length > 0).map(statusKey => {
            const items = grouped[statusKey] ?? [];
            const isOpen = expanded === statusKey;
            const statusTotal = items.reduce((sum: number, d: any) => sum + parseFloat(String(d.amount ?? "0")), 0);
            return (
              <div key={statusKey} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-accent/20 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : statusKey)}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", STATUS_COLORS[statusKey] ?? "text-muted-foreground")}>
                      {STATUS_LABELS[statusKey] ?? statusKey}
                    </span>
                    <span className="text-xs text-muted-foreground">{items.length} divergência{items.length !== 1 ? "s" : ""}</span>
                    <span className="text-xs font-mono text-muted-foreground">{formatCurrency(statusTotal)}</span>
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-accent/10 border-b border-border">
                          {["Data","Dias","Banco","Tipo","Descrição Banco","Cliente API","END2END","Vlr Banco","Vlr API","Diferença","Categoria","Prioridade","Responsável",""].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {items.map((d: any) => {
                          const days = daysOpen(d.divergenceDate);
                          const isSurplus = d.divergenceType === "bank_surplus";
                          return (
                            <tr key={d.id}
                              className={cn("hover:bg-accent/20 cursor-pointer transition-colors",
                                d.priority === "critical" && "bg-red-500/5",
                                d.priority === "high" && "bg-orange-500/3"
                              )}
                              onClick={() => setSelected(d)}
                            >
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(d.divergenceDate)}</td>
                              <td className={cn("px-3 py-2 font-semibold whitespace-nowrap", days > 7 ? "text-red-400" : days > 3 ? "text-yellow-400" : "text-muted-foreground")}>{days}d</td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{d.bankName ?? "—"}</td>
                              <td className="px-3 py-2">
                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap",
                                  isSurplus ? "bg-orange-500/10 text-orange-400" : "bg-red-500/10 text-red-400")}>
                                  {isSurplus ? "↑ Sobra" : "↓ Falta"}
                                </span>
                              </td>
                              <td className="px-3 py-2 max-w-[160px] truncate text-foreground" title={d.bankDescription ?? ""}>{d.bankDescription ?? "—"}</td>
                              <td className="px-3 py-2 max-w-[130px] truncate text-muted-foreground" title={d.clientName ?? ""}>{d.clientName ?? "—"}</td>
                              <td className="px-3 py-2 max-w-[100px] truncate font-mono text-[10px] text-muted-foreground" title={d.externalId ?? ""}>{d.externalId ? `...${d.externalId.slice(-12)}` : "—"}</td>
                              <td className={cn("px-3 py-2 font-mono whitespace-nowrap", d.transactionType === "credit" ? "text-emerald-400" : "text-red-400")}>{d.bankAmount ? formatCurrency(d.bankAmount) : "—"}</td>
                              <td className={cn("px-3 py-2 font-mono whitespace-nowrap", d.transactionType === "credit" ? "text-blue-400" : "text-orange-400")}>{d.apiAmount ? formatCurrency(d.apiAmount) : "—"}</td>
                              <td className="px-3 py-2 font-mono font-semibold text-yellow-400 whitespace-nowrap">{formatCurrency(d.amount)}</td>
                              <td className="px-3 py-2 max-w-[130px] truncate text-muted-foreground">{CAT_LABELS[d.category] ?? d.category}</td>
                              <td className="px-3 py-2">
                                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold whitespace-nowrap", PRIORITY_COLORS[d.priority] ?? "")}>
                                  {PRIORITY_LABELS[d.priority] ?? d.priority}
                                </span>
                              </td>
                              <td className="px-3 py-2 max-w-[100px] truncate text-muted-foreground">{d.responsible ?? "—"}</td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                                  onClick={() => setSelected(d)}>
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-accent/5 border-t border-border">
                          <td colSpan={9} className="px-3 py-2 text-xs text-muted-foreground font-semibold">Subtotal</td>
                          <td className="px-3 py-2 font-mono font-bold text-yellow-400">{formatCurrency(statusTotal)}</td>
                          <td colSpan={4} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Panel de detalhe */}
      {selected && (
        <DivergencePanel
          div={selected}
          onClose={() => setSelected(null)}
          onUpdate={(data) => updateMutation.mutate({ id: selected.id, ...data })}
          onDelete={() => { if (confirm("Remover esta divergência?")) deleteMutation.mutate({ id: selected.id }); }}
        />
      )}
    </div>
  );
}
