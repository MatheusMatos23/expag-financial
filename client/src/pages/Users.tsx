import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useState } from "react";
import { Users as UsersIcon, Shield, Mail, Calendar, Clock, Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", manager: "Gerente", operator: "Operador", viewer: "Visualizador",
};
const ROLE_COLORS: Record<string, string> = {
  admin: "text-red-400 bg-red-500/10 border-red-500/30",
  manager: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  operator: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  viewer: "text-gray-400 bg-gray-500/10 border-gray-500/30",
};

export default function Users() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading, refetch } = trpc.system.getUsers.useQuery(undefined, { refetchInterval: 30000 });

  const filtered = ((users ?? []) as any[]).filter(u => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [u.name, u.email, u.role].some((v: any) => v && String(v).toLowerCase().includes(s));
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-1">Controle de acesso e auditoria de ações no sistema</p>
        </div>
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail..." className="h-8 text-xs w-56" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: filtered.length, color: "text-foreground" },
          { label: "Admins", value: filtered.filter((u: any) => u.role === "admin").length, color: "text-red-400" },
          { label: "Operadores", value: filtered.filter((u: any) => u.role === "operator").length, color: "text-blue-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={cn("text-2xl font-bold font-mono mt-1", color)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando usuários...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <UsersIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-accent/10 border-b border-border">
                {["Usuário", "E-mail", "Perfil", "Último acesso", "Cadastro", "Método"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u: any) => (
                <tr key={u.id} className="hover:bg-accent/10 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                        {(u.name || u.email || "?")[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">{u.name || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold", ROLE_COLORS[u.role] ?? "text-muted-foreground")}>
                      {ROLE_LABELS[u.role] ?? u.role ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.lastSignedIn ? formatDate(u.lastSignedIn) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.createdAt ? formatDate(u.createdAt) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{u.loginMethod || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
