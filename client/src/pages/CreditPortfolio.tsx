import { trpc } from "@/lib/trpc";
import { formatCurrency, formatCurrencyCompact, formatDate, getStatusLabel, safeNumber } from "@/lib/utils";
import { useState } from "react";
import { Plus, CreditCard, TrendingUp, AlertTriangle, CheckCircle, Users, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/data-table/DataTable";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  ativo:        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inadimplente: "bg-red-500/10    text-red-400    border-red-500/20",
  quitado:      "bg-gray-500/10   text-gray-400   border-gray-500/20",
  renegociado:  "bg-amber-500/10  text-amber-400  border-amber-500/20",
  cancelado:    "bg-gray-500/10   text-gray-400   border-gray-500/20",
};

const FUNDING_LABELS: Record<string, string> = {
  capital_proprio: "Capital Próprio",
  uso_custodia: "Custódia",
  externo: "Externo",
};

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-border/40 rounded-full h-1.5 overflow-hidden">
        <div
          className={cn("h-1.5 rounded-full transition-all", pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-sky-400" : "bg-amber-400")}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

const DEFAULT_FORM = {
  clientId: "", clientName: "", principal: "", interestRate: "",
  totalInstallments: "12", startDate: new Date().toISOString().split("T")[0],
  expectedEndDate: "", fundingSource: "capital_proprio", notes: "",
};

export default function CreditPortfolio() {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editRow, setEditRow] = useState<any>(null);
  const set = (k: string) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleEdit = (row: any) => {
    setForm({
      clientId: row.clientId ?? "",
      clientName: row.clientName ?? "",
      principal: String(row.principal ?? ""),
      interestRate: String(Math.round(safeNumber(row.interestRate) * 10000) / 100),
      totalInstallments: String(row.totalInstallments ?? "12"),
      startDate: typeof row.startDate === "string" ? row.startDate.slice(0,10) : new Date(row.startDate).toISOString().split("T")[0],
      expectedEndDate: typeof row.expectedEndDate === "string" ? row.expectedEndDate.slice(0,10) : new Date(row.expectedEndDate).toISOString().split("T")[0],
      fundingSource: row.fundingSource ?? "capital_proprio",
      notes: row.notes ?? "",
    });
    setEditRow(row);
    setOpen(true);
  };

  const { data: loans, refetch, isLoading } = trpc.controllership.getLoans.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });
  const { data: summary } = trpc.controllership.getLoanSummary.useQuery();

  const createMutation = trpc.controllership.createLoan.useMutation({
    onSuccess: () => { toast.success("Operação registrada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });

  const updateLoanMutation = trpc.controllership.updateLoan.useMutation({
    onSuccess: () => { toast.success("Operação atualizada!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });

  const deleteLoanMutation = trpc.controllership.deleteLoan.useMutation({
    onSuccess: () => { toast.success("Operação removida."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = (loans ?? []) as any[];
  const totalPortfolio = safeNumber(summary?.total);
  const activeCount    = safeNumber(summary?.active, 0);
  const totalCount     = safeNumber(summary?.count, 0);
  const defaulted      = rows.filter(l => l.status === "inadimplente");
  const totalDefaulted = defaulted.reduce((s, l) => s + safeNumber(l.outstandingBalance), 0);

  const columns: ColumnDef<any>[] = [
    {
      key: "clientName", header: "Cliente", searchable: true, minWidth: "160px",
      cell: (r) => (
        <div>
          <p className="text-xs font-semibold text-foreground truncate max-w-[180px]">{r.clientName}</p>
          <p className="text-[10px] text-muted-foreground">{r.clientId}</p>
        </div>
      ),
    },
    {
      key: "principal", header: "Principal", sortable: true, align: "right", width: "120px",
      cell: (r) => <span className="font-mono text-xs font-semibold text-foreground">{formatCurrency(r.principal)}</span>,
    },
    {
      key: "outstandingBalance", header: "Saldo Devedor", sortable: true, align: "right", width: "130px",
      cell: (r) => (
        <span className={cn("font-mono text-xs font-bold", safeNumber(r.outstandingBalance) > 0 ? "text-amber-400" : "text-emerald-400")}>
          {formatCurrency(r.outstandingBalance)}
        </span>
      ),
    },
    {
      key: "interestRate", header: "Taxa/mês", sortable: true, align: "right", width: "90px",
      cell: (r) => (
        <span className="font-mono text-xs text-sky-400">
          {(safeNumber(r.interestRate) * 100).toFixed(2)}%
        </span>
      ),
    },
    {
      key: "paidInstallments", header: "Parcelas", width: "140px",
      cell: (r) => (
        <div className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground">{r.paidInstallments ?? 0}/{r.totalInstallments}</p>
          <ProgressBar paid={safeNumber(r.paidInstallments, 0)} total={safeNumber(r.totalInstallments, 1)} />
        </div>
      ),
    },
    {
      key: "startDate", header: "Início", sortable: true, width: "90px",
      cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.startDate)}</span>,
    },
    {
      key: "expectedEndDate", header: "Término", sortable: true, width: "90px",
      cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.expectedEndDate)}</span>,
    },
    {
      key: "fundingSource", header: "Funding", width: "110px",
      cell: (r) => (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">
          {FUNDING_LABELS[r.fundingSource] ?? r.fundingSource}
        </span>
      ),
    },
    {
      key: "status", header: "Status", sortable: true, width: "110px",
      cell: (r) => (
        <span className={cn("inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border", STATUS_STYLES[r.status] ?? STATUS_STYLES.ativo)}>
          {getStatusLabel(r.status)}
        </span>
      ),
    },
    {
      key: "id", header: "Ações", align: "center", width: "80px", searchable: false,
      cell: (r) => (
        <div className="flex items-center justify-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); handleEdit(r); }}>
            <Edit2 className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            onClick={(e) => { e.stopPropagation(); if (confirm("Remover esta operação?")) deleteLoanMutation.mutate({ id: r.id }); }}>
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Carteira de Crédito</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 2 · Controle de empréstimos e operações de crédito</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos</SelectItem>
              <SelectItem value="ativo" className="text-xs">Ativo</SelectItem>
              <SelectItem value="inadimplente" className="text-xs">Inadimplente</SelectItem>
              <SelectItem value="quitado" className="text-xs">Quitado</SelectItem>
              <SelectItem value="renegociado" className="text-xs">Renegociado</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if(!v) { setEditRow(null); setForm(DEFAULT_FORM); } }}>
            <DialogTrigger asChild>
              <Button className="gap-2 shrink-0"><Plus className="w-4 h-4" /> Nova Operação</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editRow ? "Editar Operação de Crédito" : "Registrar Operação de Crédito"}</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Cliente *</Label>
                  <Input value={form.clientName} onChange={e => set("clientName")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Nome completo do cliente" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">ID do Cliente</Label>
                  <Input value={form.clientId} onChange={e => set("clientId")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="CPF / CNPJ / Código interno" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Principal (R$) *</Label>
                    <Input type="number" step="0.01" value={form.principal}
                      onChange={e => set("principal")(e.target.value)} className="mt-1 h-8 text-xs font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Taxa % a.m. *</Label>
                    <Input type="number" step="0.01" placeholder="Ex: 1.8" value={form.interestRate}
                      onChange={e => set("interestRate")(e.target.value)} className="mt-1 h-8 text-xs font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Parcelas *</Label>
                    <Input type="number" min="1" value={form.totalInstallments}
                      onChange={e => set("totalInstallments")(e.target.value)} className="mt-1 h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Funding</Label>
                    <Select value={form.fundingSource} onValueChange={set("fundingSource")}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="capital_proprio" className="text-xs">Capital Próprio</SelectItem>
                        <SelectItem value="uso_custodia" className="text-xs">Custódia</SelectItem>
                        <SelectItem value="externo" className="text-xs">Externo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Data Início *</Label>
                    <Input type="date" value={form.startDate} onChange={e => set("startDate")(e.target.value)} className="mt-1 h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Data Término</Label>
                    <Input type="date" value={form.expectedEndDate} onChange={e => set("expectedEndDate")(e.target.value)} className="mt-1 h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Observações</Label>
                  <Input value={form.notes} onChange={e => set("notes")(e.target.value)}
                    className="mt-1 h-8 text-xs" placeholder="Detalhes da operação..." />
                </div>
                <Button
                  onClick={() => editRow
                    ? updateLoanMutation.mutate({
                        id: editRow.id,
                        principal: form.principal,
                        interestRate: (parseFloat(form.interestRate) / 100).toFixed(4),
                        totalInstallments: parseInt(form.totalInstallments),
                        expectedEndDate: form.expectedEndDate || form.startDate,
                        fundingSource: form.fundingSource,
                        notes: form.notes || undefined,
                      })
                    : createMutation.mutate({
                        clientId: form.clientId || form.clientName,
                        clientName: form.clientName,
                        principal: form.principal,
                        interestRate: (parseFloat(form.interestRate) / 100).toFixed(4),
                        totalInstallments: parseInt(form.totalInstallments),
                        startDate: form.startDate,
                        expectedEndDate: form.expectedEndDate || form.startDate,
                        fundingSource: form.fundingSource,
                        notes: form.notes || undefined,
                      })
                  }
                  disabled={!form.clientName || !form.principal || !form.interestRate || createMutation.isPending || updateLoanMutation.isPending}
                  className="w-full"
                >
                  {(createMutation.isPending || updateLoanMutation.isPending) ? "Salvando..." : editRow ? "Salvar Alterações" : "Registrar Operação"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Carteira Total</span>
            <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{formatCurrencyCompact(totalPortfolio)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">saldo devedor</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Operações Ativas</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-400">{activeCount}</p>
          <p className="text-[10px] text-muted-foreground mt-1">de {totalCount} no total</p>
        </div>
        <div className={cn("border rounded-xl p-4", defaulted.length > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card border-border")}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Inadimplentes</span>
            <AlertTriangle className={cn("w-3.5 h-3.5", defaulted.length > 0 ? "text-red-400" : "text-muted-foreground")} />
          </div>
          <p className={cn("text-2xl font-bold font-mono", defaulted.length > 0 ? "text-red-400" : "text-foreground")}>{defaulted.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{formatCurrencyCompact(totalDefaulted)} em risco</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Clientes</span>
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{totalCount}</p>
          <p className="text-[10px] text-muted-foreground mt-1">operações cadastradas</p>
        </div>
      </div>

      {/* DataTable */}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por cliente, ID..."
        exportFilename="carteira-credito"
        emptyTitle="Nenhuma operação de crédito"
        emptyDescription="Registre uma nova operação usando o botão acima."
        defaultPageSize={25}
        rowClassName={(r) => {
          if (r.status === "inadimplente") return "bg-red-500/5";
          return undefined;
        }}
      />
    </div>
  );
}
