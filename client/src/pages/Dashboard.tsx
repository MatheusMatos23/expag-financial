import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nContext";
import { formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  ChevronRight, RefreshCw, CheckCircle2, Activity, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";

const TOOLTIP = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: "10px", fontSize: "11px", color: "var(--foreground)",
};
const BANK_COLORS = ["#10b981","#f59e0b","#38bdf8","#818cf8","#f87171","#fb923c"];


// ── 90-day range helper ───────────────────────────────────────────────────────
function get90DayRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo:   to.toISOString().slice(0, 10),
  };
}

function KpiCard({ label, value, sub, color, icon: Icon, onClick }: {
  label: string; value: string; sub?: string; color: string; icon: any; onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "kpi-accent card-premium relative p-5 space-y-3 group",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <div className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity",
          color.replace("text-","bg-").replace("-400","-500/12")
        )}>
          <Icon className={cn("w-3.5 h-3.5", color)} />
        </div>
      </div>
      <div>
        <p className={cn("text-[1.6rem] font-bold font-mono tracking-tight leading-none", color)}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1.5 font-normal">{sub}</p>}
      </div>
      {onClick && (
        <div className="absolute bottom-3.5 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

const fmtS = (v: number) => { if (Math.abs(v) >= 1_000_000) return `R$ ${(v/1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `R$ ${(v/1_000).toFixed(0)}k`; return formatCurrency(v); };

export default function Dashboard() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { dateFrom, dateTo } = get90DayRange();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: ctrlData, refetch: refetchCtrl } = trpc.controllership.getControllershipDashboard.useQuery(
    { dateFrom, dateTo }, { refetchOnWindowFocus: false }
  );
  const { data: sessions, refetch: refetchSessions } = trpc.reconciliation.getSessions.useQuery(undefined, { refetchInterval: 30000 });
  const { data: bankByBank } = trpc.reconciliation.getBankBalancesByBank.useQuery(undefined, { refetchInterval: 15000 });
  const { data: divAll } = trpc.reconciliation.getDivergences.useQuery({}, { refetchInterval: 30000, staleTime: 15000 });
  const { data: dailyBal } = trpc.reconciliation.getDailyBankBalances.useQuery(undefined, { refetchInterval: 15000 });

  // ── Derived ──────────────────────────────────────────────────────────────────
  const totalRevenue  = ctrlData?.totalRevenue  ?? 0;
  const totalExpenses = ctrlData?.totalExpenses ?? 0;
  const netResult     = ctrlData?.netResult     ?? 0;
  const margin        = ctrlData?.margin        ?? 0;

  const sessionList = (sessions as any[]) ?? [];
  // Busca stats ao vivo da última sessão para valores corretos
  const lastSession = sessionList[0];
  const { data: lastSessionStats } = trpc.reconciliation.getSessionStats.useQuery(
    { id: lastSession?.id ?? 0 },
    { enabled: !!lastSession?.id, refetchInterval: 15000 }
  );
  // Usa stats ao vivo se disponível (mais preciso), fallback para sessão
  const liveMatched    = (lastSessionStats as any)?.matchedCount  ?? lastSession?.matchedCount  ?? 0;
  const liveTotal      = (lastSessionStats as any)?.totalCount    ?? 0;
  const livePending    = (lastSessionStats as any)?.pendingCount  ?? lastSession?.pendingCount  ?? 0;
  const liveMatchRate  = (lastSessionStats as any)?.matchRate;

  const lastMatched    = liveMatched;
  const lastDivergent  = livePending; // pendentes reais da tabela divergences
  const lastTotal      = liveTotal > 0 ? liveTotal : (liveMatched + livePending);
  const matchRate      = liveMatchRate ?? (lastTotal > 0 ? Math.round((lastMatched / lastTotal) * 100) : 0);

  const PENDING_ST = ["pendente","em_analise","identificado","escalado_diretoria","em_aberto"];
  const divList      = (divAll as any[]) ?? [];
  const pendingDivs  = divList.filter(d => PENDING_ST.includes(d.status));
  const criticalDivs = pendingDivs.filter(d => d.priority === "critical" || d.priority === "high");
  const pendingAmt   = pendingDivs.reduce((s, d) => s + parseFloat(String(d.amount ?? 0)), 0);
  const surplusAmt   = pendingDivs.filter(d => d.divergenceType === "bank_surplus").reduce((s, d) => s + parseFloat(String(d.amount ?? 0)), 0);
  const shortageAmt  = pendingDivs.filter(d => d.divergenceType === "bank_shortage").reduce((s, d) => s + parseFloat(String(d.amount ?? 0)), 0);

  const latestBal = ((dailyBal as any[]) ?? []).slice(-1)[0];

  const bankRows = (bankByBank as any[]) ?? [];

  // ── Charts ───────────────────────────────────────────────────────────────────
  const evolutionData = useMemo(() => {
    return (ctrlData?.dailyEvolution ?? []).slice(-21).map(d => ({
      date: String(d.date).slice(5).replace("-", "/"),
      receitas: d.receitas,
      despesas: d.despesas,
      resultado: d.receitas - d.despesas,
    }));
  }, [ctrlData]);

  const revenueByType = useMemo(() => {
    return Object.entries(ctrlData?.revenueByType ?? {})
      .map(([k, v]) => ({ name: k.replace("receita_","").replace("_"," "), value: v as number }))
      .sort((a, b) => b.value - a.value).slice(0, 5);
  }, [ctrlData]);

  const expenseByCategory = useMemo(() => {
    return Object.entries(ctrlData?.expenseByCategory ?? {})
      .map(([k, v]) => ({ name: k.replace("_"," "), value: v as number }))
      .sort((a, b) => b.value - a.value).slice(0, 5);
  }, [ctrlData]);

  const COLORS = ["#10b981","#38bdf8","#818cf8","#f59e0b","#f87171","#fb923c"];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("dashboard.subtitle")}</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { refetchCtrl(); refetchSessions(); }}>
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </Button>
      </div>

      {/* ── Faixa 1: KPIs financeiros ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Receitas"     value={formatCurrency(totalRevenue)}  color="text-emerald-400" icon={TrendingUp}   onClick={() => navigate("/receitas")} sub={`${ctrlData?.recentRevenues?.length ?? 0} lançamentos`} />
        <KpiCard label="Despesas"     value={formatCurrency(totalExpenses)} color="text-red-400"     icon={TrendingDown} onClick={() => navigate("/despesas")} sub={`${ctrlData?.recentExpenses?.length ?? 0} lançamentos`} />
        <KpiCard label="Resultado"    value={formatCurrency(netResult)}     color={netResult >= 0 ? "text-emerald-400" : "text-red-400"} icon={DollarSign} sub={`Margem ${margin.toFixed(1)}%`} />
        <KpiCard label="Pendente"     value={formatCurrency(pendingAmt)}    color="text-yellow-400"  icon={AlertTriangle} onClick={() => navigate("/divergencias")} sub={`${pendingDivs.length} itens · ${criticalDivs.length} críticos`} />
        <KpiCard label="Conciliação"  value={`${matchRate}%`}     color={matchRate>=90?"text-emerald-400":matchRate>=70?"text-yellow-400":"text-red-400"} icon={CheckCircle2} onClick={() => navigate("/conciliacao")} sub={`${lastMatched.toLocaleString()} de ${lastTotal.toLocaleString()} transações`} />
      </div>

      {/* ── Faixa 2: Divergências pendentes resumo ───────────────────────── */}
      {pendingDivs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Volume Total Pendente</p>
            <p className="text-xl font-bold font-mono text-orange-400 mt-1">{formatCurrency(pendingAmt)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Meta: R$ 0,00 (zerar)</p>
            <div className="mt-2 w-full bg-accent/20 rounded-full h-1.5">
              <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(100, (pendingAmt / (pendingAmt + (totalRevenue||1))) * 100)}%` }} />
            </div>
          </div>
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">↑ Sobra Banco (banco &gt; API)</p>
            <p className="text-xl font-bold font-mono text-red-400 mt-1">{formatCurrency(surplusAmt)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{pendingDivs.filter(d => d.divergenceType === "bank_surplus").length} divergências</p>
          </div>
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">↓ Falta Banco (API &gt; banco)</p>
            <p className="text-xl font-bold font-mono text-yellow-400 mt-1">{formatCurrency(shortageAmt)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{pendingDivs.filter(d => d.divergenceType === "bank_shortage").length} divergências</p>
          </div>
        </div>
      )}

      {/* ── Faixa 3: Gráfico evolução + Saldo por banco ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Evolução 21 dias */}
        <div className="md:col-span-2 bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Receitas vs Despesas — Diário</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Últimos 21 dias com lançamentos</p>
            </div>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/controladoria")}>
              Controladoria <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          {evolutionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={evolutionData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f87171" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtS(v)} tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                <Area type="monotone" dataKey="receitas" stroke="#10b981" strokeWidth={2} fill="url(#gRev)" name="Receitas" />
                <Area type="monotone" dataKey="despesas" stroke="#f87171" strokeWidth={2} fill="url(#gExp)" name="Despesas" />
                <Area type="monotone" dataKey="resultado" stroke="#60a5fa" strokeWidth={1.5} fill="url(#gRes)" strokeDasharray="4 2" name="Resultado" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem lançamentos no período. Execute uma conciliação.</p>
            </div>
          )}
        </div>

        {/* Saldo por banco */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Saldo por Banco</h3>
            <span className="text-[10px] text-muted-foreground">Acumulado</span>
          </div>
          {latestBal && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
                <p className="text-[9px] text-muted-foreground">Banco</p>
                <p className="text-sm font-bold font-mono text-emerald-400">{formatCurrency(parseFloat(String(latestBal.totalCredits??0)))}</p>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5">
                <p className="text-[9px] text-muted-foreground">API</p>
                <p className="text-sm font-bold font-mono text-blue-400">{formatCurrency(parseFloat(String(latestBal.apiCredits??0)))}</p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {bankRows.length > 0 ? bankRows.map((b: any, i: number) => {
              const cred = parseFloat(String(b.totalCredits ?? 0));
              const deb  = parseFloat(String(b.totalDebits ?? 0));
              const tot  = parseInt(String(b.totalTxs ?? 0));
              const mat  = parseInt(String(b.matchedTxs ?? 0));
              const rate = tot > 0 ? Math.round((mat / tot) * 100) : 0;
              const divCount = parseInt(String(b.divergentTxs ?? 0));
              // Linha especial: divergências do lado da API (sem banco atribuído)
              if (b.apiSideOnly) {
                return (
                  <div key="api-side" className="flex items-center gap-2 pt-1 border-t border-border/40">
                    <div className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/50" />
                    <span className="text-xs font-medium text-muted-foreground flex-1">API / Sem banco</span>
                    {divCount > 0 && (
                      <span className="text-[10px] text-yellow-400 font-semibold">{divCount} div.</span>
                    )}
                  </div>
                );
              }
              return (
                <div key={b.bankName} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: BANK_COLORS[i % BANK_COLORS.length] }} />
                    <span className="text-xs font-medium text-foreground flex-1 capitalize">{b.bankName}</span>
                    <span className={cn("text-[10px] font-bold", rate>=90?"text-emerald-400":rate>=70?"text-yellow-400":"text-red-400")}>{rate}%</span>
                  </div>
                  <div className="ml-4 flex items-center gap-2 text-[9px] text-muted-foreground">
                    <span className="text-emerald-400">+{formatCurrency(cred)}</span>
                    <span>/</span>
                    <span className="text-red-400">-{formatCurrency(deb)}</span>
                    {divCount > 0 && (
                      <span className="text-yellow-400">{divCount} div.</span>
                    )}
                  </div>
                  <div className="ml-4 w-full bg-accent/20 rounded-full h-1 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width:`${rate}%`, background: BANK_COLORS[i % BANK_COLORS.length] }} />
                  </div>
                </div>
              );
            }) : (
              <p className="text-xs text-muted-foreground text-center py-4">Execute uma conciliação para ver os saldos por banco.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Faixa 4: Receitas por tipo + Despesas por categoria + Matching ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Receitas por tipo */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Receitas por Tipo</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/receitas")}>
              Ver <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          {revenueByType.length > 0 ? (
            <div className="flex gap-3">
              <ResponsiveContainer width="50%" height={120}>
                <PieChart>
                  <Pie data={revenueByType} dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={28} paddingAngle={2}>
                    {revenueByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 pt-1">
                {revenueByType.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i%COLORS.length] }} />
                      <span className="text-[10px] text-muted-foreground truncate capitalize">{d.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 shrink-0">{fmtS(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem receitas no período</p>
            </div>
          )}
        </div>

        {/* Despesas por categoria */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Despesas por Categoria</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/despesas")}>
              Ver <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          {expenseByCategory.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={expenseByCategory} layout="vertical" margin={{ left:0, right:8, top:0, bottom:0 }}>
                <XAxis type="number" tickFormatter={v => fmtS(v)} tick={{ fontSize:8, fill:"#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:9, fill:"#9ca3af" }} axisLine={false} tickLine={false} width={75} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v:any) => formatCurrency(v)} />
                <Bar dataKey="value" radius={[0,3,3,0]} name="Valor">
                  {expenseByCategory.map((_, i) => <Cell key={i} fill={["#f87171","#fb923c","#fbbf24","#a3e635","#34d399"][i%5]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-24 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem despesas no período</p>
            </div>
          )}
        </div>

        {/* Taxa de conciliação + sessões */}
        <div className="card-premium rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Taxa de Conciliação</h3>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => navigate("/conciliacao")}>
              Ver <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <p className={cn("text-4xl font-bold font-mono", matchRate>=90?"text-emerald-400":matchRate>=70?"text-yellow-400":"text-red-400")}>{matchRate}%</p>
            <div className="flex-1 text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Conciliados</span><span className="text-emerald-400 font-mono">{lastMatched}</span></div>
              <div className="flex justify-between"><span>Pendentes</span><span className="text-yellow-400 font-mono">{lastDivergent}</span></div>
              <div className="flex justify-between"><span>Total banco</span><span className="text-muted-foreground font-mono">{lastTotal}</span></div>
            </div>
          </div>
          <div className="w-full bg-accent/20 rounded-full h-2 overflow-hidden mb-4">
            <div className={cn("h-full rounded-full", matchRate>=90?"bg-emerald-400":matchRate>=70?"bg-yellow-400":"bg-red-400")} style={{ width:`${matchRate}%` }} />
          </div>
          <div className="space-y-2">
            {sessionList.slice(0,4).map((s: any) => {
              // Denominador consistente com getSessionStats: total real de transações de banco
              const t = s.totalTransactions ?? ((s.matchedCount??0) + (s.divergentCount??0));
              const r = t > 0 ? Math.round(((s.matchedCount??0)/t)*100) : 0;
              return (
                <div key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-accent/10 rounded px-1 py-1 transition-colors" onClick={() => navigate(`/conciliacao/${s.id}`)}>
                  <span className="text-[10px] text-muted-foreground flex-1">{String(s.referenceDate).slice(0,10)}</span>
                  <div className="w-16 bg-accent/20 rounded-full h-1 overflow-hidden">
                    <div className={cn("h-full rounded-full", r>=90?"bg-emerald-400":r>=70?"bg-yellow-400":"bg-red-400")} style={{ width:`${r}%` }} />
                  </div>
                  <span className={cn("text-[10px] font-bold w-8 text-right", r>=90?"text-emerald-400":r>=70?"text-yellow-400":"text-red-400")}>{r}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Faixa 5: Alertas de ação ─────────────────────────────────────── */}
      {(criticalDivs.length > 0 || pendingDivs.length > 0 || matchRate < 100) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {criticalDivs.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{criticalDivs.length} divergência{criticalDivs.length>1?"s":""} crítica{criticalDivs.length>1?"s":""}</p>
                  <p className="text-[10px] text-muted-foreground">Atenção imediata</p>
                </div>
              </div>
              <Button size="sm" className="text-xs bg-red-500 hover:bg-red-600 text-white border-0 shrink-0" onClick={() => navigate("/divergencias")}>Analisar</Button>
            </div>
          )}
          {pendingDivs.length > 0 && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <DollarSign className="w-4 h-4 text-yellow-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{formatCurrency(pendingAmt)} em aberto</p>
                  <p className="text-[10px] text-muted-foreground">{pendingDivs.length} pendentes para zerar</p>
                </div>
              </div>
              <Button size="sm" className="text-xs bg-amber-500 hover:bg-amber-600 text-white border-0 shrink-0" onClick={() => navigate("/divergencias")}>Resolver</Button>
            </div>
          )}
          {matchRate < 100 && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Meta: 100% conciliado</p>
                  <p className="text-[10px] text-muted-foreground">Faltam {100-matchRate}% para fechar</p>
                </div>
              </div>
              <Button size="sm" className="text-xs bg-blue-500 hover:bg-blue-600 text-white border-0 shrink-0" onClick={() => navigate("/conciliacao")}>Conciliar</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
