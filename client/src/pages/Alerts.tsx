import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/utils";
import { useState } from "react";
import {
  AlertTriangle, CheckCircle, Info, ShieldAlert, Clock,
  Eye, RefreshCw, Bell, XCircle, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SEVERITY_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", icon: ShieldAlert, label: "Crítico" },
  warning:  { color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", icon: AlertTriangle, label: "Atenção" },
  info:     { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: Info, label: "Informativo" },
};

const STATUS_TABS = [
  { key: "active",       label: "Ativos" },
  { key: "acknowledged", label: "Reconhecidos" },
  { key: "resolved",     label: "Resolvidos" },
  { key: undefined,      label: "Todos" },
];

const TYPE_LABELS: Record<string, string> = {
  critical_divergence: "Divergências Críticas",
  cash_shortage:       "Caixa Insuficiente",
  overdue_payable:     "Conta Vencida",
  credit_delinquency:  "Inadimplência",
  ndi_aging:           "NDI Antigo",
  stale_divergence:    "Divergência Sem Tratativa",
  upcoming_payable:    "Vencimento Próximo",
};

export default function Alerts() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>("active");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: rawAlerts, isLoading, refetch } = trpc.dashboard.getAlerts.useQuery(
    { status: statusFilter },
    { refetchInterval: 30000 } // auto-refresh 30s
  );

  const generateMutation = trpc.dashboard.generateAlerts.useMutation({
    onSuccess: (r: any) => {
      if (r.generated > 0) {
        toast.success(`${r.generated} novo(s) alerta(s) gerado(s)!`);
      } else {
        toast.info("Nenhum novo alerta — sistema operando normalmente.");
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ackMutation = trpc.dashboard.acknowledgeAlert.useMutation({
    onSuccess: () => { toast.success("Alerta reconhecido."); refetch(); },
  });

  const dismissMutation = trpc.dashboard.dismissAlert.useMutation({
    onSuccess: () => { toast.success("Alerta dispensado."); refetch(); },
  });

  const alerts = ((rawAlerts ?? []) as any[]).filter(a =>
    severityFilter === "all" || a.severity === severityFilter
  );

  const counts = {
    critical: ((rawAlerts ?? []) as any[]).filter(a => a.severity === "critical" && a.status === "active").length,
    warning:  ((rawAlerts ?? []) as any[]).filter(a => a.severity === "warning"  && a.status === "active").length,
    info:     ((rawAlerts ?? []) as any[]).filter(a => a.severity === "info"     && a.status === "active").length,
    resolved: ((rawAlerts ?? []) as any[]).filter(a => a.status !== "active").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alertas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoramento operacional · Eventos críticos e notificações automáticas
          </p>
        </div>
        <Button
          size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
          disabled={generateMutation.isPending}
          onClick={() => generateMutation.mutate()}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", generateMutation.isPending && "animate-spin")} />
          {generateMutation.isPending ? "Verificando..." : "Verificar agora"}
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Críticos Ativos",    value: counts.critical, color: "text-red-400",    bg: "bg-red-500/5 border-red-500/20",    icon: ShieldAlert },
          { label: "Atenção Ativos",     value: counts.warning,  color: "text-yellow-400", bg: "bg-yellow-500/5 border-yellow-500/20", icon: AlertTriangle },
          { label: "Informativos",       value: counts.info,     color: "text-blue-400",   bg: "bg-blue-500/5 border-blue-500/20",  icon: Info },
          { label: "Resolvidos (total)", value: counts.resolved, color: "text-emerald-400",bg: "bg-emerald-500/5 border-emerald-500/20", icon: CheckCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className={cn("border rounded-2xl p-5", bg)}>
            <div className="flex items-center justify-between mb-3">
              <Icon className={cn("w-5 h-5", color)} />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
            <p className={cn("text-3xl font-bold font-mono mt-1", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-card border border-border rounded-lg p-0.5 gap-0.5">
          {STATUS_TABS.map(tab => (
            <button key={String(tab.key)} onClick={() => setStatusFilter(tab.key)}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-all font-medium",
                statusFilter === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex bg-card border border-border rounded-lg p-0.5 gap-0.5">
          {[
            { key: "all",      label: "Todas" },
            { key: "critical", label: "Crítico" },
            { key: "warning",  label: "Atenção" },
            { key: "info",     label: "Info" },
          ].map(s => (
            <button key={s.key} onClick={() => setSeverityFilter(s.key)}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-all",
                severityFilter === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando alertas...</div>
      ) : alerts.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="text-sm font-semibold text-foreground">Nenhum alerta ativo</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            O sistema está operando normalmente. Clique em "Verificar agora" para checar contas vencidas, inadimplência e divergências críticas.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert: any) => {
            const cfg = SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.info;
            const Icon = cfg.icon;
            return (
              <div key={alert.id} className={cn("border rounded-2xl p-5", cfg.bg)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                      alert.severity === "critical" ? "bg-red-500/20" :
                      alert.severity === "warning"  ? "bg-yellow-500/20" : "bg-blue-500/20"
                    )}>
                      <Icon className={cn("w-4.5 h-4.5", cfg.color)} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-foreground">{alert.title}</p>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold", cfg.color,
                          alert.severity === "critical" ? "border-red-500/30 bg-red-500/10" :
                          alert.severity === "warning" ? "border-yellow-500/30 bg-yellow-500/10" : "border-blue-500/30 bg-blue-500/10"
                        )}>
                          {cfg.label}
                        </span>
                        {TYPE_LABELS[alert.type] && (
                          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
                            {TYPE_LABELS[alert.type]}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(alert.createdAt)}
                        {alert.acknowledgedAt && (
                          <span className="ml-2 text-emerald-400">
                            · Reconhecido em {formatDateTime(alert.acknowledgedAt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {alert.status === "active" && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                        onClick={() => ackMutation.mutate({ id: alert.id })}>
                        <Eye className="w-3 h-3" /> Reconhecer
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => dismissMutation.mutate({ id: alert.id })}>
                        <XCircle className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">Como os alertas são gerados automaticamente</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] text-muted-foreground">
          {[
            "🔴 Contas a Pagar vencidas — gera alerta crítico ao vencer",
            "🔴 Inadimplência na Carteira de Crédito — parcelas vencidas atualizam status para 'atrasado'",
            "🔴 Divergências críticas sem tratativa há +7 dias",
            "🟡 Contas a vencer nos próximos 3 dias",
            "🟡 NDI com mais de 30 dias sem identificação",
            "🔴 Caixa Real abaixo do limite mínimo configurado",
            "🔴 Divergências críticas detectadas ao finalizar conciliação",
            "✅ Alertas são re-verificados a cada 30s nesta página",
          ].map(item => (
            <div key={item} className="flex items-start gap-1.5">
              <span className="mt-0.5">{item.slice(0, 2)}</span>
              <span>{item.slice(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
