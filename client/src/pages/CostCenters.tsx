import { trpc } from "@/lib/trpc";
import { formatCurrency, getCurrentMonthRange } from "@/lib/utils";
import { useState } from "react";
import { Plus, Building2, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CC_TYPES = ["receita","despesa_fixa","despesa_variavel","imposto","investimento"];
const TYPE_LABELS: Record<string, string> = {
  receita: "Receita", despesa_fixa: "Despesa Fixa",
  despesa_variavel: "Despesa Variável", imposto: "Imposto", investimento: "Investimento",
};
const TYPE_COLORS: Record<string, string> = {
  receita: "text-green-400 bg-green-500/10 border-green-500/20",
  despesa_fixa: "text-red-400 bg-red-500/10 border-red-500/20",
  despesa_variavel: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  imposto: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  investimento: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

const DEFAULT_FORM = { name: "", type: "despesa_fixa", description: "", budget: "" };

export default function CostCenters() {
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data: costCenters, refetch } = trpc.accounting.getCostCenters.useQuery();
  const { data: summary } = trpc.accounting.getCostCenterSummary.useQuery({ dateFrom, dateTo });

  const handleEdit = (cc: any) => {
    setForm({ name: cc.name ?? "", type: cc.type ?? "despesa_fixa", description: cc.description ?? "", budget: cc.budget ? String(cc.budget) : "" });
    setEditRow(cc);
    setOpen(true);
  };

  const createMutation = trpc.accounting.createCostCenter.useMutation({
    onSuccess: () => { toast.success("Centro de custo criado!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.accounting.updateCostCenter.useMutation({
    onSuccess: () => { toast.success("Centro de custo atualizado!"); setOpen(false); refetch(); setForm(DEFAULT_FORM); setEditRow(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.accounting.deleteCostCenter.useMutation({
    onSuccess: () => { toast.success("Centro de custo removido."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const summaryMap = Object.fromEntries((summary ?? []).map((s: any) => [s.costCenterId, s]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Centros de Custo</h1>
          <p className="text-sm text-muted-foreground mt-1">Categoria 3 · Mapeamento por centro de despesas e receitas</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditRow(null); setForm(DEFAULT_FORM); } }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> Novo Centro</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editRow ? "Editar Centro de Custo" : "Criar Centro de Custo"}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-xs text-muted-foreground">Nome *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Tipo *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CC_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Orçamento Mensal (R$)</Label>
                <Input type="number" step="0.01" value={form.budget}
                  onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} className="mt-1 h-8 text-xs font-mono" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="mt-1 text-xs" rows={2} />
              </div>
              <Button
                onClick={() => editRow
                  ? updateMutation.mutate({ id: editRow.id, ...form, budget: form.budget || undefined })
                  : createMutation.mutate({ name: form.name, type: form.type, description: form.description || undefined })
                }
                disabled={!form.name || createMutation.isPending || updateMutation.isPending}
                className="w-full"
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Salvando..." : editRow ? "Salvar Alterações" : "Criar Centro"}
              </Button>
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
          const s = summaryMap[cc.id];
          const actual = parseFloat(s?.total ?? "0");
          const revenues = parseFloat(s?.totalRevenues ?? "0");
          const exps = parseFloat(s?.totalExpenses ?? "0");
          const budget = parseFloat(cc.budget ?? "0");
          const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
          return (
            <div key={cc.id} className="bg-card border border-border rounded-xl p-5 kpi-card">
              <div className="flex items-start justify-between mb-3 gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">{cc.name}</h3>
                  {cc.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{cc.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", TYPE_COLORS[cc.type] ?? "")}>{TYPE_LABELS[cc.type] ?? cc.type}</span>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => handleEdit(cc)}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => { if (confirm(`Remover "${cc.name}"?`)) deleteMutation.mutate({ id: cc.id }); }}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5 pt-3 border-t border-border/50">
                {revenues > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Receitas</span>
                    <span className="font-mono font-semibold text-emerald-400">{formatCurrency(revenues)}</span>
                  </div>
                )}
                {exps > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Despesas</span>
                    <span className="font-mono font-semibold text-red-400">{formatCurrency(exps)}</span>
                  </div>
                )}
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
                    <div className="bg-border rounded-full h-1.5 mt-1">
                      <div className={cn("h-1.5 rounded-full transition-all", pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-yellow-400" : "bg-primary")}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-right">{pct.toFixed(1)}% do orçamento</p>
                  </>
                )}
                {actual === 0 && budget === 0 && (
                  <p className="text-xs text-muted-foreground/50 text-center py-1">Nenhum lançamento no mês</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
