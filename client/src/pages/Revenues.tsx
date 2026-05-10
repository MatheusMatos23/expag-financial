import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, getCurrentMonthRange, getStatusBadge, getStatusLabel } from "@/lib/utils";
import { useState } from "react";
import { Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const REVENUE_TYPES = ["pix", "ted", "boleto", "credito", "antecipacao", "pos", "white_label", "receita_financeira", "receita_operacional", "outros"];
const REVENUE_TYPE_LABELS: Record<string, string> = { pix: "PIX", ted: "TED", boleto: "Boleto", credito: "Crédito", antecipacao: "Antecipação", pos: "POS", white_label: "White Label", receita_financeira: "Receita Financeira", receita_operacional: "Receita Operacional", outros: "Outros" };
const STATUS_LIST = ["pendente", "realizado", "cancelado", "estornado"];

export default function Revenues() {
  const { dateFrom, dateTo } = getCurrentMonthRange();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ referenceDate: new Date().toISOString().split("T")[0], type: "pix", description: "", amount: "", status: "realizado", clientId: "", clientName: "", notes: "" });

  const { data: revenues, refetch } = trpc.controllership.getRevenues.useQuery({ dateFrom, dateTo });
  const { data: summary } = trpc.controllership.getRevenueSummary.useQuery({ dateFrom, dateTo });
  const createMutation = trpc.controllership.createRevenue.useMutation({
    onSuccess: () => { toast.success("Receita registrada!"); setOpen(false); refetch(); setForm(f => ({ ...f, type: "pix", description: "", amount: "", clientId: "", clientName: "", notes: "" })); },
    onError: (e) => toast.error(e.message),
  });

  const chartData = (summary?.byType ?? []).map((r: any) => ({ name: REVENUE_TYPE_LABELS[r.type] ?? r.type, valor: parseFloat(r.total ?? "0") }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Receitas</h1>
          <p className="text-sm text-muted-foreground mt-1">Camada 2 · Apuração de receitas por tipo</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Nova Receita</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Registrar Receita</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Data *</Label><Input type="date" value={form.referenceDate} onChange={e => setForm(f => ({ ...f, referenceDate: e.target.value }))} className="mt-1" /></div>
              <div><Label>Tipo *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>{REVENUE_TYPES.map(t => <SelectItem key={t} value={t}>{REVENUE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" /></div>
              <div><Label>Valor (R$) *</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="mt-1" /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_LIST.map(s => <SelectItem key={s} value={s}>{getStatusLabel(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Cliente</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="mt-1" placeholder="Nome do cliente" /></div>
              <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 text-xs" rows={2} /></div>
              <Button onClick={() => createMutation.mutate({ referenceDate: form.referenceDate, type: form.type, amount: form.amount, description: form.description, clientId: form.clientId || undefined, clientName: form.clientName || undefined, status: form.status })} disabled={createMutation.isPending} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total do Mês</p>
          <p className="text-2xl font-bold font-mono text-green-400 mt-2">{formatCurrency(summary?.total)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Realizadas</p>
          <p className="text-2xl font-bold font-mono text-foreground mt-2">{formatCurrency(summary?.received)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Pendentes</p>
          <p className="text-2xl font-bold font-mono text-yellow-400 mt-2">{formatCurrency(summary?.pending)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Qtd Lançamentos</p>
          <p className="text-2xl font-bold font-mono text-foreground mt-2">{summary?.count ?? 0}</p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-400" /> Receitas por Tipo</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: "#1a1f2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} />
              <Bar dataKey="valor" fill="#4ade80" radius={[4, 4, 0, 0]} name="Receita" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Lançamentos do Mês</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-accent/20">
                {["Data", "Tipo", "Descrição", "Cliente", "Valor", "Status"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(revenues ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhuma receita registrada no período.</td></tr>
              ) : (revenues ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-accent/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(r.referenceDate)}</td>
                  <td className="px-4 py-3 text-xs font-medium text-foreground">{REVENUE_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[180px]">{r.description}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.clientName || "-"}</td>
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-green-400">{formatCurrency(r.amount)}</td>
                  <td className="px-4 py-3"><span className={getStatusBadge(r.status)}>{getStatusLabel(r.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
