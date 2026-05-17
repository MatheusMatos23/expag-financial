import { trpc } from "@/lib/trpc";
import { cn, exportToCsv } from "@/lib/utils";
import { useState } from "react";
import {
  ScrollText, Search, RefreshCw, Download, Activity, Calendar,
  ArrowLeftRight, AlertTriangle, Users as UsersIcon, FileText,
  Shield, Clock, Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ── Metadados de categorias ───────────────────────────────────────────────────
const CATEGORY_META: Record<string, { label: string; cls: string; icon: any }> = {
  conciliacao: { label: "Conciliação", cls: "text-sky-300 bg-sky-500/12 border-sky-500/25",       icon: ArrowLeftRight },
  divergencia: { label: "Divergência", cls: "text-amber-300 bg-amber-500/12 border-amber-500/25", icon: AlertTriangle },
  ndi:         { label: "NDI",         cls: "text-violet-300 bg-violet-500/12 border-violet-500/25", icon: FileText },
  usuario:     { label: "Usuário",     cls: "text-emerald-300 bg-emerald-500/12 border-emerald-500/25", icon: UsersIcon },
};

function catMeta(c: string) {
  return CATEGORY_META[c] ?? { label: c || "Sistema", cls: "text-muted-foreground bg-muted/30 border-border", icon: Activity };
}

function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function relativeTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `há ${days}d`;
  return "";
}

function Avatar({ name }: { name?: string }) {
  const letter = (name || "?")[0]?.toUpperCase() ?? "?";
  const colors = ["#4f6ef7", "#06d6a0", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6"];
  const idx = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div
      style={{ background: `${colors[idx]}22`, border: `1px solid ${colors[idx]}40`, color: colors[idx] }}
      className="w-7 h-7 rounded-full flex items-center justify-center font-bold shrink-0 text-[11px]"
    >
      {letter}
    </div>
  );
}

const CATEGORY_TABS = [
  { key: "all",         label: "Tudo" },
  { key: "conciliacao", label: "Conciliação" },
  { key: "divergencia", label: "Divergência" },
  { key: "ndi",         label: "NDI" },
  { key: "usuario",     label: "Usuário" },
];

export default function AuditLog() {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const { data: logs, isLoading, refetch } = trpc.dashboard.getAuditLogs.useQuery(
    { category: category === "all" ? undefined : category, limit: 500 },
    { refetchInterval: 30000 },
  );
  const { data: stats } = trpc.dashboard.getAuditStats.useQuery(undefined, { refetchInterval: 60000 });

  const allLogs = (logs ?? []) as any[];
  const filtered = allLogs.filter((l: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [l.summary, l.userName, l.userEmail, l.action].some(
      (v: any) => v && String(v).toLowerCase().includes(s)
    );
  });

  // Agrupa por dia
  const byDay: Record<string, any[]> = {};
  for (const log of filtered) {
    const day = new Date(log.createdAt).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "long", year: "numeric",
    });
    (byDay[day] ??= []).push(log);
  }

  const handleExport = () => {
    exportToCsv(
      filtered.map((l: any) => ({
        dataHora: fmtDateTime(l.createdAt),
        usuario: l.userName ?? "",
        email: l.userEmail ?? "",
        categoria: catMeta(l.category).label,
        acao: l.action ?? "",
        descricao: l.summary ?? "",
        ip: l.ipAddress ?? "",
      })),
      {
        dataHora: "Data/Hora", usuario: "Usuário", email: "E-mail",
        categoria: "Categoria", acao: "Ação", descricao: "Descrição", ip: "IP",
      },
      "auditoria",
    );
    toast.success(`${filtered.length} registro(s) exportado(s).`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Auditoria</h1>
          <p className="page-subtitle">Registro completo de todas as ações realizadas no sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleExport}>
            <Download className="w-3.5 h-3.5" /> Exportar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="kpi-accent card-premium p-4 group">
          <div className="flex items-start justify-between">
            <p className="text-[9px] font-semibold text-[#3a5280] uppercase tracking-[0.08em]">Total de registros</p>
            <ScrollText className="w-3.5 h-3.5 text-sky-300 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-2xl font-bold font-mono mt-2 tracking-tight text-foreground">
            {(stats?.total ?? 0).toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="kpi-accent card-premium p-4 group">
          <div className="flex items-start justify-between">
            <p className="text-[9px] font-semibold text-[#3a5280] uppercase tracking-[0.08em]">Ações hoje</p>
            <Activity className="w-3.5 h-3.5 text-emerald-300 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-2xl font-bold font-mono mt-2 tracking-tight text-emerald-300">
            {(stats?.today ?? 0).toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="kpi-accent card-premium p-4 group">
          <div className="flex items-start justify-between">
            <p className="text-[9px] font-semibold text-[#3a5280] uppercase tracking-[0.08em]">Categorias ativas</p>
            <Filter className="w-3.5 h-3.5 text-violet-300 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-2xl font-bold font-mono mt-2 tracking-tight text-violet-300">
            {(stats?.byCategory?.length ?? 0)}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                category === tab.key
                  ? "bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgba(79,110,247,0.2)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar ação, usuário..."
            className="h-9 text-xs pl-9" />
        </div>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="card-premium rounded-xl py-16 text-center text-sm text-muted-foreground">
          Carregando registros...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-premium rounded-xl py-16 text-center">
          <ScrollText className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-30" />
          <p className="text-sm text-muted-foreground">Nenhum registro de auditoria encontrado</p>
          <p className="text-xs text-muted-foreground/60 mt-1">As ações realizadas no sistema aparecerão aqui.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(byDay).map(([day, items]) => (
            <div key={day}>
              {/* Day header */}
              <div className="flex items-center gap-2 mb-2.5 px-1">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground/50" />
                <span className="text-[11px] font-semibold text-muted-foreground capitalize">{day}</span>
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground/50">{items.length} ação(ões)</span>
              </div>

              {/* Entries */}
              <div className="card-premium rounded-xl overflow-hidden divide-y divide-border/40">
                {items.map((log: any) => {
                  const meta = catMeta(log.category);
                  const CatIcon = meta.icon;
                  return (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[rgba(79,110,247,0.03)] transition-colors">
                      <Avatar name={log.userName} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">
                            {log.userName ?? "Sistema"}
                          </span>
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border font-semibold",
                            meta.cls
                          )}>
                            <CatIcon className="w-2.5 h-2.5" />
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">
                          {log.summary}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {fmtDateTime(log.createdAt)}
                            {relativeTime(log.createdAt) && (
                              <span className="text-muted-foreground/40">· {relativeTime(log.createdAt)}</span>
                            )}
                          </span>
                          {log.ipAddress && (
                            <span className="text-[10px] text-muted-foreground/40 font-mono">
                              {log.ipAddress}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/20 border border-border/60 rounded-lg px-3 py-2">
        <Shield className="w-3.5 h-3.5 shrink-0" />
        Os registros de auditoria são imutáveis e mantidos para fins de conformidade e rastreabilidade.
      </div>
    </div>
  );
}
