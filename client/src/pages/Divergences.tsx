import { trpc } from "@/lib/trpc";
import {
  formatCurrency, formatDate, getStatusBadge, getStatusLabel,
} from "@/lib/utils";
import { useState } from "react";
import {
  AlertTriangle, Filter, ChevronDown, ChevronUp,
  Clock, DollarSign, Hash, User, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";

// ─── CATEGORY LABELS ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  deposito_nao_identificado: "Depósito Não Identificado",
  pix_sem_cliente: "PIX Sem Cliente",
  ted_orfa: "TED Órfã",
  estorno: "Estorno",
  devolucao: "Devolução",
  receita_financeira: "Receita Financeira",
  tarifa_nao_apropriada: "Tarifa Não Apropriada",
  emprestimo_operacional: "Empréstimo Operacional",
  uso_saldo_clientes: "Uso Saldo Clientes",
  receita_nao_lancada: "Receita Não Lançada",
  receita_operacional: "Receita Operacional",
  despesa_nao_lancada: "Despesa Não Lançada",
  tarifa_bancaria: "Tarifa Bancária",
  imposto: "Imposto/IOF",
  repasse_externo: "Repasse Externo",
  saida_operacional: "Saída Operacional",
  liquidacao_divergente: "Liquidação Divergente",
  ajuste_manual: "Ajuste Manual",
  outros: "Outros",
};

const STATUS_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "pendente", label: "Pendente" },
  { value: "em_analise", label: "Em Análise" },
  { value: "identificado", label: "Identificado" },
  { value: "regularizado", label: "Regularizado" },
  { value: "escalado_diretoria", label: "Escalado" },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "Todas prioridades" },
  { value: "critical", label: "Crítica" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Média" },
  { value: "low", label: "Baixa" },
];

const STATUS_MUTATION_OPTIONS = [
  "pendente", "em_analise", "identificado", "regularizado",
  "reclassificado", "baixado", "escalado_diretoria",
];

// ─── PRIORITY BADGE ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    low: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  const labels: Record<string, string> = {
    critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${styles[priority] ?? styles.low}`}>
      {priority === "critical" && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
      {labels[priority] ?? priority}
    </span>
  );
}

// ─── TYPE BADGE ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const isSurplus = type === "bank_surplus";
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
      isSurplus
        ? "bg-green-500/10 text-green-400"
        : "bg-red-500/10 text-red-400"
    }`}>
      {isSurplus ? "Sobra" : "Falta"}
    </span>
  );
}

// ─── SLA INDICATOR ───────────────────────────────────────────────────────────

function SLAIndicator({ deadline }: { deadline: string | null | undefined }) {
  if (!deadline) return <span className="text-muted-foreground/40">—</span>;
  const today = new Date();
  const sla = new Date(deadline);
  const diffDays = Math.ceil((sla.getTime() - today.getTime()) / 86400000);

  let cls = "text-green-400";
  if (diffDays <= 0) cls = "text-red-400 font-semibold";
  else if (diffDays <= 2) cls = "text-red-400";
  else if (diffDays <= 5) cls = "text-yellow-400";

  return (
    <span className={`text-xs ${cls}`}>
      {formatDate(deadline)}
      {diffDays <= 0 && <span className="ml-1 text-[10px]">VENCIDO</span>}
      {diffDays > 0 && diffDays <= 5 && (
        <span className="ml-1 text-[10px] opacity-70">({diffDays}d)</span>
      )}
    </span>
  );
}

// ─── EDIT DIALOG ──────────────────────────────────────────────────────────────

interface EditDialogProps {
  divergence: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditDivergenceDialog({ divergence, onClose, onSuccess }: EditDialogProps) {
  const [status, setStatus] = useState(String(divergence?.status ?? "em_analise"));
  const [responsible, setResponsible] = useState(String(divergence?.responsible ?? ""));
  const [observation, setObservation] = useState(String(divergence?.observation ?? ""));
  const [actionTaken, setActionTaken] = useState(String(divergence?.actionTaken ?? ""));
  const [sla, setSla] = useState(
    divergence?.slaDeadline ? String(divergence.slaDeadline).slice(0, 10) : ""
  );

  const updateMutation = trpc.reconciliation.updateDivergence.useMutation({
    onSuccess: () => {
      toast.success("Divergência atualizada com sucesso!");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!divergence) return null;

  return (
    <Dialog open={!!divergence} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            Gerenciar Divergência #{String(divergence.id)}
          </DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="bg-muted/30 rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tipo</span>
            <TypeBadge type={String(divergence.divergenceType)} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Categoria</span>
            <span className="font-medium">{CATEGORY_LABELS[String(divergence.category)] ?? String(divergence.category)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor</span>
            <span className="font-mono font-semibold text-foreground">{formatCurrency(String(divergence.amount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Prioridade</span>
            <PriorityBadge priority={String(divergence.priority)} />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label>Novo Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_MUTATION_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {getStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Responsável</Label>
            <Input
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              className="mt-1 h-8 text-xs"
              placeholder="Nome do responsável pela tratativa"
            />
          </div>

          <div>
            <Label>SLA — Prazo de resolução</Label>
            <Input
              type="date"
              value={sla}
              onChange={(e) => setSla(e.target.value)}
              className="mt-1 h-8 text-xs"
            />
          </div>

          <div>
            <Label>Observação</Label>
            <Textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              className="mt-1 text-xs min-h-16 resize-none"
              placeholder="Descreva a análise da divergência..."
            />
          </div>

          <div>
            <Label>Ação Tomada</Label>
            <Textarea
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              className="mt-1 text-xs min-h-16 resize-none"
              placeholder="Descreva a ação tomada para resolução..."
            />
          </div>

          <Button
            onClick={() =>
              updateMutation.mutate({
                id: Number(divergence.id),
                status,
                responsible: responsible || undefined,
                observation: observation || undefined,
                actionTaken: actionTaken || undefined,
                slaDeadline: sla || undefined,
              })
            }
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function Divergences() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const { data: divergences, refetch, isLoading } = trpc.reconciliation.getDivergences.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
  });

  const rows = (divergences ?? []) as Record<string, unknown>[];

  // ── Stats ──
  const totalAmount = rows.reduce((s, d) => s + parseFloat(String(d.amount ?? "0")), 0);
  const critical = rows.filter((d) => d.priority === "critical").length;
  const pending = rows.filter((d) => d.status === "pendente").length;

  // ── Columns ──
  const columns: ColumnDef<Record<string, unknown>>[] = [
    {
      key: "divergenceDate", header: "Data", sortable: true,
      cell: (row) => <span className="text-muted-foreground">{formatDate(String(row.divergenceDate))}</span>,
    },
    {
      key: "divergenceType", header: "Tipo", sortable: true,
      cell: (row) => <TypeBadge type={String(row.divergenceType)} />,
    },
    {
      key: "category", header: "Categoria", sortable: true, minWidth: "160px",
      cell: (row) => (
        <span className="text-foreground font-medium">
          {CATEGORY_LABELS[String(row.category)] ?? String(row.category)}
        </span>
      ),
    },
    {
      key: "amount", header: "Valor", sortable: true, align: "right",
      cell: (row) => (
        <span className="font-mono font-semibold text-foreground">
          {formatCurrency(String(row.amount))}
        </span>
      ),
    },
    {
      key: "priority", header: "Prioridade", sortable: true,
      cell: (row) => <PriorityBadge priority={String(row.priority)} />,
    },
    {
      key: "status", header: "Status", sortable: true,
      cell: (row) => (
        <span className={getStatusBadge(String(row.status))}>
          {getStatusLabel(String(row.status))}
        </span>
      ),
    },
    {
      key: "slaDeadline", header: "SLA", sortable: true,
      cell: (row) => <SLAIndicator deadline={row.slaDeadline as string | null} />,
    },
    {
      key: "responsible", header: "Responsável",
      cell: (row) => row.responsible
        ? <span className="text-foreground">{String(row.responsible)}</span>
        : <span className="text-muted-foreground/40 italic text-[11px]">Não atribuído</span>,
    },
    {
      key: "bankName", header: "Banco/Cliente",
      cell: (row) => {
        const label = row.clientName ?? row.bankName ?? null;
        return label
          ? <span className="text-muted-foreground truncate max-w-[120px] block">{String(label)}</span>
          : <span className="text-muted-foreground/40">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Divergências</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Motor de divergências · Sobras e faltas mapeadas automaticamente
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Total</span>
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{rows.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Volume</span>
          </div>
          <p className="text-xl font-bold font-mono text-foreground">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="bg-card border border-red-500/20 rounded-xl p-4 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Críticas</span>
          </div>
          <p className="text-2xl font-bold font-mono text-red-400">{critical}</p>
        </div>
        <div className="bg-card border border-yellow-500/20 rounded-xl p-4 bg-yellow-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Pendentes</span>
          </div>
          <p className="text-2xl font-bold font-mono text-yellow-400">{pending}</p>
        </div>
      </div>

      {/* ── DataTable ── */}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por categoria, cliente, banco, responsável..."
        exportFilename="divergencias"
        emptyTitle="Nenhuma divergência encontrada"
        emptyDescription="Processe uma conciliação para que as divergências sejam geradas automaticamente."
        onRowClick={(row) => setSelected(row)}
        defaultPageSize={25}
        rowClassName={(row) => {
          if (row.priority === "critical") return "bg-red-500/5 hover:bg-red-500/10";
          if (row.status === "escalado_diretoria") return "bg-orange-500/5";
          return undefined;
        }}
      />

      {/* ── Edit Dialog ── */}
      {selected && (
        <EditDivergenceDialog
          divergence={selected}
          onClose={() => setSelected(null)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
}
