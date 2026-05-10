import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Search, Download,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc" | null;

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  searchable?: boolean;    // Defaults to true for string fields
  cell?: (row: T, index: number) => React.ReactNode;
  width?: string;
  minWidth?: string;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T extends object> {
  data: T[];
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  defaultPageSize?: number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  exportFilename?: string;
  actions?: React.ReactNode;
  compact?: boolean;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

// ─── SORT ICON ────────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === "asc")  return <ChevronUp   className="w-3 h-3 text-primary" />;
  if (dir === "desc") return <ChevronDown className="w-3 h-3 text-primary" />;
  return <ChevronsUpDown className="w-3 h-3 opacity-30 group-hover:opacity-60 transition-opacity" />;
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

function exportToCSV<T extends object>(data: T[], columns: ColumnDef<T>[], filename: string) {
  const headers = columns.map((c) => c.header);
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = (row as Record<string, unknown>)[col.key];
      const str = val === null || val === undefined ? "" : String(val);
      // Escape CSV special chars
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function DataTable<T extends object>({
  data,
  columns,
  searchPlaceholder = "Buscar registros...",
  defaultPageSize = DEFAULT_PAGE_SIZE,
  loading = false,
  emptyTitle = "Nenhum registro encontrado",
  emptyDescription,
  onRowClick,
  rowClassName,
  exportFilename,
  actions,
  compact = false,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const searchableColumns = useMemo(
    () => columns.filter((c) => c.searchable !== false).map((c) => c.key),
    [columns]
  );

  // ── Filter ──
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase().trim();
    return data.filter((row) =>
      searchableColumns.some((key) => {
        const val = (row as Record<string, unknown>)[key];
        return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, search, searchableColumns]);

  // ── Sort ──
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortKey];
      const bVal = (b as Record<string, unknown>)[sortKey];
      const aStr = aVal === null || aVal === undefined ? "" : String(aVal);
      const bStr = bVal === null || bVal === undefined ? "" : String(bVal);
      // Numeric sort
      const aNum = parseFloat(aStr.replace(/[^\d.-]/g, ""));
      const bNum = parseFloat(bStr.replace(/[^\d.-]/g, ""));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }
      // String sort
      return sortDir === "asc"
        ? aStr.localeCompare(bStr, "pt-BR", { sensitivity: "base" })
        : bStr.localeCompare(aStr, "pt-BR", { sensitivity: "base" });
    });
  }, [filtered, sortKey, sortDir]);

  // ── Paginate ──
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safeCurrentPage = Math.min(page, totalPages);

  const pageData = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safeCurrentPage, pageSize]);

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev !== key) {
        setSortDir("asc");
        return key;
      }
      setSortDir((d) => {
        if (d === "asc") return "desc";
        if (d === "desc") { setSortKey(null); return null; }
        return "asc";
      });
      return key;
    });
    setPage(1);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((value: string) => {
    setPageSize(Number(value));
    setPage(1);
  }, []);

  const rowPy = compact ? "py-2" : "py-3";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0 max-w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 h-8 text-xs bg-background"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
            {sorted.length.toLocaleString("pt-BR")} registro{sorted.length !== 1 ? "s" : ""}
            {search && ` de ${data.length.toLocaleString("pt-BR")}`}
          </span>

          {exportFilename && sorted.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground"
              onClick={() => exportToCSV(sorted, columns, exportFilename)}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
          )}

          {actions}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    className={cn(
                      "px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                      col.sortable && "cursor-pointer select-none group hover:text-foreground transition-colors",
                      col.headerClassName
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className={cn(
                      "flex items-center gap-1",
                      col.align === "right" && "justify-end",
                      col.align === "center" && "justify-center",
                    )}>
                      {col.header}
                      {col.sortable && <SortIcon dir={sortKey === col.key ? sortDir : null} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                // Loading skeleton rows
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 ${rowPy}`}>
                        <div
                          className="h-3.5 bg-muted/40 rounded"
                          style={{ width: `${45 + (i * 7 + col.key.charCodeAt(0)) % 40}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-14 text-center">
                    <p className="text-sm font-medium text-muted-foreground">{emptyTitle}</p>
                    {emptyDescription && (
                      <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs mx-auto">
                        {emptyDescription}
                      </p>
                    )}
                  </td>
                </tr>
              ) : pageData.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "transition-colors duration-100",
                    onRowClick && "cursor-pointer hover:bg-muted/20",
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        `px-4 ${rowPy} text-xs`,
                        col.align === "right" && "text-right tabular-nums",
                        col.align === "center" && "text-center",
                        col.className
                      )}
                    >
                      {col.cell
                        ? col.cell(row, idx)
                        : (() => {
                            const val = (row as Record<string, unknown>)[col.key];
                            return val === null || val === undefined ? (
                              <span className="text-muted-foreground/40">—</span>
                            ) : (
                              String(val)
                            );
                          })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {!loading && sorted.length > 0 && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 bg-muted/5 flex-wrap gap-2">
            {/* Page size */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground hidden sm:block">
                Linhas por página:
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={handlePageSizeChange}
              >
                <SelectTrigger className="h-7 w-[58px] text-xs border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Range info */}
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {((safeCurrentPage - 1) * pageSize + 1).toLocaleString("pt-BR")}
              {" – "}
              {Math.min(safeCurrentPage * pageSize, sorted.length).toLocaleString("pt-BR")}
              {" de "}
              {sorted.length.toLocaleString("pt-BR")}
            </span>

            {/* Navigation */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPage(1)}
                disabled={safeCurrentPage === 1}
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>

              <span className="text-[11px] text-muted-foreground px-2 tabular-nums min-w-[60px] text-center">
                {safeCurrentPage} / {totalPages}
              </span>

              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setPage(totalPages)}
                disabled={safeCurrentPage === totalPages}
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
