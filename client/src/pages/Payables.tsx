import { trpc } from "@/lib/trpc";
import { formatCurrency, formatCurrencyCompact, formatDate, getStatusLabel, safeNumber } from "@/lib/utils";
import { useState } from "react";
import { Plus, AlertTriangle, CheckCircle, Clock, DollarSign, Trash2, Edit2 , RefreshCw} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { RecordDetail } from "@/components/RecordDetail";
import { cn } from "@/lib/utils";

const CATEGORIES = ["operacional","folha","impostos","tecnologia","infra","juridico","administrativo","marketing","bancaria","outros"];
const CAT_LABELS: Record<string,string> = {
  operacional:"Operacional", folha:"Folha", impostos:"Impostos",
  tecnologia:"Tecnologia", infra:"Infra", juridico:"Jurídico",
  administrativo:"Administrativo", marketing:"Marketing",
  bancaria:"Bancária", outros:"Outros",
};

function StatusBadge({ status, dueDate }: { status: string; dueDate: string }) {
  const today = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);

  if (status === "pago") {
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle className="w-2.5 h-2.5" />Pago</span>;
  }
  if (status === "vencido" || (status === "pendente" && diffDays < 0)) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"><AlertTriangle className="w-2.5 h-2.5" />Vencido</span>;
  }
  if (status === "pendente" && diffDays <= 3) {
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20"><Clock className="w-2.5 h-2.5" />Vence em {diffDays}d</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-400 border-sky-500/20"><Clock className="w-2.5 h-2.5" />Pendente</span>;
}

function DueDateCell({ dueDate, status }: { dueDate: string; status: string }) {
  const today = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  const isOverdue = status !== "pago" && diffDays < 0;
  const isUrgent = status !== "pago" && diffDays >= 0 && diffDays <= 3;

  return (
    <div>
      <span className={cn("text-xs", isOverdue ? "text-red-400 font-semibold" : isUrgent ? "text-amber-400 font-semibold" : "text-muted-foreground")}>
        {formatDate(dueDate)}
      </span>
      {isOverdue && <p className="text-[9px] text-red-400 font-bold uppercase">{Math.abs(diffDays)}d atrasado</p>}
    </div>
  );
}

const DEFAULT_FORM = {
  dueDate: "", description: "", category: "operacional",
  amount: "", supplier: "", recurrent: false, recurrenceDay: "", notes: "",
};

export default function Payables() {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editRow, setEditRow] = useState<any>(null);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const set = (k: string) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const handleEdit = (row: any) => {
    setForm({
      dueDate: typeof row.dueDate === "string" ? row.dueDate.slice(0, 10) : new Date(row.dueDate).toISOString().split("T")[0],
      description: row.description ?? "",
      category: row.category ?? "operacional",
      amount: String(row.amount ?? ""),
      supplier: row.supplier ?? "",
      recurrent: !!row.recurrent,
      recurrenceDay: row.recurrenceDay ? String(row.recurrenceDay) : "",
      notes: row.notes ?? "",
    });
    setEditRow(row);
    setOpen(true);
  };

  const { data: payables, refetch, isLoading } = trpc.controllership.getPayables.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const createMutation = trpc.controllership.createPayable.useMutation({
    onSuccess: () => { toast.success("Conta registrada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.controllership.updatePayable.useMutation({
    onSuccess: () => { toast.success("Conta atualizada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });

  const markPaidMutation = trpc.controllership.markPayablePaid.useMutation({
    onSuccess: () => { toast.success("✓ Marcada como paga!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.controllership.deletePayable.useMutation({
    onSuccess: () => { toast.success("Conta removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = (payables ?? []) as any[];
  const overdue  = rows.filter(p => p.status === "vencido" || (p.status === "pendente" && new Date(p.dueDate) < new Date()));
  const upcoming = rows.filter(p => p.status === "pendente" && new Date(p.dueDate) >= new Date());
  const paid     = rows.filter(p => p.status === "pago");

  const totalOverdue  = overdue.reduce((s, p) => s + safeNumber(p.amount), 0);
  const totalUpcoming = upcoming.reduce((s, p) => s + safeNumber(p.amount), 0);
  const totalPaid     = paid.reduce((s, p) => s + safeNumber(p.amount), 0);
  const total         = rows.reduce((s, p) => s + safeNumber(p.amount), 0);

  const columns: ColumnDef<any>[] = [
    {
      key: "dueDate", header: "Vencimento", sortable: true, width: "110px",
      cell: (r) => <DueDateCell dueDate={r.dueDate} status={r.status} />,
    },
    {
      key: "description", header: "Descrição", searchable: true, minWidth: "160px",
      cell: (r) => <span className="text-xs text-foreground font-medium truncate block max-w-[200px]">{r.description}</span>,
    },
    {
      key: "category", header: "Categoria", sortable: true, width: "120px",
      cell: (r) => (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted/50 text-muted-foreground">
          {CAT_LABELS[r.category] ?? r.category}
        </span>
      ),
    },
    {
      key: "supplier", header: "Fornecedor", searchable: true,
      cell: (r) => r.supplier
        ? <span className="text-xs text-muted-foreground truncate block max-w-[140px]">{r.supplier}</span>
        : <span className="text-muted-foreground/40 text-xs">—</span>,
    },
    {
      key: "amount", header: "Valor", sortable: true, align: "right", width: "120px",
      cell: (r) => (
        <span className={cn("font-mono text-sm font-bold", r.status === "pago" ? "text-muted-foreground" : "text-foreground")}>
          {formatCurrency(r.amount)}
        </span>
      ),
    },
    {
      key: "status", header: "Status", width: "130px",
      cell: (r) => <StatusBadge status={r.status} dueDate={r.dueDate} />,
    },
    {
      key: "id", header: "Ações", align: "center", width: "120px", searchable: false,
      cell: (r) => (
        <div className="flex items-center justify-center gap-1">
          {r.status !== "pago" && (
            <Button size="sm" variant="ghost"
              className="h-6 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={(e) => { e.stopPropagation(); markPaidMutation.mutate({ id: r.id }); }}
              disabled={markPaidMutation.isPending}>
              Pagar
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); handleEdit(r); }}>
            <Edit2 className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            onClick={(e) => { e.stopPropagation(); if(confirm("Remover esta conta?")) deleteMutation.mutate({ id: r.id }); }}>
            <Trash2 className="w-3 h-3" />
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Contas a Pagar</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 2 · Gestão de obrigações financeiras</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos</SelectItem>
              <SelectItem value="pendente" className="text-xs">Pendente</SelectItem>
              <SelectItem value="vencido" className="text-xs">Vencido</SelectItem>
              <SelectItem value="pago" className="text-xs">Pago</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if(!v) { setEditRow(null); setForm(DEFAULT_FORM); } }}>
          <DialogTrigger asChild>
              <Button className="gap-2 shrink-0"><Plus className="w-4 h-4" /> Nova Conta</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editRow ? "Editar Conta a Pagar" : "Registrar Conta a Pagar"}</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Vencimento *</Label>
                  <Input type="date" value={form.dueDate} onChange={e => set("dueDate")(e.target.value)} className="mt-1 h-8 text-xs" />
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
                    <Label className="text-xs text-muted-foreground">Valor (R$) *</Label>
                    <Input type="number" step="0.01" placeholder="0,00" value={form.amount}
                      onChange={e => set("amount")(e.target.value)} className="mt-1 h-8 text-xs font-mono" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Descrição *</Label>
                  <Input value={form.description} onChange={e => set("description")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Descreva a obrigação..." />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Fornecedor</Label>
                  <Input value={form.supplier} onChange={e => set("supplier")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Nome do fornecedor" />
                </div>
                <div className="flex items-center gap-2 py-1">
                  <input type="checkbox" id="recurrent" checked={form.recurrent}
                    onChange={e => set("recurrent")(e.target.checked)}
                    className="w-4 h-4 rounded border-border bg-input" />
                  <Label htmlFor="recurrent" className="text-xs cursor-pointer text-muted-foreground">Recorrente mensalmente</Label>
                </div>
                {form.recurrent && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Dia do Mês</Label>
                    <Input type="number" min="1" max="31" value={form.recurrenceDay}
                      onChange={e => set("recurrenceDay")(e.target.value)} className="mt-1 h-8 text-xs" />
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground">Observações</Label>
                  <Textarea value={form.notes} onChange={e => set("notes")(e.target.value)}
                    className="mt-1 text-xs min-h-14 resize-none" rows={2} />
                </div>
                <Button
                  onClick={() => editRow
                    ? updateMutation.mutate({
                        id: editRow.id, dueDate: form.dueDate, description: form.description,
                        category: form.category, amount: form.amount,
                        supplier: form.supplier || undefined,
                        notes: form.notes || undefined,
                      })
                    : createMutation.mutate({
                        dueDate: form.dueDate, description: form.description,
                        category: form.category, amount: form.amount,
                        supplier: form.supplier || undefined, recurrent: form.recurrent,
                        recurrenceDay: form.recurrenceDay ? parseInt(form.recurrenceDay) : undefined,
                        notes: form.notes || undefined,
                      })
                  }
                  disabled={!form.dueDate || !form.description || !form.amount || createMutation.isPending || updateMutation.isPending}
                  className="w-full"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? "Salvando..." : editRow ? "Salvar Alterações" : "Salvar Conta"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={cn("border rounded-xl p-4", overdue.length > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card border-border")}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Vencido</span>
            <AlertTriangle className={cn("w-3.5 h-3.5", overdue.length > 0 ? "text-red-400" : "text-muted-foreground")} />
          </div>
          <p className={cn("text-2xl font-bold font-mono", overdue.length > 0 ? "text-red-400" : "text-foreground")}>{overdue.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{formatCurrencyCompact(totalOverdue)}</p>
        </div>
        <div className="card-premium rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">A Vencer</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-amber-400">{upcoming.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{formatCurrencyCompact(totalUpcoming)}</p>
        </div>
        <div className="card-premium rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pago</span>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-400">{paid.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{formatCurrencyCompact(totalPaid)}</p>
        </div>
        <div className="card-premium rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total</span>
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{formatCurrencyCompact(total)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{rows.length} obrigações</p>
        </div>
      </div>

      {/* DataTable */}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por descrição, fornecedor, categoria..."
        exportFilename="contas-a-pagar"
        emptyTitle="Nenhuma conta a pagar"
        emptyDescription="Registre uma nova conta usando o botão acima."
        defaultPageSize={25}
        onRowClick={(row) => setSelectedRow(row)}
        rowClassName={(r) => {
          if (r.status === "vencido") return "bg-red-500/5";
          if (r.status === "pendente" && new Date(String(r.dueDate)) < new Date(Date.now() + 3*86400000)) return "bg-amber-500/5";
          return undefined;
        }}
      />

      <RecordDetail
        open={!!selectedRow}
        record={selectedRow}
        onClose={() => setSelectedRow(null)}
        onEdit={(row) => handleEdit(row)}
        title="Detalhe da Conta a Pagar"
        fields={[
          { label: "Vencimento", key: "dueDate", format: "date" },
          { label: "Descrição", key: "description" },
          { label: "Categoria", key: "category" },
          { label: "Fornecedor", key: "supplier" },
          { label: "Valor", key: "amount", format: "currency" },
          { label: "Status", key: "status", format: "status" },
          { label: "Observações", key: "notes" },
          { label: "Pago em", key: "paidDate", format: "date" },
        ]}
      />
    </div>
  );
}
