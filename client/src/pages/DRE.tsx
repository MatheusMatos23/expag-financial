import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { BarChart3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function DRE() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ referenceMonth: new Date().toISOString().slice(0, 7), grossRevenue: "", financialCosts: "", operationalCosts: "", adminExpenses: "", commercialExpenses: "", taxes: "" });

  const { data: dreList, refetch } = trpc.accounting.getDRE.useQuery({ months: 12 });
  const dre = dreList?.[0];
  const upsertMutation = trpc.accounting.upsertDRE.useMutation({
    onSuccess: () => { toast.success("DRE atualizado!"); setOpen(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = dre ? [
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
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">DRE</h1>
          <p className="text-sm text-muted-foreground mt-1">Camada 3 · Demonstração de Resultado do Exercício</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Lançar DRE</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Lançar DRE</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto">
              <div><Label>Mês de Referência *</Label><Input type="month" value={form.referenceMonth} onChange={e => setForm(f => ({ ...f, referenceMonth: e.target.value }))} className="mt-1" /></div>
              {[
                { key: "grossRevenue", label: "Receita Bruta (R$)" },
                { key: "financialCosts", label: "Custos Financeiros (R$)" },
                { key: "operationalCosts", label: "Custos Operacionais (R$)" },
                { key: "adminExpenses", label: "Despesas Administrativas (R$)" },
                { key: "commercialExpenses", label: "Despesas Comerciais (R$)" },
                { key: "taxes", label: "Impostos (R$)" },
              ].map(({ key, label }) => (
                <div key={key}><Label>{label}</Label><Input type="number" step="0.01" value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="mt-1" /></div>
              ))}
              <Button onClick={() => upsertMutation.mutate({ referenceMonth: form.referenceMonth, grossRevenue: form.grossRevenue || undefined, financialCosts: form.financialCosts || undefined, operationalCosts: form.operationalCosts || undefined, adminExpenses: form.adminExpenses || undefined, commercialExpenses: form.commercialExpenses || undefined, taxes: form.taxes || undefined })} disabled={upsertMutation.isPending} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {dre ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">DRE · {dre.referenceMonth}</h2>
          </div>
          <div className="divide-y divide-border">
            {rows.map(({ label, value, type }) => (
              <div key={label} className={`flex items-center justify-between px-6 py-3 ${type === "subtotal" ? "bg-accent/20 font-semibold" : type === "positive" ? "bg-green-500/5 font-bold" : type === "negative" ? "bg-red-500/5 font-bold" : ""}`}>
                <span className={`text-sm ${type === "subtotal" ? "text-foreground" : type === "positive" ? "text-green-400" : type === "negative" ? "text-red-400" : type === "revenue" ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                <span className={`font-mono text-sm ${type === "positive" ? "text-green-400" : type === "negative" ? "text-red-400" : type === "subtotal" ? "text-foreground" : type === "revenue" ? "text-green-400" : "text-red-400"}`}>{formatCurrency(value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="text-sm text-muted-foreground">Nenhum DRE lançado para o mês atual.</p>
          <p className="text-xs text-muted-foreground mt-1">Clique em "Lançar DRE" para registrar.</p>
        </div>
      )}
    </div>
  );
}
