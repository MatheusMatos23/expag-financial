import { trpc } from "@/lib/trpc";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { TrendingUp, DollarSign, Info, ArrowUpRight, ArrowDownRight, Trash2, Plus, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TOOLTIP = { background:"var(--popover)", border:"1px solid var(--border)", borderRadius:"8px", fontSize:"11px", color:"var(--foreground)" };

const fmtS = (v: number) => { if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `R$ ${(v/1_000).toFixed(0)}k`; return formatCurrency(v); };

/** Estado inicial do formulário de override manual */
function emptyForm() {
  return {
    referenceDate: new Date().toISOString().slice(0, 10),
    openingBalance: "",
    realizedInflows: "",
    realizedOutflows: "",
    projectedInflows: "",
    projectedOutflows: "",
  };
}

export default function CashFlow() {
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: cfData, isLoading, refetch } = trpc.accounting.getCashFlow.useQuery({ days });
  const invalidateAll = useInvalidateFinancialData();

  const upsertMutation = trpc.accounting.upsertCashFlow.useMutation({
    onSuccess: () => {
      toast.success(editingDate ? "Lançamento atualizado." : "Override de fluxo criado.");
      setOpen(false);
      setEditingDate(null);
      setForm(emptyForm());
      refetch();
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.accounting.deleteCashFlow.useMutation({
    onSuccess: () => {
      toast.success("Lançamento removido.");
      refetch();
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = ((cfData ?? []) as any[]).filter(Boolean).slice(0, days).reverse();

  const totalIn  = rows.reduce((s, r) => s + parseFloat(String(r.realizedInflows ?? 0)), 0);
  const totalOut = rows.reduce((s, r) => s + parseFloat(String(r.realizedOutflows ?? 0)), 0);
  const netFlow  = totalIn - totalOut;
  const lastBalance = rows.length > 0 ? parseFloat(String(rows[rows.length-1].closingBalance ?? 0)) : 0;

  const chartData = rows.map(r => ({
    date: String(r.referenceDate ?? r.date ?? "").slice(5, 10).replace("-", "/"),
    entradas: parseFloat(String(r.realizedInflows ?? 0)),
    saidas: parseFloat(String(r.realizedOutflows ?? 0)),
    saldo: parseFloat(String(r.closingBalance ?? 0)),
  }));

  /** Abre o dialog em modo edição com valores do dia */
  const handleEdit = (r: any) => {
    const ref = String(r.referenceDate ?? r.date ?? "").slice(0, 10);
    setEditingDate(ref);
    setForm({
      referenceDate: ref,
      openingBalance: String(r.openingBalance ?? ""),
      realizedInflows: String(r.realizedInflows ?? ""),
      realizedOutflows: String(r.realizedOutflows ?? ""),
      projectedInflows: String(r.projectedInflows ?? ""),
      projectedOutflows: String(r.projectedOutflows ?? ""),
    });
    setOpen(true);
  };

  const handleNew = () => {
    setEditingDate(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.referenceDate) { toast.error("Data obrigatória."); return; }
    upsertMutation.mutate({
      referenceDate: form.referenceDate,
      openingBalance: form.openingBalance || "0",
      realizedInflows: form.realizedInflows || "0",
      realizedOutflows: form.realizedOutflows || "0",
      projectedInflows: form.projectedInflows || undefined,
      projectedOutflows: form.projectedOutflows || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fluxo de Caixa</h1>
          <p className="text-sm text-muted-foreground mt-1">Entradas e saídas reais do período</p>
        </div>
        <div className="flex gap-2 items-center">
          {[7,15,30,60,90].map(d => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="text-xs h-8" onClick={() => setDays(d)}>{d}d</Button>
          ))}
          <Button size="sm" onClick={handleNew} className="text-xs h-8 gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Override Manual
          </Button>
        </div>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-blue-400">
        <Info className="w-4 h-4 shrink-0" />
        <span>Calculado automaticamente a partir de receitas e despesas registradas. Use <strong>Override Manual</strong> para sobrescrever um dia específico (ajuste contábil, conciliação retroativa). Overrides têm prioridade sobre o cálculo automático.</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Entradas", value: formatCurrency(totalIn), color: "text-emerald-400", icon: ArrowUpRight },
          { label: "Total Saídas", value: formatCurrency(totalOut), color: "text-red-400", icon: ArrowDownRight },
          { label: "Fluxo Líquido", value: formatCurrency(netFlow), color: netFlow >= 0 ? "text-blue-400" : "text-orange-400", icon: DollarSign },
          { label: "Saldo Final", value: formatCurrency(lastBalance), color: lastBalance >= 0 ? "text-emerald-400" : "text-red-400", icon: TrendingUp },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card-premium rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span></div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <>
          {/* Saldo acumulado */}
          <div className="card-premium rounded-2xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">Saldo Acumulado</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtS(v)} tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} width={65} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                <Area type="monotone" dataKey="saldo" stroke="#38bdf8" strokeWidth={2} fill="url(#gSaldo)" name="Saldo" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Entradas vs Saídas */}
          <div className="card-premium rounded-2xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">Entradas vs Saídas por Dia</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtS(v)} tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} width={65} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[2,2,0,0]} />
                <Bar dataKey="saidas" name="Saídas" fill="#f87171" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Tabela */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="card-premium rounded-xl p-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sem movimentações no período. Registre receitas e despesas para gerar o fluxo de caixa — ou clique em <strong>Override Manual</strong> para sobrescrever um dia.</p>
        </div>
      ) : (
        <div className="card-premium rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Data","Entradas","Saídas","Saldo Abertura","Saldo Fechamento","Fluxo Líq.","Fonte","Ações"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice().reverse().map((r: any, i: number) => {
                  const inflow  = parseFloat(String(r.realizedInflows ?? 0));
                  const outflow = parseFloat(String(r.realizedOutflows ?? 0));
                  const net     = inflow - outflow;
                  const closing = parseFloat(String(r.closingBalance ?? 0));
                  const opening = parseFloat(String(r.openingBalance ?? 0));
                  const isManual = r.source === "manual";
                  return (
                    <tr key={i} className="hover:bg-accent/10 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(r.referenceDate ?? r.date)}</td>
                      <td className="px-4 py-2.5 font-mono text-emerald-400">{inflow > 0 ? `+${formatCurrency(inflow)}` : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-red-400">{outflow > 0 ? `-${formatCurrency(outflow)}` : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(opening)}</td>
                      <td className={cn("px-4 py-2.5 font-mono font-bold", closing >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(closing)}</td>
                      <td className={cn("px-4 py-2.5 font-mono font-semibold", net >= 0 ? "text-emerald-400" : "text-red-400")}>{net >= 0 ? `+${formatCurrency(net)}` : formatCurrency(net)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold", !isManual ? "text-blue-400 bg-blue-500/10 border-blue-500/30" : "text-purple-400 bg-purple-500/10 border-purple-500/30")}>
                          {isManual ? "Manual" : "Auto"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(r)}
                            title={isManual ? "Editar override" : "Criar override sobre este dia"}
                            className="text-muted-foreground hover:text-foreground transition-colors opacity-60 hover:opacity-100"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {isManual && r.id > 0 && (
                            <button
                              onClick={() => { if (confirm(`Remover override de ${formatDate(r.referenceDate ?? r.date)}? Volta a usar cálculo automático.`)) deleteMutation.mutate({ referenceDate: String(r.referenceDate ?? r.date ?? "") }); }}
                              title="Remover override (volta para Auto)"
                              className="text-red-400 hover:text-red-300 transition-colors opacity-60 hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dialog de override manual */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingDate ? `Editar Fluxo de Caixa — ${formatDate(editingDate)}` : "Override Manual de Fluxo de Caixa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Data *</Label>
              <Input
                type="date"
                value={form.referenceDate}
                onChange={e => setForm(f => ({ ...f, referenceDate: e.target.value }))}
                disabled={!!editingDate}
                className="mt-1 h-8 text-xs"
              />
              {editingDate && (
                <p className="text-[10px] text-muted-foreground mt-1">A data não pode ser alterada em edição (chave primária). Para outro dia, crie um novo override.</p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Saldo de Abertura (R$)</Label>
              <Input type="number" step="0.01" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} className="mt-1 h-8 text-xs" placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Entradas Realizadas (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.realizedInflows} onChange={e => setForm(f => ({ ...f, realizedInflows: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Saídas Realizadas (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.realizedOutflows} onChange={e => setForm(f => ({ ...f, realizedOutflows: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Projeções (opcional)
              </summary>
              <div className="space-y-3 mt-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Entradas Projetadas (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={form.projectedInflows} onChange={e => setForm(f => ({ ...f, projectedInflows: e.target.value }))} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Saídas Projetadas (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={form.projectedOutflows} onChange={e => setForm(f => ({ ...f, projectedOutflows: e.target.value }))} className="mt-1 h-8 text-xs" />
                </div>
              </div>
            </details>

            {/* Preview do saldo de fechamento */}
            {(() => {
              const opening = parseFloat(form.openingBalance || "0");
              const inflow = parseFloat(form.realizedInflows || "0");
              const outflow = parseFloat(form.realizedOutflows || "0");
              const closing = opening + inflow - outflow;
              const net = inflow - outflow;
              return (
                <div className="rounded-lg bg-accent/5 border border-border p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Prévia do cálculo</div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Fluxo Líquido</span><span className={cn("font-mono", net >= 0 ? "text-emerald-400" : "text-red-400")}>{net >= 0 ? "+" : ""}{formatCurrency(net)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Saldo de Fechamento</span><span className={cn("font-mono font-semibold", closing >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(closing)}</span></div>
                  {closing < 0 && (
                    <div className="text-[10px] text-red-400 mt-1">⚠ Saldo negativo → será disparado alerta de funding</div>
                  )}
                </div>
              );
            })()}

            <Button onClick={handleSubmit} disabled={upsertMutation.isPending} className="w-full">
              {upsertMutation.isPending ? "Salvando…" : editingDate ? "Atualizar" : "Criar Override"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
