import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { formatCurrency, formatDate, cn, safeNumber } from "@/lib/utils";
import {
  Search, Unlink, ChevronLeft, ChevronRight,
  Filter, X, AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  sessionId: number;
  prefilledAmount?: number;
  onUnmatch: (bank: any, api: any) => void;
}

/**
 * Visão dedicada de pares conciliados — para auditoria e desconciliação.
 *
 * Permite buscar por descrição/cliente, filtrar por faixa de valor e data,
 * paginar entre os pares e desconciliar diretamente.
 */
export function MatchedPairsAudit({ sessionId, prefilledAmount, onUnmatch }: Props) {
  // ── Filtros ──
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");           // valor "commited" após debounce
  const [amountInput, setAmountInput] = useState(prefilledAmount ? prefilledAmount.toFixed(2) : "");
  const [amount, setAmount] = useState<number | undefined>(prefilledAmount);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [type, setType] = useState<"credit" | "debit" | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Debounce simples — só dispara a busca quando o usuário aperta Enter ou clica Buscar
  const applyFilters = () => {
    setSearch(searchInput.trim());
    const parsed = parseFloat(amountInput.replace(",", "."));
    setAmount(!isNaN(parsed) && parsed > 0 ? parsed : undefined);
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput(""); setSearch("");
    setAmountInput(""); setAmount(undefined);
    setDateFrom(""); setDateTo("");
    setType("");
    setPage(1);
  };

  const hasFilters = !!(search || amount || dateFrom || dateTo || type);

  const { data, isLoading, refetch } = trpc.reconciliation.getMatchedPairs.useQuery(
    {
      sessionId,
      search: search || undefined,
      amount,
      amountTolerance: amount ? 2 : undefined,   // ± R$ 2,00 quando busca por valor
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      type: (type || undefined) as any,
      page,
      pageSize,
    },
    { refetchInterval: 10000 }
  );

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="space-y-3">
      {/* ── Banner explicativo ── */}
      <div className="bg-blue-500/8 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-blue-400">Auditar pares conciliados:</strong> esta visão
          mostra todas as transações que o sistema conciliou. Use os filtros para encontrar
          um par específico e clique em <em>Desconciliar</em> caso identifique um match errado —
          os dois lados voltarão para divergências pendentes para reanálise.
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-card border border-border rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Filtros de busca
          </span>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
              Limpar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {/* Busca textual */}
          <div className="md:col-span-2">
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              Descrição ou cliente
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="ex: GOL COMBUSTIVEIS, PIX RECEBIDO, R$ 14.999..."
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              Valor (± R$ 2,00)
            </label>
            <Input
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="14999.01"
              className="h-8 text-xs font-mono"
            />
          </div>

          {/* Tipo */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              Tipo
            </label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value as any); setPage(1); }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Todos</option>
              <option value="credit">Créditos</option>
              <option value="debit">Débitos</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {/* Data de */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              Data inicial
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
              Data final
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={applyFilters} size="sm" className="h-8 text-xs gap-1.5 w-full">
              <Search className="w-3.5 h-3.5" />
              Buscar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Carregando..." : (
            <>
              <strong className="text-foreground">{totalCount.toLocaleString("pt-BR")}</strong>
              {" "}par{totalCount !== 1 ? "es" : ""} conciliado{totalCount !== 1 ? "s" : ""}
              {hasFilters && " (filtrados)"}
            </>
          )}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground px-2">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Lista de pares ── */}
      {!isLoading && rows.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground bg-card border border-border rounded-xl">
          {hasFilters
            ? "Nenhum par encontrado com esses filtros."
            : "Nenhum par conciliado nesta sessão."}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((pair: any) => (
          <PairCard
            key={`${pair.bank.id}-${pair.api.id}`}
            pair={pair}
            onUnmatch={() => onUnmatch(pair.bank, pair.api)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Cartão de um par conciliado ─────────────────────────────────────────────
function PairCard({ pair, onUnmatch }: { pair: any; onUnmatch: () => void }) {
  const { bank, api, amountDiff, dayDiff } = pair;
  const hasAmountDiff = amountDiff > 0.01;
  const hasDateDiff = Math.abs(dayDiff) > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-3 hover:border-amber-500/30 transition-colors group">
      {/* Header com indicadores e botão de desconciliar */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded uppercase tracking-wider">
            Conciliado
          </span>
          {bank.matchType && (
            <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">
              {bank.matchType}
            </span>
          )}
          {hasAmountDiff && (
            <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
              Δ valor: {formatCurrency(amountDiff)}
            </span>
          )}
          {hasDateDiff && (
            <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
              Δ {Math.abs(dayDiff)} dia{Math.abs(dayDiff) !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={onUnmatch}
          title="Desconciliar este par"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
        >
          <Unlink className="w-3 h-3" />
          Desconciliar
        </button>
      </div>

      {/* Conteúdo: banco | API */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Banco */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Banco</span>
            <span className="text-[9px] text-muted-foreground">{formatDate(bank.transactionDate)}</span>
            {bank.bankName && (
              <span className="text-[9px] text-muted-foreground/60">· {bank.bankName}</span>
            )}
          </div>
          <p className="text-xs text-foreground truncate" title={bank.description}>
            {bank.description || "Sem descrição"}
          </p>
          <div className="flex items-center justify-between">
            {bank.channel && (
              <span className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                {bank.channel}
              </span>
            )}
            <span className={cn(
              "ml-auto font-mono text-sm font-bold",
              bank.type === "credit" ? "text-emerald-400" : "text-red-400"
            )}>
              {bank.type === "debit" ? "−" : ""}{formatCurrency(bank.amount)}
            </span>
          </div>
        </div>

        {/* API */}
        <div className="space-y-1 min-w-0 md:border-l md:border-border md:pl-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">API</span>
            <span className="text-[9px] text-muted-foreground">{formatDate(api.transactionDate)}</span>
          </div>
          <p className="text-xs text-foreground truncate" title={api.clientName || api.description}>
            {api.clientName || api.description || "Sem cliente"}
          </p>
          {api.description && api.clientName && (
            <p className="text-[10px] text-muted-foreground truncate" title={api.description}>
              {api.description}
            </p>
          )}
          <div className="flex items-center justify-between">
            {api.channel && (
              <span className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                {api.channel}
              </span>
            )}
            <span className={cn(
              "ml-auto font-mono text-sm font-bold",
              api.type === "credit" ? "text-emerald-400" : "text-red-400"
            )}>
              {api.type === "debit" ? "−" : ""}{formatCurrency(api.amount)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
