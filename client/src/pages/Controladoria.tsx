import { trpc } from "@/lib/trpc";
import { formatCurrency, getCurrentMonthRange } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap, Target,
  Calendar, ChevronRight, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useLocation } from "wouter";

// ── Constantes ────────────────────────────────────────────────────────────────
const PERIODS = [
  { label: "Este mês",    getValue: () => getCurrentMonthRange() },
  { label: "30 dias",     getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-30); return { dateFrom: from.toISOString().slice(0,10), dateTo: to.toISOString().slice(0,10) }; } },
  { label: "90 dias",     getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-90); return { dateFrom: from.toISOString().slice(0,10), dateTo: to.toISOString().slice(0,10) }; } },
  { label: "Este ano",    getValue: () => { const now = new Date(); return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: now.toISOString().slice(0,10) }; } },
];

const TYPE_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", boleto: "Boleto", credito: "Crédito",
  antecipacao: "Antecipação", pos: "POS", white_label: "White Label",
  receita_financeira: "Rec. Financeira", receita_operacional: "Rec. Operacional", outros: "Outros",
};

const CAT_LABELS: Record<string, string> = {
  bancaria: "Bancária", api: "API/Plataforma", operacional: "Operacional",
  impostos: "Impostos", estorno: "Estorno", chargeback: "Chargeback",
  folha: "Folha", comercial: "Comercial", tecnologia: "Tecnologia",
  infra: "Infra", outros: "Outros",
};

const REV_COLORS  = ["#10b981","#38bdf8","#818cf8","#f59e0b","#fb923c","#e879f9","#2dd4bf","#60a5fa","#a78bfa","#94a3b8"];
const EXP_COLORS  = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#38bdf8","#818cf8","#e879f9","#f472b6","#94a3b8"];

const TOOLTIP_STYLE = { background:"var(--popover)", border:"1px solid var(--border)", borderRadius:"10px", fontSize:"11px", color:"var(--foreground)" };

function fmt(v: number) { return formatCurrency(v); }
// fmtShort only for chart axes
const fmtShort = (v: number) => { if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `R$ ${(v/1_000).toFixed(0)}k`; return formatCurrency(v); };
function fmtDate(d: string) {
  const [y,m,day] = d.split("-");
  return `${day}/${m}`;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon, trend }: {
  label: string; value: string; sub?: string; color: string;
  icon: any; trend?: number;
}) {
  return (
    <div className="card-premium rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", color.replace("text-","bg-").replace("-400","-500/15"))}>
          <Icon className={cn("w-4.5 h-4.5", color)} />
        </div>
        {trend !== undefined && (
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full",
            trend >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10")}>
            {trend >= 0 ? "+" : ""}{trend.toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
        <p className={cn("text-2xl font-bold font-mono mt-0.5 leading-tight", color)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Controladoria() {
  const [periodIdx, setPeriodIdx] = useState(1); // 30 dias por padrão
  const [, navigate] = useLocation();

  const { dateFrom, dateTo } = PERIODS[periodIdx].getValue();

  const { data, isLoading, refetch } = trpc.controllership.getControllershipDashboard.useQuery(
    { dateFrom, dateTo },
    { refetchOnWindowFocus: false }
  );

  // Prepara dados do gráfico de evolução
  const evolutionData = useMemo(() => {
    if (!data?.dailyEvolution) return [];
    return data.dailyEvolution.map(d => ({
      ...d,
      date: fmtDate(d.date),
      resultado: d.receitas - d.despesas,
    }));
  }, [data]);

  // Prepara dados de receita por tipo (top 6)
  const revenueChartData = useMemo(() => {
    if (!data?.revenueByType) return [];
    return Object.entries(data.revenueByType)
      .map(([k, v]) => ({ name: TYPE_LABELS[k] ?? k, value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [data]);

  // Prepara dados de despesa por categoria
  const expenseChartData = useMemo(() => {
    if (!data?.expenseByCategory) return [];
    return Object.entries(data.expenseByCategory)
      .map(([k, v]) => ({ name: CAT_LABELS[k] ?? k, value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [data]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center space-y-2">
        <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Carregando dados da Controladoria...</p>
      </div>
    </div>
  );

  const totalRev  = data?.totalRevenue  ?? 0;
  const totalExp  = data?.totalExpenses ?? 0;
  const netResult = data?.netResult     ?? 0;
  const margin    = data?.margin        ?? 0;
  const divValue  = data?.divValue      ?? 0;
  const divCount  = data?.divCount      ?? 0;

  // Período sem nenhum lançamento — mostra aviso em vez de só zeros,
  // para o usuário não achar que o sistema está quebrado.
  const isEmpty = !isLoading && totalRev === 0 && totalExp === 0 && divCount === 0;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Controladoria</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visão consolidada de receitas, despesas e resultado — {dateFrom} até {dateTo}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center bg-card border border-border rounded-lg p-0.5 gap-0.5">
            {PERIODS.map((p, i) => (
              <button key={p.label}
                onClick={() => setPeriodIdx(i)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md transition-all font-medium",
                  periodIdx === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {p.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {/* Aviso de período sem dados */}
      {isEmpty && (
        <div className="card-premium rounded-2xl p-6 border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <Calendar className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Nenhum lançamento neste período</p>
              <p className="text-xs text-muted-foreground mt-1">
                Não há receitas, despesas ou divergências entre {fmtDate(dateFrom)} e {fmtDate(dateTo)}.
                Tente ampliar o intervalo — seus dados podem estar em outra data.
              </p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {PERIODS.map((p, i) => (
                  i !== periodIdx && (
                    <button key={p.label} onClick={() => setPeriodIdx(i)}
                      className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors font-medium">
                      Ver {p.label}
                    </button>
                  )
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Receitas"  value={formatCurrency(totalRev)}  color="text-emerald-400" icon={TrendingUp}    sub={`${(data?.recentRevenues?.length ?? 0)} lançamentos`} />
        <KpiCard label="Total Despesas"  value={formatCurrency(totalExp)}  color="text-red-400"     icon={TrendingDown}  sub={`${(data?.recentExpenses?.length ?? 0)} lançamentos`} />
        <KpiCard label="Resultado Líq."  value={formatCurrency(netResult)} color={netResult >= 0 ? "text-emerald-400" : "text-red-400"} icon={DollarSign} />
        <KpiCard label="Margem"          value={`${margin.toFixed(1)}%`} color={margin >= 0 ? "text-blue-400" : "text-red-400"} icon={Target} sub="Receitas - Despesas / Receitas" />
        <KpiCard label="Divergências"    value={formatCurrency(divValue)}  color="text-yellow-400"  icon={AlertTriangle} sub={`${divCount} pendentes`} />
      </div>

      {/* Origem: Auto vs Manual */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Rec. Automáticas", value: data?.autoRevenue ?? 0, sub: "Tarifas via conciliação", color: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20" },
          { label: "Rec. Manuais",     value: data?.movedRevenue ?? 0, sub: "Divergências reclassificadas", color: "text-blue-400", bg: "bg-blue-500/5 border-blue-500/20" },
          { label: "Desp. Automáticas",value: data?.autoExpense ?? 0, sub: "Tarifas bancárias", color: "text-red-400", bg: "bg-red-500/5 border-red-500/20" },
          { label: "Desp. Manuais",    value: data?.movedExpense ?? 0, sub: "Divergências reclassificadas", color: "text-orange-400", bg: "bg-orange-500/5 border-orange-500/20" },
        ].map(({ label, value, sub, color, bg }) => (
          <div key={label} className={cn("border rounded-xl p-4", bg)}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={cn("text-xl font-bold font-mono mt-1", color)}>{fmtShort(value)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Gráfico de evolução */}
      {evolutionData.length > 0 && (
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold text-foreground">Evolução Receitas vs Despesas</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Por data de lançamento</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-emerald-400 rounded-full inline-block" />Receitas</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-red-400 rounded-full inline-block" />Despesas</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-blue-400 rounded-full inline-block" />Resultado</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={evolutionData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.20} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => fmtShort(v)} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => fmt(v)} />
              <Area type="monotone" dataKey="receitas" stroke="#10b981" strokeWidth={2} fill="url(#gRev)" name="Receitas" />
              <Area type="monotone" dataKey="despesas" stroke="#f87171" strokeWidth={2} fill="url(#gExp)" name="Despesas" />
              <Area type="monotone" dataKey="resultado" stroke="#60a5fa" strokeWidth={1.5} fill="none" strokeDasharray="4 2" name="Resultado" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Breakdown por tipo / categoria */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Receitas por tipo */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Receitas por Tipo</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/receitas")}>
              Ver todas <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          {revenueChartData.length > 0 ? (
            <div className="flex gap-4">
              <ResponsiveContainer width="45%" height={150}>
                <PieChart>
                  <Pie data={revenueChartData} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={35} paddingAngle={2}>
                    {revenueChartData.map((_, i) => <Cell key={i} fill={REV_COLORS[i % REV_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2 pt-1">
                {revenueChartData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: REV_COLORS[i % REV_COLORS.length] }} />
                      <span className="text-[10px] text-muted-foreground truncate">{d.name}</span>
                    </div>
                    <span className="text-[10px] font-mono font-semibold text-emerald-400 shrink-0">{formatCurrency(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[150px] flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem receitas no período</p>
            </div>
          )}
        </div>

        {/* Despesas por categoria */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Despesas por Categoria</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/despesas")}>
              Ver todas <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          {expenseChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={expenseChartData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <XAxis type="number" tickFormatter={v => fmtShort(v)} tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={90} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => fmt(v)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Valor">
                  {expenseChartData.map((_, i) => <Cell key={i} fill={EXP_COLORS[i % EXP_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[150px] flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem despesas no período</p>
            </div>
          )}
        </div>
      </div>

      {/* Últimos lançamentos lado a lado */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Últimas Receitas */}
        <div className="card-premium rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-foreground">Últimas Receitas</h3>
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/receitas")}>
              Ver todas <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {(data?.recentRevenues ?? []).length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-xs text-muted-foreground">Nenhuma receita no período</p>
                <p className="text-[10px] text-muted-foreground mt-1">Execute uma conciliação ou adicione manualmente</p>
              </div>
            ) : (data?.recentRevenues ?? []).slice(0, 8).map((r: any) => (
              <div key={r.id} className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-accent/10 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">{r.description || TYPE_LABELS[r.type] || r.type}</p>
                  <p className="text-[10px] text-muted-foreground">{String(r.referenceDate).slice(0,10)} · {r.clientName || TYPE_LABELS[r.type] || "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono font-bold text-emerald-400">{fmt(parseFloat(String(r.amount)))}</p>
                  <p className="text-[10px] text-muted-foreground">{(r as any).origin === 'auto_tariff' ? 'Auto' : (r as any).origin === 'manual_move' ? 'Movido' : 'Manual'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Últimas Despesas */}
        <div className="card-premium rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-bold text-foreground">Últimas Despesas</h3>
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/despesas")}>
              Ver todas <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {(data?.recentExpenses ?? []).length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-xs text-muted-foreground">Nenhuma despesa no período</p>
                <p className="text-[10px] text-muted-foreground mt-1">Execute uma conciliação ou adicione manualmente</p>
              </div>
            ) : (data?.recentExpenses ?? []).slice(0, 8).map((e: any) => (
              <div key={e.id} className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-accent/10 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">{e.description || CAT_LABELS[e.category] || e.category}</p>
                  <p className="text-[10px] text-muted-foreground">{String(e.referenceDate).slice(0,10)} · {e.supplier || "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono font-bold text-red-400">{fmt(parseFloat(String(e.amount)))}</p>
                  <p className="text-[10px] text-muted-foreground">{(e as any).origin === 'auto_tariff' ? 'Auto' : (e as any).origin === 'manual_move' ? 'Movido' : 'Manual'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alerta de divergências pendentes */}
      {divCount > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {divCount} divergência{divCount > 1 ? "s" : ""} pendente{divCount > 1 ? "s" : ""} — {fmt(divValue)} em risco
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Identifique e mova para Receitas ou Despesas para limpar a lista de pendências
              </p>
            </div>
          </div>
          <Button size="sm" className="text-xs gap-1.5 shrink-0 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
            onClick={() => navigate("/divergencias")}>
            Ver Divergências <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
// deploy trigger Fri May 15 17:35:16 UTC 2026
