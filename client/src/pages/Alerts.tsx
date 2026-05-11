import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/utils";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Info, ShieldAlert, Clock, Eye, Filter, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SeverityKey = "critical" | "warning" | "info";

const SEVERITY_CONFIG: Record<SeverityKey, { icon: any; label: string; color: string; bg: string; badge: string; dot: string }> = {
  critical: { icon: ShieldAlert, label: "Crítico",     color: "text-red-400",   bg: "bg-red-500/8 border-red-500/25",   badge: "bg-red-500/15 text-red-400 border-red-500/30",   dot: "bg-red-400 animate-pulse" },
  warning:  { icon: AlertTriangle, label: "Atenção",   color: "text-amber-400", bg: "bg-amber-500/8 border-amber-500/25", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", dot: "bg-amber-400" },
  info:     { icon: Info,       label: "Informação",   color: "text-sky-400",   bg: "bg-sky-500/8 border-sky-500/25",   badge: "bg-sky-500/15 text-sky-400 border-sky-500/30",   dot: "bg-sky-400" },
};

const TYPE_LABELS: Record<string, string> = {
  cash_shortage: "Caixa Insuficiente", negative_cash: "Caixa Negativo",
  insufficient_funding: "Funding Insuficiente", excessive_client_balance_use: "Uso Excessivo de Custódia",
  critical_divergence: "Divergência Crítica", overdue_payable: "Conta Vencida",
  credit_default: "Inadimplência", concentration_excess: "Concentração Excessiva",
};

function AlertCard({ alert, onAction, isPending }: { alert: any; onAction: (id: number) => void; isPending: boolean }) {
  const sev = (alert.severity as SeverityKey) in SEVERITY_CONFIG ? alert.severity as SeverityKey : "info";
  const cfg = SEVERITY_CONFIG[sev];
  const Icon = cfg.icon;
  const isAcknowledged = alert.status === "acknowledged";
  const isResolved     = alert.status === "resolved";

  return (
    <div className={cn("border rounded-xl p-4 flex items-start gap-4 transition-all duration-200", isResolved ? "opacity-50 bg-card border-border" : cfg.bg)}>
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border", isResolved ? "bg-muted/30 border-border" : cfg.badge)}>
        <Icon className={cn("w-4 h-4", isResolved ? "text-muted-foreground" : cfg.color)} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", isResolved ? "bg-muted/20 text-muted-foreground border-border" : cfg.badge)}>{cfg.label}</span>
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">{TYPE_LABELS[alert.type] ?? alert.type}</span>
          {isAcknowledged && <span className="text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-full flex items-center gap-1"><Eye className="w-2.5 h-2.5" />Reconhecido</span>}
          {isResolved && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" />Resolvido</span>}
        </div>
        <p className={cn("text-sm font-semibold", isResolved ? "text-muted-foreground" : cfg.color)}>{alert.title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <Clock className="w-3 h-3" />{formatDateTime(alert.createdAt)}
        </div>
      </div>
      {!isResolved && (
        <div className="flex flex-col gap-1.5 shrink-0">
          {!isAcknowledged && (
            <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground hover:text-foreground px-2" onClick={() => onAction(alert.id)} disabled={isPending}>
              <Eye className="w-3 h-3 mr-1" />Reconhecer
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 px-2" onClick={() => onAction(alert.id)} disabled={isPending}>
            <CheckCircle className="w-3 h-3 mr-1" />Resolver
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const [statusFilter, setStatusFilter] = useState("active");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: alerts, refetch } = trpc.dashboard.getAlerts.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const acknowledgeMutation = trpc.dashboard.acknowledgeAlert.useMutation({
    onSuccess: () => { toast.success("Alerta atualizado!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = ((alerts ?? []) as any[]).filter((a: any) => severityFilter === "all" ? true : a.severity === severityFilter);
  const allAlerts = (alerts ?? []) as any[];
  const critical = allAlerts.filter((a: any) => a.severity === "critical" && a.status === "active").length;
  const warning  = allAlerts.filter((a: any) => a.severity === "warning"  && a.status === "active").length;
  const info     = allAlerts.filter((a: any) => a.severity === "info"     && a.status === "active").length;
  const resolved = allAlerts.filter((a: any) => a.status === "resolved").length;

  const TABS = [
    { key: "active", label: "Ativos" }, { key: "acknowledged", label: "Reconhecidos" },
    { key: "resolved", label: "Resolvidos" }, { key: "all", label: "Todos" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Alertas</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitoramento operacional · Eventos críticos e notificações automáticas</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Críticos Ativos",    value: critical, color: "text-red-400",     bg: critical > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card border-border", Icon: ShieldAlert },
          { label: "Atenção Ativos",     value: warning,  color: "text-amber-400",   bg: "bg-card border-border", Icon: AlertTriangle },
          { label: "Informativos",       value: info,     color: "text-sky-400",     bg: "bg-card border-border", Icon: Info },
          { label: "Resolvidos (total)", value: resolved, color: "text-emerald-400", bg: "bg-card border-border", Icon: CheckCircle },
        ].map(({ label, value, color, bg, Icon }) => (
          <div key={label} className={cn("border rounded-xl p-4", bg)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
              <Icon className={cn("w-3.5 h-3.5", color)} />
            </div>
            <p className={cn("text-3xl font-bold font-mono", color)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center p-0.5 bg-muted/30 rounded-lg">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                statusFilter === tab.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-7 text-xs w-32 border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todas</SelectItem>
              <SelectItem value="critical" className="text-xs">Crítico</SelectItem>
              <SelectItem value="warning" className="text-xs">Atenção</SelectItem>
              <SelectItem value="info" className="text-xs">Informativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} alertas</span>
      </div>

      <div className="space-y-2.5">
        {rows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {statusFilter === "active" ? "Nenhum alerta ativo" : "Nenhum alerta encontrado"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {statusFilter === "active"
                ? "O sistema está operando normalmente. Alertas são gerados automaticamente pelo motor de monitoramento."
                : "Nenhum alerta corresponde ao filtro selecionado."}
            </p>
          </div>
        ) : (
          (["critical", "warning", "info"] as SeverityKey[]).map(sev => {
            const group = rows.filter((a: any) => a.severity === sev);
            if (group.length === 0) return null;
            const cfg = SEVERITY_CONFIG[sev];
            return (
              <div key={sev} className="space-y-2">
                {severityFilter === "all" && (
                  <div className="flex items-center gap-2 px-1 pt-2">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {cfg.label} ({group.length})
                    </span>
                  </div>
                )}
                {group.map((alert: any) => (
                  <AlertCard key={alert.id} alert={alert}
                    onAction={(id) => acknowledgeMutation.mutate({ id })}
                    isPending={acknowledgeMutation.isPending} />
                ))}
              </div>
            );
          })
        )}
      </div>

      <div className="bg-sky-500/5 border border-sky-500/15 rounded-xl p-4 flex gap-3">
        <Activity className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-sky-400">Como os alertas são gerados automaticamente</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Caixa negativo ao registrar fluxo · Funding insuficiente em projeções · Contas vencidas · Inadimplência na carteira de crédito · Divergências críticas na conciliação
          </p>
        </div>
      </div>
    </div>
  );
}
