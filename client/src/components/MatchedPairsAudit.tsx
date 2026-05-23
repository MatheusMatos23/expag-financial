import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import {
  Search, Unlink, ChevronLeft, ChevronRight, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Props {
  sessionId: number;
  prefilledAmount?: number;
  onUnmatch?: (bank: any, api: any) => void;
}

type SortMode = "amount_desc" | "amount_asc" | "date_desc" | "date_asc";

/**
 * Visão dedicada para auditar e desconciliar pares conciliados.
 * Desenho enxuto: tabela com Banco | Vlr Banco | Vlr API | Δ | Desconciliar.
 * Confirmação inline (sem modal) para agilizar desconciliar em sequência.
 */
export function MatchedPairsAudit({ sessionId, prefilledAmount }: Props) {
  // ── Filtros ──
  const [searchInput, setSearchInput] = useState(
    prefilledAmount ? prefilledAmount.toFixed(2) : ""
  );
  const [search, setSearch] = useState(
    prefilledAmount ? prefilledAmount.toFixed(2) : ""
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [bankFilter, setBankFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("amount_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Confirmação inline ── key do par a confirmar, null se nenhum
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Se o search é um número, vira filtro por valor; senão, busca textual
  const parsedAmount = useMemo(() => {
    const cleaned = search.replace(/[R$\s.]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return !isNaN(n) && n > 0 ? n : undefined;
  }, [search]);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const clearAll = () => {
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setBankFilter("");
    setSort("amount_desc");
    setPage(1);
  };

  const hasFilters = !!(search || dateFrom || dateTo || bankFilter);

  const { data, isLoading, refetch } = trpc.reconciliation.getMatchedPairs.useQuery(
    {
      sessionId,
      search: parsedAmount === undefined ? (search || undefined) : undefined,
      amount: parsedAmount,
      amountTolerance: parsedAmount ? 2 : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      bankName: bankFilter || undefined,
      page,
      pageSize: 500,
    },
    { refetchInterval: 15000 }
  );

  const utils = trpc.useUtils();
  const unmatchMutation = trpc.reconciliation.unmatchPair.useMutation({
    onSuccess: () => {
      toast.success("Par desconciliado — os dois lados voltaram para divergências.");
      setConfirmingId(null);
      refetch();
      utils.reconciliation.getSessionStats.invalidate();
      utils.reconciliation.getDivergences.invalidate();
      utils.reconciliation.getSessionTransactions.invalidate();
    },
    onError: (e) => {
      toast.error(e.message);
      setConfirmingId(null);
    },
  });

  // Ordenação no cliente
  const sortedRows = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    switch (sort) {
      case "amount_desc":
        rows.sort((a, b) => parseFloat(b.bank.amount) - parseFloat(a.bank.amount));
        break;
      case "amount_asc":
        rows.sort((a, b) => parseFloat(a.bank.amount) - parseFloat(b.bank.amount));
        break;
      case "date_desc":
        rows.sort((a, b) =>
          new Date(b.bank.transactionDate).getTime() - new Date(a.bank.transactionDate).getTime()
        );
        break;
      case "date_asc":
        rows.sort((a, b) =>
          new Date(a.bank.transactionDate).getTime() - new Date(b.bank.transactionDate).getTime()
        );
        break;
    }
    return rows;
  }, [data?.rows, sort]);

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const pageRows = useMemo(
    () => sortedRows.slice((page - 1) * pageSize, page * pageSize),
    [sortedRows, page]
  );

  // Lista de bancos para o filtro
  const bankOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of (data?.rows ?? [])) {
      if (r.bank.bankName) set.add(r.bank.bankName);
    }
    return Array.from(set).sort();
  }, [data?.rows]);

  return (
    <div className="space-y-3">
      {/* ── Cabeçalho mínimo ── */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-foreground">Pares Conciliados</h2>
        <span className="text-xs text-muted-foreground">
          {isLoading
            ? "carregando..."
            : `${totalRows.toLocaleString("pt-BR")} ${totalRows === 1 ? "par" : "pares"}${hasFilters ? " (filtrados)" : ""}`}
        </span>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-card border border-border rounded-lg p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              onBlur={applySearch}
              placeholder="Buscar descrição, cliente ou valor (ex: 14999.01)"
              className="h-8 pl-7 text-xs"
            />
          </div>

          <select
            value={bankFilter}
            onChange={(e) => { setBankFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
          >
            <option value="">Todos os bancos</option>
            {bankOptions.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[170px]"
          >
            <option value="amount_desc">Maior valor primeiro</option>
            <option value="amount_asc">Menor valor primeiro</option>
            <option value="date_desc">Mais recente primeiro</option>
            <option value="date_asc">Mais antigo primeiro</option>
          </select>

          {hasFilters && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2"
            >
              <X className="w-3 h-3" />
              Limpar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Período:</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-7 text-xs w-36"
          />
          <span className="text-[10px] text-muted-foreground">até</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-7 text-xs w-36"
          />
        </div>
      </div>

      {/* ── Tabela ── */}
      {isLoading ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center text-sm text-muted-foreground">
          Carregando pares...
        </div>
      ) : pageRows.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "Nenhum par encontrado com esses filtros." : "Nenhum par conciliado nesta sessão."}
          </p>
          {hasFilters && (
            <button onClick={clearAll} className="mt-2 text-xs text-primary hover:underline">
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="text-left px-3 py-2 w-24">Data</th>
                  <th className="text-left px-3 py-2 w-28">Banco</th>
                  <th className="text-left px-3 py-2">Descrição</th>
                  <th className="text-left px-3 py-2">Cliente (API)</th>
                  <th className="text-right px-3 py-2 w-32">Vlr Banco</th>
                  <th className="text-right px-3 py-2 w-32">Vlr API</th>
                  <th className="text-right px-3 py-2 w-48">Ação</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((pair: any) => {
                  const key = `${pair.bank.id}-${pair.api.id}`;
                  const isConfirming = confirmingId === key;
                  const isPending = unmatchMutation.isPending && confirmingId === key;
                  return (
                    <tr
                      key={key}
                      className="border-b border-border/40 hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatDate(pair.bank.transactionDate)}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {pair.bank.bankName ?? "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[260px] truncate text-foreground" title={pair.bank.description}>
                        {pair.bank.description ?? "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate text-foreground" title={pair.api.clientName ?? pair.api.description}>
                        {pair.api.clientName ?? pair.api.description ?? "—"}
                      </td>
                      <td className={cn(
                        "px-3 py-2 text-right font-mono whitespace-nowrap",
                        pair.bank.type === "credit" ? "text-emerald-400" : "text-red-400"
                      )}>
                        {pair.bank.type === "debit" ? "−" : ""}{formatCurrency(pair.bank.amount)}
                      </td>
                      <td className={cn(
                        "px-3 py-2 text-right font-mono whitespace-nowrap",
                        pair.api.type === "credit" ? "text-emerald-400" : "text-red-400"
                      )}>
                        {pair.api.type === "debit" ? "−" : ""}{formatCurrency(pair.api.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isConfirming ? (
                          <div className="inline-flex items-center gap-1">
                            <span className="text-[10px] text-amber-400 font-semibold mr-1">Confirmar?</span>
                            <button
                              onClick={() => unmatchMutation.mutate({ bankTransactionId: pair.bank.id })}
                              disabled={isPending}
                              className="px-2 py-1 rounded text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
                            >
                              {isPending ? "..." : "Sim, desfazer"}
                            </button>
                            <button
                              onClick={() => setConfirmingId(null)}
                              disabled={isPending}
                              className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:bg-muted/30 transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingId(key)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                          >
                            <Unlink className="w-3 h-3" />
                            Desconciliar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/10 text-[11px]">
              <span className="text-muted-foreground">
                {totalRows > 0 ? `${((page - 1) * pageSize + 1).toLocaleString("pt-BR")}–${Math.min(page * pageSize, totalRows).toLocaleString("pt-BR")} de ${totalRows.toLocaleString("pt-BR")}` : "0 pares"}
              </span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Linhas:</span>
                  {[25, 50, 100, 200].map(n => (
                    <button key={n}
                      onClick={() => { setPageSize(n); setPage(1); }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        pageSize === n
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/20"
                      }`}
                    >{n}</button>
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2 text-muted-foreground">
                      {page}/{totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
