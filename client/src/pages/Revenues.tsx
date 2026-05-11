import { trpc } from "@/lib/trpc";
import {
  formatCurrency, formatCurrencyCompact, formatDate,
  getCurrentMonthRange, getStatusBadge, getStatusLabel, safeNumber,
} from "@/lib/utils";
import { useState } from "react";
import { Plus, TrendingUp, DollarSign, Calendar, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { cn } from "@/lib/utils";

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
const STATUS_LIST = ["previsto", "realizado", "cancelado"];
const TOOLTIP_STYLE = { background:"#0d1528", border:"1px solid #1a2d50", borderRadius:"8px", fontSize:"11px", color:"#e8edf5" };

const DEFAULT_FORM = {
  referenceDate: new Date().toISOString().split("T")[0],
  type: "pix", description: "", amount: "", status: "realizado",
  clientId: "", clientName: "", notes: "",
};

export default function Revenues() {
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const set = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: revenues, refetch, isLoading } = trpc.controllership.getRevenues.useQuery({ dateFrom, dateTo });
  const { data: summary } = trpc.controllership.getRevenueSummary.useQuery({ dateFrom, dateTo });

  const createMutation = trpc.controllership.createRevenue.useMutation({
    onSuccess: () => {
      toast.success("Receita registrada com sucesso!");
      setOpen(false); refetch(); setForm(DEFAULT_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (revenues ?? []) as any[];
  const total = safeNumber(summary?.total);
  const received = safeNumber(summary?.received);
  const pending = safeNumber(summary?.pending);
  const count = safeNumber(summary?.count, 0);

  const chartData = (summary?.byType ?? []).map((r: any) => ({
    name: TYPE_LABELS[r.type] ?? r.type,
    valor: safeNumber(r.total),
  }));

  // ── Columns ──
  const columns: ColumnDef<any>[] = [
    {
      key: "referenceDate", header: "Data", sortable: true, width: "90px",
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.referenceDate)}</span>,
    },
    {
      key: "type", header: "Tipo", sortable: true, width: "110px",
      cell: (r) => (
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded", TYPE_COLORS[r.type] ?? "text-gray-400 bg-gray-500/10")}>
          {TYPE_LABELS[r.type] ?? r.type}
        </span>
      ),
    },
    {
      key: "description", header: "Descrição", searchable: true, minWidth: "160px",
      cell: (r) => (
        <span className="text-xs text-foreground truncate block max-w-[200px]">
          {r.description || <span className="text-muted-foreground/40 italic">—</span>}
        </span>
      ),
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
        <span className="font-mono text-sm font-bold text-emerald-400">
          {formatCurrency(r.amount)}
        </span>
      ),
    },
    {
      key: "status", header: "Status", width: "100px",
      cell: (r) => <span className={getStatusBadge(r.status)}>{getStatusLabel(r.status)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Receitas</h1>
          <p className="text-sm text-muted-foreground mt-1">Camada 2 · Apuração de receitas por tipo e canal</p>
        </div>
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
                    <SelectContent>
                      {REVENUE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={form.status} onValueChange={set("status")}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_LIST.map(s => <SelectItem key={s} value={s} className="text-xs">{getStatusLabel(s)}</SelectItem>)}
                    </SelectContent>
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
                <Label className="text-xs text-muted-foreground">Observações</Label>
                <Textarea value={form.notes} onChange={e => set("notes")(e.target.value)}
                  className="mt-1 text-xs min-h-14 resize-none" rows={2} />
              </div>
              <Button
                onClick={() => createMutation.mutate({
                  referenceDate: form.referenceDate, type: form.type, amount: form.amount,
                  description: form.description || undefined, clientId: form.clientId || undefined,
                  clientName: form.clientName || undefined, status: form.status,
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

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total do Mês",    value: formatCurrencyCompact(total),    color: "text-emerald-400", icon: DollarSign, sub: "acumulado" },
          { label: "Realizado",       value: formatCurrencyCompact(received), color: "text-emerald-400", icon: TrendingUp, sub: "confirmado" },
          { label: "Pendente",        value: formatCurrencyCompact(pending),  color: "text-amber-400",   icon: Calendar,  sub: "a confirmar" },
          { label: "Lançamentos",     value: count,                           color: "text-foreground",  icon: Hash,      sub: "no período" },
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
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Receitas por Tipo — Mês Atual
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5c7099" }} />
              <YAxis tick={{ fontSize: 10, fill: "#5c7099" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="valor" fill="#10b981" radius={[4,4,0,0]} name="Receita" opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
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
      />
    </div>
  );
}
