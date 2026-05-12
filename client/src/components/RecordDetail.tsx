import { formatCurrency, formatDate, formatDateTime, getStatusLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { X, User, Clock, Calendar, Hash, Edit2 } from "lucide-react";
import { Button } from "./ui/button";

interface RecordDetailProps {
  record: any;
  open: boolean;
  onClose: () => void;
  onEdit?: (record: any) => void;
  title: string;
  fields: { label: string; key: string; format?: "currency" | "date" | "datetime" | "status" | "text" }[];
}

export function RecordDetail({ record, open, onClose, onEdit, title, fields }: RecordDetailProps) {
  if (!open || !record) return null;

  const formatValue = (value: any, format?: string) => {
    if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/40">—</span>;
    switch (format) {
      case "currency": return <span className="font-mono font-semibold text-foreground">{formatCurrency(value)}</span>;
      case "date": return formatDate(value);
      case "datetime": return formatDateTime(value);
      case "status": return <span className="text-xs font-semibold">{getStatusLabel(value)}</span>;
      default: return <span>{String(value)}</span>;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-card border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-1">
            {onEdit && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => { onClose(); setTimeout(() => onEdit(record), 100); }}>
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Fields */}
          <div className="space-y-3">
            {fields.map(({ label, key, format }) => (
              <div key={key} className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
                <span className="text-xs text-muted-foreground shrink-0">{label}</span>
                <span className="text-xs text-right">{formatValue(record[key], format)}</span>
              </div>
            ))}
          </div>

          {/* Audit info */}
          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Auditoria</p>

            {record.createdByName && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Lançado por</p>
                  <p className="text-xs font-semibold text-foreground">{record.createdByName}</p>
                </div>
              </div>
            )}

            {record.createdAt && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="w-7 h-7 rounded-full bg-muted/30 border border-border/40 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Criado em</p>
                  <p className="text-xs font-semibold text-foreground">{formatDateTime(record.createdAt)}</p>
                </div>
              </div>
            )}

            {record.updatedAt && record.updatedAt !== record.createdAt && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="w-7 h-7 rounded-full bg-muted/30 border border-border/40 flex items-center justify-center shrink-0">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Última atualização</p>
                  <p className="text-xs font-semibold text-foreground">{formatDateTime(record.updatedAt)}</p>
                </div>
              </div>
            )}

            {record.id && (
              <div className="flex items-center gap-2 pt-1">
                <Hash className="w-3 h-3 text-muted-foreground/40" />
                <span className="text-[10px] text-muted-foreground/40">ID #{record.id}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
