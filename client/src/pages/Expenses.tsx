import { trpc } from "@/lib/trpc";
import {
  formatCurrency, formatCurrencyCompact, formatDate,
  getCurrentMonthRange, getStatusBadge, getStatusLabel, safeNumber,
} from "@/lib/utils";
import { useState } from "react";
import { Plus, Receipt, TrendingDown, Calendar, Hash, Filter, ArrowDownRight, Edit2, Trash2 , RefreshCw} from "lucide-react";
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
import { cn } from "@/lib/utils";

const CATEGORIES = ["bancaria","api","tecnologia","infra","operacional","comercial","folha","comissao","impostos","reembolso","chargeback","estorno","marketing","juridico","administrativo","outros"];
const CAT_LABELS: Record<string,string> = {
  bancaria:"Bancária", api:"API", tecnologia:"Tecnologia", infra:"Infra",
  operacional:"Operacional", comercial:"Comercial", folha:"Folha", comissao:"Comissão",
  impostos:"Impostos", reembolso:"Reembolso", chargeback:"Chargeback", estorno:"Estorno",
  outros:"Outros", marketing:"Marketing", juridico:"Jurídico", administrativo:"Administrativo",
};
const CAT_COLORS: Record<string,string> = {
  bancaria:"text-sky-400 bg-sky-500/10", api:"text-violet-400 bg-violet-500/10",
  tecnologia:"text-blue-400 bg-blue-500/10", infra:"text-teal-400 bg-teal-500/10",
  operacional:"text-emerald-400 bg-emerald-500/10", comercial:"text-amber-400 bg-amber-500/10",
  folha:"text-orange-400 bg-orange-500/10", comissao:"text-pink-400 bg-pink-500/10",
  impostos:"text-red-400 bg-red-500/10", reembolso:"text-lime-400 bg-lime-500/10",
  chargeback:"text-rose-400 bg-rose-500/10", estorno:"text-yellow-400 bg-yellow-500/10",
  marketing:"text-purple-400 bg-purple-500/10", juridico:"text-indigo-400 bg-indigo-500/10",
  administrativo:"text-gray-400 bg-gray-500/10", outros:"text-gray-400 bg-gray-500/10",
};
const CHART_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#38bdf8","#818cf8","#e879f9","#f472b6","#94a3b8","#10b981","#6ee7b7","#7dd3fc","#c4b5fd","#fca5a5","#fdba74"];
const STATUS_LIST = ["realizado","previsto","cancelado"];
const TOOLTIP_STYLE = { background:"#0d1528", border:"1px solid #1a2d50", borderRadius:"8px", fontSize:"11px", color:"#e8edf5" };

const DEFAULT_FORM = {
  referenceDate: new Date().toISOString().split("T")[0],
  category: "operacional", subcategory: "", description: "",
  amount: "", status: "realizado", supplier: "", notes: "", costCenterId: "",
};

const PERIODS = [
  { label: "Este mês", getValue: () => getCurrentMonthRange() },
  { label: "30 dias",  getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-30); return { dateFrom: from.toISOString().split("T")[0], dateTo: to.toISOString().split("T")[0] }; } },
  { label: "90 dias",  getValue: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate()-90); return { dateFrom: from.toISOString().split("T")[0], dateTo: to.toISOString().split("T")[0] }; } },
  { label: "Este ano", getValue: () => { const now = new Date(); return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: now.toISOString().split("T")[0] }; } },
];

export default function Expenses() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [periodIdx, setPeriodIdx] = useState(2); // padrão: últimos 90 dias
  const [catFilter, setCatFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const set = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const { dateFrom, dateTo } = PERIODS[periodIdx].getValue();

  const [editRow, setEditRow] = useState<any>(null);
  const [selectedRow, setSelectedRow] = useState<any>(null);

  const { data: expenses, refetch, isLoading } = trpc.controllership.getExpenses.useQuery({
    dateFrom, dateTo,
    category: catFilter !== "all" ? catFilter : undefined,
    origin: originFilter !== "all" ? originFilter : undefined,
  });
  const { data: summary } = trpc.controllership.getExpenseSummary.useQuery({ dateFrom, dateTo });
  const { data: costCenters } = trpc.accounting.getCostCenters.useQuery();

  const createMutation = trpc.controllership.createExpense.useMutation({
    onSuccess: () => { toast.success("Despesa registrada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.controllership.updateExpense.useMutation({
    onSuccess: () => { toast.success("Despesa atualizada!"); setEditRow(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.controllership.deleteExpense.useMutation({
    onSuccess: () => { toast.success("Despesa removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (row: any) => {
    setEditRow(row);
    setForm({
      referenceDate: row.referenceDate?.slice(0,10) ?? new Date().toISOString().split("T")[0],
      category: row.category ?? "operacional", subcategory: row.subcategory ?? "",
      description: row.description ?? "", amount: row.amount ?? "",
      status: row.status ?? "realizado", supplier: row.supplier ?? "", notes: "",
      costCenterId: row.costCenterId ? String(row.costCenterId) : "",
    });
  };

  const rows = (expenses ?? []) as any[];
  const total   = safeNumber(summary?.total);
  const paid    = safeNumber(summary?.paid);
  const pending = safeNumber(summary?.pending);
  const count   = safeNumber(summary?.count, 0);

  const chartData = (summary?.byCategory ?? []).map((e: any, i: number) => ({
    name: CAT_LABELS[e.category] ?? e.category,
    valor: safeNumber(e.total),
    color: CHART_COLORS[i % CHART_COLORS.length],
  })).sort((a: any, b: any) => b.valor - a.valor).slice(0, 8);

  const columns: ColumnDef<any>[] = [
    {
      key: "referenceDate", header: "Data", sortable: true, width: "90px",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.referenceDate)}</span>,
    },
    {
      key: "category", header: "Categoria", sortable: true, width: "130px",
      cell: (r) => (
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded", CAT_COLORS[r.category] ?? "text-gray-400 bg-gray-500/10")}>
          {CAT_LABELS[r.category] ?? r.category}
        </span>
      ),
    },
    {
      key: "description", header: "Descrição", searchable: true, minWidth: "150px",
      cell: (r) => <span className="text-xs text-foreground truncate block max-w-[180px]">{r.description || "—"}</span>,
    },
    {
      key: "supplier", header: "Fornecedor", searchable: true,
      cell: (r) => r.supplier
        ? <span className="text-xs text-muted-foreground truncate block max-w-[130px]">{r.supplier}</span>
        : <span className="text-muted-foreground/40 text-xs">—</span>,
    },
    {
      key: "amount", header: "Valor", sortable: true, align: "right", width: "120px",
      cell: (r) => <span className="font-mono text-sm font-bold text-red-400">{formatCurrency(r.amount)}</span>,
    },
    {
      key: "status", header: "Status", width: "100px",
      cell: (r) => <span className={getStatusBadge(r.status)}>{getStatusLabel(r.status)}</span>,
    },
    {
      key: "id", header: "", align: "right" as const, width: "70px", searchable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary gap-1"
            onClick={(e) => { e.stopPropagation(); handleEdit(r); }}>
            <Edit2 className="w-3 h-3" /> Editar
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-red-400 gap-1"
            onClick={(e) => { e.stopPropagation(); if(confirm("Remover esta despesa?")) deleteMutation.mutate({ id: r.id }); }}>
            <Trash2 className="w-3 h-3" /> Excluir
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Despesas</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 2 · Mapeamento de despesas por categoria</p>
        </div>
        <Dialog open={open} onOpenChange={v => { setOpen(v); if(!v) { setEditRow(null); setForm(DEFAULT_FORM); } }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
            <Button className="gap-2 shrink-0"><Plus className="w-4 h-4" /> Nova Despesa</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editRow ? "Editar Despesa" : "Registrar Despesa"}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Data *</Label>
                <Input type="date" value={form.referenceDate} onChange={e => set("referenceDate")(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Categoria *</Label>
                  <Select value={form.category} onValueChange={set("category")}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs">{CAT_LABELS[c]}</SelectItem>)}</SelectContent>
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
                  className="mt-1 h-8 text-xs" placeholder="Descreva a despesa..." />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Fornecedor</Label>
                <Input value={form.supplier} onChange={e => set("supplier")(e.target.value)}
                  className="mt-1 h-8 text-xs" placeholder="Nome do fornecedor" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Subcategoria</Label>
                <Input value={form.subcategory} onChange={e => set("subcategory")(e.target.value)}
                  className="mt-1 h-8 text-xs" placeholder="Ex: INSS, Tarifa..." />
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
                  referenceDate: form.referenceDate, category: form.category,
                  subcategory: form.subcategory || undefined,
                  description: form.description || undefined,
                  amount: form.amount, supplier: form.supplier || undefined,
                  status: form.status,
                  costCenterId: form.costCenterId && form.costCenterId !== "none" ? parseInt(form.costCenterId) : undefined,
                })}
                disabled={!form.amount || !form.category || createMutation.isPending}
                className="w-full"
              >
                {createMutation.isPending ? "Salvando..." : "Salvar Despesa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total do Mês",  value: formatCurrencyCompact(total),   color: "text-red-400",      icon: TrendingDown, sub: "acumulado" },
          { label: "Realizado",     value: formatCurrencyCompact(paid),    color: "text-red-400",      icon: Receipt,      sub: "confirmado" },
          { label: "Pendente",      value: formatCurrencyCompact(pending), color: "text-amber-400",    icon: Calendar,     sub: "a confirmar" },
          { label: "Lançamentos",   value: count,                          color: "text-foreground",   icon: Hash,         sub: "no período" },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className={cn("text-2xl font-bold font-mono", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            Top Categorias — Mês Atual
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5c7099" }} />
              <YAxis tick={{ fontSize: 10, fill: "#5c7099" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="valor" radius={[4,4,0,0]} name="Despesa" opacity={0.85}>
                {chartData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por descrição, fornecedor, categoria..."
        exportFilename="despesas"
        emptyTitle="Nenhuma despesa no período"
        emptyDescription="Registre uma nova despesa usando o botão acima."
        defaultPageSize={25}
        onRowClick={(row) => setSelectedRow(row)}
      />

      <RecordDetail
        open={!!selectedRow}
        record={selectedRow}
        onClose={() => setSelectedRow(null)}
        onEdit={(row) => { setForm({ referenceDate: row.referenceDate?.slice(0,10) ?? "", category: row.category, subcategory: row.subcategory ?? "", description: row.description ?? "", amount: String(row.amount), supplier: row.supplier ?? "", status: row.status, notes: row.notes ?? "", costCenterId: row.costCenterId ? String(row.costCenterId) : "" }); setEditRow(row); }}
        title="Detalhe da Despesa"
        fields={[
          { label: "Data", key: "referenceDate", format: "date" },
          { label: "Categoria", key: "category" },
          { label: "Subcategoria", key: "subcategory" },
          { label: "Descrição", key: "description" },
          { label: "Fornecedor", key: "supplier" },
          { label: "Valor", key: "amount", format: "currency" },
          { label: "Status", key: "status", format: "status" },
        ]}
      />

      {/* Edit Dialog */}
      <Dialog open={editRow !== null} onOpenChange={v => !v && setEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Despesa</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="text-xs text-muted-foreground">Data</Label>
              <Input type="date" value={form.referenceDate} onChange={e => set("referenceDate")(e.target.value)} className="mt-1 h-8 text-xs" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground">Categoria</Label>
                <Select value={form.category} onValueChange={set("category")}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-xs">{CAT_LABELS[c]}</SelectItem>)}</SelectContent>
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
            <div><Label className="text-xs text-muted-foreground">Fornecedor</Label>
              <Input value={form.supplier} onChange={e => set("supplier")(e.target.value)} className="mt-1 h-8 text-xs" /></div>
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
