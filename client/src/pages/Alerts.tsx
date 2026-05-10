import { trpc } from "@/lib/trpc";
import { formatDateTime, getStatusBadge, getStatusLabel } from "@/lib/utils";
import { useState } from "react";
import { AlertTriangle, Bell, CheckCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Alerts() {
  const [statusFilter, setStatusFilter] = useState("active");
  const { data: alerts, refetch } = trpc.dashboard.getAlerts.useQuery({ status: statusFilter !== "all" ? statusFilter : undefined });
  const acknowledgeMutation = trpc.dashboard.acknowledgeAlert.useMutation({
    onSuccess: () => { toast.success("Alerta reconhecido!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const severityConfig: Record<string, { icon: any; color: string; bg: string }> = {
    critical: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
    warning: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
    info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alertas</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitoramento de eventos críticos e notificações</p>
        </div>
        <div className="flex items-center gap-2">
          {["active", "acknowledged", "all"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}>
              {s === "active" ? "Ativos" : s === "acknowledged" ? "Vistos" : "Todos"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {(alerts ?? []).length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="text-sm text-foreground font-medium">Nenhum alerta ativo</p>
            <p className="text-xs text-muted-foreground mt-1">O sistema está operando normalmente.</p>
          </div>
        ) : (alerts ?? []).map((a: any) => {
          const cfg = severityConfig[a.severity] ?? severityConfig.info;
          const Icon = cfg.icon;
          return (
            <div key={a.id} className={`border rounded-xl p-4 flex items-start gap-4 ${cfg.bg}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
                <Icon className={`w-5 h-5 ${cfg.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className={`text-sm font-semibold ${cfg.color}`}>{a.title}</p>
                  <span className={getStatusBadge(a.status)}>{getStatusLabel(a.status)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDateTime(a.createdAt)}</p>
              </div>
              {a.status === "active" && (
                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => acknowledgeMutation.mutate({ id: a.id })}>
                  Reconhecer
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
