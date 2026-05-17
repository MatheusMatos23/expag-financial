import { trpc } from "@/lib/trpc";
import {
  formatCurrency, formatDate,
  getCurrentMonthRange, getStatusBadge, getStatusLabel, safeNumber,
} from "@/lib/utils";
import { useState } from "react";
import { Plus, TrendingUp, DollarSign, Calendar, Hash, ArrowUpRight, Filter, Edit2, Trash2, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { RecordDetail } from "@/components/RecordDetail";
import { cn, exportToCsv } from "@/lib/utils";

const REVENUE_TYPES = ["pix","ted","boleto","credito","antecipacao","pos","white_label","receita_financeira","receita_operacional","outros"];
const TYPE_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", boleto: "Boleto", credito: "Crédito",
  antecipacao: "Antecipação", pos: "POS", white_label: "White Label",
  receita_financeira: "Rec. Financeira", receita_operacional: "Rec. Operacional", outros: "Outros",
};
const TYPE_COLORS: Record<string, string> = {
  pix: "text-sky-400 bg-sky-500/10", ted: "text-violet-400 bg-violet-500/10",
  boleto: "text-emerald-400 bg-emerald-500/10", credito: "text-amber-400 bg-amber-500/10",
  antecipacao: "text-orange-400 bg-orange-500/10", pos: "text-pink-400 bg-pink-500/10",
  white_label: "text-teal-400 bg-teal-500/10", receita_financeira: "text-blue-400 bg-blue-500/10",
  receita_operacional: "text-indigo-400 bg-indigo-500/10", outros: "text-gray-400 bg-gray-500/10",
};
const BAR_COLORS = ["#10b981","#38bdf8","#818cf8","#f59e0b","#fb923c","#e879f9","#2dd4bf","#60a5fa","#a78bfa","#94a3b8"];
const STATUS_LIST = ["previsto", "realizado", "cancelado"];
const TOOLTIP_STYLE = { background:"#0d1528", border:"1px solid #1a2d50", borderRadius:"8px", fontSize:"11px", color:"#e8edf5" };

const DEFAULT_FORM = {
  referenceDate: new Date().toISOString().split("T")[0],
  type: "pix", description: "", amount: "", status: "realizado",
  clientId: "", clientName: "", notes: "", costCenterId: "",
};

// Period presets
const PERIODS = [
  { label: "Este mês", getValue: () => getCurrentMonthRange() },
  { label: "Últimos 30 dias", getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 30); return { dateFrom: from.toISOString().split("T")[0], dateTo: to.toISOString().split("T")[0] }; } },
  { label: "Últimos 90 dias", getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 90); return { dateFrom: from.toISOString().split("T")[0], dateTo: to.toISOString().split("T")[0] }; } },
  { label: "Este ano", getValue: () => { const now = new Date(); return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: now.toISOString().split("T")[0] }; } },
];

export default function Revenues() {
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [periodIdx, setPeriodIdx] = useState(2); // padrão: últimos 90 dias para incluir conciliações recentes
  const [typeFilter, setTypeFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const set = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const { dateFrom, dateTo } = PERIODS[periodIdx].getValue();

  const { data: revenues, refetch, isLoading } = trpc.controllership.getRevenues.useQuery({
    dateFrom, dateTo,
    type: typeFilter !== "all" ? typeFilter : undefined,
    origin: originFilter !== "all" ? originFilter : undefined,
  });
  const { data: summary } = trpc.controllership.getRevenueSummary.useQuery({ dateFrom, dateTo });
  const { data: costCenters } = trpc.accounting.getCostCenters.useQuery();

  const createMutation = trpc.controllership.createRevenue.useMutation({
    onSuccess: () => { toast.success("Receita registrada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.controllership.updateRevenue.useMutation({
    onSuccess: () => { toast.success("Receita atualizada!"); setEditRow(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.controllership.deleteRevenue.useMutation({
    onSuccess: () => { toast.success("Receita removida!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (row: any) => {
    setEditRow(row);
    setForm({
      referenceDate: row.referenceDate?.slice(0,10) ?? new Date().toISOString().split("T")[0],
      type: row.type ?? "pix", description: row.description ?? "",
      amount: row.amount ?? "", status: row.status ?? "realizado",
      clientId: row.clientId ?? "", clientName: row.clientName ?? "", notes: "",
      costCenterId: row.costCenterId ? String(row.costCenterId) : "",
    });
  };

  const rows = (revenues ?? []) as any[];
  const total    = safeNumber(summary?.total);
  const received = safeNumber(summary?.received);
  const pending  = safeNumber(summary?.pending);
  const count    = safeNumber(summary?.count, 0);

  const chartData = (summary?.byType ?? []).map((r: any, i: number) => ({
    name: TYPE_LABELS[r.type] ?? r.type,
    valor: safeNumber(r.total),
    pct: total > 0 ? Math.round((safeNumber(r.total) / total) * 100) : 0,
    color: BAR_COLORS[i % BAR_COLORS.length],
    type: r.type,
  })).sort((a: any, b: any) => b.valor - a.valor);

  const columns: ColumnDef<any>[] = [
    {
      key: "referenceDate", header: "Data", sortable: true, width: "90px",
      cell: (r) => <span className="text-muted-foreground text-xs">{formatDate(r.referenceDate)}</span>,
    },
    {
      key: "type", header: "Tipo", sortable: true, width: "120px",
      cell: (r) => (
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded", TYPE_COLORS[r.type] ?? "text-gray-400 bg-gray-500/10")}>
          {TYPE_LABELS[r.type] ?? r.type}
        </span>
      ),
    },
    {
      key: "description", header: "Descrição", searchable: true, minWidth: "160px",
      cell: (r) => <span className="text-xs text-foreground truncate block max-w-[200px]">{r.description || "—"}</span>,
    },
    {
      key: "clientName", header: "Cliente", searchable: true,
      cell: (r) => r.clientName
        ? <span className="text-xs text-muted-foreground truncate block max-w-[140px]">{r.clientName}</span>
        : <span className="text-muted-foreground/40 text-xs">—</span>,
    },
    {
      key: "amount", header: "Valor", sortable: true, align: "right", width: "120px",
      cell: (r) => (
        <span className="font-mono text-sm font-bold text-emerald-400 flex items-center justify-end gap-1">
          <ArrowUpRight className="w-3 h-3" />{formatCurrency(r.amount)}
        </span>
      ),
    },
    {
      key: "status", header: "Status", width: "100px",
      cell: (r) => <span className={getStatusBadge(r.status)}>{getStatusLabel(r.status)}</span>,
    },
    {
      key: "id", header: "Ações", width: "100px", align: "right" as const, searchable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary gap-1"
            onClick={(e) => { e.stopPropagation(); handleEdit(r); }}>
            <Edit2 className="w-3 h-3" /> Editar
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-red-400 gap-1"
            onClick={(e) => { e.stopPropagation(); if(confirm("Remover esta receita?")) deleteMutation.mutate({ id: r.id }); }}>
            <Trash2 className="w-3 h-3" /> Excluir
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Receitas</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 2 · Apuração de receitas por tipo e canal</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center p-0.5 bg-muted/30 rounded-lg">
            {PERIODS.map((p, i) => (
              <button key={p.label} onClick={() => setPeriodIdx(i)}
                className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
                  periodIdx === i ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Type filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <Filter className="w-3 h-3 mr-1" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os tipos</SelectItem>
              {REVENUE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0"
            onClick={() => {
              exportToCsv(
                ((revenues ?? []) as any[]).map((r: any) => ({
                  data: r.referenceDate ? formatDate(r.referenceDate) : "",
                  descricao: r.description ?? "",
                  tipo: r.type ?? "",
                  origem: r.origin ?? "",
                  valor: r.amount ?? "",
                })),
                { data: "Data", descricao: "Descrição", tipo: "Tipo", origem: "Origem", valor: "Valor" },
                "receitas",
              );
              toast.success("Receitas exportadas em CSV.");
            }}>
            <Download className="w-3.5 h-3.5" /> Exportar
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
              <Button className="gap-2 shrink-0"><Plus className="w-4 h-4" /> Nova Receita</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Registrar Receita</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Data *</Label>
                  <Input type="date" value={form.referenceDate} onChange={e => set("referenceDate")(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Tipo *</Label>
                    <Select value={form.type} onValueChange={set("type")}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{REVENUE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={form.status} onValueChange={set("status")}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_LIST.map(s => <SelectItem key={s} value={s} className="text-xs">{getStatusLabel(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Valor (R$) *</Label>
                  <Input type="number" step="0.01" placeholder="0,00" value={form.amount}
                    onChange={e => set("amount")(e.target.value)} className="mt-1 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Descrição</Label>
                  <Input value={form.description} onChange={e => set("description")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Descreva a receita..." />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Cliente</Label>
                  <Input value={form.clientName} onChange={e => set("clientName")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Nome do cliente" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Centro de Custo</Label>
                  <Select value={form.costCenterId} onValueChange={set("costCenterId")}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Selecionar (opcional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">Nenhum</SelectItem>
                      {(costCenters ?? []).map((cc: any) => (
                        <SelectItem key={cc.id} value={String(cc.id)} className="text-xs">{cc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Observações</Label>
                  <Textarea value={form.notes} onChange={e => set("notes")(e.target.value)}
                    className="mt-1 text-xs min-h-14 resize-none" rows={2} />
                </div>
                <Button
                  onClick={() => createMutation.mutate({
                    referenceDate: form.referenceDate, type: form.type, amount: form.amount,
                    description: form.description || undefined,
                    clientName: form.clientName || undefined, status: form.status,
                    costCenterId: form.costCenterId && form.costCenterId !== "none" ? parseInt(form.costCenterId) : undefined,
                  })}
                  disabled={!form.amount || !form.type || createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? "Salvando..." : "Salvar Receita"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total",      value: formatCurrency(total),    color: "text-emerald-400", icon: DollarSign, sub: "no período" },
          { label: "Realizado",  value: formatCurrency(received), color: "text-emerald-400", icon: TrendingUp, sub: "confirmado" },
          { label: "Previsto",   value: formatCurrency(pending),  color: "text-amber-400",   icon: Calendar,  sub: "a confirmar" },
          { label: "Lançamentos",value: count,                           color: "text-foreground",  icon: Hash,      sub: "registros" },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <div key={label} className="card-premium rounded-xl p-4 kpi-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className={cn("text-2xl font-bold font-mono tracking-tight", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Charts + Breakdown */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Bar chart */}
          <div className="card-premium rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Receitas por Tipo
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#5c7099" }} />
                <YAxis tick={{ fontSize: 9, fill: "#5c7099" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="valor" radius={[4,4,0,0]} name="Receita" opacity={0.88}>
                  {chartData.map((e: any, i: number) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Breakdown table */}
          <div className="card-premium rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Mix de Receitas</h3>
            <div className="space-y-2.5">
              {chartData.map((item: any) => (
                <div key={item.type} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded", TYPE_COLORS[item.type] ?? "text-gray-400 bg-gray-500/10")}>
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-foreground">{formatCurrency(item.valor)}</span>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{item.pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                    <div className="h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${item.pct}%`, background: item.color }} />
                  </div>
                </div>
              ))}
              {chartData.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhuma receita no período</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por descrição, cliente, tipo..."
        exportFilename="receitas"
        emptyTitle="Nenhuma receita no período"
        emptyDescription="Registre uma nova receita usando o botão acima."
        defaultPageSize={25}
        onRowClick={(row) => setSelectedRow(row)}
      />

      <RecordDetail
        open={!!selectedRow}
        record={selectedRow}
        onClose={() => setSelectedRow(null)}
        onEdit={(row) => { setForm({ referenceDate: row.referenceDate?.slice(0,10) ?? "", type: row.type, description: row.description ?? "", amount: String(row.amount), status: row.status, clientId: row.clientId ?? "", clientName: row.clientName ?? "", notes: "", costCenterId: row.costCenterId ? String(row.costCenterId) : "" }); setEditRow(row); }}
        title="Detalhe da Receita"
        fields={[
          { label: "Data", key: "referenceDate", format: "date" },
          { label: "Tipo", key: "type" },
          { label: "Descrição", key: "description" },
          { label: "Cliente", key: "clientName" },
          { label: "Valor", key: "amount", format: "currency" },
          { label: "Status", key: "status", format: "status" },
        ]}
      />

      {/* Edit Dialog */}
      <Dialog open={editRow !== null} onOpenChange={v => !v && setEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Receita</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs text-muted-foreground">Data</Label>
              <Input type="date" value={form.referenceDate} onChange={e => set("referenceDate")(e.target.value)} className="mt-1 h-8 text-xs" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground">Tipo</Label>
                <Select value={form.type} onValueChange={set("type")}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{REVENUE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={form.status} onValueChange={set("status")}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_LIST.map(s => <SelectItem key={s} value={s} className="text-xs">{getStatusLabel(s)}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div><Label className="text-xs text-muted-foreground">Valor (R$)</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={e => set("amount")(e.target.value)} className="mt-1 h-8 text-xs font-mono" /></div>
            <div><Label className="text-xs text-muted-foreground">Descrição</Label>
              <Input value={form.description} onChange={e => set("description")(e.target.value)} className="mt-1 h-8 text-xs" /></div>
            <div><Label className="text-xs text-muted-foreground">Cliente</Label>
              <Input value={form.clientName} onChange={e => set("clientName")(e.target.value)} className="mt-1 h-8 text-xs" /></div>
            <Button onClick={() => updateMutation.mutate({ id: editRow.id, ...form })}
              disabled={updateMutation.isPending} className="w-full">
              {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
