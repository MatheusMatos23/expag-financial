import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { BarChart3, Plus, Edit2, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const EMPTY_FORM = { referenceMonth: new Date().toISOString().slice(0, 7), grossRevenue: "", financialCosts: "", operationalCosts: "", adminExpenses: "", commercialExpenses: "", taxes: "" };

export default function DRE() {
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: dreList, refetch } = trpc.accounting.getDRE.useQuery({ months: 24 });

  const upsertMutation = trpc.accounting.upsertDRE.useMutation({
    onSuccess: () => { toast.success(editRow ? "DRE atualizado!" : "DRE registrado!"); setOpen(false); refetch(); setForm(EMPTY_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.accounting.deleteDRE.useMutation({
    onSuccess: () => { toast.success("DRE removido."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleEdit = (row: any) => {
    setForm({
      referenceMonth: row.referenceMonth ?? "",
      grossRevenue: row.grossRevenue ? String(row.grossRevenue) : "",
      financialCosts: row.financialCosts ? String(row.financialCosts) : "",
      operationalCosts: row.operationalCosts ? String(row.operationalCosts) : "",
      adminExpenses: row.adminExpenses ? String(row.adminExpenses) : "",
      commercialExpenses: row.commercialExpenses ? String(row.commercialExpenses) : "",
      taxes: row.taxes ? String(row.taxes) : "",
    });
    setEditRow(row);
    setOpen(true);
  };

  const getRows = (dre: any) => [
    { label: "Receita Bruta", value: dre.grossRevenue, type: "revenue" },
    { label: "(-) Custos Financeiros", value: dre.financialCosts, type: "deduction" },
    { label: "Receita Líquida", value: dre.netRevenue, type: "subtotal" },
    { label: "(-) Custos Operacionais", value: dre.operationalCosts, type: "deduction" },
    { label: "(-) Despesas Administrativas", value: dre.adminExpenses, type: "deduction" },
    { label: "(-) Despesas Comerciais", value: dre.commercialExpenses, type: "deduction" },
    { label: "(-) Impostos", value: dre.taxes, type: "deduction" },
    { label: "Resultado Operacional", value: dre.operationalResult, type: "subtotal" },
    { label: "Resultado Financeiro", value: dre.financialResult, type: "subtotal" },
    { label: "Lucro Líquido", value: dre.netProfit, type: dre.netProfit && parseFloat(String(dre.netProfit)) >= 0 ? "positive" : "negative" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">DRE</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 3 · Demonstração de Resultado do Exercício</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditRow(null); setForm(EMPTY_FORM); } }}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Lançar DRE</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editRow ? "Editar DRE" : "Lançar DRE"}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto">
              <div>
                <Label className="text-xs text-muted-foreground">Mês de Referência *</Label>
                <Input type="month" value={form.referenceMonth} onChange={e => setForm(f => ({ ...f, referenceMonth: e.target.value }))} className="mt-1" />
              </div>
              {[
                { key: "grossRevenue", label: "Receita Bruta (R$)" },
                { key: "financialCosts", label: "Custos Financeiros (R$)" },
                { key: "operationalCosts", label: "Custos Operacionais (R$)" },
                { key: "adminExpenses", label: "Despesas Administrativas (R$)" },
                { key: "commercialExpenses", label: "Despesas Comerciais (R$)" },
                { key: "taxes", label: "Impostos (R$)" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input type="number" step="0.01" value={(form as any)[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="mt-1" />
                </div>
              ))}
              <Button
                onClick={() => upsertMutation.mutate({
                  referenceMonth: form.referenceMonth,
                  grossRevenue: form.grossRevenue || undefined,
                  financialCosts: form.financialCosts || undefined,
                  operationalCosts: form.operationalCosts || undefined,
                  adminExpenses: form.adminExpenses || undefined,
                  commercialExpenses: form.commercialExpenses || undefined,
                  taxes: form.taxes || undefined,
                })}
                disabled={!form.referenceMonth || upsertMutation.isPending}
                className="w-full"
              >
                {upsertMutation.isPending ? "Salvando..." : editRow ? "Salvar Alterações" : "Salvar DRE"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(dreList ?? []).length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-sm text-muted-foreground">Nenhum DRE lançado.</p>
          <p className="text-xs text-muted-foreground mt-1">Clique em "Lançar DRE" para registrar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(dreList ?? []).map((dre: any, idx: number) => {
            const isOpen = expanded === idx;
            const rows = getRows(dre);
            const netProfit = parseFloat(String(dre.netProfit ?? 0));
            return (
              <div key={dre.id ?? idx} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">{dre.referenceMonth}</h2>
                    <span className={cn("text-xs font-mono font-semibold", netProfit >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {formatCurrency(netProfit)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                      onClick={() => handleEdit(dre)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                      onClick={() => { if (confirm(`Remover DRE de ${dre.referenceMonth}?`)) deleteMutation.mutate({ id: dre.id }); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                      onClick={() => setExpanded(isOpen ? null : idx)}>
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="divide-y divide-border">
                    {rows.map(({ label, value, type }) => (
                      <div key={label} className={cn("flex items-center justify-between px-6 py-2.5",
                        type === "subtotal" && "bg-accent/20 font-semibold",
                        type === "positive" && "bg-green-500/5 font-bold",
                        type === "negative" && "bg-red-500/5 font-bold",
                      )}>
                        <span className={cn("text-sm",
                          type === "subtotal" ? "text-foreground" :
                          type === "positive" ? "text-green-400" :
                          type === "negative" ? "text-red-400" :
                          type === "revenue" ? "text-foreground" : "text-muted-foreground"
                        )}>{label}</span>
                        <span className={cn("font-mono text-sm",
                          type === "positive" ? "text-green-400" :
                          type === "negative" ? "text-red-400" :
                          type === "subtotal" ? "text-foreground" :
                          type === "revenue" ? "text-green-400" : "text-red-400"
                        )}>{formatCurrency(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
