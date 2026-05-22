import { trpc } from "@/lib/trpc";
import { formatCurrency, cn } from "@/lib/utils";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Maximize2, Minimize2,
  DollarSign, Activity, Percent, Wallet, CheckCircle2, AlertTriangle, Clock, Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, ComposedChart, Area,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Calcula range de datas baseado no preset selecionado */
function getPeriodRange(preset: PeriodPreset): { from: string; to: string; label: string } {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);

  if (preset === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    return { from: first, to: isoToday, label: "Este mês" };
  }
  if (preset === "prevMonth") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
    const last = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
    return { from: first, to: last, label: "Mês anterior" };
  }
  if (preset === "quarter") {
    const q = Math.floor(today.getMonth() / 3);
    const first = new Date(today.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
    return { from: first, to: isoToday, label: "Trimestre" };
  }
  if (preset === "ytd") {
    const first = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
    return { from: first, to: isoToday, label: "Ano (YTD)" };
  }
  // 30 dias por default
  const from = new Date(today); from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: isoToday, label: "Últimos 30 dias" };
}

type PeriodPreset = "month" | "prevMonth" | "quarter" | "ytd" | "30d";

/** Variação percentual entre dois valores, sinalizada */
function pctChange(current: number, previous: number): { value: number; sign: "up" | "down" | "flat" } {
  if (previous === 0 && current === 0) return { value: 0, sign: "flat" };
  if (previous === 0) return { value: 100, sign: "up" };
  const v = ((current - previous) / Math.abs(previous)) * 100;
  return { value: v, sign: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat" };
}

/** Animação de contagem nos números KPI */
function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    const from = value;
    let raf = 0;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
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

/** Formatação de valores grandes: 1.2M, 1.5K, etc */
function compactCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  return formatCurrency(v);
}

const REVENUE_TYPE_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", boleto: "Boleto", credito: "Crédito",
  antecipacao: "Antecipação", pos: "POS", white_label: "White Label",
  receita_financeira: "Rec. Financeira", receita_operacional: "Rec. Operacional",
  outros: "Outros",
};

const PIE_COLORS = ["#10b981","#38bdf8","#818cf8","#f59e0b","#fb923c","#e879f9","#2dd4bf","#60a5fa","#a78bfa","#94a3b8"];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--foreground)",
  padding: "8px 12px",
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const period = useMemo(() => getPeriodRange(preset), [preset]);
  const [fullscreen, setFullscreen] = useState(false);

  const { data, isLoading } = trpc.accounting.getExecutiveDashboard.useQuery(
    { dateFrom: period.from, dateTo: period.to },
    { refetchInterval: 60000 } // atualiza a cada 60s
  );

  // Toggle fullscreen
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

  if (isLoading || !data) {
    return (
      <div className="p-12 text-center text-muted-foreground text-sm">
        Carregando Dashboard Executivo...
      </div>
    );
  }

  const { current, previous, series12m, revenueByType } = data as any;

  // Comparativos MoM
  const cmpRevenue = pctChange(current.totalRevenue, previous.totalRevenue);
  const cmpTpv     = pctChange(current.tpv, previous.tpv);
  const cmpProfit  = pctChange(current.netProfit, previous.netProfit);
  const cmpMargin  = pctChange(current.margin, previous.margin);

  return (
    <div className="p-6 lg:p-10 max-w-[1600px] mx-auto space-y-10">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">Dashboard Executivo</p>
          <h1 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
            Visão Estratégica
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {period.label} · {formatPeriodLabel(period.from, period.to)}
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <PeriodSelector value={preset} onChange={setPreset} />
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" />
            Exportar PDF
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {fullscreen ? "Sair" : "Apresentar"}
          </Button>
        </div>
      </div>

      {/* ── SEÇÃO 1: Hero KPIs ──────────────────────────────────────────── */}
      <section>
        <SectionHeader>Resumo do Período</SectionHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <HeroKPI
            label="Volume Processado (TPV)"
            value={current.tpv}
            change={cmpTpv}
            sparkline={series12m.map((m: any) => m.tpv)}
            color="emerald"
            icon={Activity}
          />
          <HeroKPI
            label="Receita Total"
            value={current.totalRevenue}
            change={cmpRevenue}
            sparkline={series12m.map((m: any) => m.totalRevenue)}
            color="sky"
            icon={DollarSign}
            sub={`Op: ${compactCurrency(current.operationalRevenue)} · Fin: ${compactCurrency(current.financialRevenue)}`}
          />
          <HeroKPI
            label="Lucro Líquido"
            value={current.netProfit}
            change={cmpProfit}
            sparkline={series12m.map((m: any) => m.netProfit)}
            color={current.netProfit >= 0 ? "emerald" : "red"}
            icon={Wallet}
          />
          <HeroKPI
            label="Margem Operacional"
            value={current.margin}
            isPercent
            change={cmpMargin}
            isPercentChange
            sparkline={series12m.map((m: any) => m.margin)}
            color={current.margin >= 30 ? "emerald" : current.margin >= 10 ? "amber" : "red"}
            icon={Percent}
          />
        </div>
      </section>

      {/* ── SEÇÃO 2: Evolução (12 meses) ─────────────────────────────────── */}
      <section>
        <SectionHeader>Evolução — Últimos 12 Meses</SectionHeader>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Receita mensal — composta (operacional + financeira) */}
          <div className="lg:col-span-2 card-premium rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Receita Mensal</p>
                <p className="text-lg font-semibold text-foreground">
                  Operacional + Financeira
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={series12m}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={formatMonth} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => compactCurrency(v)} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [formatCurrency(v), name]}
                  labelFormatter={formatMonth}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="operationalRevenue" stackId="rev" fill="#10b981" name="Operacional" radius={[0, 0, 0, 0]} />
                <Bar dataKey="financialRevenue" stackId="rev" fill="#38bdf8" name="Financeira" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Margem operacional — linha */}
          <div className="card-premium rounded-2xl p-5">
            <div className="mb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Margem Operacional</p>
              <p className="text-lg font-semibold text-foreground">Tendência %</p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series12m}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={formatMonth} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, "Margem"]}
                  labelFormatter={formatMonth}
                />
                <Line type="monotone" dataKey="margin" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 3, fill: "#a78bfa" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Receita vs Despesa vs Lucro */}
        <div className="card-premium rounded-2xl p-5 mt-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Receita vs Despesa vs Lucro</p>
              <p className="text-lg font-semibold text-foreground">Visão integrada</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={series12m}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={formatMonth} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => compactCurrency(v)} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number, name: string) => [formatCurrency(v), name]}
                labelFormatter={formatMonth}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="totalRevenue" fill="#10b981" name="Receita" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalExpenses" fill="#ef4444" name="Despesa" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="netProfit" stroke="#fbbf24" strokeWidth={2.5} name="Lucro" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── SEÇÃO 3: Composição da Receita ──────────────────────────────── */}
      <section>
        <SectionHeader>Composição da Receita — Período</SectionHeader>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Donut por tipo */}
          <div className="card-premium rounded-2xl p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Por Tipo</p>
            <p className="text-lg font-semibold text-foreground mb-4">{revenueByType.length} tipo{revenueByType.length !== 1 ? "s" : ""}</p>
            {revenueByType.length === 0 ? (
              <p className="text-xs text-muted-foreground py-12 text-center">Sem dados no período</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={revenueByType}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={90}
                    paddingAngle={2}
                    dataKey="amount"
                    nameKey="type"
                  >
                    {revenueByType.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => formatCurrency(v)}
                    labelFormatter={(label) => REVENUE_TYPE_LABELS[String(label)] ?? label}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {/* Lista colorida */}
            <div className="space-y-1.5 mt-3">
              {revenueByType.slice(0, 6).map((t: any, i: number) => (
                <div key={t.type} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-muted-foreground truncate">{REVENUE_TYPE_LABELS[t.type] ?? t.type}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{compactCurrency(t.amount)}</span>
                    <span className="text-muted-foreground w-10 text-right">{t.percentage.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Operacional vs Financeira */}
          <div className="card-premium rounded-2xl p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Operacional vs Financeira</p>
            <p className="text-lg font-semibold text-foreground mb-4">Origem do resultado</p>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={[
                    { name: "Operacional", value: current.operationalRevenue },
                    { name: "Financeira", value: current.financialRevenue },
                  ]}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#38bdf8" />
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Operacional</span>
                </div>
                <span className="font-mono">{compactCurrency(current.operationalRevenue)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span className="text-muted-foreground">Financeira (juros)</span>
                </div>
                <span className="font-mono">{compactCurrency(current.financialRevenue)}</span>
              </div>
            </div>
          </div>

          {/* Resumo numérico */}
          <div className="card-premium rounded-2xl p-5 flex flex-col">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Indicadores</p>
            <p className="text-lg font-semibold text-foreground mb-4">Período</p>
            <div className="space-y-4 flex-1">
              <Indicator
                label="Take Rate"
                value={current.tpv > 0 ? ((current.totalRevenue / current.tpv) * 100).toFixed(2) + "%" : "—"}
                hint="Receita ÷ Volume Processado"
              />
              <Indicator
                label="Transações"
                value={current.transactionCount.toLocaleString("pt-BR")}
                hint="Movimentações operacionais"
              />
              <Indicator
                label="Ticket Médio"
                value={current.transactionCount > 0
                  ? compactCurrency(current.tpv / current.transactionCount)
                  : "—"}
                hint="TPV ÷ transações"
              />
              <Indicator
                label="Lucro / Receita Op."
                value={current.operationalRevenue > 0
                  ? ((current.netProfit / current.operationalRevenue) * 100).toFixed(1) + "%"
                  : "—"}
                hint="Eficiência da operação"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── SEÇÃO 4: Top Clientes & Concentração ────────────────────────── */}
      <section>
        <SectionHeader>Top Clientes & Concentração</SectionHeader>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lista Top 10 (ocupa 2 colunas) */}
          <div className="lg:col-span-2 card-premium rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Ranking</p>
                <p className="text-lg font-semibold text-foreground">Top 10 — período</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {(data as any).topClients.length} cliente{(data as any).topClients.length !== 1 ? "s" : ""} ativo{(data as any).topClients.length !== 1 ? "s" : ""}
              </p>
            </div>
            {(data as any).topClients.length === 0 ? (
              <p className="text-xs text-muted-foreground py-12 text-center">
                Sem dados de clientes no período
              </p>
            ) : (
              <div className="space-y-2">
                {(data as any).topClients.map((c: any, i: number) => (
                  <ClientRow key={c.clientName} rank={i + 1} client={c} maxValue={(data as any).topClients[0]?.period ?? 1} />
                ))}
              </div>
            )}
          </div>

          {/* Concentração de risco */}
          <div className="card-premium rounded-2xl p-5 flex flex-col">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Concentração</p>
            <p className="text-lg font-semibold text-foreground mb-4">Risco de dependência</p>

            <div className="space-y-4 flex-1">
              <ConcentrationGauge
                label="Maior cliente"
                value={(data as any).concentration.top1}
                threshold={30}
              />
              <ConcentrationGauge
                label="Top 5 juntos"
                value={(data as any).concentration.top5}
                threshold={60}
              />
              <ConcentrationGauge
                label="Top 10 juntos"
                value={(data as any).concentration.top10}
                threshold={80}
              />
            </div>

            {/* Avaliação automática */}
            {(() => {
              const t5 = (data as any).concentration.top5;
              if (t5 >= 80) return (
                <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] text-red-400">
                  ⚠ Alto risco: top 5 clientes representam {t5.toFixed(0)}% da receita.
                  Diversificar carteira é prioridade.
                </div>
              );
              if (t5 >= 60) return (
                <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-400">
                  Atenção: top 5 representam {t5.toFixed(0)}% — concentração elevada.
                </div>
              );
              return (
                <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-400">
                  ✓ Concentração saudável: top 5 = {t5.toFixed(0)}% da receita.
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ── SEÇÃO 5: Carteira de Crédito ────────────────────────────────── */}
      <section>
        <SectionHeader>Carteira de Crédito</SectionHeader>
        {(data as any).creditPortfolio.totalLoans === 0 ? (
          <div className="card-premium rounded-2xl p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Sem empréstimos cadastrados na Carteira de Crédito.
            </p>
          </div>
        ) : (
          <>
            {/* 4 KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <CreditKpi
                label="Saldo Emprestado"
                value={compactCurrency((data as any).creditPortfolio.outstandingTotal)}
                hint={`${(data as any).creditPortfolio.activeLoans} empréstimo${(data as any).creditPortfolio.activeLoans !== 1 ? "s" : ""} ativo${(data as any).creditPortfolio.activeLoans !== 1 ? "s" : ""}`}
                color="text-sky-400"
              />
              <CreditKpi
                label="Juros Recebidos"
                value={compactCurrency((data as any).creditPortfolio.interestPeriod)}
                hint="no período"
                color="text-emerald-400"
              />
              <CreditKpi
                label="Inadimplência"
                value={`${(data as any).creditPortfolio.defaultRate.toFixed(1)}%`}
                hint={`${compactCurrency((data as any).creditPortfolio.overdueAmount)} em ${(data as any).creditPortfolio.overdueCount} parcela${(data as any).creditPortfolio.overdueCount !== 1 ? "s" : ""}`}
                color={(data as any).creditPortfolio.defaultRate > 10 ? "text-red-400" : (data as any).creditPortfolio.defaultRate > 5 ? "text-amber-400" : "text-emerald-400"}
              />
              <CreditKpi
                label="Taxa Média"
                value={`${(data as any).creditPortfolio.avgInterestRate.toFixed(2)}%`}
                hint="ao mês"
                color="text-violet-400"
              />
            </div>

            {/* Distribuição por status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card-premium rounded-2xl p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Por Status</p>
                <p className="text-lg font-semibold text-foreground mb-4">Distribuição dos empréstimos</p>

                <div className="space-y-3">
                  <StatusBar
                    label="Ativos"
                    count={(data as any).creditPortfolio.activeLoans}
                    total={(data as any).creditPortfolio.totalLoans}
                    color="bg-emerald-500"
                  />
                  <StatusBar
                    label="Quitados"
                    count={(data as any).creditPortfolio.paidLoans}
                    total={(data as any).creditPortfolio.totalLoans}
                    color="bg-sky-500"
                  />
                  {(data as any).creditPortfolio.defaultLoans > 0 && (
                    <StatusBar
                      label="Inadimplentes"
                      count={(data as any).creditPortfolio.defaultLoans}
                      total={(data as any).creditPortfolio.totalLoans}
                      color="bg-red-500"
                    />
                  )}
                  {(data as any).creditPortfolio.renegotiatedLoans > 0 && (
                    <StatusBar
                      label="Renegociados"
                      count={(data as any).creditPortfolio.renegotiatedLoans}
                      total={(data as any).creditPortfolio.totalLoans}
                      color="bg-amber-500"
                    />
                  )}
                </div>
              </div>

              {/* Performance */}
              <div className="card-premium rounded-2xl p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Performance</p>
                <p className="text-lg font-semibold text-foreground mb-4">Retorno da carteira</p>

                <div className="space-y-4">
                  <Indicator
                    label="Principal Total Concedido"
                    value={compactCurrency((data as any).creditPortfolio.principalTotal)}
                    hint="Capital emprestado (histórico)"
                  />
                  <Indicator
                    label="Juros Acumulados"
                    value={compactCurrency((data as any).creditPortfolio.totalInterestEarned)}
                    hint="Total recebido + projetado"
                  />
                  <Indicator
                    label="ROI da Carteira"
                    value={
                      (data as any).creditPortfolio.principalTotal > 0
                        ? `${(((data as any).creditPortfolio.totalInterestEarned / (data as any).creditPortfolio.principalTotal) * 100).toFixed(1)}%`
                        : "—"
                    }
                    hint="Juros ÷ Principal"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── SEÇÃO 6: Saúde Operacional ──────────────────────────────────── */}
      <section>
        <SectionHeader>Saúde Operacional</SectionHeader>

        {/* 4 KPIs principais */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <HealthKPI
            label="Taxa de Conciliação"
            value={`${(data as any).operationalHealth.reconciliationRate.toFixed(1)}%`}
            icon={CheckCircle2}
            hint={`Últimos 90 dias · ${(data as any).operationalHealth.sessionCount} sessão${(data as any).operationalHealth.sessionCount !== 1 ? "ões" : ""}`}
            status={
              (data as any).operationalHealth.reconciliationRate >= 95 ? "good" :
              (data as any).operationalHealth.reconciliationRate >= 85 ? "warning" : "critical"
            }
          />
          <HealthKPI
            label="Divergências Críticas"
            value={(data as any).operationalHealth.criticalDivergences.toLocaleString("pt-BR")}
            icon={AlertTriangle}
            hint={(data as any).operationalHealth.criticalAmount > 0
              ? `${compactCurrency((data as any).operationalHealth.criticalAmount)} em aberto`
              : "Nenhuma pendência crítica"}
            status={
              (data as any).operationalHealth.criticalDivergences === 0 ? "good" :
              (data as any).operationalHealth.criticalDivergences <= 5 ? "warning" : "critical"
            }
          />
          <HealthKPI
            label="Saldo de Caixa"
            value={
              (data as any).operationalHealth.cashReferenceDate
                ? compactCurrency((data as any).operationalHealth.cashBalance)
                : "—"
            }
            icon={Wallet}
            hint={
              (data as any).operationalHealth.cashReferenceDate
                ? `Saldo Gerencial · ${formatBrDate((data as any).operationalHealth.cashReferenceDate)} · Livre: ${compactCurrency((data as any).operationalHealth.cashFreeBalance)}`
                : "Sem registro em Saldo Gerencial"
            }
            status={
              !(data as any).operationalHealth.cashReferenceDate ? "neutral" :
              (data as any).operationalHealth.cashBalance > 0 ? "good" :
              (data as any).operationalHealth.cashBalance === 0 ? "warning" : "critical"
            }
          />
          <HealthKPI
            label="Tempo de Resolução"
            value={
              (data as any).operationalHealth.avgResolutionDays > 0
                ? `${(data as any).operationalHealth.avgResolutionDays.toFixed(1)} dias`
                : "—"
            }
            icon={Clock}
            hint={`${(data as any).operationalHealth.resolvedCount} regularizada${(data as any).operationalHealth.resolvedCount !== 1 ? "s" : ""} em 90 dias`}
            status={
              (data as any).operationalHealth.avgResolutionDays === 0 ? "neutral" :
              (data as any).operationalHealth.avgResolutionDays <= 3 ? "good" :
              (data as any).operationalHealth.avgResolutionDays <= 7 ? "warning" : "critical"
            }
          />
        </div>

        {/* Resumo executivo */}
        <div className="card-premium rounded-2xl p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Avaliação Geral</p>
          <p className="text-lg font-semibold text-foreground mb-3">
            {(() => {
              const h = (data as any).operationalHealth;
              const score = (
                (h.reconciliationRate >= 95 ? 1 : h.reconciliationRate >= 85 ? 0.5 : 0) +
                (h.criticalDivergences === 0 ? 1 : h.criticalDivergences <= 5 ? 0.5 : 0) +
                (h.avgResolutionDays === 0 || h.avgResolutionDays <= 3 ? 1 : h.avgResolutionDays <= 7 ? 0.5 : 0)
              ) / 3;
              if (score >= 0.85) return "✓ Operação saudável";
              if (score >= 0.5) return "⚠ Atenção em alguns indicadores";
              return "❌ Operação requer atenção urgente";
            })()}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <HealthCheck
              label="Conciliação"
              ok={(data as any).operationalHealth.reconciliationRate >= 95}
              warning={(data as any).operationalHealth.reconciliationRate >= 85 && (data as any).operationalHealth.reconciliationRate < 95}
              message={
                (data as any).operationalHealth.reconciliationRate >= 95
                  ? "Acima de 95% — excelente"
                  : (data as any).operationalHealth.reconciliationRate >= 85
                  ? "Entre 85-95% — pode melhorar"
                  : "Abaixo de 85% — investigar"
              }
            />
            <HealthCheck
              label="Divergências críticas"
              ok={(data as any).operationalHealth.criticalDivergences === 0}
              warning={(data as any).operationalHealth.criticalDivergences > 0 && (data as any).operationalHealth.criticalDivergences <= 5}
              message={
                (data as any).operationalHealth.criticalDivergences === 0
                  ? "Sem pendências críticas"
                  : `${(data as any).operationalHealth.criticalDivergences} caso${(data as any).operationalHealth.criticalDivergences !== 1 ? "s" : ""} aberto${(data as any).operationalHealth.criticalDivergences !== 1 ? "s" : ""}`
              }
            />
            <HealthCheck
              label="Tempo de resposta"
              ok={(data as any).operationalHealth.avgResolutionDays === 0 || (data as any).operationalHealth.avgResolutionDays <= 3}
              warning={(data as any).operationalHealth.avgResolutionDays > 3 && (data as any).operationalHealth.avgResolutionDays <= 7}
              message={
                (data as any).operationalHealth.avgResolutionDays === 0
                  ? "Sem dados de resolução"
                  : (data as any).operationalHealth.avgResolutionDays <= 3
                  ? "Resposta rápida (≤3 dias)"
                  : (data as any).operationalHealth.avgResolutionDays <= 7
                  ? "Resposta moderada (4-7 dias)"
                  : "Resposta lenta (>7 dias)"
              }
            />
          </div>
        </div>
      </section>

      {/* Rodapé para impressão (só aparece em PDF) */}
      <div className="hidden print:block text-center text-[10px] text-muted-foreground mt-6 pt-4 border-t border-border">
        Expag · Dashboard Executivo · Gerado em {new Date().toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

// ── KPI de saúde operacional (verde/âmbar/vermelho) ──────────────────────────
function HealthKPI({ label, value, icon: Icon, hint, status }: {
  label: string;
  value: string;
  icon: any;
  hint: string;
  status: "good" | "warning" | "critical" | "neutral";
}) {
  const colorMap = {
    good: { text: "text-emerald-400", bg: "from-emerald-500/10", icon: "text-emerald-400" },
    warning: { text: "text-amber-400", bg: "from-amber-500/10", icon: "text-amber-400" },
    critical: { text: "text-red-400", bg: "from-red-500/10", icon: "text-red-400" },
    neutral: { text: "text-muted-foreground", bg: "from-muted/10", icon: "text-muted-foreground" },
  };
  const c = colorMap[status];
  return (
    <div className={cn("card-premium rounded-2xl p-5 bg-gradient-to-br to-transparent", c.bg)}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em] font-medium">{label}</p>
        <Icon className={cn("w-4 h-4 opacity-60", c.icon)} />
      </div>
      <p className={cn("text-3xl font-bold font-mono tracking-tight tabular-nums", c.text)}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-2">{hint}</p>
    </div>
  );
}

// ── Item de checklist de saúde ───────────────────────────────────────────────
function HealthCheck({ label, ok, warning, message }: {
  label: string;
  ok: boolean;
  warning: boolean;
  message: string;
}) {
  const color = ok ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : warning ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : "text-red-400 bg-red-500/10 border-red-500/30";
  const symbol = ok ? "✓" : warning ? "⚠" : "✗";
  return (
    <div className={cn("rounded-xl border p-3", color)}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-bold">{symbol}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="text-xs opacity-80">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <h2 className="text-sm font-semibold text-foreground tracking-tight">{children}</h2>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function HeroKPI({
  label, value, change, sparkline, color, icon: Icon, isPercent, isPercentChange, sub,
}: {
  label: string;
  value: number;
  change: { value: number; sign: "up" | "down" | "flat" };
  sparkline: number[];
  color: "emerald" | "sky" | "red" | "amber";
  icon: any;
  isPercent?: boolean;
  isPercentChange?: boolean;
  sub?: string;
}) {
  const animated = useCountUp(value, 800);

  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    sky: "text-sky-400",
    red: "text-red-400",
    amber: "text-amber-400",
  };
  const bgMap: Record<string, string> = {
    emerald: "from-emerald-500/10",
    sky: "from-sky-500/10",
    red: "from-red-500/10",
    amber: "from-amber-500/10",
  };

  const formattedValue = isPercent
    ? `${animated.toFixed(1)}%`
    : compactCurrency(animated);

  return (
    <div className={cn("card-premium rounded-2xl p-5 relative overflow-hidden bg-gradient-to-br to-transparent", bgMap[color])}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em] font-medium">{label}</p>
        <Icon className={cn("w-4 h-4 opacity-60", colorMap[color])} />
      </div>
      <p className={cn("text-3xl lg:text-4xl font-bold font-mono tracking-tight tabular-nums", colorMap[color])}>
        {formattedValue}
      </p>

      <div className="flex items-center justify-between mt-3">
        <ChangePill change={change} isPercentChange={isPercentChange} />
        {sub && <p className="text-[10px] text-muted-foreground truncate ml-2">{sub}</p>}
      </div>

      {/* Sparkline embedded */}
      {sparkline.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-10 opacity-30 pointer-events-none">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline.map((v, i) => ({ i, v }))}>
              <Line type="monotone" dataKey="v" stroke="currentColor" strokeWidth={1.5} dot={false} className={colorMap[color]} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ChangePill({ change, isPercentChange }: { change: { value: number; sign: string }; isPercentChange?: boolean }) {
  const Icon = change.sign === "up" ? ArrowUpRight : change.sign === "down" ? ArrowDownRight : TrendingUp;
  const color = change.sign === "up"
    ? "text-emerald-400 bg-emerald-500/10"
    : change.sign === "down"
    ? "text-red-400 bg-red-500/10"
    : "text-muted-foreground bg-muted/20";

  if (change.sign === "flat") {
    return <span className="text-[10px] text-muted-foreground">sem variação</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold", color)}>
      <Icon className="w-2.5 h-2.5" />
      {isPercentChange ? `${change.value.toFixed(1)} pp` : `${Math.abs(change.value).toFixed(1)}%`}
      <span className="font-normal text-[9px] opacity-80">vs anterior</span>
    </span>
  );
}

function Indicator({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold font-mono text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// ── Linha do ranking Top 10 ──────────────────────────────────────────────────
function ClientRow({ rank, client, maxValue }: { rank: number; client: any; maxValue: number }) {
  const barWidth = maxValue > 0 ? (client.period / maxValue) * 100 : 0;
  // Cor do rank: top 3 destacados, resto neutro
  const rankColor = rank === 1
    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
    : rank === 2
    ? "bg-slate-400/20 text-slate-300 border-slate-400/40"
    : rank === 3
    ? "bg-orange-600/20 text-orange-400 border-orange-600/40"
    : "bg-accent/20 text-muted-foreground border-border";
  return (
    <div className="group relative flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-accent/10 transition-colors">
      <div className={cn(
        "shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold",
        rankColor
      )}>
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-foreground truncate">{client.clientName}</p>
          <p className="text-sm font-mono font-semibold text-emerald-400 shrink-0">
            {compactCurrency(client.period)}
          </p>
        </div>
        <div className="relative h-1 bg-accent/20 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500/60 to-emerald-400 transition-all"
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
          <span>{client.txCount} transaç{client.txCount !== 1 ? "ões" : "ão"} · YTD {compactCurrency(client.ytd)}</span>
          <span className="font-medium">{client.percentage.toFixed(1)}% da receita</span>
        </div>
      </div>
    </div>
  );
}

// ── Gauge de concentração com cor por threshold ──────────────────────────────
function ConcentrationGauge({ label, value, threshold }: {
  label: string;
  value: number;
  threshold: number;
}) {
  const color = value >= threshold
    ? "text-red-400"
    : value >= threshold * 0.7
    ? "text-amber-400"
    : "text-emerald-400";
  const barColor = value >= threshold
    ? "bg-red-500"
    : value >= threshold * 0.7
    ? "bg-amber-500"
    : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-bold font-mono tabular-nums", color)}>
          {value.toFixed(0)}%
        </p>
      </div>
      <div className="relative h-1.5 bg-accent/20 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(100, value)}%` }}
        />
        {/* Marcador de threshold */}
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/30"
          style={{ left: `${threshold}%` }}
          title={`Limite de alerta: ${threshold}%`}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Alerta acima de {threshold}%
      </p>
    </div>
  );
}

// ── KPI compacto para Carteira de Crédito ────────────────────────────────────
function CreditKpi({ label, value, hint, color }: {
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div className="card-premium rounded-2xl p-4">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className={cn("text-2xl font-bold font-mono tabular-nums", color)}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

// ── Barra de status com label + count + percentual ───────────────────────────
function StatusBar({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{count}</span> · {pct.toFixed(0)}%
        </p>
      </div>
      <div className="h-2 bg-accent/20 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PeriodSelector({ value, onChange }: { value: PeriodPreset; onChange: (v: PeriodPreset) => void }) {
  const options: Array<{ key: PeriodPreset; label: string }> = [
    { key: "month",     label: "Este mês" },
    { key: "prevMonth", label: "Mês ant." },
    { key: "quarter",   label: "Trimestre" },
    { key: "ytd",       label: "YTD" },
    { key: "30d",       label: "30 dias" },
  ];
  return (
    <div className="flex items-center gap-0.5 bg-accent/10 rounded-lg p-0.5">
      {options.map(o => (
        <button key={o.key}
          onClick={() => onChange(o.key)}
          className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
            value === o.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formatação
// ─────────────────────────────────────────────────────────────────────────────

function formatPeriodLabel(from: string, to: string): string {
  const d = (s: string) => {
    const [y, m, dd] = s.split("-");
    return `${dd}/${m}/${y}`;
  };
  return `${d(from)} → ${d(to)}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m, 10) - 1]}/${y.slice(2)}`;
}

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
