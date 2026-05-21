import { trpc } from "@/lib/trpc";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { formatCurrency, formatDate, safeNumber } from "@/lib/utils";
import { useState } from "react";
import {
  Plus, CreditCard, TrendingUp, AlertTriangle, CheckCircle,
  Users, Trash2, ChevronDown, ChevronUp, DollarSign, Calendar,
  X, Percent, Edit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  ativo: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  atrasado: "text-red-400 bg-red-500/10 border-red-500/30",
  quitado: "text-gray-400 bg-gray-500/10 border-gray-500/30",
  renegociado: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
};

function PayInstallmentModal({ inst, clientName, onConfirm, onClose }: {
  inst: any;
  clientName?: string;
  onConfirm: (data: {
    paidDate: string; paidAmount: string; paidPrincipal: string;
    paidInterest: string; paidPenalty: string; notes: string;
  }) => void;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = String(inst.dueDate ?? "").slice(0, 10);
  const isLate  = dueDate && dueDate < today;

  const [paidDate,      setPaidDate]      = useState(today);
  const [paidPrincipal, setPaidPrincipal] = useState(String(parseFloat(String(inst.principalAmount ?? 0)).toFixed(2)));
  const [paidInterest,  setPaidInterest]  = useState(String(parseFloat(String(inst.interestAmount ?? 0)).toFixed(2)));
  const [paidPenalty,   setPaidPenalty]   = useState("0.00");
  const [notes,         setNotes]         = useState("");
  const [editMode,      setEditMode]      = useState(false);

  const totalCalc = (parseFloat(paidPrincipal) || 0) + (parseFloat(paidInterest) || 0) + (parseFloat(paidPenalty) || 0);
  const origTotal = parseFloat(String(inst.totalAmount ?? 0));
  const diff      = totalCalc - origTotal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="card-premium rounded-2xl p-6 w-full max-w-md space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-bold text-foreground">Registrar Pagamento</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Parcela #{inst.installmentNumber} · {clientName}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {/* Valores calculados originalmente */}
        <div className="bg-accent/10 border border-border rounded-xl p-4 space-y-1.5 text-xs">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Valores calculados (tabela Price)</p>
          <div className="flex justify-between"><span className="text-muted-foreground">Amortização</span><span className="font-mono">{formatCurrency(inst.principalAmount)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Juros</span><span className="font-mono text-emerald-400">{formatCurrency(inst.interestAmount)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1.5 mt-1.5"><span>Total</span><span className="font-mono">{formatCurrency(inst.totalAmount)}</span></div>
          {isLate && (
            <p className="text-[10px] text-yellow-400 mt-1">⚠ Vencimento: {dueDate} — em atraso</p>
          )}
        </div>

        {/* Toggle modo edição */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Valores reais do pagamento</p>
          <button
            onClick={() => setEditMode(!editMode)}
            className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors",
              editMode ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-muted-foreground border-border hover:border-primary/30"
            )}
          >
            {editMode ? "✓ Editando valores" : "Editar valores"}
          </button>
        </div>

        <div className="space-y-3">
          {/* Data */}
          <div>
            <Label className="text-xs">Data do pagamento <span className="text-red-400">*</span></Label>
            <Input type="date" className="mt-1 h-8 text-xs" value={paidDate} onChange={e => setPaidDate(e.target.value)} />
          </div>

          {/* Valores editáveis */}
          {editMode ? (
            <div className="space-y-3 border border-blue-500/20 rounded-xl p-3 bg-blue-500/5">
              <p className="text-[10px] text-blue-400">Edite os valores reais recebidos do cliente</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Amortização (R$)</Label>
                  <Input type="number" step="0.01" className="mt-1 h-8 text-xs font-mono"
                    value={paidPrincipal} onChange={e => setPaidPrincipal(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Juros (R$)</Label>
                  <Input type="number" step="0.01" className="mt-1 h-8 text-xs font-mono text-emerald-400"
                    value={paidInterest} onChange={e => setPaidInterest(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Multa / Mora por atraso (R$)</Label>
                <Input type="number" step="0.01" className="mt-1 h-8 text-xs font-mono text-yellow-400"
                  value={paidPenalty} onChange={e => setPaidPenalty(e.target.value)} />
              </div>
              {/* Total calculado */}
              <div className={cn("flex justify-between items-center text-xs font-bold pt-2 border-t border-border",
                Math.abs(diff) < 0.02 ? "text-emerald-400" : diff > 0 ? "text-yellow-400" : "text-red-400"
              )}>
                <span>Total a registrar</span>
                <span className="font-mono">{formatCurrency(totalCalc)}</span>
              </div>
              {Math.abs(diff) > 0.02 && (
                <p className={cn("text-[10px]", diff > 0 ? "text-yellow-400" : "text-red-400")}>
                  {diff > 0 ? `+${formatCurrency(diff)} acima` : `${formatCurrency(Math.abs(diff))} abaixo`} do valor calculado
                </p>
              )}
            </div>
          ) : (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Valor a registrar</span>
              <span className="text-lg font-bold font-mono text-emerald-400">{formatCurrency(origTotal)}</span>
            </div>
          )}

          {/* Observação */}
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea className="mt-1 text-xs resize-none h-16"
              placeholder="Ex: Pagamento parcial, negociação de desconto nos juros..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="bg-accent/10 rounded-lg p-3 text-[10px] text-muted-foreground space-y-0.5">
          <p>✓ Receita de juros criada automaticamente: {formatCurrency(parseFloat(paidInterest)||0)}</p>
          <p>✓ Receita de amortização criada automaticamente: {formatCurrency(parseFloat(paidPrincipal)||0)}</p>
          {parseFloat(paidPenalty) > 0 && <p>✓ Receita de multa/mora: {formatCurrency(parseFloat(paidPenalty))}</p>}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 text-xs" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            disabled={!paidDate}
            onClick={() => onConfirm({
              paidDate,
              paidAmount: totalCalc.toFixed(2),
              paidPrincipal,
              paidInterest,
              paidPenalty,
              notes,
            })}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Confirmar Pagamento
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CreditPortfolio() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [payingInst, setPayingInst] = useState<any>(null);
  const [form, setForm] = useState({ clientId: "", clientName: "", principal: "", interestRate: "", totalInstallments: "12", startDate: new Date().toISOString().slice(0,10), expectedEndDate: "", fundingSource: "", notes: "" });

  // ── Edição/Exclusão de empréstimo ────────────────────────────────────────
  // O backend já expunha updateLoan e deleteLoan via tRPC mas o frontend
  // não tinha UI para chamar essas mutations. Empréstimos eram efetivamente
  // imutáveis depois de criados — só dava para registrar pagamento de parcela.
  // Adicionado: dialog de edição (status, taxa, notas, fonte) e botão de
  // excluir com confirmação dupla.
  const [editingLoan, setEditingLoan] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    status: "ativo",
    interestRate: "",
    notes: "",
    fundingSource: "",
  });

  const { data: loans, refetch, isLoading } = trpc.controllership.getLoans.useQuery({ status: statusFilter !== "all" ? statusFilter : undefined });
  const { data: summary } = trpc.controllership.getLoanSummary.useQuery();
  const { data: installments, refetch: refetchInst } = trpc.controllership.getCreditInstallments.useQuery(
    { creditId: expanded! },
    { enabled: !!expanded }
  );
  const invalidateAcrossScreens = useInvalidateFinancialData();

  const createMutation = trpc.controllership.createLoan.useMutation({
    onSuccess: () => { toast.success("Crédito criado com parcelas calculadas!"); setNewOpen(false); refetch(); invalidateAcrossScreens(); },
    onError: e => toast.error(e.message),
  });

  const updateLoanMutation = trpc.controllership.updateLoan.useMutation({
    onSuccess: () => {
      toast.success("Empréstimo atualizado.");
      setEditingLoan(null);
      refetch();
      invalidateAcrossScreens();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteLoanMutation = trpc.controllership.deleteLoan.useMutation({
    onSuccess: () => {
      toast.success("Empréstimo removido junto com suas parcelas.");
      refetch();
      if (expanded) setExpanded(null);
      invalidateAcrossScreens();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleEditLoan = (loan: any) => {
    setEditingLoan(loan);
    setEditForm({
      status: String(loan.status ?? "ativo"),
      interestRate: String(loan.interestRate ?? ""),
      notes: String(loan.notes ?? ""),
      fundingSource: String(loan.fundingSource ?? ""),
    });
  };

  const handleDeleteLoan = (loan: any) => {
    // Confirmação dupla porque exclusão é destrutiva — também apaga as parcelas
    // (FK cascade no schema).
    const paid = (((loan.totalInstallments ?? 0) as number) > 0)
      ? `\n\nEsse empréstimo tem ${loan.totalInstallments} parcelas configuradas — todas serão removidas.`
      : "";
    if (!confirm(`Excluir empréstimo de ${loan.clientName} (${formatCurrency(loan.principal)})?${paid}`)) return;
    if (!confirm("Ação IRREVERSÍVEL. Confirmar?")) return;
    deleteLoanMutation.mutate({ id: loan.id });
  };



  const payMutation = trpc.controllership.recordInstallmentPayment.useMutation({
    onSuccess: () => {
      toast.success("Pagamento registrado — receita financeira criada!");
      setPayingInst(null);
      refetch();
      setTimeout(() => refetchInst(), 300); // wait for DB write before re-fetching
      invalidateAcrossScreens();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const loanList = (loans as any[]) ?? [];
  const totalPrincipal = safeNumber((summary as any)?.total ?? 0);
  const activeCount    = (summary as any)?.active ?? 0;
  const totalInterest  = loanList.reduce((s, l) => s + safeNumber(l.interestRate) * safeNumber(l.principal) / 100, 0);
  const overdueCount   = loanList.filter(l => l.status === "atrasado").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carteira de Crédito</h1>
          <p className="text-sm text-muted-foreground mt-1">Empréstimos, parcelas e receitas de juros</p>
        </div>
        <div className="flex gap-2">
          {["all","ativo","atrasado","quitado"].map(s => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} className="text-xs h-8"
              onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
          <Button size="sm" className="text-xs h-8 gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Novo Crédito
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Investido", value: formatCurrency(totalPrincipal), color: "text-blue-400", icon: CreditCard },
          { label: "Créditos Ativos", value: activeCount, color: "text-emerald-400", icon: CheckCircle },
          { label: "Juros Esperados", value: formatCurrency(totalInterest), color: "text-yellow-400", icon: Percent, sub: "mensal" },
          { label: "Em Atraso", value: overdueCount, color: overdueCount > 0 ? "text-red-400" : "text-muted-foreground", icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <div key={label} className="card-premium rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span></div>
            <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Lista de créditos */}
      {isLoading ? <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
      : loanList.length === 0 ? (
        <div className="card-premium rounded-xl p-12 text-center">
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum crédito cadastrado. Clique em "Novo Crédito" para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {loanList.map((loan: any) => {
            const isExp = expanded === loan.id;
            const instList = (installments as any[]) ?? [];
            const paidInst = instList.filter(i => i.status === 'pago').length;
            const pendInst = instList.filter(i => i.status !== 'pago').length;
            const progress = instList.length > 0 ? Math.round((paidInst / instList.length) * 100) : 0;
            const nextDue = instList.filter(i => i.status !== 'pago').sort((a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

            return (
              <div key={loan.id} className="card-premium rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 hover:bg-accent/10">
                  <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onClick={() => setExpanded(isExp ? null : loan.id)}>
                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{loan.clientName}</p>
                      <p className="text-[10px] text-muted-foreground">{loan.clientId} · Taxa {loan.interestRate}% a.m.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right cursor-pointer" onClick={() => setExpanded(isExp ? null : loan.id)}>
                      <p className="text-sm font-bold font-mono text-blue-400">{formatCurrency(loan.principal)}</p>
                      <p className="text-[10px] text-muted-foreground">{loan.totalInstallments}x parcelas</p>
                    </div>
                    {nextDue && (
                      <div className="text-right hidden md:block cursor-pointer" onClick={() => setExpanded(isExp ? null : loan.id)}>
                        <p className="text-xs text-muted-foreground">Próximo venc.</p>
                        <p className="text-xs font-mono text-yellow-400">{formatDate(nextDue.dueDate)}</p>
                      </div>
                    )}
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", STATUS_COLORS[loan.status] ?? "text-muted-foreground")}>
                      {loan.status}
                    </span>
                    {/* Ações inline: editar / excluir.
                        stopPropagation evita que o click vaze para o handler
                        de expandir/colapsar do card. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditLoan(loan); }}
                      title="Editar empréstimo"
                      className="text-muted-foreground hover:text-foreground transition-colors opacity-60 hover:opacity-100 p-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteLoan(loan); }}
                      title="Excluir empréstimo (também remove parcelas)"
                      className="text-red-400 hover:text-red-300 transition-colors opacity-60 hover:opacity-100 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span className="cursor-pointer" onClick={() => setExpanded(isExp ? null : loan.id)}>
                      {isExp ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </span>
                  </div>
                </div>

                {isExp && (
                  <div className="border-t border-border px-5 py-4 space-y-4">
                    {/* Progress */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{paidInst} parcelas pagas de {instList.length}</span>
                        <span className="text-emerald-400 font-mono">{progress}%</span>
                      </div>
                      <div className="w-full bg-accent/20 rounded-full h-2">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    {/* Parcelas */}
                    {instList.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {["#","Vencimento","Principal","Juros","Total","Status",""].map(h => (
                                <th key={h} className="text-left px-2 py-2 text-muted-foreground font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {instList.map((inst: any) => (
                              <tr key={inst.id} className={cn("hover:bg-accent/10", inst.status === 'pago' && "opacity-60")}>
                                <td className="px-2 py-2 text-muted-foreground">#{inst.installmentNumber}</td>
                                <td className="px-2 py-2 text-muted-foreground">{formatDate(inst.dueDate)}</td>
                                <td className="px-2 py-2 font-mono">{formatCurrency(inst.principalAmount)}</td>
                                <td className="px-2 py-2 font-mono text-emerald-400">{formatCurrency(inst.interestAmount)}</td>
                                <td className="px-2 py-2 font-mono font-bold">{formatCurrency(inst.totalAmount)}</td>
                                <td className="px-2 py-2">
                                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold", inst.status === 'pago' ? "text-gray-400 border-gray-500/30 bg-gray-500/10" : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10")}>
                                    {inst.status === 'pago' ? `Pago ${formatDate(inst.paidDate ?? '')}` : 'Pendente'}
                                  </span>
                                </td>
                                <td className="px-2 py-2">
                                  {inst.status !== 'pago' && (
                                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-emerald-400 border-emerald-500/30"
                                      onClick={() => setPayingInst({ ...inst, creditId: loan.id })}>
                                      Registrar Pgto
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-xs text-muted-foreground">Parcelas não calculadas ainda.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal novo crédito */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="card-premium rounded-2xl p-6 w-full max-w-lg space-y-4 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-foreground">Novo Crédito</h3>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setNewOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "ID do Cliente", key: "clientId", placeholder: "CPF/CNPJ" },
                { label: "Nome do Cliente", key: "clientName", placeholder: "Nome completo" },
                { label: "Valor Principal (R$)", key: "principal", placeholder: "10000.00" },
                { label: "Taxa de Juros (% a.m.)", key: "interestRate", placeholder: "2.5" },
                { label: "Nº de Parcelas", key: "totalInstallments", placeholder: "12" },
                { label: "Data de Início", key: "startDate", type: "date" },
                { label: "Data Prev. Término", key: "expectedEndDate", type: "date" },
                { label: "Fonte dos Recursos", key: "fundingSource", placeholder: "Capital próprio" },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input type={type ?? "text"} className="mt-1 h-8 text-xs" placeholder={placeholder}
                    value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea className="mt-1 text-xs resize-none h-16" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <p className="text-[10px] text-muted-foreground">As parcelas serão calculadas automaticamente pelo sistema de amortização Price.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-xs" onClick={() => setNewOpen(false)}>Cancelar</Button>
              <Button className="flex-1 text-xs" disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ ...form, totalInstallments: parseInt(form.totalInstallments) })}>
                {createMutation.isPending ? "Criando..." : "Criar Crédito"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal registrar pagamento */}
      {payingInst && (
        <PayInstallmentModal
          inst={payingInst}
          clientName={loanList.find((l: any) => l.id === payingInst?.creditId)?.clientName ?? ""}
          onClose={() => setPayingInst(null)}
          onConfirm={(data) => payMutation.mutate({
            installmentId: payingInst.id,
            creditId: payingInst.creditId,
            clientName: loanList.find((l: any) => l.id === payingInst?.creditId)?.clientName,
            ...data,
          })}
        />
      )}

      {/* Dialog de edição do empréstimo.
          Mostra apenas os campos mais úteis para ajuste pós-criação:
          status, taxa de juros (em casos de renegociação), fonte e notas.
          Mudar principal/parcelas após criar gera inconsistência com as
          installments já calculadas — não exponho na UI para evitar foot-gun. */}
      <Dialog open={!!editingLoan} onOpenChange={(o) => !o && setEditingLoan(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Editar Empréstimo {editingLoan && `— ${editingLoan.clientName}`}
            </DialogTitle>
          </DialogHeader>
          {editingLoan && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-accent/5 border border-border p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span className="font-mono">{editingLoan.clientId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span className="font-mono">{formatCurrency(editingLoan.principal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Parcelas</span><span className="font-mono">{editingLoan.totalInstallments}x</span></div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Status</Label>
                <select
                  className="mt-1 w-full h-8 px-2 text-xs rounded-md border border-border bg-background"
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="ativo">Ativo</option>
                  <option value="atrasado">Atrasado</option>
                  <option value="renegociado">Renegociado</option>
                  <option value="quitado">Quitado</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Taxa de Juros (% a.m.)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={editForm.interestRate}
                  onChange={e => setEditForm(f => ({ ...f, interestRate: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                  placeholder={String(editingLoan.interestRate ?? "")}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Mudar a taxa não recalcula parcelas já criadas. Use para refletir
                  renegociação registrada externamente.
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Fonte dos Recursos</Label>
                <Input
                  value={editForm.fundingSource}
                  onChange={e => setEditForm(f => ({ ...f, fundingSource: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                  placeholder="Capital próprio"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Notas</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="mt-1 text-xs resize-none h-20"
                  placeholder="Observações sobre o empréstimo…"
                />
              </div>
              <Button
                onClick={() => updateLoanMutation.mutate({
                  id: editingLoan.id,
                  status: editForm.status,
                  interestRate: editForm.interestRate || undefined,
                  notes: editForm.notes,
                  fundingSource: editForm.fundingSource,
                })}
                disabled={updateLoanMutation.isPending}
                className="w-full"
              >
                {updateLoanMutation.isPending ? "Salvando…" : "Salvar Alterações"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
