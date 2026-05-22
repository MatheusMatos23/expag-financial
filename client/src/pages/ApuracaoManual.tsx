import { trpc } from "@/lib/trpc";
import { formatCurrency, cn } from "@/lib/utils";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus, Edit2, Trash2, TrendingUp, TrendingDown, Wallet, Percent,
  Maximize2, Minimize2, Printer, PieChart as PieIcon, Calendar,
  CheckCircle2, X, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Legend, Line, ComposedChart,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function formatMonth(m: string): string {
  const [y, mm] = m.split("-");
  return `${MONTH_NAMES[parseInt(mm, 10) - 1]}/${y.slice(2)}`;
}
function compactCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  return formatCurrency(v);
}

// Configuração das APIs (cores, labels, ordem)
type ApiSource = "expag" | "cinqbank";
const API_CONFIG: Record<ApiSource, { label: string; color: string; bg: string; border: string; dot: string }> = {
  expag:    { label: "Expag",    color: "text-indigo-400", bg: "bg-indigo-500/10",  border: "border-indigo-500/30", dot: "bg-indigo-500" },
  cinqbank: { label: "CINQBank", color: "text-amber-400",  bg: "bg-amber-500/10",   border: "border-amber-500/30",  dot: "bg-amber-500" },
};
const API_ORDER: ApiSource[] = ["expag", "cinqbank"];

const REVENUE_COLORS = ["#10b981","#34d399","#6ee7b7","#a7f3d0","#0d9488","#14b8a6","#2dd4bf","#5eead4","#0f766e","#115e59","#0e7490","#06b6d4","#22d3ee","#67e8f9"];
const EXPENSE_COLORS = ["#ef4444","#f87171","#fca5a5","#fecaca","#dc2626","#b91c1c","#991b1b","#7f1d1d","#f59e0b","#fb923c","#fdba74"];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--foreground)",
  padding: "8px 12px",
};

// Animação de contagem
function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(target);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    startRef.current = null;
    const from = value;
    let raf = 0;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

// Sugestões para autocomplete do form (baseadas no anexo + comuns)
const SUGGESTED_REVENUES = [
  "Aplicação CDI", "Tarifas Pacotes", "Empréstimo", "Tarifas Pix QRCode",
  "Tarifas Pix", "Tarifa BOLETOS", "Aplicação Compromissada", "Tarifa TED",
  "Tarifa Abertura CC", "Saque Cartão", "POS", "Receita Repasse", "ENOQ",
];
const SUGGESTED_EXPENSES = [
  "Folha", "Impostos", "Administrativas", "Cartão Corporativo", "SCD",
  "Consórcios", "Jurídico+Contábil", "Comercial Externo", "Comissões",
  "Tarifas Bancárias",
];

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal — alterna entre 2 abas: Inserir Dados e Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "input" | "dashboard";

export default function ApuracaoManual() {
  const [tab, setTab] = useState<Tab>("input");

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5">
      {/* Cabeçalho com seletor de aba */}
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">Apuração Manual</p>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            Apuração de Resultado
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Modo emergência: entrada manual de categorias para apresentação enquanto a conciliação não está completa.
          </p>
        </div>

        <div className="flex items-center gap-0.5 bg-accent/10 rounded-lg p-0.5">
          <TabButton active={tab === "input"}    onClick={() => setTab("input")}    label="Inserir Dados" />
          <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} label="Dashboard" />
        </div>
      </div>

      {tab === "input" ? <InputView /> : <DashboardView />}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={cn("px-4 py-1.5 text-xs rounded-md transition-colors font-medium",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 1: Inserir Dados
// ─────────────────────────────────────────────────────────────────────────────

function InputView() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [apiFilter, setApiFilter] = useState<"all" | ApiSource>("all");
  const [kindFilter, setKindFilter] = useState<"all" | "receita" | "despesa">("all");

  const { data: rows, refetch } = trpc.accounting.listManualApuracao.useQuery({
    referenceMonth: month,
    kind: kindFilter === "all" ? undefined : kindFilter,
    apiSource: apiFilter === "all" ? undefined : apiFilter,
  });
  const { data: monthsAvailable, refetch: refetchMonths } = trpc.accounting.getManualApuracaoMonths.useQuery();

  const reload = () => { refetch(); refetchMonths(); };

  // Mutations
  const createMutation = trpc.accounting.createManualApuracao.useMutation({
    onSuccess: () => { toast.success("Categoria adicionada"); setFormOpen(false); reload(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.accounting.updateManualApuracao.useMutation({
    onSuccess: () => { toast.success("Atualizado"); setFormOpen(false); setEditing(null); reload(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.accounting.deleteManualApuracao.useMutation({
    onSuccess: () => { toast.success("Removido"); reload(); },
    onError: (e: any) => toast.error(e.message),
  });

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    referenceMonth: month,
    apiSource: "expag" as ApiSource,
    kind: "receita" as "receita" | "despesa",
    category: "",
    amount: "",
    notes: "",
  });

  function openCreate(kind: "receita" | "despesa", api: ApiSource = "expag") {
    setEditing(null);
    setForm({ referenceMonth: month, apiSource: api, kind, category: "", amount: "", notes: "" });
    setFormOpen(true);
  }
  function openEdit(row: any) {
    setEditing(row);
    setForm({
      referenceMonth: row.referenceMonth,
      apiSource: row.apiSource,
      kind: row.kind,
      category: row.category,
      amount: String(parseFloat(row.amount)),
      notes: row.notes ?? "",
    });
    setFormOpen(true);
  }
  function submit() {
    const amount = parseFloat(form.amount || "0");
    if (!form.category.trim()) { toast.error("Categoria obrigatória"); return; }
    if (amount <= 0) { toast.error("Valor deve ser maior que zero"); return; }
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        category: form.category.trim(),
        amount,
        notes: form.notes,
        apiSource: form.apiSource,
      });
    } else {
      createMutation.mutate({
        referenceMonth: form.referenceMonth,
        apiSource: form.apiSource,
        kind: form.kind,
        category: form.category.trim(),
        amount,
        notes: form.notes || undefined,
      });
    }
  }

  // Agrupa por kind para exibir em 2 tabelas
  const receitas = (rows ?? []).filter((r: any) => r.kind === "receita");
  const despesas = (rows ?? []).filter((r: any) => r.kind === "despesa");
  const totalReceitas = receitas.reduce((s: number, r: any) => s + parseFloat(r.amount), 0);
  const totalDespesas = despesas.reduce((s: number, r: any) => s + parseFloat(r.amount), 0);
  const resultado = totalReceitas - totalDespesas;

  return (
    <>
      {/* Seletor de mês + filtros */}
      <div className="card-premium rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Mês</Label>
          </div>
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="h-9 w-40 text-xs" />
          {monthsAvailable && monthsAvailable.length > 0 && (
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder="Existentes" /></SelectTrigger>
              <SelectContent>
                {monthsAvailable.map((m: string) => (
                  <SelectItem key={m} value={m} className="text-xs">{formatMonth(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={apiFilter} onValueChange={v => setApiFilter(v as any)}>
            <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todas APIs</SelectItem>
              <SelectItem value="expag" className="text-xs">Expag</SelectItem>
              <SelectItem value="cinqbank" className="text-xs">CINQBank</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kindFilter} onValueChange={v => setKindFilter(v as any)}>
            <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Tudo</SelectItem>
              <SelectItem value="receita" className="text-xs">Só Receitas</SelectItem>
              <SelectItem value="despesa" className="text-xs">Só Despesas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard label="Receita Total" value={totalReceitas} color="text-emerald-400" />
        <SummaryCard label="Despesa Total" value={totalDespesas} color="text-red-400" />
        <SummaryCard label="Resultado Líquido" value={resultado} color={resultado >= 0 ? "text-emerald-400" : "text-red-400"} />
      </div>

      {/* Tabelas de Receitas e Despesas lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryTable
          title="Composição de Receitas"
          icon={TrendingUp}
          iconColor="text-emerald-400"
          rows={receitas}
          total={totalReceitas}
          onAdd={() => openCreate("receita")}
          onEdit={openEdit}
          onDelete={(id) => {
            if (confirm("Remover essa categoria?")) deleteMutation.mutate({ id });
          }}
        />
        <CategoryTable
          title="Composição de Despesas"
          icon={TrendingDown}
          iconColor="text-red-400"
          rows={despesas}
          total={totalDespesas}
          onAdd={() => openCreate("despesa")}
          onEdit={openEdit}
          onDelete={(id) => {
            if (confirm("Remover essa categoria?")) deleteMutation.mutate({ id });
          }}
        />
      </div>

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar categoria" : `Nova ${form.kind === "receita" ? "receita" : "despesa"}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Mês de referência</Label>
              <Input type="month" value={form.referenceMonth}
                disabled={!!editing}
                onChange={e => setForm({ ...form, referenceMonth: e.target.value })}
                className="mt-1 h-9 text-xs" />
            </div>

            {/* SELETOR DE API — sempre visível */}
            <div>
              <Label className="text-xs">API <span className="text-red-400">*</span></Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {API_ORDER.map(api => (
                  <button key={api} onClick={() => setForm({ ...form, apiSource: api })}
                    className={cn("h-9 text-xs rounded-lg border transition-colors flex items-center justify-center gap-1.5",
                      form.apiSource === api
                        ? `${API_CONFIG[api].bg} ${API_CONFIG[api].border} ${API_CONFIG[api].color}`
                        : "bg-accent/5 border-border text-muted-foreground hover:text-foreground"
                    )}>
                    <span className={cn("w-2 h-2 rounded-full", API_CONFIG[api].dot)} />
                    {API_CONFIG[api].label}
                  </button>
                ))}
              </div>
            </div>

            {!editing && (
              <div>
                <Label className="text-xs">Tipo</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button onClick={() => setForm({ ...form, kind: "receita" })}
                    className={cn("h-9 text-xs rounded-lg border transition-colors",
                      form.kind === "receita"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-accent/5 border-border text-muted-foreground hover:text-foreground"
                    )}>
                    <TrendingUp className="w-3 h-3 inline mr-1" /> Receita
                  </button>
                  <button onClick={() => setForm({ ...form, kind: "despesa" })}
                    className={cn("h-9 text-xs rounded-lg border transition-colors",
                      form.kind === "despesa"
                        ? "bg-red-500/10 border-red-500/30 text-red-400"
                        : "bg-accent/5 border-border text-muted-foreground hover:text-foreground"
                    )}>
                    <TrendingDown className="w-3 h-3 inline mr-1" /> Despesa
                  </button>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Categoria <span className="text-red-400">*</span></Label>
              <Input list={form.kind === "receita" ? "rev-suggestions" : "exp-suggestions"}
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder={form.kind === "receita" ? "Ex: Aplicação CDI" : "Ex: Folha"}
                className="mt-1 h-9 text-xs" />
              <datalist id="rev-suggestions">
                {SUGGESTED_REVENUES.map(s => <option key={s} value={s} />)}
              </datalist>
              <datalist id="exp-suggestions">
                {SUGGESTED_EXPENSES.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>

            <div>
              <Label className="text-xs">Valor (R$) <span className="text-red-400">*</span></Label>
              <Input type="number" step="0.01" min="0"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="mt-1 h-9 text-xs font-mono" />
            </div>

            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="mt-1 text-xs min-h-[60px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setEditing(null); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submit}
              disabled={createMutation.isPending || updateMutation.isPending}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              {editing ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const animated = useCountUp(value, 600);
  return (
    <div className="card-premium rounded-xl p-4">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className={cn("text-2xl font-bold font-mono tabular-nums", color)}>
        {compactCurrency(animated)}
      </p>
    </div>
  );
}

function CategoryTable({ title, icon: Icon, iconColor, rows, total, onAdd, onEdit, onDelete }: {
  title: string; icon: any; iconColor: string;
  rows: any[]; total: number;
  onAdd: () => void;
  onEdit: (r: any) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="card-premium rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", iconColor)} />
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={onAdd}>
          <Plus className="w-3 h-3" /> Adicionar
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="text-left px-4 py-2 font-medium">Categoria</th>
            <th className="text-left px-4 py-2 font-medium">API</th>
            <th className="text-right px-4 py-2 font-medium">Valor</th>
            <th className="w-20 px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
              Sem lançamentos. Clique em "Adicionar".
            </td></tr>
          ) : rows.map((r: any) => {
            const api = (r.apiSource ?? "expag") as ApiSource;
            const cfg = API_CONFIG[api];
            return (
              <tr key={r.id} className="border-b border-border/50 hover:bg-accent/10 transition-colors text-xs">
                <td className="px-4 py-2.5 font-medium">{r.category}</td>
                <td className="px-4 py-2.5">
                  <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border", cfg.bg, cfg.border, cfg.color)}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                    {cfg.label}
                  </span>
                </td>
                <td className={cn("px-4 py-2.5 text-right font-mono", iconColor)}>
                  {formatCurrency(parseFloat(r.amount))}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(r)}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400" onClick={() => onDelete(r.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-accent/10 font-bold">
            <td colSpan={2} className="px-4 py-2.5 text-xs">TOTAL</td>
            <td className={cn("px-4 py-2.5 text-right font-mono", iconColor)}>{formatCurrency(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 2: Dashboard de Apresentação
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "month" | "ytd" | "all";

function DashboardView() {
  const [mode, setMode] = useState<Mode>("ytd");
  const [month, setMonth] = useState(CURRENT_MONTH);
  // Toggle de filtro de API: "all" mostra consolidado, "expag"/"cinqbank" filtra
  const [apiView, setApiView] = useState<"all" | ApiSource>("all");
  const [fullscreen, setFullscreen] = useState(false);

  const params = {
    mode,
    ...(mode === "month" ? { referenceMonth: month } : {}),
    ...(apiView !== "all" ? { apiSource: apiView } : {}),
  };
  const { data } = trpc.accounting.getManualApuracaoSummary.useQuery(params);
  const { data: monthsAvailable } = trpc.accounting.getManualApuracaoMonths.useQuery();

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!data) {
    return <div className="p-12 text-center text-xs text-muted-foreground">Carregando...</div>;
  }

  const { totals, byApi, revenues, expenses, monthlySeries } = data as any;
  const showApiSplit = apiView === "all";  // só mostra split quando está em "Todas"

  return (
    <>
      {/* Barra de controles */}
      <div className="card-premium rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Período */}
          <div className="flex items-center gap-0.5 bg-accent/10 rounded-lg p-0.5">
            <button onClick={() => setMode("month")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                mode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>Mês específico</button>
            <button onClick={() => setMode("ytd")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                mode === "ytd" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>YTD {new Date().getFullYear()}</button>
            <button onClick={() => setMode("all")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                mode === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>Total</button>
          </div>
          {mode === "month" && (
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthsAvailable && monthsAvailable.length > 0
                  ? monthsAvailable.map((m: string) => (
                    <SelectItem key={m} value={m} className="text-xs">{formatMonth(m)}</SelectItem>
                  ))
                  : <SelectItem value={CURRENT_MONTH} className="text-xs">{formatMonth(CURRENT_MONTH)}</SelectItem>}
              </SelectContent>
            </Select>
          )}

          {/* Toggle de API */}
          <div className="flex items-center gap-0.5 bg-accent/10 rounded-lg p-0.5 border-l border-border ml-1 pl-2">
            <button onClick={() => setApiView("all")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                apiView === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>Consolidado</button>
            {API_ORDER.map(api => (
              <button key={api} onClick={() => setApiView(api)}
                className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium flex items-center gap-1.5",
                  apiView === api ? `${API_CONFIG[api].bg} ${API_CONFIG[api].color}` : "text-muted-foreground hover:text-foreground"
                )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", API_CONFIG[api].dot)} />
                {API_CONFIG[api].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" />
            PDF
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {fullscreen ? "Sair" : "Apresentar"}
          </Button>
        </div>
      </div>

      {/* Título de apresentação */}
      <div className="text-center py-4 print:py-2">
        <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
          Apuração de Resultado
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "month" ? formatMonth(month) : mode === "ytd" ? `YTD ${new Date().getFullYear()}` : "Acumulado total"}
          {apiView !== "all" && (
            <span className={cn("ml-2 inline-flex items-center gap-1", API_CONFIG[apiView].color)}>
              · <span className={cn("w-1.5 h-1.5 rounded-full", API_CONFIG[apiView].dot)} />
              {API_CONFIG[apiView].label}
            </span>
          )}
        </p>
      </div>

      {/* HERO KPIs (4 cards) — com split por API quando consolidado */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <BigKPI label="Receita Total" value={totals.revenue} icon={TrendingUp} color="emerald"
          apiSplit={showApiSplit ? { expag: byApi.expag.revenue, cinqbank: byApi.cinqbank.revenue } : null} />
        <BigKPI label="Despesa Total" value={totals.expense} icon={TrendingDown} color="red"
          apiSplit={showApiSplit ? { expag: byApi.expag.expense, cinqbank: byApi.cinqbank.expense } : null} />
        <BigKPI label="Resultado Líquido" value={totals.result} icon={Wallet}
          color={totals.result >= 0 ? "emerald" : "red"}
          apiSplit={showApiSplit ? { expag: byApi.expag.result, cinqbank: byApi.cinqbank.result } : null} />
        <BigKPI label="Margem" value={totals.margin} isPercent icon={Percent}
          color={totals.margin >= 30 ? "emerald" : totals.margin >= 10 ? "amber" : "red"} />
      </div>

      {/* SEÇÃO COMPARATIVA — só aparece em modo consolidado */}
      {showApiSplit && (byApi.expag.revenue > 0 || byApi.cinqbank.revenue > 0) && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Comparativo por API</h3>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {API_ORDER.map(api => (
              <ApiCompareCard key={api} api={api} data={byApi[api]} grandTotal={totals.revenue} />
            ))}
          </div>
        </section>
      )}

      {/* Composição: 2 donuts lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CompositionDonut
          title="Composição de Receitas"
          icon={TrendingUp}
          iconColor="text-emerald-400"
          rows={revenues}
          total={totals.revenue}
          colors={REVENUE_COLORS}
        />
        <CompositionDonut
          title="Composição de Despesas"
          icon={TrendingDown}
          iconColor="text-red-400"
          rows={expenses}
          total={totals.expense}
          colors={EXPENSE_COLORS}
        />
      </div>

      {/* Tabelas detalhadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DetailTable title="Receitas" iconColor="text-emerald-400" bg="bg-emerald-500/5"
          rows={revenues} total={totals.revenue} valueColor="text-emerald-400" />
        <DetailTable title="Despesas" iconColor="text-red-400" bg="bg-red-500/5"
          rows={expenses} total={totals.expense} valueColor="text-red-400" />
      </div>

      {/* Evolução mensal */}
      {mode !== "month" && monthlySeries.length > 1 && (
        <div className="card-premium rounded-2xl p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Evolução Mensal</p>
          <p className="text-lg font-semibold text-foreground mb-4">
            Receita, Despesa e Resultado por mês
            {apiView !== "all" && <span className={cn("text-sm ml-2", API_CONFIG[apiView].color)}>· {API_CONFIG[apiView].label}</span>}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={monthlySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={formatMonth} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={compactCurrency} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                labelFormatter={formatMonth}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" fill="#10b981" name="Receita" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#ef4444" name="Despesa" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="result" stroke="#fbbf24" strokeWidth={2.5} name="Resultado" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

// Card comparativo de uma API (usado na seção comparativa)
function ApiCompareCard({ api, data, grandTotal }: { api: ApiSource; data: any; grandTotal: number }) {
  const cfg = API_CONFIG[api];
  const pctOfRevenue = grandTotal > 0 ? (data.revenue / grandTotal) * 100 : 0;
  return (
    <div className={cn("card-premium rounded-2xl p-5 border-2", cfg.border, cfg.bg)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={cn("w-2.5 h-2.5 rounded-full", cfg.dot)} />
          <p className={cn("text-lg font-bold", cfg.color)}>{cfg.label}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {pctOfRevenue.toFixed(1)}% da receita total
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniKPI label="Receita" value={data.revenue} colorClass="text-emerald-400" />
        <MiniKPI label="Despesa" value={data.expense} colorClass="text-red-400" />
        <MiniKPI label="Resultado" value={data.result} colorClass={data.result >= 0 ? "text-emerald-400" : "text-red-400"} />
        <MiniKPI label="Margem" value={data.margin} isPercent colorClass={data.margin >= 30 ? "text-emerald-400" : data.margin >= 10 ? "text-amber-400" : "text-red-400"} />
      </div>
    </div>
  );
}

function MiniKPI({ label, value, colorClass, isPercent }: {
  label: string; value: number; colorClass: string; isPercent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={cn("text-lg font-bold font-mono tabular-nums", colorClass)}>
        {isPercent ? `${value.toFixed(1)}%` : compactCurrency(value)}
      </p>
    </div>
  );
}

function BigKPI({ label, value, icon: Icon, color, isPercent, apiSplit }: {
  label: string; value: number; icon: any;
  color: "emerald" | "red" | "amber"; isPercent?: boolean;
  apiSplit?: { expag: number; cinqbank: number } | null;
}) {
  const animated = useCountUp(value, 800);
  const colorMap = {
    emerald: { text: "text-emerald-400", bg: "from-emerald-500/10" },
    red:     { text: "text-red-400",     bg: "from-red-500/10" },
    amber:   { text: "text-amber-400",   bg: "from-amber-500/10" },
  };
  const c = colorMap[color];
  const formatted = isPercent ? `${animated.toFixed(1)}%` : compactCurrency(animated);
  return (
    <div className={cn("card-premium rounded-2xl p-5 bg-gradient-to-br to-transparent", c.bg)}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em] font-medium">{label}</p>
        <Icon className={cn("w-4 h-4 opacity-60", c.text)} />
      </div>
      <p className={cn("text-3xl lg:text-4xl font-bold font-mono tracking-tight tabular-nums", c.text)}>
        {formatted}
      </p>
      {apiSplit && (apiSplit.expag !== 0 || apiSplit.cinqbank !== 0) && (
        <div className="mt-2.5 pt-2.5 border-t border-border/50 flex items-center justify-between gap-2 text-[10px]">
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className={cn("w-1.5 h-1.5 rounded-full", API_CONFIG.expag.dot)} />
            <span className={API_CONFIG.expag.color}>{compactCurrency(apiSplit.expag)}</span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className={cn("w-1.5 h-1.5 rounded-full", API_CONFIG.cinqbank.dot)} />
            <span className={API_CONFIG.cinqbank.color}>{compactCurrency(apiSplit.cinqbank)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function CompositionDonut({ title, icon: Icon, iconColor, rows, total, colors }: {
  title: string; icon: any; iconColor: string;
  rows: any[]; total: number; colors: string[];
}) {
  if (rows.length === 0) {
    return (
      <div className="card-premium rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon className={cn("w-4 h-4", iconColor)} />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <p className="text-xs text-muted-foreground text-center py-12">Sem dados no período</p>
      </div>
    );
  }
  return (
    <div className="card-premium rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", iconColor)} />
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        <p className="text-xs text-muted-foreground">{rows.length} categoria{rows.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={rows} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
              paddingAngle={2} dataKey="amount" nameKey="category">
              {rows.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, _name, p: any) => [
                `${formatCurrency(v)} (${((v / total) * 100).toFixed(1)}%)`,
                p.payload.category,
              ]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1 max-h-[200px] overflow-y-auto pr-2">
          {rows.map((r: any, i: number) => {
            const pct = total > 0 ? (r.amount / total) * 100 : 0;
            return (
              <div key={r.category} className="flex items-center justify-between text-[11px] gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
                  <span className="text-muted-foreground truncate">{r.category}</span>
                </div>
                <span className="text-muted-foreground w-10 text-right shrink-0">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailTable({ title, iconColor, bg, rows, total, valueColor }: {
  title: string; iconColor: string; bg: string;
  rows: any[]; total: number; valueColor: string;
}) {
  return (
    <div className="card-premium rounded-2xl overflow-hidden">
      <div className={cn("px-5 py-3 border-b border-border", bg)}>
        <p className={cn("text-sm font-semibold", iconColor)}>{title}</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
            <th className="text-left px-4 py-2 font-medium">Categoria</th>
            <th className="text-right px-4 py-2 font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={2} className="text-center py-4 text-muted-foreground">Sem dados</td></tr>
          ) : rows.map((r: any) => (
            <tr key={r.category} className="border-b border-border/30">
              <td className={cn("px-4 py-2", valueColor)}>{r.category}</td>
              <td className={cn("px-4 py-2 text-right font-mono", valueColor)}>
                {formatCurrency(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={cn("font-bold", bg)}>
            <td className="px-4 py-2">TOTAL</td>
            <td className={cn("px-4 py-2 text-right font-mono", valueColor)}>{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
