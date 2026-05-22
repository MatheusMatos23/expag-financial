import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useState, useMemo, useRef } from "react";
import {
  Plus, Upload, Edit2, Trash2, Filter, ArrowDownUp, TrendingUp, TrendingDown,
  Repeat, Hash, Calendar, X, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// ── Tipos de operação conhecidos (auto-completar no formulário) ──────────────
// O usuário pode digitar qualquer texto, mas estes aparecem como sugestão
// no select. Em verde = operacional, em azul = neutro (transferência).
const KNOWN_OPERATIONS = [
  "PIX ENVIADO", "PIX RECEBIDO", "TARIFA PIX ENVIADO", "TARIFA PIX RECEBIDO",
  "TED ENVIADA", "TED RECEBIDA", "TARIFA TED",
  "DEPÓSITO POR BOLETO", "TARIFA EMISSÃO DE BOLETO",
  "PAGAMENTO", "TRANSFERÊNCIA RECEBIDA", "TRANSFERÊNCIA ENVIADA",
  "TRANSFERÊNCIA ENTRE CONTAS", "TARIFA TRANSFERÊNCIA ENTRE CONTAS RECEBIDA",
  "ADIANTAMENTO", "AJUSTE DE SALDO", "RECEITA TARIFAS",
];

// ── Períodos de filtro ───────────────────────────────────────────────────────
function getDateRange(period: "day" | "month" | "all") {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  if (period === "day") return { dateFrom: todayISO, dateTo: todayISO };
  if (period === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    return { dateFrom: first, dateTo: todayISO };
  }
  return {};
}

export default function InternalMovements() {
  const [period, setPeriod] = useState<"day" | "month" | "all">("month");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [transferFilter, setTransferFilter] = useState<"all" | "operational" | "transfer">("all");

  const filters = useMemo(() => {
    const range = customRange
      ? { dateFrom: customRange.from, dateTo: customRange.to }
      : getDateRange(period);
    return {
      ...range,
      operationType: typeFilter !== "all" ? typeFilter : undefined,
      isTransfer: transferFilter === "transfer" ? true : transferFilter === "operational" ? false : undefined,
    };
  }, [period, customRange, typeFilter, transferFilter]);

  const { data: list, refetch } = trpc.accounting.listInternalMovements.useQuery(filters);
  const summaryFilters = useMemo(() => ({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  }), [filters.dateFrom, filters.dateTo]);
  const { data: summary, refetch: refetchSummary } = trpc.accounting.getInternalMovementsSummary.useQuery(summaryFilters);

  const reload = () => { refetch(); refetchSummary(); };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = trpc.accounting.createInternalMovement.useMutation({
    onSuccess: () => { toast.success("Movimentação criada"); setFormOpen(false); reload(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.accounting.updateInternalMovement.useMutation({
    onSuccess: () => { toast.success("Movimentação atualizada"); setFormOpen(false); setEditing(null); reload(); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.accounting.deleteInternalMovement.useMutation({
    onSuccess: () => { toast.success("Movimentação excluída"); reload(); },
    onError: (e: any) => toast.error(e.message),
  });
  const importMutation = trpc.accounting.importInternalMovements.useMutation({
    onSuccess: (data: any) => { toast.success(`${data.inserted} movimentação(ões) importada(s)`); reload(); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Form state ────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    movementDate: new Date().toISOString().slice(0, 10),
    operationType: "PIX RECEBIDO",
    processor: "",
    quantity: "1",
    debitAmount: "0",
    creditAmount: "0",
    isTransfer: false,
    notes: "",
  });

  function openCreate() {
    setEditing(null);
    setForm({
      movementDate: new Date().toISOString().slice(0, 10),
      operationType: "PIX RECEBIDO",
      processor: "",
      quantity: "1",
      debitAmount: "0",
      creditAmount: "0",
      isTransfer: false,
      notes: "",
    });
    setFormOpen(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    setForm({
      movementDate: String(row.movementDate).slice(0, 10),
      operationType: row.operationType,
      processor: row.processor ?? "",
      quantity: String(row.quantity ?? 1),
      debitAmount: String(parseFloat(row.debitAmount ?? "0")),
      creditAmount: String(parseFloat(row.creditAmount ?? "0")),
      isTransfer: !!row.isTransfer,
      notes: row.notes ?? "",
    });
    setFormOpen(true);
  }

  function submit() {
    const payload = {
      movementDate: form.movementDate,
      operationType: form.operationType.trim(),
      processor: form.processor.trim() || undefined,
      quantity: parseInt(form.quantity || "1", 10),
      debitAmount: Math.abs(parseFloat(form.debitAmount || "0")),
      creditAmount: Math.abs(parseFloat(form.creditAmount || "0")),
      isTransfer: form.isTransfer,
      notes: form.notes.trim() || undefined,
    };
    if (!payload.operationType) { toast.error("Tipo de operação é obrigatório"); return; }
    if (payload.debitAmount === 0 && payload.creditAmount === 0) {
      toast.error("Informe pelo menos um valor (débito ou crédito)"); return;
    }
    if (editing) updateMutation.mutate({ id: editing.id, ...payload });
    else createMutation.mutate(payload);
  }

  // ── Import file handling ──────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
        const parsed = parseImportRows(rows);
        if (parsed.length === 0) {
          toast.error("Nenhuma linha válida encontrada no arquivo");
          return;
        }
        importMutation.mutate({ rows: parsed });
      } catch (err: any) {
        toast.error(`Erro ao ler arquivo: ${err.message}`);
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Cards por tipo (resumo) ───────────────────────────────────────────────
  const byType = summary?.byType ?? [];
  const totals = summary?.totals ?? {
    operationalCredits: 0, operationalDebits: 0, operationalNet: 0,
    transferCredits: 0, transferDebits: 0, totalQuantity: 0,
  };

  // Lista única de tipos pra filtro
  const allTypes = useMemo(() => {
    const set = new Set<string>(KNOWN_OPERATIONS);
    byType.forEach(b => set.add(b.operationType));
    return Array.from(set).sort();
  }, [byType]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Movimentações Internas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operações na API Expag — apenas visualização.
            Transferências entre contas aparecem mas não somam ao total operacional.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="outline" size="sm" className="h-9 gap-1.5"
            disabled={importMutation.isPending}
            onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" />
            {importMutation.isPending ? "Importando..." : "Importar planilha"}
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            Nova movimentação
          </Button>
        </div>
      </div>

      {/* Filtros de período */}
      <div className="card-premium rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {([
              { key: "day", label: "Hoje" },
              { key: "month", label: "Este mês" },
              { key: "all", label: "Geral" },
            ] as const).map(p => (
              <button key={p.key}
                onClick={() => { setPeriod(p.key); setCustomRange(null); }}
                className={cn("px-3 py-1.5 text-xs rounded-lg transition-colors font-medium",
                  !customRange && period === p.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/20"
                )}>
                {p.label}
              </button>
            ))}
            <div className="ml-2 flex items-center gap-1.5 border-l border-border pl-3">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <Input type="date" className="h-8 w-36 text-xs"
                value={customRange?.from ?? ""}
                onChange={e => setCustomRange(r => ({ from: e.target.value, to: r?.to ?? e.target.value }))}
              />
              <span className="text-muted-foreground text-xs">→</span>
              <Input type="date" className="h-8 w-36 text-xs"
                value={customRange?.to ?? ""}
                onChange={e => setCustomRange(r => ({ from: r?.from ?? e.target.value, to: e.target.value }))}
              />
              {customRange && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => setCustomRange(null)}>
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={transferFilter} onValueChange={v => setTransferFilter(v as any)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                <SelectItem value="operational" className="text-xs">Só operacionais</SelectItem>
                <SelectItem value="transfer" className="text-xs">Só transferências</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos os tipos</SelectItem>
                {allTypes.map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Totais gerais */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KPI
          label="Crédito Operacional"
          value={formatCurrency(totals.operationalCredits)}
          icon={TrendingUp}
          color="text-emerald-400"
        />
        <KPI
          label="Débito Operacional"
          value={formatCurrency(totals.operationalDebits)}
          icon={TrendingDown}
          color="text-red-400"
        />
        <KPI
          label="Líquido Operacional"
          value={formatCurrency(totals.operationalNet)}
          icon={ArrowDownUp}
          color={totals.operationalNet >= 0 ? "text-emerald-400" : "text-red-400"}
          sub={`${totals.totalQuantity.toLocaleString("pt-BR")} transações`}
        />
        <KPI
          label="Transferências (neutras)"
          value={formatCurrency(totals.transferCredits)}
          icon={Repeat}
          color="text-blue-400"
          sub={`R$ ${totals.transferDebits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em débitos`}
        />
      </div>

      {/* Cards por tipo */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          Resumo por tipo de operação
        </h2>
        {byType.length === 0 ? (
          <div className="card-premium rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma movimentação no período. Clique em "Nova movimentação" ou "Importar planilha" para começar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {byType.map((t, i) => (
              <TypeCard key={`${t.operationType}-${t.isTransfer}-${i}`} type={t} />
            ))}
          </div>
        )}
      </div>

      {/* Tabela detalhada */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Hash className="w-3.5 h-3.5 text-muted-foreground" />
          Detalhamento
          {list && <span className="text-xs text-muted-foreground font-normal">— {list.length} linha{list.length !== 1 ? "s" : ""}</span>}
        </h2>
        <div className="card-premium rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Data</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium">Processador</th>
                  <th className="text-right px-4 py-3 font-medium">Qtd</th>
                  <th className="text-right px-4 py-3 font-medium">Débito</th>
                  <th className="text-right px-4 py-3 font-medium">Crédito</th>
                  <th className="text-center px-4 py-3 font-medium">Tipo</th>
                  <th className="text-right px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(!list || list.length === 0) ? (
                  <tr><td colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                    Sem movimentações no período
                  </td></tr>
                ) : list.map((row: any) => (
                  <tr key={row.id} className={cn("border-b border-border/50 hover:bg-accent/10 transition-colors text-xs",
                    row.isTransfer && "bg-blue-500/5"
                  )}>
                    <td className="px-4 py-3">{formatDate(row.movementDate)}</td>
                    <td className="px-4 py-3 font-medium">{row.operationType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.processor ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{Number(row.quantity ?? 1).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-right text-red-400 font-mono">
                      {parseFloat(row.debitAmount) > 0 ? formatCurrency(parseFloat(row.debitAmount)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-mono">
                      {parseFloat(row.creditAmount) > 0 ? formatCurrency(parseFloat(row.creditAmount)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.isTransfer ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
                          <Repeat className="w-3 h-3" /> Neutra
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          Operacional
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(row)}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          onClick={() => {
                            if (confirm(`Excluir movimentação #${row.id}?`)) deleteMutation.mutate({ id: row.id });
                          }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Dialog form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar movimentação" : "Nova movimentação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Data <span className="text-red-400">*</span></Label>
                <Input type="date" className="mt-1.5 h-9 text-xs"
                  value={form.movementDate}
                  onChange={e => setForm({ ...form, movementDate: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Quantidade</Label>
                <Input type="number" min={1} className="mt-1.5 h-9 text-xs"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Tipo de operação <span className="text-red-400">*</span></Label>
              <Input className="mt-1.5 h-9 text-xs" list="op-types"
                placeholder="Ex: PIX RECEBIDO"
                value={form.operationType}
                onChange={e => setForm({ ...form, operationType: e.target.value.toUpperCase() })} />
              <datalist id="op-types">
                {KNOWN_OPERATIONS.map(o => <option key={o} value={o} />)}
              </datalist>
            </div>

            <div>
              <Label className="text-xs">Processador (opcional)</Label>
              <Input className="mt-1.5 h-9 text-xs"
                placeholder="Ex: BANCO DO BRASIL S.A., EXPAG"
                value={form.processor}
                onChange={e => setForm({ ...form, processor: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-red-400">Débito (R$)</Label>
                <Input type="number" step="0.01" min={0} className="mt-1.5 h-9 text-xs"
                  value={form.debitAmount}
                  onChange={e => setForm({ ...form, debitAmount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-emerald-400">Crédito (R$)</Label>
                <Input type="number" step="0.01" min={0} className="mt-1.5 h-9 text-xs"
                  value={form.creditAmount}
                  onChange={e => setForm({ ...form, creditAmount: e.target.value })} />
              </div>
            </div>

            <label className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-xl cursor-pointer">
              <input type="checkbox" className="w-4 h-4"
                checked={form.isTransfer}
                onChange={e => setForm({ ...form, isTransfer: e.target.checked })} />
              <div className="flex-1">
                <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
                  <Repeat className="w-3 h-3" />
                  Transferência entre contas (neutra)
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Marca como movimentação interna — aparece nas listagens mas NÃO soma nem subtrai do total operacional.
                </p>
              </div>
            </label>

            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea className="mt-1.5 text-xs min-h-[60px]"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setEditing(null); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submit}
              disabled={createMutation.isPending || updateMutation.isPending}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ─────────────────────────────────────────────────────────────────────────────

function KPI({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: any; color: string; sub?: string;
}) {
  return (
    <div className="card-premium rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <Icon className={cn("w-4 h-4", color)} />
      </div>
      <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function TypeCard({ type }: { type: any }) {
  const net = type.credit - type.debit;
  return (
    <div className={cn("card-premium rounded-xl p-3 border",
      type.isTransfer ? "border-blue-500/30 bg-blue-500/5" : "border-border"
    )}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-foreground truncate" title={type.operationType}>
          {type.operationType}
        </p>
        {type.isTransfer && (
          <Repeat className="w-3 h-3 text-blue-400 shrink-0" />
        )}
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Crédito</span>
          <span className="text-emerald-400 font-mono">{formatCurrency(type.credit)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Débito</span>
          <span className="text-red-400 font-mono">{formatCurrency(type.debit)}</span>
        </div>
        {!type.isTransfer && (
          <div className="flex justify-between border-t border-border pt-1 mt-1">
            <span className="text-muted-foreground">Líquido</span>
            <span className={cn("font-mono font-semibold", net >= 0 ? "text-emerald-400" : "text-red-400")}>
              {formatCurrency(net)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-muted-foreground text-[10px]">
          <span>{type.quantity.toLocaleString("pt-BR")} transações</span>
          <span>{type.count} lançamento{type.count !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser do arquivo "Extrato Por Operação"
// Formato esperado: COD | PROCESSADOR POR | TIPO DE OPERAÇÃO | QUANTIDADE | DATA | R$ DÉBITO | R$ CRÉDITO
// ─────────────────────────────────────────────────────────────────────────────

function parseImportRows(rows: any[]): Array<{
  movementDate: string;
  operationType: string;
  processor: string | null;
  quantity: number;
  debitAmount: number;
  creditAmount: number;
  isTransfer: boolean;
}> {
  const out: any[] = [];
  for (const r of rows) {
    // Aceita variações de nome de coluna (case-insensitive, com ou sem R$)
    const opType = String(
      r["TIPO DE OPERAÇÃO"] ?? r["TIPO DE OPERACAO"] ?? r["tipo de operação"] ??
      r["Tipo de Operação"] ?? r.operationType ?? ""
    ).trim();
    if (!opType) continue;

    const date = parseDate(r.DATA ?? r.data ?? r.Data ?? r.movementDate);
    if (!date) continue;

    const processor = String(
      r["PROCESSADOR POR"] ?? r["processador por"] ?? r["Processador Por"] ??
      r.processor ?? ""
    ).trim() || null;

    const quantity = Math.max(1, parseInt(String(r.QUANTIDADE ?? r.quantidade ?? r.quantity ?? "1"), 10) || 1);
    const debit = Math.abs(parseFloat(String(r["R$ DÉBITO"] ?? r["R$ DEBITO"] ?? r["r$ débito"] ?? r.debit ?? "0").replace(",", ".")) || 0);
    const credit = Math.abs(parseFloat(String(r["R$ CRÉDITO"] ?? r["R$ CREDITO"] ?? r["r$ crédito"] ?? r.credit ?? "0").replace(",", ".")) || 0);

    // Detecta transferência entre contas automaticamente pelo nome.
    // O usuário pode mudar depois manualmente se necessário.
    const isTransfer = /ENTRE\s+CONTAS/i.test(opType);

    if (debit === 0 && credit === 0) continue; // sem valor, pula

    out.push({
      movementDate: date,
      operationType: opType.toUpperCase(),
      processor,
      quantity,
      debitAmount: debit,
      creditAmount: credit,
      isTransfer,
    });
  }
  return out;
}

function parseDate(raw: any): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // BR DD/MM/YYYY
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Excel serial number (raro com cellDates:true, mas defensivo)
  const num = Number(s);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    const date = new Date((num - 25569) * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}
