import { trpc } from "@/lib/trpc";
import { formatCurrency, getCurrentMonthRange } from "@/lib/utils";
import { useState } from "react";
import { Plus, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const CC_TYPES = ["receita", "despesa_fixa", "despesa_variavel", "imposto", "investimento"];

export default function CostCenters() {
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "despesa_fixa", description: "", budget: "" });

  const { data: costCenters, refetch } = trpc.accounting.getCostCenters.useQuery();
  const summary: any[] = [];
  const createMutation = trpc.accounting.createCostCenter.useMutation({
    onSuccess: () => { toast.success("Centro de custo criado!"); setOpen(false); refetch(); setForm({ name: "", type: "despesa_fixa", description: "", budget: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const typeLabels: Record<string, string> = {
    receita: "Receita", despesa_fixa: "Despesa Fixa", despesa_variavel: "Despesa Variável", imposto: "Imposto", investimento: "Investimento",
  };
  const typeColors: Record<string, string> = {
    receita: "text-green-400 bg-green-500/10 border-green-500/20",
    despesa_fixa: "text-red-400 bg-red-500/10 border-red-500/20",
    despesa_variavel: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    imposto: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    investimento: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Centros de Custo</h1>
          <p className="text-sm text-muted-foreground mt-1">Camada 3 · Mapeamento por centro de despesas e receitas</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Novo Centro</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Criar Centro de Custo</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" /></div>
              <div><Label>Tipo *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CC_TYPES.map(t => <SelectItem key={t} value={t}>{typeLabels[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Orçamento Mensal (R$)</Label><Input type="number" step="0.01" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} className="mt-1" /></div>
              <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1 text-xs" rows={2} /></div>
              <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {(costCenters ?? []).length === 0 ? (
          <div className="col-span-3 bg-card border border-border rounded-xl p-12 text-center">
            <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">Nenhum centro de custo criado.</p>
          </div>
        ) : (costCenters ?? []).map((cc: any) => {
          const ccSummary = (summary ?? []).find((s: any) => s.costCenterId === cc.id);
          const actual = parseFloat(ccSummary?.total ?? "0");
          const budget = parseFloat(cc.budget ?? "0");
          const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
          return (
            <div key={cc.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">{cc.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${typeColors[cc.type] ?? ""}`}>{typeLabels[cc.type] ?? cc.type}</span>
              </div>
              {cc.description && <p className="text-xs text-muted-foreground mb-3">{cc.description}</p>}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Realizado</span>
                  <span className="font-mono font-semibold text-foreground">{formatCurrency(actual)}</span>
                </div>
                {budget > 0 && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Orçamento</span>
                      <span className="font-mono text-muted-foreground">{formatCurrency(budget)}</span>
                    </div>
                    <div className="bg-border rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-yellow-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground text-right">{pct.toFixed(1)}% do orçamento</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
