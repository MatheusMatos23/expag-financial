import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, formatDateTime, getStatusBadge, getStatusLabel, safeNumber } from "@/lib/utils";
import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Upload, Plus, ArrowRight, CheckCircle, AlertTriangle, Clock,
  FileText, X, CloudUpload, Zap, TrendingUp, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

// ─── FILE DROP ZONE ───────────────────────────────────────────────────────────
function FileDropZone({ label, sublabel, file, onFile, accept = ".xlsx,.xls,.csv" }: {
  label: string; sublabel?: string; file: File | null;
  onFile: (f: File) => void; accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "relative border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all duration-200",
        file
          ? "border-emerald-500/50 bg-emerald-500/5"
          : dragging
          ? "border-primary/60 bg-primary/5 scale-[1.01]"
          : "border-border/60 hover:border-border hover:bg-accent/20"
      )}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />

      {file ? (
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-400 truncate">{file.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {(file.size / 1024).toFixed(1)} KB · {label}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onFile(null as any); }}
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
            <CloudUpload className={cn("w-4 h-4", dragging ? "text-primary" : "text-muted-foreground")} />
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">{label}</p>
            {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>}
            <p className="text-[10px] text-muted-foreground/60">Clique ou arraste o arquivo aqui</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PROGRESS STEP ────────────────────────────────────────────────────────────
function ProcessingStep({ step, current, label }: { step: number; current: number; label: string }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
        done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {done ? <CheckCircle className="w-3.5 h-3.5" /> : step}
      </div>
      <span className={cn(
        "text-xs transition-colors",
        done ? "text-emerald-400" : active ? "text-foreground font-medium" : "text-muted-foreground"
      )}>{label}</span>
      {active && (
        <span className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin ml-1" />
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Reconciliation() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().split("T")[0]);
  const [files, setFiles] = useState<Record<string, File | null>>({
    bankCredits: null, bankDebits: null, apiCredits: null, apiDebits: null,
  });

  const { data: sessions, refetch } = trpc.reconciliation.getSessions.useQuery();

  const processMutation = trpc.reconciliation.processExcel.useMutation({
    onSuccess: (data) => {
      setProcessingStep(5);
      toast.success(
        `✓ Conciliação concluída — ${data.matchedCount} conciliados · ${data.divergentCount} divergências · ${data.matchRate}% matching`,
        { duration: 6000 }
      );
      setTimeout(() => {
        setOpen(false);
        setProcessingStep(0);
        refetch();
        setLocation(`/conciliacao/${data.sessionId}`);
      }, 1200);
    },
    onError: (e) => {
      setProcessingStep(0);
      toast.error("Erro ao processar: " + e.message);
    },
  });

  const setFile = (key: string) => (f: File) => setFiles((prev) => ({ ...prev, [key]: f }));
  const allFilesSelected = Object.values(files).every(Boolean);

  const parseExcel = (file: File): Promise<Record<string, unknown>[]> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[]);
      };
      reader.readAsBinaryString(file);
    });

  const handleProcess = async () => {
    if (!allFilesSelected) { toast.error("Selecione todos os 4 arquivos antes de processar."); return; }

    setProcessingStep(1);
    try {
      setProcessingStep(2);
      const [bc, bd, ac, ad] = await Promise.all([
        parseExcel(files.bankCredits!), parseExcel(files.bankDebits!),
        parseExcel(files.apiCredits!),  parseExcel(files.apiDebits!),
      ]);

      setProcessingStep(3);
      await new Promise((r) => setTimeout(r, 400)); // allow UI to update

      setProcessingStep(4);
      await processMutation.mutateAsync({
        referenceDate,
        bankCreditsData: bc,
        bankDebitsData: bd,
        apiCreditsData: ac,
        apiDebitsData: ad,
      });
    } catch (e: any) {
      setProcessingStep(0);
      if (!e.message?.includes("trpc")) toast.error("Erro: " + e.message);
    }
  };

  // Stats from sessions
  const allSessions = (sessions ?? []) as any[];
  const totalMatched  = allSessions.reduce((s, x) => s + safeNumber(x.matchedCount, 0), 0);
  const totalDivergent = allSessions.reduce((s, x) => s + safeNumber(x.divergentCount, 0), 0);
  const avgMatchRate  = allSessions.length > 0
    ? Math.round(allSessions.reduce((s, x) => {
        const total = safeNumber(x.matchedCount, 0) + safeNumber(x.divergentCount, 0);
        return s + (total > 0 ? (safeNumber(x.matchedCount, 0) / total) * 100 : 0);
      }, 0) / allSessions.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Conciliação Financeira</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Motor de matching Banco × API · O(n log n) · Confidence scoring
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { if (!processMutation.isPending) { setOpen(v); if (!v) setProcessingStep(0); } }}>
          <DialogTrigger asChild>
            <Button className="gap-2 shrink-0"><Plus className="w-4 h-4" /> Nova Conciliação</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Nova Conciliação
              </DialogTitle>
            </DialogHeader>

            {processingStep > 0 ? (
              <div className="py-4 space-y-4">
                <p className="text-sm font-medium text-foreground">Processando conciliação...</p>
                <div className="space-y-3">
                  {[
                    "Iniciando sessão",
                    "Lendo arquivos Excel",
                    "Normalizando transações",
                    "Executando motor de matching",
                    "Classificando divergências",
                  ].map((label, i) => (
                    <ProcessingStep key={i} step={i + 1} current={processingStep} label={label} />
                  ))}
                </div>
                {processingStep === 5 && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" /> Conciliação concluída com sucesso!
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Data de Referência
                  </Label>
                  <Input type="date" value={referenceDate}
                    onChange={(e) => setReferenceDate(e.target.value)}
                    className="mt-1.5 h-9" />
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Extratos Bancários
                  </Label>
                  <div className="mt-1.5 space-y-2">
                    <FileDropZone label="Créditos Banco" sublabel="Coluna: data, descricao, valor" file={files.bankCredits} onFile={setFile("bankCredits")} />
                    <FileDropZone label="Débitos Banco" sublabel="Coluna: data, descricao, valor" file={files.bankDebits} onFile={setFile("bankDebits")} />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Extratos da API/Sistema
                  </Label>
                  <div className="mt-1.5 space-y-2">
                    <FileDropZone label="Créditos API" sublabel="Coluna: data, descricao, valor, cliente" file={files.apiCredits} onFile={setFile("apiCredits")} />
                    <FileDropZone label="Débitos API" sublabel="Coluna: data, descricao, valor, cliente" file={files.apiDebits} onFile={setFile("apiDebits")} />
                  </div>
                </div>

                {!allFilesSelected && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    {Object.values(files).filter(Boolean).length}/4 arquivos selecionados
                  </p>
                )}

                <Button
                  onClick={handleProcess}
                  disabled={!allFilesSelected}
                  className="w-full gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Processar Conciliação
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      {allSessions.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: CheckCircle, label: "Total Conciliado", value: totalMatched.toLocaleString("pt-BR"), color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
            { icon: AlertTriangle, label: "Total Divergências", value: totalDivergent.toLocaleString("pt-BR"), color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
            { icon: Activity, label: "Taxa Média Matching", value: `${avgMatchRate}%`, color: avgMatchRate >= 90 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className={cn("border rounded-xl p-4 flex items-center gap-3", color.split(" ").slice(1).join(" "), "bg-card")}>
              <div className={cn("w-9 h-9 rounded-lg border flex items-center justify-center shrink-0", color)}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className={cn("text-xl font-bold font-mono", color.split(" ")[0])}>{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sessions list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Histórico de Conciliações</h2>
          <span className="text-xs text-muted-foreground">{allSessions.length} sessão{allSessions.length !== 1 ? "ões" : ""}</span>
        </div>

        {allSessions.length === 0 ? (
          <div className="p-14 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6 text-muted-foreground opacity-40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Nenhuma conciliação realizada</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Clique em "Nova Conciliação" para começar.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {allSessions.map((s: any) => {
              const total = safeNumber(s.matchedCount, 0) + safeNumber(s.divergentCount, 0);
              const rate  = total > 0 ? Math.round((safeNumber(s.matchedCount, 0) / total) * 100) : 0;
              return (
                <div key={s.id} onClick={() => setLocation(`/conciliacao/${s.id}`)}
                  className="px-5 py-4 flex items-center justify-between hover:bg-accent/20 transition-colors cursor-pointer gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                      s.status === "completed" ? "bg-emerald-500/10 border border-emerald-500/20"
                        : s.status === "processing" ? "bg-sky-500/10 border border-sky-500/20"
                        : "bg-red-500/10 border border-red-500/20"
                    )}>
                      {s.status === "completed" ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                        : s.status === "processing" ? <Clock className="w-4 h-4 text-sky-400" />
                        : <AlertTriangle className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{formatDate(s.referenceDate)}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(s.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-center hidden sm:block">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Conciliados</p>
                      <p className="text-sm font-mono font-bold text-emerald-400">{safeNumber(s.matchedCount, 0)}</p>
                    </div>
                    <div className="text-center hidden sm:block">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Divergências</p>
                      <p className="text-sm font-mono font-bold text-amber-400">{safeNumber(s.divergentCount, 0)}</p>
                    </div>
                    {rate > 0 && (
                      <div className="text-center hidden md:block">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Matching</p>
                        <p className={cn("text-sm font-mono font-bold", rate >= 90 ? "text-emerald-400" : "text-amber-400")}>{rate}%</p>
                      </div>
                    )}
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                      s.status === "completed" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                        : s.status === "processing" ? "text-sky-400 bg-sky-500/10 border-sky-500/20"
                        : "text-red-400 bg-red-500/10 border-red-500/20"
                    )}>
                      {getStatusLabel(s.status)}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
