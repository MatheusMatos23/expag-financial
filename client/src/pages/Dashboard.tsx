import { trpc } from "@/lib/trpc";
import { formatCurrency, getCurrentMonthRange } from "@/lib/utils";
import { useLocation } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  ArrowUpRight, ArrowDownRight, ChevronRight, RefreshCw,
  CheckCircle2, Activity, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";

const TOOLTIP = {
  background: "#0d1528", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px", fontSize: "11px", color: "#e8edf5",
};

const BANK_COLORS: Record<string, string> = {
  Sicoob: "#10b981", "Banco do Brasil": "#f59e0b", BB: "#f59e0b",
  JD: "#38bdf8", API: "#818cf8",
};
const BANK_COLOR_LIST = ["#10b981","#f59e0b","#38bdf8","#818cf8","#f87171","#fb923c"];

function fmtShort(v: number) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `R$ ${(v/1_000).toFixed(0)}k`;
  return formatCurrency(v);
}

function KpiCard({ label, value, sub, color, icon: Icon, onClick, trend }: {
  label: string; value: string; sub?: string; color: string;
  icon: any; onClick?: () => void; trend?: number;
}) {
  return (
    <div
      className={cn("bg-card border border-border rounded-2xl p-5 flex flex-col gap-3", onClick && "cursor-pointer hover:border-primary/30 transition-colors")}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", color.replace("text-","bg-").replace("-400","-500/15"))}>
          <Icon className={cn("w-4 h-4", color)} />
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
        <p className={cn("text-2xl font-bold font-mono mt-0.5", color)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [period] = useState({ dateFrom, dateTo });

  // ── Data fetching ────────────────────────────────────────────────────────────
  const { data: ctrlData, isLoading: ctrlLoading } = trpc.controllership.getControllershipDashboard.useQuery(
    { dateFrom: period.dateFrom, dateTo: period.dateTo },
    { refetchOnWindowFocus: false }
  );
  const { data: sessions } = trpc.reconciliation.getSessions.useQuery();
  const { data: balances } = trpc.reconciliation.getDailyBankBalances.useQuery();
  const { data: divAll } = trpc.reconciliation.getDivergences.useQuery({});

  // ── Derived values ───────────────────────────────────────────────────────────
  const totalRevenue  = ctrlData?.totalRevenue  ?? 0;
  const totalExpenses = ctrlData?.totalExpenses ?? 0;
  const netResult     = ctrlData?.netResult     ?? 0;
  const margin        = ctrlData?.margin        ?? 0;

  const sessionList = (sessions as any[]) ?? [];
  const lastSession = sessionList[0];
  const lastMatched  = lastSession?.matchedCount ?? 0;
  const lastDivergent = lastSession?.divergentCount ?? 0;
  const lastTotal    = lastMatched + lastDivergent;
  const matchRate    = lastTotal > 0 ? Math.round((lastMatched / lastTotal) * 100) : 0;

  const divList = (divAll as any[]) ?? [];
  const pendingDivs   = divList.filter(d => !['regularizado','reclassificado','baixado'].includes(d.status));
  const criticalDivs  = pendingDivs.filter(d => d.priority === 'critical' || d.priority === 'high');
  const pendingAmount = pendingDivs.reduce((s, d) => s + parseFloat(String(d.amount ?? 0)), 0);

  // ── Bank balances by bank ────────────────────────────────────────────────────
  const balanceRows = (balances as any[]) ?? [];
  const latestBalance = balanceRows[balanceRows.length - 1];

  // Try to get per-bank data from sessions
  const bankBreakdown = useMemo(() => {
    if (!sessionList.length) return [];
    // Aggregate from sessions byBank summary if available
    const map: Record<string, { credits: number; debits: number; matched: number }> = {};
    for (const s of sessionList.slice(0, 5)) {
      const byBank = s.byBank as Record<string, any> | undefined;
      if (!byBank) continue;
      for (const [bank, data] of Object.entries(byBank)) {
        if (!map[bank]) map[bank] = { credits: 0, debits: 0, matched: 0 };
        map[bank].credits += parseFloat(String((data as any).credits ?? 0));
        map[bank].debits  += parseFloat(String((data as any).debits ?? 0));
        map[bank].matched += parseInt(String((data as any).matched ?? 0));
      }
    }
    return Object.entries(map).map(([bank, d], i) => ({
      bank,
      credits: d.credits,
      debits: d.debits,
      net: d.credits - d.debits,
      color: BANK_COLOR_LIST[i % BANK_COLOR_LIST.length],
    }));
  }, [sessionList]);

  // ── Evolution chart from daily balances ─────────────────────────────────────
  const evolutionData = useMemo(() => {
    if (!ctrlData?.dailyEvolution?.length) return [];
    return ctrlData.dailyEvolution.slice(-14).map(d => ({
      date: String(d.date).slice(5).replace("-", "/"),
      receitas: d.receitas,
      despesas: d.despesas,
      resultado: d.receitas - d.despesas,
    }));
  }, [ctrlData]);

  // ── Recent sessions for matching overview ────────────────────────────────────
  const recentSessions = sessionList.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão executiva — {period.dateFrom} até {period.dateTo}</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => window.location.reload()}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Receitas"    value={fmtShort(totalRevenue)}  color="text-emerald-400" icon={TrendingUp}    onClick={() => navigate("/receitas")} />
        <KpiCard label="Despesas"    value={fmtShort(totalExpenses)} color="text-red-400"     icon={TrendingDown}  onClick={() => navigate("/despesas")} />
        <KpiCard label="Resultado"   value={fmtShort(netResult)}     color={netResult >= 0 ? "text-emerald-400" : "text-red-400"} icon={DollarSign} />
        <KpiCard label="Margem"      value={`${margin.toFixed(1)}%`} color={margin >= 30 ? "text-blue-400" : margin >= 0 ? "text-yellow-400" : "text-red-400"} icon={Activity} />
        <KpiCard label="Divergências" value={fmtShort(pendingAmount)} color="text-yellow-400" icon={AlertTriangle} sub={`${pendingDivs.length} pendentes · ${criticalDivs.length} críticas`} onClick={() => navigate("/divergencias")} />
      </div>

      {/* Taxa de matching + saldo bancário */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Matching overview */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Taxa de Conciliação</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/conciliacao")}>
              Ver sessões <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-end gap-4 mb-4">
            <div>
              <p className={cn("text-5xl font-bold font-mono", matchRate >= 90 ? "text-emerald-400" : matchRate >= 70 ? "text-yellow-400" : "text-red-400")}>
                {matchRate}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">última sessão</p>
            </div>
            <div className="flex-1 space-y-2 pb-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Conciliados</span>
                <span className="text-emerald-400 font-mono">{lastMatched}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Divergentes</span>
                <span className="text-yellow-400 font-mono">{lastDivergent}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total banco</span>
                <span className="text-muted-foreground font-mono">{lastTotal}</span>
              </div>
            </div>
          </div>
          <div className="w-full bg-accent/20 rounded-full h-3 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", matchRate >= 90 ? "bg-emerald-400" : matchRate >= 70 ? "bg-yellow-400" : "bg-red-400")}
              style={{ width: `${matchRate}%` }} />
          </div>

          {/* Sessões recentes */}
          {recentSessions.length > 0 && (
            <div className="mt-4 space-y-2">
              {recentSessions.map((s: any) => {
                const t = (s.matchedCount ?? 0) + (s.divergentCount ?? 0);
                const r = t > 0 ? Math.round(((s.matchedCount ?? 0) / t) * 100) : 0;
                return (
                  <div key={s.id} className="flex items-center gap-3 cursor-pointer hover:bg-accent/10 rounded-lg px-2 py-1.5 transition-colors"
                    onClick={() => navigate(`/conciliacao/${s.id}`)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">
                        {String(s.referenceDate).slice(0,10)}
                      </p>
                      <div className="w-full bg-accent/20 rounded-full h-1 mt-1 overflow-hidden">
                        <div className={cn("h-full rounded-full", r >= 90 ? "bg-emerald-400" : r >= 70 ? "bg-yellow-400" : "bg-red-400")} style={{ width: `${r}%` }} />
                      </div>
                    </div>
                    <span className={cn("text-xs font-mono font-bold shrink-0", r >= 90 ? "text-emerald-400" : r >= 70 ? "text-yellow-400" : "text-red-400")}>{r}%</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{s.divergentCount ?? 0} div.</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Saldo por banco */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Saldo por Banco</h3>
            {latestBalance && (
              <span className="text-[10px] text-muted-foreground">Última conciliação</span>
            )}
          </div>

          {/* Totais banco vs API */}
          {latestBalance ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Building2 className="w-3 h-3 text-emerald-400" />
                    <p className="text-[10px] text-muted-foreground">Banco · Créditos</p>
                  </div>
                  <p className="text-lg font-bold font-mono text-emerald-400">{fmtShort(parseFloat(String(latestBalance.totalCredits ?? 0)))}</p>
                  <p className="text-[10px] text-muted-foreground">Déb: {fmtShort(parseFloat(String(latestBalance.totalDebits ?? 0)))}</p>
                </div>
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Activity className="w-3 h-3 text-blue-400" />
                    <p className="text-[10px] text-muted-foreground">API · Créditos</p>
                  </div>
                  <p className="text-lg font-bold font-mono text-blue-400">{fmtShort(parseFloat(String(latestBalance.apiCredits ?? 0)))}</p>
                  <p className="text-[10px] text-muted-foreground">Déb: {fmtShort(parseFloat(String(latestBalance.apiDebits ?? 0)))}</p>
                </div>
              </div>

              {/* Por banco individual */}
              {bankBreakdown.length > 0 ? (
                <div className="space-y-2">
                  {bankBreakdown.map(b => (
                    <div key={b.bank} className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="text-xs text-muted-foreground flex-1">{b.bank}</span>
                      <span className="text-xs font-mono text-emerald-400">{fmtShort(b.credits)}</span>
                      <span className="text-[10px] text-muted-foreground">↔</span>
                      <span className="text-xs font-mono text-red-400">{fmtShort(b.debits)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {[
                    { bank: "Sicoob", color: "#10b981" },
                    { bank: "Banco do Brasil", color: "#f59e0b" },
                    { bank: "JD", color: "#38bdf8" },
                  ].map(b => (
                    <div key={b.bank} className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="text-xs text-muted-foreground flex-1">{b.bank}</span>
                      <span className="text-[10px] text-muted-foreground italic">aguardando conciliação</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <Building2 className="w-8 h-8 text-muted-foreground opacity-30" />
              <p className="text-xs text-muted-foreground">Execute uma conciliação para ver os saldos</p>
              <Button size="sm" className="text-xs mt-1" onClick={() => navigate("/conciliacao")}>
                Ir para Conciliações
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Evolução receitas vs despesas */}
      {evolutionData.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold text-foreground">Evolução — Receitas vs Despesas</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Últimos 14 dias com lançamentos</p>
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/controladoria")}>
              Controladoria <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={evolutionData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => fmtShort(v)} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={65} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: any) => formatCurrency(v)} />
              <Area type="monotone" dataKey="receitas" stroke="#10b981" strokeWidth={2} fill="url(#gRev)" name="Receitas" />
              <Area type="monotone" dataKey="despesas" stroke="#f87171" strokeWidth={2} fill="url(#gExp)" name="Despesas" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Alertas de ação */}
      {pendingDivs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              show: criticalDivs.length > 0,
              color: "bg-red-500/5 border-red-500/20",
              icon: <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />,
              title: `${criticalDivs.length} divergência${criticalDivs.length > 1 ? "s" : ""} crítica${criticalDivs.length > 1 ? "s" : ""}`,
              sub: "Requerem atenção imediata",
              btn: "Analisar", path: "/divergencias",
              btnColor: "bg-red-500/20 text-red-400 border-red-500/30",
            },
            {
              show: (ctrlData?.divCount ?? 0) > 0,
              color: "bg-yellow-500/5 border-yellow-500/20",
              icon: <DollarSign className="w-4 h-4 text-yellow-400 shrink-0" />,
              title: `${fmtShort(pendingAmount)} em aberto`,
              sub: `${pendingDivs.length} divergências pendentes`,
              btn: "Resolver", path: "/divergencias",
              btnColor: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
            },
            {
              show: matchRate < 100,
              color: "bg-blue-500/5 border-blue-500/20",
              icon: <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />,
              title: `Meta: 100% conciliado`,
              sub: `Faltam ${100 - matchRate}% para fechar`,
              btn: "Conciliar", path: "/conciliacao",
              btnColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
            },
          ].filter(a => a.show).map(a => (
            <div key={a.title} className={cn("border rounded-2xl p-4 flex items-center justify-between gap-3", a.color)}>
              <div className="flex items-center gap-3 min-w-0">
                {a.icon}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{a.title}</p>
                  <p className="text-[10px] text-muted-foreground">{a.sub}</p>
                </div>
              </div>
              <Button size="sm" className={cn("text-xs shrink-0 border", a.btnColor)} onClick={() => navigate(a.path)}>
                {a.btn}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
