import { trpc } from "@/lib/trpc";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Percent, Info, Trash2, Plus, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TOOLTIP = { background:"var(--popover)", border:"1px solid var(--border)", borderRadius:"8px", fontSize:"11px", color:"var(--foreground)" };

const fmtS = (v: number) => { if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `R$ ${(v/1_000).toFixed(0)}k`; return formatCurrency(v); };

/** Estado inicial do formulário de override manual */
function emptyForm() {
  // referenceMonth tem que ser o primeiro dia do mês (formato YYYY-MM-01)
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    referenceMonth: monthStart,
    grossRevenue: "",
    financialCosts: "0",
    operationalCosts: "",
    adminExpenses: "0",
    commercialExpenses: "0",
    taxes: "0",
  };
}

export default function DRE() {
  const [months, setMonths] = useState(6);
  const [open, setOpen] = useState(false);
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: dreList, isLoading, refetch } = trpc.accounting.getDRE.useQuery({ months });
  const invalidateAll = useInvalidateFinancialData();

  const upsertMutation = trpc.accounting.upsertDRE.useMutation({
    onSuccess: () => {
      toast.success(editingMonth ? "DRE atualizado." : "Override de DRE criado.");
      setOpen(false);
      setEditingMonth(null);
      setForm(emptyForm());
      refetch();
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.accounting.deleteDRE.useMutation({
    onSuccess: () => {
      toast.success("Entrada removida.");
      refetch();
      // DRE manual mexe nos números do Dashboard de Controladoria
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const list = ((dreList ?? []) as any[]).filter(Boolean);

  /** Abre o dialog em modo edição preenchendo os valores do mês */
  const handleEdit = (d: any) => {
    const ref = String(d.referenceMonth ?? "").slice(0, 10);
    setEditingMonth(ref);
    setForm({
      referenceMonth: ref,
      grossRevenue: String(d.grossRevenue ?? ""),
      financialCosts: String(d.financialCosts ?? "0"),
      operationalCosts: String(d.operationalCosts ?? ""),
      adminExpenses: String(d.adminExpenses ?? "0"),
      commercialExpenses: String(d.commercialExpenses ?? "0"),
      taxes: String(d.taxes ?? "0"),
    });
    setOpen(true);
  };

  const handleNew = () => {
    setEditingMonth(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.referenceMonth) { toast.error("Mês de referência obrigatório."); return; }
    if (!form.grossRevenue || parseFloat(form.grossRevenue) <= 0) {
      toast.error("Receita bruta obrigatória e maior que zero."); return;
    }
    upsertMutation.mutate({
      referenceMonth: form.referenceMonth,
      grossRevenue: form.grossRevenue,
      financialCosts: form.financialCosts || "0",
      operationalCosts: form.operationalCosts || "0",
      adminExpenses: form.adminExpenses || "0",
      commercialExpenses: form.commercialExpenses || "0",
      taxes: form.taxes || "0",
    });
  };

  const chartData = list.slice(0, 12).reverse().map((d: any) => ({
    month: String(d.referenceMonth ?? "").slice(0, 7),
    receita: parseFloat(String(d.grossRevenue ?? 0)),
    despesa: parseFloat(String(d.operationalCosts ?? 0)),
    resultado: parseFloat(String(d.netProfit ?? 0)),
    margem: parseFloat(String(d.margin ?? 0)) * 100,
    source: d.source,
  }));

  const totalRev = list.reduce((s, d) => s + parseFloat(String(d.grossRevenue ?? 0)), 0);
  const totalExp = list.reduce((s, d) => s + parseFloat(String(d.operationalCosts ?? 0)), 0);
  const totalNet = list.reduce((s, d) => s + parseFloat(String(d.netProfit ?? 0)), 0);
  const avgMargin = list.length > 0 ? list.reduce((s, d) => s + parseFloat(String(d.margin ?? 0)), 0) / list.length * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">DRE — Demonstrativo de Resultado</h1>
          <p className="text-sm text-muted-foreground mt-1">Calculado automaticamente a partir de Receitas e Despesas</p>
        </div>
        <div className="flex gap-2 items-center">
          {[3,6,12,24].map(m => (
            <Button key={m} size="sm" variant={months === m ? "default" : "outline"} className="text-xs h-8" onClick={() => setMonths(m)}>{m} meses</Button>
          ))}
          <Button size="sm" onClick={handleNew} className="text-xs h-8 gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Override Manual
          </Button>
        </div>
      </div>

      {/* Aviso de fonte automática */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-blue-400">
        <Info className="w-4 h-4 shrink-0" />
        <span>O DRE é calculado automaticamente a partir dos lançamentos de <strong>Receitas</strong> e <strong>Despesas</strong>. Use <strong>Override Manual</strong> para sobrescrever um mês específico (auditoria, ajuste contábil, fechamento). Overrides têm prioridade sobre o cálculo automático.</span>
      </div>

      {/* KPIs do período */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: `Receita Total (${months}m)`, value: formatCurrency(totalRev), color: "text-emerald-400", icon: TrendingUp },
          { label: `Despesas Total (${months}m)`, value: formatCurrency(totalExp), color: "text-red-400", icon: TrendingDown },
          { label: "Resultado Acum.", value: formatCurrency(totalNet), color: totalNet >= 0 ? "text-emerald-400" : "text-red-400", icon: DollarSign },
          { label: "Margem Média", value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 30 ? "text-blue-400" : avgMargin >= 0 ? "text-yellow-400" : "text-red-400", icon: Percent },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card-premium rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span></div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Gráfico */}
      {chartData.length > 0 && (
        <div className="card-premium rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Receita vs Despesa vs Resultado</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize:10, fill:"#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => fmtS(v)} tick={{ fontSize:10, fill:"#6b7280" }} axisLine={false} tickLine={false} width={65} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
              <Bar dataKey="receita" name="Receita" fill="#10b981" radius={[3,3,0,0]} />
              <Bar dataKey="despesa" name="Despesa" fill="#f87171" radius={[3,3,0,0]} />
              <Bar dataKey="resultado" name="Resultado" radius={[3,3,0,0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.resultado >= 0 ? "#60a5fa" : "#f97316"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabela DRE */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Carregando DRE...</div>
      ) : list.length === 0 ? (
        <div className="card-premium rounded-xl p-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sem dados no período. Registre receitas e despesas para gerar o DRE automaticamente — ou clique em <strong>Override Manual</strong> para sobrescrever um mês.</p>
        </div>
      ) : (
        <div className="card-premium rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Mês","Receita Bruta","Custos Oper.","Resultado","Margem","Fonte","Ações"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((d: any, i: number) => {
                  const rev = parseFloat(String(d.grossRevenue ?? 0));
                  const exp = parseFloat(String(d.operationalCosts ?? 0));
                  const net = parseFloat(String(d.netProfit ?? 0));
                  const margin = parseFloat(String(d.margin ?? 0)) * 100;
                  const isManual = d.source === "manual";
                  return (
                    <tr key={i} className="hover:bg-accent/10 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground">{String(d.referenceMonth ?? "").slice(0, 7)}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400">{formatCurrency(rev)}</td>
                      <td className="px-4 py-3 font-mono text-red-400">{formatCurrency(exp)}</td>
                      <td className={cn("px-4 py-3 font-mono font-bold", net >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(net)}</td>
                      <td className={cn("px-4 py-3 font-mono", margin >= 30 ? "text-emerald-400" : margin >= 0 ? "text-yellow-400" : "text-red-400")}>{margin.toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold", !isManual ? "text-blue-400 bg-blue-500/10 border-blue-500/30" : "text-purple-400 bg-purple-500/10 border-purple-500/30")}>
                          {isManual ? "Manual" : "Auto"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Sempre pode criar/editar override: se for auto, clicar abre o dialog
                              pré-preenchido com os valores atuais e SOBRESCREVE no save */}
                          <button
                            onClick={() => handleEdit(d)}
                            title={isManual ? "Editar override" : "Criar override manual sobre este mês"}
                            className="text-muted-foreground hover:text-foreground transition-colors opacity-60 hover:opacity-100"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {isManual && d.id > 0 && (
                            <button
                              onClick={() => { if (confirm(`Remover override de ${String(d.referenceMonth).slice(0,7)}? O cálculo voltará a ser automático.`)) deleteMutation.mutate({ id: d.id }); }}
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
              <tfoot>
                <tr className="bg-accent/5 border-t-2 border-border">
                  <td className="px-4 py-3 font-bold text-foreground text-xs">TOTAL</td>
                  <td className="px-4 py-3 font-mono font-bold text-emerald-400">{formatCurrency(totalRev)}</td>
                  <td className="px-4 py-3 font-mono font-bold text-red-400">{formatCurrency(totalExp)}</td>
                  <td className={cn("px-4 py-3 font-mono font-bold", totalNet >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(totalNet)}</td>
                  <td className={cn("px-4 py-3 font-mono font-bold", avgMargin >= 0 ? "text-emerald-400" : "text-red-400")}>{avgMargin.toFixed(1)}%</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Dialog de override manual */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingMonth ? `Editar DRE — ${editingMonth.slice(0,7)}` : "Override Manual de DRE"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Mês de referência *</Label>
              <Input
                type="month"
                value={form.referenceMonth.slice(0, 7)}
                onChange={e => setForm(f => ({ ...f, referenceMonth: `${e.target.value}-01` }))}
                disabled={!!editingMonth}
                className="mt-1 h-8 text-xs"
              />
              {editingMonth && (
                <p className="text-[10px] text-muted-foreground mt-1">O mês não pode ser alterado em edição. Para outro mês, crie um novo override.</p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Receita Bruta (R$) *</Label>
              <Input type="number" step="0.01" min="0" value={form.grossRevenue} onChange={e => setForm(f => ({ ...f, grossRevenue: e.target.value }))} className="mt-1 h-8 text-xs" placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Custos Financeiros (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.financialCosts} onChange={e => setForm(f => ({ ...f, financialCosts: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Custos Operacionais (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.operationalCosts} onChange={e => setForm(f => ({ ...f, operationalCosts: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Despesas Administrativas (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.adminExpenses} onChange={e => setForm(f => ({ ...f, adminExpenses: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Despesas Comerciais (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.commercialExpenses} onChange={e => setForm(f => ({ ...f, commercialExpenses: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Impostos (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.taxes} onChange={e => setForm(f => ({ ...f, taxes: e.target.value }))} className="mt-1 h-8 text-xs" />
            </div>

            {/* Preview do que o backend vai calcular */}
            {form.grossRevenue && parseFloat(form.grossRevenue) > 0 && (() => {
              const gross = parseFloat(form.grossRevenue || "0");
              const fin = parseFloat(form.financialCosts || "0");
              const op = parseFloat(form.operationalCosts || "0");
              const adm = parseFloat(form.adminExpenses || "0");
              const com = parseFloat(form.commercialExpenses || "0");
              const tx = parseFloat(form.taxes || "0");
              const net = gross - fin;
              const result = net - op - adm - com - tx;
              const margin = gross > 0 ? (result / gross) * 100 : 0;
              return (
                <div className="rounded-lg bg-accent/5 border border-border p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Prévia do cálculo</div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Receita Líquida</span><span className="font-mono">{formatCurrency(net)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Resultado Operacional</span><span className={cn("font-mono font-semibold", result >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(result)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Margem</span><span className={cn("font-mono", margin >= 30 ? "text-emerald-400" : margin >= 0 ? "text-yellow-400" : "text-red-400")}>{margin.toFixed(1)}%</span></div>
                </div>
              );
            })()}

            <Button onClick={handleSubmit} disabled={upsertMutation.isPending} className="w-full">
              {upsertMutation.isPending ? "Salvando…" : editingMonth ? "Atualizar" : "Criar Override"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
