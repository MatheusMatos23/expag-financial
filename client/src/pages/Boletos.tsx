import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, safeNumber } from "@/lib/utils";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { useState, useMemo } from "react";
import {
  Calendar, DollarSign, TrendingUp, ReceiptText, Edit2, Trash2,
  Save, X, Settings, Info, BarChart3, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── KPI card ────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color = "text-foreground", icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: any;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />}
      </div>
      <p className={cn("text-2xl font-bold font-mono", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ─── Inline editor para apiAmount ────────────────────────────────────────────
function ApiAmountCell({ row, onSave }: {
  row: any;
  onSave: (apiAmount: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(parseFloat(String(row.apiAmount ?? 0))));

  const current = parseFloat(String(row.apiAmount ?? 0));

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(parseFloat(value) || 0); setEditing(false); }
            if (e.key === "Escape") { setValue(String(current)); setEditing(false); }
          }}
          className="h-7 text-xs font-mono w-32"
          autoFocus
        />
        <button
          onClick={() => { onSave(parseFloat(value) || 0); setEditing(false); }}
          className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded"
          title="Salvar"
        >
          <Save className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setValue(String(current)); setEditing(false); }}
          className="p-1 text-muted-foreground hover:bg-muted/30 rounded"
          title="Cancelar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={cn(
        "group flex items-center gap-2 text-left w-full px-1 py-0.5 rounded hover:bg-accent/20 transition-colors",
        current === 0 && "text-muted-foreground/60 italic"
      )}
    >
      <span className="font-mono text-sm">
        {current === 0 ? "Lançar..." : formatCurrency(current)}
      </span>
      <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 text-muted-foreground" />
    </button>
  );
}

// ─── PÁGINA ──────────────────────────────────────────────────────────────────
export default function Boletos() {
  const { data, isLoading, refetch } = trpc.reconciliation.getBoletoDaily.useQuery();
  const [initialOpen, setInitialOpen] = useState(false);
  const [initialValue, setInitialValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<any>(null);

  // Boletos afetam saldos diários e podem virar receitas/despesas — invalida Dashboard.
  const invalidateAcrossScreens = useInvalidateFinancialData();

  const setInitialMutation = trpc.reconciliation.setBoletoInitialBalance.useMutation({
    onSuccess: () => { toast.success("Saldo inicial atualizado."); setInitialOpen(false); refetch(); invalidateAcrossScreens(); },
    onError: (e) => toast.error(e.message),
  });

  const setApiMutation = trpc.reconciliation.setBoletoApiAmount.useMutation({
    onSuccess: () => { toast.success("Saldo API atualizado."); refetch(); invalidateAcrossScreens(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.reconciliation.deleteBoletoEntry.useMutation({
    onSuccess: () => { toast.success("Entrada removida."); setConfirmDelete(null); refetch(); invalidateAcrossScreens(); },
    onError: (e) => toast.error(e.message),
  });

  const initialBalance = data?.initialBalance ?? 0;
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { totalBank: 0, totalApi: 0, currentDifference: initialBalance };

  // Ordenar do mais recente ao mais antigo na tela (mas DB mantém ordem crescente)
  const displayRows = useMemo(() => [...rows].reverse(), [rows]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto py-6 px-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ReceiptText className="w-6 h-6 text-primary" />
            Boletos
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Camada 1 · Compensação diária BB x API — controle do saldo de boletos pagos
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => { setInitialValue(String(initialBalance)); setInitialOpen(true); }}
        >
          <Settings className="w-3.5 h-3.5" />
          Saldo inicial
        </Button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label="Saldo Inicial"
          value={formatCurrency(initialBalance)}
          sub="Configurável"
          color="text-blue-400"
          icon={Wallet}
        />
        <KPI
          label="Total BB (Cobrança)"
          value={formatCurrency(totals.totalBank)}
          sub={`${rows.length} dia(s) registrado(s)`}
          color="text-emerald-400"
          icon={TrendingUp}
        />
        <KPI
          label="Total API (Manual)"
          value={formatCurrency(totals.totalApi)}
          sub="Lançado pelo usuário"
          color="text-purple-400"
          icon={DollarSign}
        />
        <KPI
          label="Diferença Acumulada"
          value={formatCurrency(totals.currentDifference)}
          sub="Saldo sobrante atual"
          color={
            totals.currentDifference > 0 ? "text-amber-400" :
            totals.currentDifference < 0 ? "text-red-400" :
            "text-emerald-400"
          }
          icon={BarChart3}
        />
      </div>

      {/* ── Explicação ── */}
      <div className="bg-blue-500/8 border border-blue-500/25 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-blue-400">Como funciona:</strong> o valor de "cobrança" do BB
          vem agregado (total dos boletos pagos no dia) e é importado das divergências através do
          botão <em>"Mover para Boletos"</em>. Você lança manualmente o saldo API correspondente
          clicando na coluna "Saldo API". A diferença é acumulada dia após dia:{" "}
          <span className="font-mono text-foreground">diferença = diferença anterior + (BB − API)</span>.
        </div>
      </div>

      {/* ── Tabela diária ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            Histórico Diário
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Mostrando do mais recente para o mais antigo · Saldo inicial: {formatCurrency(initialBalance)}
          </p>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : displayRows.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <ReceiptText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">Nenhuma entrada ainda.</p>
            <p className="text-[11px] text-muted-foreground">
              Use o botão <em>"Mover para Boletos"</em> na aba Divergências para começar.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Data</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Saldo BB (Cobrança)</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Saldo API (Manual)</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Diferença</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-16">Ação</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row: any) => {
                  const bank = parseFloat(String(row.bankAmount ?? 0));
                  const api = parseFloat(String(row.apiAmount ?? 0));
                  const diff = parseFloat(String(row.difference ?? 0));
                  const apiPending = api === 0 && bank > 0;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/10 transition-colors",
                        apiPending && "bg-amber-500/5"
                      )}
                    >
                      <td className="px-4 py-2.5 text-xs">
                        <div className="font-mono text-foreground">{formatDate(row.entryDate)}</div>
                        {apiPending && (
                          <span className="text-[9px] text-amber-400 font-semibold">⚠ API pendente</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn(
                          "font-mono text-sm",
                          bank > 0 ? "text-emerald-400 font-semibold" : "text-muted-foreground/40"
                        )}>
                          {bank > 0 ? formatCurrency(bank) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end">
                          <ApiAmountCell
                            row={row}
                            onSave={(v) => setApiMutation.mutate({
                              entryDate: typeof row.entryDate === 'string'
                                ? row.entryDate.slice(0, 10)
                                : new Date(row.entryDate).toISOString().slice(0, 10),
                              apiAmount: v,
                            })}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn(
                          "font-mono text-sm font-bold",
                          diff > 0 ? "text-amber-400" :
                          diff < 0 ? "text-red-400" :
                          "text-emerald-400"
                        )}>
                          {formatCurrency(diff)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setConfirmDelete(row)}
                          title="Excluir entrada (recalcula em cascata)"
                          className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Linha de totais */}
                <tr className="bg-muted/20 border-t-2 border-border">
                  <td className="px-4 py-2.5 text-xs font-bold text-foreground">TOTAIS</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-emerald-400">
                    {formatCurrency(totals.totalBank)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-purple-400">
                    {formatCurrency(totals.totalApi)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-amber-400">
                    {formatCurrency(totals.currentDifference)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════ Dialog: Saldo Inicial ════ */}
      <Dialog open={initialOpen} onOpenChange={setInitialOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/12 border border-blue-500/25 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-blue-400" />
              </div>
              Definir saldo inicial
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              O saldo inicial é o ponto de partida da diferença acumulada. Equivale ao
              "Saldo Inicial" do início da operação. Todas as diferenças serão recalculadas
              em cascata quando você salvar.
            </p>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Valor (R$)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={initialValue}
                onChange={(e) => setInitialValue(e.target.value)}
                placeholder="0,00"
                className="h-10 text-sm font-mono"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setInitialOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={setInitialMutation.isPending}
              onClick={() => setInitialMutation.mutate({ value: parseFloat(initialValue) || 0 })}
            >
              {setInitialMutation.isPending ? "Salvando..." : "Salvar e recalcular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════ Dialog: Confirmar exclusão ════ */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/12 border border-red-500/25 flex items-center justify-center">
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </div>
              Excluir entrada
            </DialogTitle>
          </DialogHeader>
          {confirmDelete && (
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Excluir a entrada do dia <strong className="text-foreground">{formatDate(confirmDelete.entryDate)}</strong>?
                As diferenças dos dias seguintes serão recalculadas automaticamente em cascata.
              </p>
              <div className="bg-muted/20 border border-border rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Saldo BB:</span>
                  <span className="font-mono font-semibold">{formatCurrency(safeNumber(confirmDelete.bankAmount))}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Saldo API:</span>
                  <span className="font-mono font-semibold">{formatCurrency(safeNumber(confirmDelete.apiAmount))}</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-border/40">
                  <span className="text-muted-foreground">Diferença atual:</span>
                  <span className="font-mono font-bold text-amber-400">{formatCurrency(safeNumber(confirmDelete.difference))}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ id: confirmDelete.id })}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir e recalcular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
