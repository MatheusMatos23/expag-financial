import { trpc } from "@/lib/trpc";
import {
  formatCurrency, formatCurrencyCompact, getCurrentMonthRange, safeNumber,
} from "@/lib/utils";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Activity,
  TrendingUp, Wallet, Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const DEMO_BALANCE = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (29 - i));
  const base = 4_800_000 + Math.sin(i * 0.3) * 400_000 + i * 22_000;
  return {
    date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    banco: Math.round(base + (i * 7919) % 80_000),
    caixaReal: Math.round(base * 0.48 + (i * 3571) % 40_000),
    caixaLivre: Math.round(base * 0.18 + (i * 1327) % 20_000),
  };
});

const DEMO_CASHFLOW = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (13 - i));
  return {
    date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    entradas: 200_000 + ((i * 97331) % 180_000),
    saidas: 130_000 + ((i * 63197) % 120_000),
  };
});

const DEMO_MIX = [
  { name: "PIX", value: 42, color: "#38bdf8" },
  { name: "TED", value: 22, color: "#818cf8" },
  { name: "Boleto", value: 15, color: "#34d399" },
  { name: "Antecipação", value: 12, color: "#f59e0b" },
  { name: "Crédito", value: 6, color: "#f87171" },
  { name: "Tarifa", value: 3, color: "#a78bfa" },
];

const TOOLTIP = {
  background: "#1a1f2e",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "8px",
  fontSize: "11px",
  color: "#e2e8f0",
};

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KPICard({ title, value, subtitle, delta, icon: Icon, accent, onClick }: {
  title: string; value: string; subtitle?: string; delta?: number;
  icon: React.ElementType; accent: string; onClick?: () => void;
}) {
  const styles: Record<string, string> = {
    blue:   "text-sky-400 bg-sky-500/10 border-sky-500/20",
    green:  "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    red:    "text-red-400 bg-red-500/10 border-red-500/20",
    yellow: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    purple: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    teal:   "text-teal-400 bg-teal-500/10 border-teal-500/20",
  };
  const [textCls, bgBorderCls] = (styles[accent] ?? styles.blue).split(" ").reduce<[string[], string[]]>(
    ([t, b], cls) => { cls.startsWith("text-") ? t.push(cls) : b.push(cls); return [t, b]; },
    [[], []]
  );

  return (
    <div
      onClick={onClick}
      className={cn(
        "kpi-card bg-card border border-border rounded-xl p-5 flex flex-col gap-3",
        onClick && "cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center", bgBorderCls.join(" "))}>
          <Icon className={cn("w-4 h-4", textCls.join(" "))} />
        </div>
      </div>
      <div>
        <p className={cn("text-2xl font-bold font-mono tracking-tight", textCls.join(" "))}>{value}</p>
        <div className="flex items-center gap-2 mt-1.5">
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          {delta !== undefined && (
            <span className={cn(
              "inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded",
              delta >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"
            )}>
              {delta >= 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, className }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("bg-card border border-border rounded-xl p-5", className)}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [, setLocation] = useLocation();

  const { data: summary } = trpc.dashboard.getSummary.useQuery({ dateFrom, dateTo });
  const { data: alerts } = trpc.dashboard.getAlerts.useQuery({ status: "active" });
  const { data: balanceHistory } = trpc.reconciliation.getManagerialBalanceHistory.useQuery({ days: 30 });
  const { data: cashFlowData } = trpc.accounting.getCashFlow.useQuery({ days: 14 });
  const { data: sessions } = trpc.reconciliation.getSessions.useQuery();

  const isDemo = !(summary?.latestBalance);

  // Chart data — real only (sem demo)
  const balanceData = (balanceHistory ?? []).length > 0
    ? [...(balanceHistory as any[])].reverse().map((b) => ({
        date: new Date(b.referenceDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        banco: safeNumber(b.bankBalance),
        caixaReal: safeNumber(b.realCash),
        caixaLivre: safeNumber(b.freeCash),
      }))
    : [];

  const cashData = (cashFlowData ?? []).length > 0
    ? [...(cashFlowData as any[])].reverse().map((c) => ({
        date: new Date(c.referenceDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        entradas: safeNumber(c.realizedInflows),
        saidas: safeNumber(c.realizedOutflows),
      }))
    : [];

  const mixData = (summary?.revenueSummary ?? []).length > 0
    ? (summary!.revenueSummary as any[]).map((r, i) => ({
        name: r.type, value: safeNumber(r.total),
        color: DEMO_MIX[i % DEMO_MIX.length].color,
      }))
    : [];

  // Metrics — zeros quando não há dados reais
  const bankBalance = safeNumber(summary?.latestBalance?.bankBalance);
  const realCash    = safeNumber(summary?.latestBalance?.realCash);
  const freeCash    = safeNumber(summary?.latestBalance?.freeCash);
  const clientBal   = safeNumber(summary?.latestBalance?.clientBalance);
  const totalRev    = safeNumber(summary?.totalRevenue);
  const totalExp    = safeNumber(summary?.totalExpenses);
  const netResult   = totalRev - totalExp;
  const divCount    = safeNumber(summary?.activeDivergences, 0);
  const overduePayables = safeNumber(summary?.overduePayables, 0);
  const alertCount  = safeNumber(summary?.activeAlerts, 0);
  const criticalAlerts = (alerts ?? []).filter((a: any) => a.severity === "critical");

  const latestSession = ((sessions ?? []) as any[])[0];
  const matchRate = latestSession?.matchedCount
    ? Math.round((latestSession.matchedCount / Math.max(1, latestSession.matchedCount + latestSession.divergentCount)) * 100)
    : 0;

  // Revenue breakdown — real only
  const revRows = (summary?.revenueSummary ?? []).length > 0
    ? (summary!.revenueSummary as any[]).map((r) => ({ label: r.type, amount: safeNumber(r.total), pct: totalRev > 0 ? (safeNumber(r.total) / totalRev) * 100 : 0 }))
    : [];

  const expRows = (summary?.expenseSummary ?? []).length > 0
    ? (summary!.expenseSummary as any[]).map((e) => ({ label: e.category, amount: safeNumber(e.total), pct: totalExp > 0 ? (safeNumber(e.total) / totalExp) * 100 : 0 }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard Executivo</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-emerald-400">Sistema Operacional</span>
          </div>
          {criticalAlerts.length > 0 && (
            <button onClick={() => setLocation("/alertas")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-[11px] font-semibold hover:bg-red-500/20 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" />
              {criticalAlerts.length} crítico{criticalAlerts.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Saldo nos Bancos" accent="blue" value={formatCurrencyCompact(bankBalance)} subtitle="Custódia total" delta={2.4} icon={Wallet} />
        <KPICard title="Caixa Real" accent="teal" value={formatCurrencyCompact(realCash)} subtitle="Bancos − Clientes − Comprometido" delta={-1.1} icon={Activity} />
        <KPICard title="Receita do Mês" accent="purple" value={formatCurrencyCompact(totalRev)} subtitle="Realizado" delta={8.3} icon={TrendingUp} />
        <KPICard title="Resultado Líquido" accent={netResult >= 0 ? "green" : "red"}
          value={formatCurrencyCompact(netResult)} subtitle="Receitas − Despesas"
          delta={netResult >= 0 ? 5.2 : -5.2}
          icon={netResult >= 0 ? ArrowUpRight : ArrowDownRight} />
      </div>

      {/* Operational strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Caixa Livre", value: formatCurrencyCompact(freeCash), color: freeCash < 0 ? "text-red-400" : "text-teal-400", sub: freeCash < 0 ? "⚠ NEGATIVO" : null, path: "/saldo-gerencial" },
          { label: "Custódia Clientes", value: formatCurrencyCompact(clientBal), color: "text-amber-400", sub: null, path: "/saldo-gerencial" },
          { label: "Divergências", value: String(divCount), color: divCount > 10 ? "text-amber-400" : "text-foreground", sub: "ativas", path: "/divergencias" },
          { label: "A Pagar Vencido", value: String(overduePayables), color: overduePayables > 0 ? "text-red-400" : "text-foreground", sub: overduePayables > 0 ? "REGULARIZAR" : null, path: "/contas-a-pagar" },
          { label: "Taxa Matching", value: `${matchRate}%`, color: matchRate >= 90 ? "text-emerald-400" : "text-amber-400", sub: "última sessão", path: "/conciliacao" },
          { label: "Alertas Ativos", value: String(alertCount), color: alertCount > 0 ? "text-orange-400" : "text-foreground", sub: "no sistema", path: "/alertas" },
        ].map(({ label, value, color, sub, path }) => (
          <div key={label} onClick={() => setLocation(path)}
            className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-border/60 transition-colors">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 leading-tight">{label}</p>
            <p className={cn("text-lg font-bold font-mono", color)}>{value}</p>
            {sub && <p className="text-[9px] font-semibold text-muted-foreground mt-0.5 uppercase">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <ChartCard title="Evolução de Saldos" subtitle="Últimos 30 dias" className="lg:col-span-3">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={balanceData} margin={{ left: -10 }}>
              <defs>
                {[["gB","#38bdf8"],["gR","#34d399"],["gL","#a78bfa"]].map(([id, c]) => (
                  <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={(v) => `${(v/1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              <Area type="monotone" dataKey="banco" stroke="#38bdf8" fill="url(#gB)" strokeWidth={1.5} name="Banco" dot={false} />
              <Area type="monotone" dataKey="caixaReal" stroke="#34d399" fill="url(#gR)" strokeWidth={1.5} name="Caixa Real" dot={false} />
              <Area type="monotone" dataKey="caixaLivre" stroke="#a78bfa" fill="url(#gL)" strokeWidth={1.5} name="Caixa Livre" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Mix de Receitas" subtitle="Distribuição por canal" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={155}>
            <PieChart>
              <Pie data={mixData} cx="50%" cy="50%" innerRadius={46} outerRadius={68} paddingAngle={2} dataKey="value">
                {mixData.map((e, i) => <Cell key={i} fill={e.color} opacity={0.88} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrencyCompact(v)} contentStyle={TOOLTIP} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
            {mixData.map((r) => (
              <div key={r.name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="text-[10px] text-muted-foreground truncate">{r.name}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <ChartCard title="Fluxo de Caixa" subtitle="Entradas × Saídas · 14 dias" className="lg:col-span-3">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cashData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              <Bar dataKey="entradas" fill="#34d399" name="Entradas" radius={[3,3,0,0]} opacity={0.85} />
              <Bar dataKey="saidas"   fill="#f87171" name="Saídas"   radius={[3,3,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="lg:col-span-2 space-y-4">
          <ChartCard title="Resultado Mensal" subtitle={new Date().toLocaleDateString("pt-BR",{ month:"long", year:"numeric" })}>
            {[
              { label: "Receita Total",    value: formatCurrencyCompact(totalRev), color: "text-emerald-400" },
              { label: "Despesas Totais",  value: formatCurrencyCompact(totalExp), color: "text-red-400" },
              { label: "Resultado Líquido",value: formatCurrencyCompact(netResult), color: netResult >= 0 ? "text-emerald-400" : "text-red-400" },
              { label: "Margem",           value: totalRev > 0 ? `${((netResult/totalRev)*100).toFixed(1)}%` : "—", color: netResult >= 0 ? "text-emerald-400" : "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className={cn("text-xs font-mono font-semibold", color)}>{value}</span>
              </div>
            ))}
          </ChartCard>

          <ChartCard title="Status Operacional">
            <div className="space-y-2.5">
              {[
                { label: "Motor de Conciliação", ok: true },
                { label: "Classificador de Divergências", ok: true },
                { label: "Alertas de Tesouraria", ok: alertCount === 0 },
                { label: "Contas a Pagar em Dia", ok: overduePayables === 0 },
                { label: "Taxa de Matching ≥90%", ok: matchRate >= 90 },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", ok ? "bg-emerald-400" : "bg-red-400 animate-pulse")} />
                  <span className="text-[11px] text-muted-foreground flex-1">{label}</span>
                  <span className={cn("text-[10px] font-bold uppercase", ok ? "text-emerald-400" : "text-red-400")}>
                    {ok ? "OK" : "ATENÇÃO"}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Receitas por Tipo" subtitle="Mês atual — acumulado">
          <div className="space-y-3">
            {revRows.slice(0, 6).map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-20 shrink-0 capitalize">{r.label}</span>
                <div className="flex-1 bg-border/40 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-sky-400 h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(r.pct, 100)}%` }} />
                </div>
                <span className="text-[11px] font-mono text-foreground w-24 text-right">{formatCurrencyCompact(r.amount)}</span>
                <span className="text-[10px] text-muted-foreground w-8 text-right">{r.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Despesas por Categoria" subtitle="Mês atual — acumulado">
          <div className="space-y-3">
            {expRows.slice(0, 6).map((e) => (
              <div key={e.label} className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-20 shrink-0 capitalize">{e.label}</span>
                <div className="flex-1 bg-border/40 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-red-400 h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(e.pct, 100)}%` }} />
                </div>
                <span className="text-[11px] font-mono text-foreground w-24 text-right">{formatCurrencyCompact(e.amount)}</span>
                <span className="text-[10px] text-muted-foreground w-8 text-right">{e.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
