import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Percent, Info, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOOLTIP = { background:"#0d1528", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", fontSize:"11px", color:"#e8edf5" };


const fmtS = (v: number) => { if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `R$ ${(v/1_000).toFixed(0)}k`; return formatCurrency(v); };

export default function DRE() {
  const [months, setMonths] = useState(6);
  const { data: dreList, isLoading, refetch } = trpc.accounting.getDRE.useQuery({ months });
  const deleteMutation = trpc.accounting.deleteDRE.useMutation({
    onSuccess: () => { toast.success("Entrada removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const list = ((dreList ?? []) as any[]).filter(Boolean);

  const chartData = list.slice(0, 12).reverse().map((d: any) => ({
    month: String(d.referenceMonth ?? "").slice(0, 7),
    receita: parseFloat(String(d.grossRevenue ?? 0)),
    despesa: parseFloat(String(d.operationalCosts ?? 0)),
    resultado: parseFloat(String(d.netProfit ?? 0)),
    margem: parseFloat(String(d.margin ?? 0)) * 100,
    source: d.source,
  }));

  const latest = list[0];
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
        <div className="flex gap-2">
          {[3,6,12,24].map(m => (
            <Button key={m} size="sm" variant={months === m ? "default" : "outline"} className="text-xs h-8" onClick={() => setMonths(m)}>{m} meses</Button>
          ))}
        </div>
      </div>

      {/* Aviso de fonte automática */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-blue-400">
        <Info className="w-4 h-4 shrink-0" />
        <span>O DRE é calculado automaticamente a partir dos lançamentos de <strong>Receitas</strong> e <strong>Despesas</strong>. Lançamentos de conciliação, movimentações manuais e NDIs identificados entram automaticamente.</span>
      </div>

      {/* KPIs do período */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: `Receita Total (${months}m)`, value: formatCurrency(totalRev), color: "text-emerald-400", icon: TrendingUp },
          { label: `Despesas Total (${months}m)`, value: formatCurrency(totalExp), color: "text-red-400", icon: TrendingDown },
          { label: "Resultado Acum.", value: formatCurrency(totalNet), color: totalNet >= 0 ? "text-emerald-400" : "text-red-400", icon: DollarSign },
          { label: "Margem Média", value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 30 ? "text-blue-400" : avgMargin >= 0 ? "text-yellow-400" : "text-red-400", icon: Percent },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span></div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Gráfico */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Receita vs Despesa vs Resultado</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
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
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sem dados no período. Registre receitas e despesas para gerar o DRE automaticamente.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Mês","Receita Bruta","Custos Oper.","Resultado","Margem","Fonte"].map(h => (
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
                  return (
                    <tr key={i} className="hover:bg-accent/10 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground">{String(d.referenceMonth ?? "").slice(0, 7)}</td>
                      <td className="px-4 py-3 font-mono text-emerald-400">{formatCurrency(rev)}</td>
                      <td className="px-4 py-3 font-mono text-red-400">{formatCurrency(exp)}</td>
                      <td className={cn("px-4 py-3 font-mono font-bold", net >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(net)}</td>
                      <td className={cn("px-4 py-3 font-mono", margin >= 30 ? "text-emerald-400" : margin >= 0 ? "text-yellow-400" : "text-red-400")}>{margin.toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold", d.source === 'auto' ? "text-blue-400 bg-blue-500/10 border-blue-500/30" : "text-purple-400 bg-purple-500/10 border-purple-500/30")}>
                            {d.source === 'auto' ? 'Auto' : 'Manual'}
                          </span>
                          {d.source === 'manual' && d.id > 0 && (
                            <button
                              onClick={() => { if (confirm(`Remover DRE de ${d.referenceMonth}?`)) deleteMutation.mutate({ id: d.id }); }}
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
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
