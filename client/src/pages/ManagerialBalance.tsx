import { trpc } from "@/lib/trpc";
import { useInvalidateFinancialData } from "@/hooks/useInvalidateFinancialData";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useState } from "react";
import { Wallet, TrendingUp, TrendingDown, Lock, Plus, Trash2, Edit2 , RefreshCw} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function ManagerialBalance() {
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState({ referenceDate: new Date().toISOString().split("T")[0], bankBalance: "", clientBalance: "", committedBalance: "", divergenceBalance: "0", thirdPartyResources: "", futureObligations: "", fundingNeeded: "", openDivergences: "0" });

  const handleEdit = (row: any) => {
    setForm({
      referenceDate: typeof row.referenceDate === "string" ? row.referenceDate.slice(0,10) : new Date(row.referenceDate).toISOString().split("T")[0],
      bankBalance: String(row.bankBalance ?? ""),
      clientBalance: String(row.clientBalance ?? ""),
      committedBalance: String(row.committedBalance ?? ""),
      divergenceBalance: String(row.divergenceBalance ?? "0"),
      thirdPartyResources: String(row.thirdPartyResources ?? ""),
      futureObligations: String(row.futureObligations ?? ""),
      fundingNeeded: String(row.fundingNeeded ?? ""),
      openDivergences: String(row.openDivergences ?? "0"),
    });
    setEditRow(row);
    setOpen(true);
  };

  const { data: latest, refetch: refetchLatest } = trpc.reconciliation.getManagerialBalance.useQuery(undefined, { refetchInterval: 15000 });
  const { data: history, refetch: refetchHistory } = trpc.reconciliation.getManagerialBalanceHistory.useQuery({ days: 30 });
  const invalidateAcrossScreens = useInvalidateFinancialData();
  const upsertMutation = trpc.reconciliation.upsertManagerialBalance.useMutation({
    onSuccess: () => { toast.success("Saldo gerencial atualizado!"); setOpen(false); refetchLatest(); refetchHistory(); setEditRow(null); invalidateAcrossScreens(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.accounting.deleteManagerialBalance.useMutation({
    onSuccess: () => { toast.success("Registro removido."); refetchLatest(); refetchHistory(); invalidateAcrossScreens(); },
    onError: (e) => toast.error(e.message),
  });

  const chartData = (history ?? []).slice().reverse().map((b: any) => ({
    date: new Date(b.referenceDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    banco: parseFloat(b.bankBalance ?? "0"),
    clientes: parseFloat(b.clientBalance ?? "0"),
    caixaReal: parseFloat(b.realCash ?? "0"),
    caixaLivre: parseFloat(b.freeCash ?? "0"),
  }));

  const cards = [
    { label: "Saldo Bancos", value: latest?.bankBalance, icon: Wallet, color: "text-blue-400 bg-blue-500/10 border-blue-500/20", desc: "Custódia total" },
    { label: "Saldo Clientes", value: latest?.clientBalance, icon: TrendingDown, color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", desc: "Obrigação com clientes" },
    { label: "Comprometido", value: latest?.committedBalance, icon: Lock, color: "text-orange-400 bg-orange-500/10 border-orange-500/20", desc: "Reservado/Bloqueado" },
    { label: "Caixa Real", value: latest?.realCash, icon: TrendingUp, color: "text-green-400 bg-green-500/10 border-green-500/20", desc: "Bancos - Clientes - Comprometido" },
    { label: "Caixa Próprio", value: latest?.ownCash, icon: Wallet, color: "text-purple-400 bg-purple-500/10 border-purple-500/20", desc: "Bancos - Clientes" },
    {
      label: "Caixa Livre",
      value: latest?.freeCash,
      icon: parseFloat(String(latest?.freeCash ?? "0")) < 0 ? TrendingDown : TrendingUp,
      color: parseFloat(String(latest?.freeCash ?? "0")) < 0
        ? "text-red-400 bg-red-500/10 border-red-500/20"
        : "text-teal-400 bg-teal-500/10 border-teal-500/20",
      desc: parseFloat(String(latest?.freeCash ?? "0")) < 0
        ? "⚠️ Caixa negativo — atenção"
        : "Disponível para uso",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Saldo Gerencial</h1>
          <p className="text-sm text-muted-foreground mt-1">Caixa Real = Bancos - Clientes - Comprometido ± Divergências</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs mr-2" onClick={() => { refetchLatest(); refetchHistory(); }}><RefreshCw className="w-3.5 h-3.5" /> Atualizar</Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Registrar Saldo</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Registrar Saldo Gerencial</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Data *</Label><Input type="date" value={form.referenceDate} onChange={e => setForm(f => ({ ...f, referenceDate: e.target.value }))} className="mt-1" /></div>
              <div><Label>Saldo Bancos (R$) *</Label><Input type="number" step="0.01" value={form.bankBalance} onChange={e => setForm(f => ({ ...f, bankBalance: e.target.value }))} className="mt-1" /></div>
              <div><Label>Saldo Clientes (R$) *</Label><Input type="number" step="0.01" value={form.clientBalance} onChange={e => setForm(f => ({ ...f, clientBalance: e.target.value }))} className="mt-1" /></div>
              <div><Label>Comprometido (R$) *</Label><Input type="number" step="0.01" value={form.committedBalance} onChange={e => setForm(f => ({ ...f, committedBalance: e.target.value }))} className="mt-1" /></div>
              <div><Label>Divergências (R$)</Label><Input type="number" step="0.01" value={form.divergenceBalance} onChange={e => setForm(f => ({ ...f, divergenceBalance: e.target.value }))} className="mt-1" /></div>
              <div><Label>Recursos de Terceiros (R$)</Label><Input type="number" step="0.01" value={form.thirdPartyResources} onChange={e => setForm(f => ({ ...f, thirdPartyResources: e.target.value }))} className="mt-1" /></div>
              <div><Label>Obrigações Futuras (R$)</Label><Input type="number" step="0.01" value={form.futureObligations} onChange={e => setForm(f => ({ ...f, futureObligations: e.target.value }))} className="mt-1" /></div>
              <Button onClick={() => upsertMutation.mutate({ ...form, openDivergences: parseInt(form.openDivergences) || 0 })} disabled={upsertMutation.isPending} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {latest && (
        <div className="card-premium rounded-xl p-4 text-xs text-muted-foreground">
          Última atualização: {formatDate(latest.referenceDate)} · Divergências abertas: {latest.openDivergences ?? 0}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ label, value, icon: Icon, color, desc }) => (
          <div key={label} className="card-premium rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
              <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
            </div>
            <p className="text-2xl font-bold font-mono text-foreground">{formatCurrency(value)}</p>
            <p className="text-xs text-muted-foreground mt-1">{desc}</p>
          </div>
        ))}
      </div>

      <div className="card-premium rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Evolução de Saldos (30 dias)</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData}>
              <defs>
                {[["banco", "#38bdf8"], ["clientes", "#facc15"], ["caixaReal", "#4ade80"], ["caixaLivre", "#a78bfa"]].map(([k, c]) => (
                  <linearGradient key={k} id={`grad_${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={c} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px", color: "var(--foreground)" }} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Area type="monotone" dataKey="banco" stroke="#38bdf8" fill="url(#grad_banco)" strokeWidth={2} name="Banco" />
              <Area type="monotone" dataKey="clientes" stroke="#facc15" fill="url(#grad_clientes)" strokeWidth={2} name="Clientes" />
              <Area type="monotone" dataKey="caixaReal" stroke="#4ade80" fill="url(#grad_caixaReal)" strokeWidth={2} name="Caixa Real" />
              <Area type="monotone" dataKey="caixaLivre" stroke="#a78bfa" fill="url(#grad_caixaLivre)" strokeWidth={2} name="Caixa Livre" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
            Registre saldos gerenciais para visualizar o histórico.
          </div>
        )}
      </div>

      {/* History table */}
      {(history ?? []).length > 0 && (
        <div className="card-premium rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Histórico de Registros</h3>
          </div>
          <div className="divide-y divide-border">
            {(history as any[]).map((row) => (
              <div key={row.id} className="flex items-center px-5 py-3 gap-4 hover:bg-accent/30 transition-colors">
                <span className="text-xs text-muted-foreground w-20 shrink-0">{formatDate(row.referenceDate)}</span>
                <span className="text-xs font-mono text-blue-400">{formatCurrency(row.bankBalance)}</span>
                <span className="text-xs text-muted-foreground">banco</span>
                <span className="text-xs font-mono text-green-400 ml-4">{formatCurrency(row.realCash)}</span>
                <span className="text-xs text-muted-foreground">caixa real</span>
                <div className="flex items-center gap-1 ml-auto">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => handleEdit(row)}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => { if(confirm("Remover este registro?")) deleteMutation.mutate({ id: row.id }); }}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
