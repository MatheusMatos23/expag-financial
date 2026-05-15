import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Info, ArrowUpRight, ArrowDownRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOOLTIP = { background:"#0d1528", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", fontSize:"11px", color:"#e8edf5" };

function fmtS(v: number) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `R$ ${(v/1_000).toFixed(0)}k`;
  return formatCurrency(v);
}

export default function CashFlow() {
  const [days, setDays] = useState(30);
  const { data: cfData, isLoading, refetch } = trpc.accounting.getCashFlow.useQuery({ days });
  const deleteMutation = trpc.accounting.deleteCashFlow?.useMutation?.({
    onSuccess: () => { toast.success("Entrada removida."); refetch(); },
  });
  const rows = ((cfData ?? []) as any[]).filter(Boolean).slice(0, days).reverse();

  const totalIn  = rows.reduce((s, r) => s + parseFloat(String(r.realizedInflows ?? 0)), 0);
  const totalOut = rows.reduce((s, r) => s + parseFloat(String(r.realizedOutflows ?? 0)), 0);
  const netFlow  = totalIn - totalOut;
  const lastBalance = rows.length > 0 ? parseFloat(String(rows[rows.length-1].closingBalance ?? 0)) : 0;
  const fundingNeeded = rows.reduce((s, r) => s + parseFloat(String(r.fundingNeeded ?? 0)), 0);

  const chartData = rows.map(r => ({
    date: String(r.referenceDate ?? r.date ?? "").slice(5, 10).replace("-", "/"),
    entradas: parseFloat(String(r.realizedInflows ?? 0)),
    saidas: parseFloat(String(r.realizedOutflows ?? 0)),
    saldo: parseFloat(String(r.closingBalance ?? 0)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fluxo de Caixa</h1>
          <p className="text-sm text-muted-foreground mt-1">Entradas e saídas reais do período</p>
        </div>
        <div className="flex gap-2">
          {[7,15,30,60,90].map(d => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="text-xs h-8" onClick={() => setDays(d)}>{d}d</Button>
          ))}
        </div>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-blue-400">
        <Info className="w-4 h-4 shrink-0" />
        <span>Calculado automaticamente a partir de receitas e despesas registradas (conciliação + lançamentos manuais).</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Entradas", value: fmtS(totalIn), color: "text-emerald-400", icon: ArrowUpRight },
          { label: "Total Saídas", value: fmtS(totalOut), color: "text-red-400", icon: ArrowDownRight },
          { label: "Fluxo Líquido", value: fmtS(netFlow), color: netFlow >= 0 ? "text-blue-400" : "text-orange-400", icon: DollarSign },
          { label: "Saldo Final", value: fmtS(lastBalance), color: lastBalance >= 0 ? "text-emerald-400" : "text-red-400", icon: TrendingUp },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span></div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <>
          {/* Saldo acumulado */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">Saldo Acumulado</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtS(v)} tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} width={65} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                <Area type="monotone" dataKey="saldo" stroke="#38bdf8" strokeWidth={2} fill="url(#gSaldo)" name="Saldo" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Entradas vs Saídas */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-bold text-foreground mb-4">Entradas vs Saídas por Dia</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
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
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sem movimentações no período. Registre receitas e despesas para gerar o fluxo de caixa.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Data","Entradas","Saídas","Saldo Abertura","Saldo Fechamento","Fluxo Líq."].map(h => (
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
                  return (
                    <tr key={i} className="hover:bg-accent/10 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(r.referenceDate ?? r.date)}</td>
                      <td className="px-4 py-2.5 font-mono text-emerald-400">{inflow > 0 ? `+${formatCurrency(inflow)}` : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-red-400">{outflow > 0 ? `-${formatCurrency(outflow)}` : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(opening)}</td>
                      <td className={cn("px-4 py-2.5 font-mono font-bold", closing >= 0 ? "text-blue-400" : "text-orange-400")}>{formatCurrency(closing)}</td>
                      <td className={cn("px-4 py-2.5 font-mono font-semibold", net >= 0 ? "text-emerald-400" : "text-red-400")}>{net >= 0 ? `+${formatCurrency(net)}` : formatCurrency(net)}</td>
                      <td className="px-4 py-2.5">
                        {r.source === 'manual' && r.id > 0 && deleteMutation && (
                          <button className="text-red-400 hover:text-red-300 opacity-50 hover:opacity-100 transition-all"
                            onClick={() => { if (confirm("Remover este lançamento?")) deleteMutation.mutate({ referenceDate: String(r.referenceDate ?? r.date ?? '') }); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
