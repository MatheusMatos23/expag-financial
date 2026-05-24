import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { useState } from "react";
import {
  AlertCircle, Building2, Calendar, CheckCircle2, DollarSign,
  Hash, X, FileSearch, UserCheck, Edit2, Clock, Tag,
  ArrowRight, Search, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function toISO(val: any): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val);
  return s.length >= 10 && s[4] === "-" ? s.slice(0, 10) : s.slice(0, 10);
}

function daysOpen(dateStr: any): number {
  const iso = toISO(dateStr);
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso + "T12:00:00Z").getTime()) / 86400000);
}

// ── NID Detail Sidebar ────────────────────────────────────────────────────────
function NidSidebar({ div, onClose, onUpdate, onUnmark, onResolve, onReconcile }: {
  div: any;
  onClose: () => void;
  onUpdate: (data: { nidNote?: string; nidFoundDate?: string; nidClientName?: string; priority?: string }) => void;
  onUnmark: () => void;
  onResolve: (clientName: string, description: string) => void;
  onReconcile: (targetDivergenceId: number) => void;
}) {
  const [note,        setNote]        = useState(div.nidNote ?? "");
  const [foundDate,   setFoundDate]   = useState(toISO(div.nidFoundDate) ?? "");
  const [clientGuess, setClientGuess] = useState(div.nidClientName ?? div.clientName ?? "");
  const [priority,    setPriority]    = useState(div.priority ?? "high");
  // NID já identificada = tem nidClientName preenchido. Mostra tab "Conciliar".
  const isIdentified = !!div.nidClientName;
  const [tab, setTab] = useState<"info" | "edit" | "resolve" | "reconcile">(
    isIdentified ? "reconcile" : "info"
  );
  const [confirmName, setConfirmName] = useState(div.nidClientName ?? "");
  const [confirmDesc, setConfirmDesc] = useState("");

  // Busca candidatos de conciliação só quando a tab está aberta
  const { data: candidates, isLoading: loadingCandidates } =
    trpc.reconciliation.getNidReconcileCandidates.useQuery(
      { nidId: div.id },
      { enabled: tab === "reconcile" && isIdentified }
    );

  const days = daysOpen(div.divergenceDate);
  const isOld = days > 30;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-[420px] bg-card border-l border-border flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", isOld ? "bg-red-400 animate-pulse" : "bg-orange-400 animate-pulse")} />
            <div>
              <p className="text-sm font-bold text-foreground">NID #{div.id}</p>
              <p className="text-[10px] text-muted-foreground">
                {formatDate(div.divergenceDate)} · <span className={isOld ? "text-red-400 font-semibold" : ""}>{days}d em aberto</span>
                {isOld && " ⚠ vencido"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Value card */}
        <div className="px-5 pt-4 shrink-0">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground">Valor não identificado no banco</p>
            <p className="text-2xl font-bold font-mono text-orange-400">{formatCurrency(div.amount)}</p>
            <div className="flex items-center gap-2 mt-1">
              <Building2 className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">{div.bankName} · entrada sem correspondência na API</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {([
            { key: "info",      label: "Detalhes",   show: true },
            { key: "edit",      label: "Editar NID", show: true },
            { key: "resolve",   label: "Identificar", show: !isIdentified },
            { key: "reconcile", label: "Conciliar",   show: isIdentified },
          ] as const).filter(t => t.show).map(t => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className={cn("flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/20"
              )}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── TAB: INFO ─────────────────────────────────────────────────── */}
          {tab === "info" && (
            <>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: "Banco",      value: div.bankName },
                  { label: "Descrição",  value: div.bankDescription },
                  { label: "Cliente",    value: div.clientName },
                  { label: "END2END",    value: div.externalId ? `...${div.externalId.slice(-16)}` : null, mono: true },
                  { label: "Prioridade", value: div.priority },
                  { label: "Status",     value: div.status },
                ].filter(r => r.value).map(({ label, value, mono }) => (
                  <div key={label} className="flex justify-between items-start gap-4">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className={cn("text-right text-foreground", mono && "font-mono text-[10px]")}>{value}</span>
                  </div>
                ))}
              </div>

              {(div.nidNote || div.nidClientName || div.nidFoundDate) && (
                <div className="bg-accent/10 border border-border rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Investigação NID</p>
                  {div.nidClientName && (
                    <div className="flex items-center gap-2 text-xs">
                      <UserCheck className="w-3 h-3 text-orange-400 shrink-0" />
                      <span className="text-foreground">Suspeito: <strong>{div.nidClientName}</strong></span>
                    </div>
                  )}
                  {div.nidFoundDate && (
                    <div className="flex items-center gap-2 text-xs">
                      <Calendar className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="text-muted-foreground">Encontrado em: <span className="text-foreground">{formatDate(div.nidFoundDate)}</span></span>
                    </div>
                  )}
                  {div.nidNote && (
                    <p className="text-xs text-foreground whitespace-pre-wrap">{div.nidNote}</p>
                  )}
                </div>
              )}

              {/* Connection with reconciliation */}
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] text-blue-400 font-medium">Impacto na Conciliação</p>
                {!isIdentified ? (
                  <>
                    <p className="text-[10px] text-muted-foreground">
                      Este valor está no saldo do banco mas não na API. Permanece como
                      <span className="text-orange-400"> sobra bancária</span> até ser identificado.
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      <strong>Passo 1 — Identificar:</strong> registre de quem é o dinheiro.
                      A NID continua pendente até o pagamento real chegar pela API.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-muted-foreground">
                      NID já identificada — aguardando o pagamento entrar pela API em uma
                      próxima conciliação. Quando entrar, vai aparecer como divergência
                      <span className="text-yellow-400"> falta no banco</span> na aba Divergências.
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      <strong>Passo 2 — Conciliar:</strong> use a aba "Conciliar" para casar
                      esta NID com a divergência da API e regularizar ambas →
                      <span className="text-emerald-400"> matching ↑</span>
                    </p>
                  </>
                )}
              </div>

              {/* Timeline de histórico do NID */}
              <div className="bg-accent/5 border border-border rounded-xl p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Histórico</p>
                <div className="space-y-2 text-[10px] border-l-2 border-border pl-3 ml-1">
                  {/* Criação da divergência */}
                  <div className="relative">
                    <div className="absolute -left-[19px] top-0.5 w-2 h-2 rounded-full bg-muted-foreground" />
                    <p className="text-muted-foreground">
                      <span className="text-foreground font-medium">Divergência criada</span>
                      {div.divergenceDate && ` · ${formatDate(div.divergenceDate)}`}
                      {div.bankName && ` · ${div.bankName}`}
                    </p>
                  </div>
                  {/* Marcado como NID */}
                  <div className="relative">
                    <div className="absolute -left-[19px] top-0.5 w-2 h-2 rounded-full bg-amber-500" />
                    <p className="text-muted-foreground">
                      <span className="text-amber-400 font-medium">Marcado como NID</span>
                      {div.nidMarkedAt && ` · ${formatDate(div.nidMarkedAt)}`}
                    </p>
                  </div>
                  {/* Identificado */}
                  {div.nidClientName && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-0.5 w-2 h-2 rounded-full bg-blue-500" />
                      <p className="text-muted-foreground">
                        <span className="text-blue-400 font-medium">Identificado</span>
                        {div.nidFoundDate && ` · ${formatDate(div.nidFoundDate)}`}
                        {` · `}<span className="text-foreground">{div.nidClientName}</span>
                        {div.responsible && ` · por ${div.responsible}`}
                      </p>
                    </div>
                  )}
                  {/* Conciliado */}
                  {div.nidReconciledAt && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-0.5 w-2 h-2 rounded-full bg-emerald-500" />
                      <p className="text-muted-foreground">
                        <span className="text-emerald-400 font-medium">Conciliado</span>
                        {` · ${formatDate(div.nidReconciledAt)}`}
                        {div.nidReconcileType === 'api_payment' && (
                          <span className="text-blue-400"> · Pagamento API</span>
                        )}
                        {div.nidReconcileType === 'bank_return' && (
                          <span className="text-amber-400"> · Devolução Banco</span>
                        )}
                        {div.nidReconciledWithId && ` · Div. #${div.nidReconciledWithId}`}
                        {div.nidReconciledBy && ` · por ${div.nidReconciledBy}`}
                      </p>
                    </div>
                  )}
                  {/* Pendente */}
                  {!div.nidReconciledAt && div.status !== 'regularizado' && (
                    <div className="relative">
                      <div className="absolute -left-[19px] top-0.5 w-2 h-2 rounded-full bg-muted-foreground/50 animate-pulse" />
                      <p className="text-muted-foreground italic">
                        {isIdentified ? "Aguardando conciliação..." : "Aguardando identificação..."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── TAB: EDIT ─────────────────────────────────────────────────── */}
          {tab === "edit" && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Anotação / Investigação</Label>
                <Textarea
                  className="mt-1.5 text-xs resize-none h-24"
                  placeholder="Detalhes da investigação, suspeitas, contatos realizados..."
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Cliente suspeito (para rastreio)</Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Nome do cliente ou empresa"
                  value={clientGuess}
                  onChange={e => setClientGuess(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Suspeita — não confirma a receita ainda</p>
              </div>
              <div>
                <Label className="text-xs">Data encontrada</Label>
                <Input
                  type="date"
                  className="mt-1.5 h-8 text-xs"
                  value={foundDate}
                  onChange={e => setFoundDate(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Data em que o valor foi localizado no extrato</p>
              </div>
              <div>
                <Label className="text-xs">Prioridade</Label>
                <select
                  className="mt-1.5 w-full text-xs rounded-md border border-border bg-background px-3 py-2"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                >
                  <option value="critical">Crítico — resolver hoje</option>
                  <option value="high">Alta — resolver essa semana</option>
                  <option value="medium">Média</option>
                  <option value="low">Baixa</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 text-xs gap-1.5"
                  onClick={() => onUpdate({ nidNote: note, nidFoundDate: foundDate || undefined, nidClientName: clientGuess || undefined, priority })}
                >
                  <Edit2 className="w-3.5 h-3.5" /> Salvar
                </Button>
                <Button
                  variant="outline"
                  className="text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                  onClick={onUnmark}
                >
                  Remover NID
                </Button>
              </div>
            </div>
          )}

          {/* ── TAB: RESOLVE (identificar — passo 1) ─────────────────────── */}
          {tab === "resolve" && (
            <div className="space-y-4">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-1.5 text-xs">
                <p className="text-blue-400 font-semibold">Passo 1: Identificar de quem é o dinheiro</p>
                <div className="space-y-1 text-muted-foreground">
                  <p>• Registra o cliente/empresa responsável pelo pagamento</p>
                  <p>• A NID continua pendente na lista, mas marcada como identificada</p>
                  <p>• Aguarda o pagamento real chegar pela API em uma próxima conciliação</p>
                  <p>• Quando o pagamento entrar, vai aparecer em Divergências como "falta no banco"</p>
                  <p>• Aí você usa a aba "Conciliar" para casar os dois lados</p>
                </div>
              </div>
              <div>
                <Label className="text-xs">Nome do cliente <span className="text-red-400">*</span></Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Nome do cliente ou empresa"
                  value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Observações sobre a identificação</Label>
                <Input
                  className="mt-1.5 h-8 text-xs"
                  placeholder="Ex: PIX referente a contrato X — período Y"
                  value={confirmDesc}
                  onChange={e => setConfirmDesc(e.target.value)}
                />
              </div>
              <Button
                className="w-full text-xs bg-blue-600 hover:bg-blue-700 gap-1.5"
                disabled={!confirmName.trim()}
                onClick={() => onResolve(confirmName, confirmDesc)}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Registrar identificação
              </Button>
            </div>
          )}

          {/* ── TAB: RECONCILE (conciliar — passo 2) ───────── */}
          {tab === "reconcile" && (
            <div className="space-y-4">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-1.5 text-xs">
                <p className="text-emerald-400 font-semibold">Passo 2: Conciliar com divergência existente</p>
                <p className="text-muted-foreground">
                  Selecione abaixo a divergência que corresponde a esta NID.
                  Pode ser de dois tipos:
                </p>
                <div className="space-y-1 text-muted-foreground mt-1.5">
                  <p>• <span className="text-blue-400 font-medium">Pagamento API</span> — o dinheiro entrou na API dias depois (falta no banco)</p>
                  <p>• <span className="text-amber-400 font-medium">Devolução Banco</span> — o PIX foi devolvido pelo banco (sobra no banco)</p>
                </div>
                <p className="text-muted-foreground mt-1.5">
                  Ao conciliar, ambas saem da aba Divergências e ficam no histórico do NID.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Candidatos (mesmo valor R$ {parseFloat(div.amount).toFixed(2)})
                  </p>
                  {candidates && (
                    <p className="text-[10px] text-muted-foreground">{candidates.length} encontrado{candidates.length !== 1 ? "s" : ""}</p>
                  )}
                </div>

                {loadingCandidates && (
                  <p className="text-xs text-muted-foreground py-4 text-center">Buscando candidatos...</p>
                )}

                {!loadingCandidates && (!candidates || candidates.length === 0) && (
                  <div className="bg-accent/10 border border-border rounded-xl p-4 text-center">
                    <Clock className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      Nenhuma divergência com este valor encontrada ainda.
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Aguarde a próxima conciliação — pode aparecer como pagamento pela API
                      ou como devolução pelo banco.
                    </p>
                  </div>
                )}

                {!loadingCandidates && candidates && candidates.length > 0 && (
                  <div className="space-y-2">
                    {candidates.map((c: any) => {
                      const isReturn = c.reconcileType === 'bank_return';
                      const badgeColor = isReturn
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : "bg-blue-500/10 text-blue-400 border-blue-500/30";
                      const badgeLabel = isReturn ? "Devolução Banco" : "Pagamento API";
                      return (
                        <div key={c.id} className={cn("border rounded-xl p-3 hover:border-emerald-500/30 transition-colors",
                          isReturn ? "border-amber-500/20" : "border-border"
                        )}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs font-mono text-emerald-400">
                                  R$ {parseFloat(String(c.amount)).toFixed(2)}
                                </p>
                                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border", badgeColor)}>
                                  {badgeLabel}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Divergência #{c.id} · Sessão #{c.sessionId} · {formatDate(c.divergenceDate)}
                                {c.bankName && ` · ${c.bankName}`}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 gap-1"
                              onClick={() => onReconcile(c.id)}
                            >
                              <CheckCircle2 className="w-3 h-3" /> Conciliar
                            </Button>
                          </div>
                          {(c.clientName || c.apiDescription || c.bankDescription) && (
                            <div className="text-[10px] text-muted-foreground space-y-0.5">
                              {c.clientName && (<p><strong className="text-foreground">{c.clientName}</strong></p>)}
                              {c.apiDescription && (<p className="truncate">API: {c.apiDescription}</p>)}
                              {isReturn && c.bankDescription && (<p className="truncate">Banco: {c.bankDescription}</p>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NID() {
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: rawData, refetch, isLoading } = trpc.reconciliation.getNidDivergences.useQuery(
    undefined, { refetchInterval: 15000 }
  );
  const invalidateAcrossScreens = useInvalidateFinancialData();

  const updateMutation = trpc.reconciliation.updateNid.useMutation({
    onSuccess: () => { toast.success("NID atualizado."); refetch(); setSelected((s: any) => s ? { ...s, _refresh: Date.now() } : s); invalidateAcrossScreens(); },
    onError: (e: any) => toast.error(e.message),
  });

  const unmarkMutation = trpc.reconciliation.unmarkNid.useMutation({
    onSuccess: () => { toast.success("NID removido."); setSelected(null); refetch(); invalidateAcrossScreens(); },
    onError: (e: any) => toast.error(e.message),
  });

  const resolveNidMutation = trpc.reconciliation.resolveNid.useMutation({
    onSuccess: () => {
      toast.success("NID identificada — aguardando o pagamento entrar pela API");
      // Não fecha o sidebar — usuário pode ir direto pra tab Conciliar se quiser
      refetch();
      setSelected((s: any) => s ? { ...s, _refresh: Date.now() } : s);
      invalidateAcrossScreens();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reconcileNidMutation = trpc.reconciliation.reconcileNidWithDivergence.useMutation({
    onSuccess: () => {
      toast.success("NID conciliada com pagamento — ambas regularizadas!");
      setSelected(null);
      refetch();
      invalidateAcrossScreens();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const items = ((rawData as any) ?? []) as any[];

  // Separar ativos de resolvidos
  const RESOLVED_STATUSES = ['regularizado', 'reclassificado', 'baixado'];
  const [statusFilter, setStatusFilter] = useState<"active" | "resolved" | "all">("active");

  const filtered = items.filter(d => {
    const s = search.toLowerCase();
    const matchSearch = !s || [d.bankDescription, d.clientName, d.bankName, d.externalId, d.nidNote, d.nidClientName]
      .some((v: any) => v && String(v).toLowerCase().includes(s));
    const matchPriority = priorityFilter === "all" || d.priority === priorityFilter;
    const isResolved = RESOLVED_STATUSES.includes(d.status);
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? !isResolved : isResolved);
    return matchSearch && matchPriority && matchStatus;
  });

  const activeCount = items.filter(d => !RESOLVED_STATUSES.includes(d.status)).length;
  const resolvedCount = items.filter(d => RESOLVED_STATUSES.includes(d.status)).length;

  const totalAmount = filtered.reduce((s: number, d: any) => s + parseFloat(String(d.amount ?? 0)), 0);
  const avgDays     = filtered.length > 0 ? Math.round(filtered.reduce((s: number, d: any) => s + daysOpen(d.divergenceDate), 0) / filtered.length) : 0;
  const overdue     = filtered.filter((d: any) => daysOpen(d.divergenceDate) > 30).length;
  const byBank      = filtered.reduce((acc: Record<string, number>, d: any) => { acc[d.bankName ?? "Outro"] = (acc[d.bankName ?? "Outro"] ?? 0) + parseFloat(String(d.amount ?? 0)); return acc; }, {});

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <h1 className="text-2xl font-bold text-foreground">Não Identificados (NID)</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Entradas bancárias sem correspondência na API — aguardando identificação para conciliar
          </p>
        </div>
        <div className="flex gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar banco, descrição, cliente..." className="h-8 text-xs w-52" />
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total NID",       value: `${filtered.length}`,         sub: "divergências",        color: "text-orange-400" },
          { label: "Valor Total",     value: formatCurrency(totalAmount),  sub: "pendente de id.",     color: "text-yellow-400" },
          { label: "Dias Médios",     value: `${avgDays}d`,                sub: "em investigação",     color: avgDays > 30 ? "text-red-400" : "text-muted-foreground" },
          { label: "Vencidos +30d",  value: `${overdue}`,                 sub: "requerem atenção",    color: overdue > 0 ? "text-red-400" : "text-emerald-400" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card-premium rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Por banco */}
      {Object.keys(byBank).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(byBank).map(([bank, total]) => (
            <div key={bank} className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3">
              <p className="text-xs font-semibold text-foreground">{bank}</p>
              <p className="text-lg font-bold font-mono text-orange-400">{formatCurrency(total)}</p>
              <p className="text-[10px] text-muted-foreground">{filtered.filter((d: any) => d.bankName === bank).length} entrada{filtered.filter((d: any) => d.bankName === bank).length !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>
      )}

      {/* Status + Priority filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex gap-1">
          {([
            { key: "active",   label: `Pendentes (${activeCount})` },
            { key: "resolved", label: `Histórico (${resolvedCount})` },
            { key: "all",      label: "Todos" },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                statusFilter === f.key
                  ? f.key === "resolved" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "text-muted-foreground border-border hover:border-orange-500/30"
              )}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex gap-1">
          {[
            { key: "all",      label: `Todos` },
            { key: "critical", label: "Crítico" },
            { key: "high",     label: "Alta" },
            { key: "medium",   label: "Média" },
          ].map(f => (
            <button key={f.key} onClick={() => setPriorityFilter(f.key)}
              className={cn("px-3 py-1 text-xs rounded-full border transition-colors",
                priorityFilter === f.key
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "text-muted-foreground border-border hover:border-orange-500/30"
              )}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando NDIs...</div>
      ) : filtered.length === 0 ? (
        <div className="card-premium rounded-xl p-12 text-center">
          <FileSearch className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-sm font-semibold text-foreground">
            {items.length === 0 ? "Nenhum NID registrado" : "Nenhum resultado"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Marque divergências como NID na página de Divergências para acompanhá-las aqui.
          </p>
        </div>
      ) : (
        <div className="card-premium rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-accent/10 border-b border-border">
                  {["Data","Dias","Banco","Descrição","Suspeito","END2END","Valor","Prior.","Status",""].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((d: any) => {
                  const days = daysOpen(d.divergenceDate);
                  const isOld = days > 30;
                  const hasInvestigation = d.nidNote || d.nidClientName || d.nidFoundDate;
                  return (
                    <tr key={d.id}
                      className="hover:bg-accent/10 cursor-pointer transition-colors"
                      onClick={() => setSelected(d)}
                    >
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(d.divergenceDate)}</td>
                      <td className={cn("px-3 py-2.5 font-semibold whitespace-nowrap", isOld ? "text-red-400" : days > 15 ? "text-yellow-400" : "text-muted-foreground")}>{days}d</td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{d.bankName ?? "—"}</td>
                      <td className="px-3 py-2.5 max-w-[160px] truncate text-foreground" title={d.bankDescription ?? ""}>{d.bankDescription ?? "—"}</td>
                      <td className="px-3 py-2.5 max-w-[120px] truncate">
                        {d.nidClientName ? (
                          <span className="text-orange-400 font-medium">{d.nidClientName}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{d.externalId ? `...${d.externalId.slice(-10)}` : "—"}</td>
                      <td className="px-3 py-2.5 font-mono font-bold text-orange-400 whitespace-nowrap">{formatCurrency(d.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold",
                          d.priority === "critical" ? "text-red-400 bg-red-500/10 border-red-500/30" :
                          d.priority === "high" ? "text-orange-400 bg-orange-500/10 border-orange-500/30" :
                          "text-muted-foreground border-border"
                        )}>{d.priority ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          {d.status === 'regularizado' ? (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              {d.nidReconcileType === 'bank_return' ? (
                                <span className="text-[10px] text-amber-400 font-medium">Devolvido</span>
                              ) : d.nidReconcileType === 'api_payment' ? (
                                <span className="text-[10px] text-blue-400 font-medium">Conciliado API</span>
                              ) : (
                                <span className="text-[10px] text-emerald-400 font-medium">Regularizado</span>
                              )}
                            </>
                          ) : (
                            <>
                              {hasInvestigation && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Em investigação" />}
                              {d.nidClientName ? (
                                <span className="text-[10px] text-blue-400 font-medium">Identificado</span>
                              ) : (
                                <span className="text-[10px] text-orange-400">Pendente</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <button className="text-orange-400 hover:text-orange-300" onClick={e => { e.stopPropagation(); setSelected(d); }}>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-accent/5 border-t border-border">
                  <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground font-semibold">Total</td>
                  <td className="px-3 py-2 font-mono font-bold text-orange-400">{formatCurrency(totalAmount)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Sidebar */}
      {selected && (
        <NidSidebar
          div={selected}
          onClose={() => setSelected(null)}
          onUpdate={(data) => { updateMutation.mutate({ id: selected.id, ...data }); }}
          onUnmark={() => unmarkMutation.mutate({ id: selected.id })}
          onResolve={(clientName, description) => resolveNidMutation.mutate({ id: selected.id, clientName, description })}
          onReconcile={(targetDivergenceId) => reconcileNidMutation.mutate({ nidId: selected.id, targetDivergenceId })}
        />
      )}
    </div>
  );
}
