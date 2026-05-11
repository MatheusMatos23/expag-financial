import { trpc } from "@/lib/trpc";
import { formatCurrency, formatCurrencyCompact, formatDate, safeNumber } from "@/lib/utils";
import { useState } from "react";
import {
  Plus, TrendingUp, TrendingDown, Activity,
  Edit2, AlertTriangle, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area, ReferenceLine,
} from "recharts";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { cn } from "@/lib/utils";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  background: "#0d1528", border: "1px solid #1a2d50",
  borderRadius: "8px", fontSize: "11px", color: "#e8edf5",
};

const EMPTY_FORM = {
  referenceDate: new Date().toISOString().split("T")[0],
  openingBalance: "", projectedInflows: "", projectedOutflows: "",
  realizedInflows: "", realizedOutflows: "", fundingNeeded: "",
};

// ─── FORM DIALOG ─────────────────────────────────────────────────────────────
function CashFlowFormDialog({
  open, onClose, initialData, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: typeof EMPTY_FORM;
  onSuccess: () => void;
}) {
  const isEdit = !!initialData?.realizedInflows || !!initialData?.openingBalance;
  const [form, setForm] = useState(initialData ?? EMPTY_FORM);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const upsertMutation = trpc.accounting.upsertCashFlow.useMutation({
    onSuccess: () => {
      toast.success(isEdit ? "Fluxo atualizado!" : "Fluxo registrado!");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const opening  = safeNumber(form.openingBalance);
  const realIn   = safeNumber(form.realizedInflows);
  const realOut  = safeNumber(form.realizedOutflows);
  const closing  = opening + realIn - realOut;
  const net      = realIn - realOut;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Fluxo de Caixa" : "Registrar Fluxo de Caixa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Data de Referência *</Label>
            <Input type="date" value={form.referenceDate}
              onChange={set("referenceDate")} className="mt-1 h-8 text-xs" />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              Valores Realizados
            </Label>
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              <div>
                <Label className="text-[11px] text-muted-foreground">Saldo Inicial (R$)</Label>
                <Input type="number" step="0.01" value={form.openingBalance}
                  onChange={set("openingBalance")} className="mt-1 h-8 text-xs font-mono"
                  placeholder="0,00" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Entradas (R$) *</Label>
                <Input type="number" step="0.01" value={form.realizedInflows}
                  onChange={set("realizedInflows")} className="mt-1 h-8 text-xs font-mono text-emerald-400"
                  placeholder="0,00" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Saídas (R$) *</Label>
                <Input type="number" step="0.01" value={form.realizedOutflows}
                  onChange={set("realizedOutflows")} className="mt-1 h-8 text-xs font-mono text-red-400"
                  placeholder="0,00" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Funding Necessário (R$)</Label>
                <Input type="number" step="0.01" value={form.fundingNeeded}
                  onChange={set("fundingNeeded")} className="mt-1 h-8 text-xs font-mono text-amber-400"
                  placeholder="0,00" />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              Projeções (Previsto)
            </Label>
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              <div>
                <Label className="text-[11px] text-muted-foreground">Entradas Previstas (R$)</Label>
                <Input type="number" step="0.01" value={form.projectedInflows}
                  onChange={set("projectedInflows")} className="mt-1 h-8 text-xs font-mono"
                  placeholder="0,00" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Saídas Previstas (R$)</Label>
                <Input type="number" step="0.01" value={form.projectedOutflows}
                  onChange={set("projectedOutflows")} className="mt-1 h-8 text-xs font-mono"
                  placeholder="0,00" />
              </div>
            </div>
          </div>

          {/* Preview do resultado */}
          {(realIn > 0 || realOut > 0) && (
            <div className="bg-muted/20 border border-border/60 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Prévia do Resultado
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Fluxo Líquido</span>
                <span className={cn("font-mono font-bold", net >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {net >= 0 ? "+" : ""}{formatCurrency(net)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Saldo Final</span>
                <span className={cn("font-mono font-bold", closing >= 0 ? "text-foreground" : "text-red-400")}>
                  {formatCurrency(closing)}
                  {closing < 0 && <span className="text-[10px] ml-1">⚠ Negativo</span>}
                </span>
              </div>
            </div>
          )}

          <Button
            onClick={() => upsertMutation.mutate({
              referenceDate: form.referenceDate,
              openingBalance: form.openingBalance || undefined,
              realizedInflows: form.realizedInflows || undefined,
              realizedOutflows: form.realizedOutflows || undefined,
              projectedInflows: form.projectedInflows || undefined,
              projectedOutflows: form.projectedOutflows || undefined,
              fundingNeeded: form.fundingNeeded || undefined,
            })}
            disabled={!form.referenceDate || upsertMutation.isPending}
            className="w-full"
          >
            {upsertMutation.isPending ? "Salvando..." : isEdit ? "Salvar Alterações" : "Registrar Fluxo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CashFlow() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<typeof EMPTY_FORM | undefined>(undefined);

  const { data: cashFlow, refetch } = trpc.accounting.getCashFlow.useQuery({ days: 30 });

  const entries = (cashFlow ?? []) as any[];
  const handleEdit = (row: any) => {
    setEditData({
      referenceDate: typeof row.referenceDate === "string"
        ? row.referenceDate.slice(0, 10)
        : new Date(row.referenceDate).toISOString().split("T")[0],
      openingBalance:    String(row.openingBalance    ?? ""),
      projectedInflows:  String(row.projectedInflows  ?? ""),
      projectedOutflows: String(row.projectedOutflows ?? ""),
      realizedInflows:   String(row.realizedInflows   ?? ""),
      realizedOutflows:  String(row.realizedOutflows  ?? ""),
      fundingNeeded:     String(row.fundingNeeded      ?? ""),
    });
    setDialogOpen(true);
  };

  // ── Totals ──
  const totalIn  = entries.reduce((s, c) => s + safeNumber(c.realizedInflows),  0);
  const totalOut = entries.reduce((s, c) => s + safeNumber(c.realizedOutflows), 0);
  const netFlow  = totalIn - totalOut;
  const avgDailyIn  = entries.length > 0 ? totalIn  / entries.length : 0;
  const avgDailyOut = entries.length > 0 ? totalOut / entries.length : 0;
  const dailyNet    = avgDailyIn - avgDailyOut;
  const lastBalance = safeNumber(entries[0]?.closingBalance ?? entries[0]?.openingBalance);
  const projD7  = lastBalance + dailyNet * 7;
  const projD15 = lastBalance + dailyNet * 15;
  const projD30 = lastBalance + dailyNet * 30;

  // ── Chart data ──
  const chartData = [...entries].reverse().map(c => ({
    date: new Date(c.referenceDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    entradas: safeNumber(c.realizedInflows),
    saidas:   safeNumber(c.realizedOutflows),
    liquido:  safeNumber(c.realizedInflows) - safeNumber(c.realizedOutflows),
  }));

  const balanceData = [...entries].reverse().map(c => ({
    date: new Date(c.referenceDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    saldo: safeNumber(c.closingBalance ?? c.openingBalance),
  }));

  // ── DataTable columns ──
  const columns: ColumnDef<any>[] = [
    {
      key: "referenceDate", header: "Data", sortable: true, width: "90px",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.referenceDate)}</span>,
    },
    {
      key: "openingBalance", header: "Saldo Inicial", sortable: true, align: "right", width: "120px",
      cell: (r) => <span className="font-mono text-xs text-foreground">{formatCurrency(r.openingBalance)}</span>,
    },
    {
      key: "realizedInflows", header: "Entradas", sortable: true, align: "right", width: "120px",
      cell: (r) => (
        <span className="font-mono text-xs font-semibold text-emerald-400 flex items-center justify-end gap-1">
          <ArrowUpRight className="w-3 h-3" />{formatCurrency(r.realizedInflows)}
        </span>
      ),
    },
    {
      key: "realizedOutflows", header: "Saídas", sortable: true, align: "right", width: "120px",
      cell: (r) => (
        <span className="font-mono text-xs font-semibold text-red-400 flex items-center justify-end gap-1">
          <ArrowDownRight className="w-3 h-3" />{formatCurrency(r.realizedOutflows)}
        </span>
      ),
    },
    {
      key: "closingBalance", header: "Saldo Final", sortable: true, align: "right", width: "120px",
      cell: (r) => {
        const v = safeNumber(r.closingBalance ?? r.openingBalance);
        return (
          <span className={cn("font-mono text-xs font-bold", v >= 0 ? "text-foreground" : "text-red-400")}>
            {formatCurrency(v)}
          </span>
        );
      },
    },
    {
      key: "projectedInflows", header: "Prev. Entrada", align: "right", width: "110px",
      cell: (r) => <span className="font-mono text-xs text-sky-400">{formatCurrency(r.projectedInflows)}</span>,
    },
    {
      key: "projectedOutflows", header: "Prev. Saída", align: "right", width: "110px",
      cell: (r) => <span className="font-mono text-xs text-orange-400">{formatCurrency(r.projectedOutflows)}</span>,
    },
    {
      key: "fundingNeeded", header: "Funding", align: "right", width: "100px",
      cell: (r) => {
        const v = safeNumber(r.fundingNeeded);
        return v > 0
          ? <span className="font-mono text-xs font-semibold text-amber-400 flex items-center justify-end gap-1">
              <AlertTriangle className="w-3 h-3" />{formatCurrencyCompact(v)}
            </span>
          : <span className="text-muted-foreground/40 text-xs text-right block">—</span>;
      },
    },
    {
      key: "id", header: "Editar", align: "center", width: "70px", searchable: false,
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
          onClick={(e) => { e.stopPropagation(); handleEdit(r); }}
        >
          <Edit2 className="w-3 h-3" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Fluxo de Caixa</h1>
          <p className="text-sm text-muted-foreground mt-1">Camada 3 · Entradas, saídas, projeções e saldo</p>
        </div>
        <Button className="gap-2 shrink-0" onClick={() => { setEditData(undefined); setDialogOpen(true); }}>
          <Plus className="w-4 h-4" /> Registrar Fluxo
        </Button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Entradas (30d)</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-400">{formatCurrencyCompact(totalIn)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">média {formatCurrencyCompact(avgDailyIn)}/dia</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Saídas (30d)</span>
            <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-red-400">{formatCurrencyCompact(totalOut)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">média {formatCurrencyCompact(avgDailyOut)}/dia</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Fluxo Líquido</span>
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className={cn("text-2xl font-bold font-mono", netFlow >= 0 ? "text-emerald-400" : "text-red-400")}>
            {netFlow >= 0 ? "+" : ""}{formatCurrencyCompact(netFlow)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">entradas − saídas</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Média Diária</span>
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className={cn("text-2xl font-bold font-mono", dailyNet >= 0 ? "text-teal-400" : "text-red-400")}>
            {dailyNet >= 0 ? "+" : ""}{formatCurrencyCompact(dailyNet)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">líquido diário</p>
        </div>
      </div>

      {/* ── Projeções D+7 / D+15 / D+30 ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Projeção D+7",  value: projD7,  days: 7  },
          { label: "Projeção D+15", value: projD15, days: 15 },
          { label: "Projeção D+30", value: projD30, days: 30 },
        ].map(({ label, value, days }) => (
          <div key={days} className={cn(
            "border rounded-xl p-5",
            value < 0
              ? "bg-red-500/5 border-red-500/20"
              : value < 500_000
              ? "bg-amber-500/5 border-amber-500/20"
              : "bg-card border-border"
          )}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={cn("w-3.5 h-3.5", value < 0 ? "text-red-400" : "text-violet-400")} />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn("text-2xl font-bold font-mono", value >= 0 ? "text-violet-400" : "text-red-400")}>
              {formatCurrencyCompact(value)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {entries.length > 0 ? `baseado na média dos últimos ${entries.length} dias` : "sem dados históricos"}
            </p>
            {value < 0 && (
              <p className="text-[10px] text-red-400 font-semibold mt-1">⚠ Requer captação</p>
            )}
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Entradas × Saídas — 30 dias
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#5c7099" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "#5c7099" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <Bar dataKey="entradas" fill="#10b981" name="Entradas" radius={[3,3,0,0]} opacity={0.85} />
                <Bar dataKey="saidas"   fill="#f87171" name="Saídas"   radius={[3,3,0,0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
              Sem dados para exibir.
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-400" />
            Evolução do Saldo — 30 dias
          </h3>
          {balanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={balanceData} margin={{ left: -10 }}>
                <defs>
                  <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#5c7099" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "#5c7099" }} tickFormatter={v => `${(v/1_000_000).toFixed(1)}M`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
                <Area type="monotone" dataKey="saldo" stroke="#a78bfa" fill="url(#gSaldo)"
                  strokeWidth={2} dot={false} name="Saldo" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
              Sem dados para exibir.
            </div>
          )}
        </div>
      </div>

      {/* ── DataTable com botão Editar ── */}
      <DataTable
        data={entries}
        columns={columns}
        searchPlaceholder="Buscar por data..."
        exportFilename="fluxo-caixa"
        emptyTitle="Nenhum fluxo de caixa registrado"
        emptyDescription="Registre o fluxo do dia usando o botão acima."
        defaultPageSize={15}
        rowClassName={(r) => {
          const v = safeNumber(r.closingBalance ?? r.openingBalance);
          return v < 0 ? "bg-red-500/5" : undefined;
        }}
      />

      {/* ── Form Dialog (novo ou editar) ── */}
      {dialogOpen && (
        <CashFlowFormDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditData(undefined); }}
          initialData={editData}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
