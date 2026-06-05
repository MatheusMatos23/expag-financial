import { trpc } from "@/lib/trpc";
import { formatDate, cn } from "@/lib/utils";
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Users as UsersIcon, Search, RefreshCw, Plus, Trash2, KeyRound,
  Pencil, ShieldCheck, User as UserIcon, X, Check, Eye, EyeOff, Lock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useI18n } from "@/i18n/I18nContext";

const ROLE_META: Record<string, { label: string; cls: string; icon: any }> = {
  admin: { label: "Administrador", cls: "text-violet-300 bg-violet-500/12 border-violet-500/25", icon: ShieldCheck },
  user:  { label: "Operador",      cls: "text-sky-300 bg-sky-500/12 border-sky-500/25",          icon: UserIcon },
};

function roleMeta(role: string) {
  return ROLE_META[role] ?? { label: role || "—", cls: "text-muted-foreground bg-muted/30 border-border", icon: UserIcon };
}

function Avatar({ name, email, size = 32 }: { name?: string; email?: string; size?: number }) {
  const letter = (name || email || "?")[0]?.toUpperCase() ?? "?";
  const colors = ["#4f6ef7", "#06d6a0", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6"];
  const idx = (name || email || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div
      style={{ width: size, height: size, background: `${colors[idx]}22`, border: `1px solid ${colors[idx]}40`, color: colors[idx] }}
      className="rounded-full flex items-center justify-center font-bold shrink-0"
    >
      <span style={{ fontSize: size * 0.4 }}>{letter}</span>
    </div>
  );
}

export default function Users() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin";

  const [search, setSearch] = useState("");
  const { data: users, isLoading, refetch } = trpc.system.getUsers.useQuery(undefined, { refetchInterval: 30000 });

  const [createOpen, setCreateOpen] = useState(false);
  const [pwUser, setPwUser]   = useState<any | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [delUser, setDelUser]   = useState<any | null>(null);
  const [myPwOpen, setMyPwOpen] = useState(false);

  const utils = trpc.useUtils();
  const refreshAll = () => { refetch(); utils.system.getUsers.invalidate(); };

  const createMut = trpc.system.createUser.useMutation({
    onSuccess: () => { toast.success("Usuário criado com sucesso."); setCreateOpen(false); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });
  const pwMut = trpc.system.updateUserPassword.useMutation({
    onSuccess: () => { toast.success("Senha alterada com sucesso."); setPwUser(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const myPwMut = trpc.system.changeOwnPassword.useMutation({
    onSuccess: () => { toast.success("Sua senha foi alterada."); setMyPwOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const roleMut = trpc.system.updateUserRole.useMutation({
    onSuccess: () => { toast.success("Perfil atualizado."); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });
  const profileMut = trpc.system.updateUserProfile.useMutation({
    onSuccess: () => { toast.success("Nome atualizado."); setEditUser(null); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMut = trpc.system.deleteUser.useMutation({
    onSuccess: () => { toast.success("Usuário removido."); setDelUser(null); refreshAll(); },
    onError: (e: any) => toast.error(e.message),
  });

  const allUsers = (users ?? []) as any[];
  const filtered = allUsers.filter(u => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [u.name, u.email, u.role].some((v: any) => v && String(v).toLowerCase().includes(s));
  });

  const adminCount = allUsers.filter(u => u.role === "admin").length;
  const userCount  = allUsers.filter(u => u.role === "user").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">{t("users.title")}</h1>
          <p className="page-subtitle">{t("users.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={refreshAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setMyPwOpen(true)}>
            <KeyRound className="w-3.5 h-3.5" /> Minha senha
          </Button>
          {isAdmin && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Novo usuário
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total de usuários", value: allUsers.length, color: "text-foreground", icon: UsersIcon },
          { label: "Administradores",   value: adminCount,       color: "text-violet-300",  icon: ShieldCheck },
          { label: "Operadores",        value: userCount,        color: "text-sky-300",     icon: UserIcon },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="kpi-accent card-premium p-4 group">
            <div className="flex items-start justify-between">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">{label}</p>
              <Icon className={cn("w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity", color)} />
            </div>
            <p className={cn("text-2xl font-bold font-mono mt-2 tracking-tight", color)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail ou perfil..."
          className="h-9 text-xs pl-9" />
      </div>

      <div className="card-premium rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando usuários...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <UsersIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40">
                {["Usuário", "Perfil", "Último acesso", "Cadastro", "Método", ""].map((h, i) => (
                  <th key={i} className={cn(
                    "text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground",
                    i === 5 && "text-right"
                  )}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u: any) => {
                const meta = roleMeta(u.role);
                const RoleIcon = meta.icon;
                const isSelf = u.id === me?.id;
                // Admin principal do sistema — blindado contra alterações por terceiros
                const isProtectedAdmin = (u.email ?? "").toLowerCase() === "admin@expag.com.br";
                const canManage = isAdmin && !(isProtectedAdmin && !isSelf);
                return (
                  <tr key={u.id} className="border-b border-border/40 hover:bg-primary/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} email={u.email} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground truncate">{u.name || "—"}</span>
                            {isSelf && <span className="text-[9px] text-primary bg-primary/10 border border-primary/20 rounded px-1 py-0.5">você</span>}
                            {isProtectedAdmin && !isSelf && <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1 py-0.5">protegido</span>}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !(isProtectedAdmin && !isSelf) ? (
                        <select
                          value={u.role}
                          onChange={e => roleMut.mutate({ id: u.id, role: e.target.value as "admin" | "user" })}
                          disabled={roleMut.isPending}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-md border font-semibold cursor-pointer outline-none",
                            "bg-input", meta.cls
                          )}
                        >
                          <option value="admin">Administrador</option>
                          <option value="user">Operador</option>
                        </select>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border font-semibold", meta.cls)}>
                          <RoleIcon className="w-3 h-3" />
                          {meta.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.lastSignedIn ? formatDate(u.lastSignedIn) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.createdAt ? formatDate(u.createdAt) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] text-muted-foreground capitalize bg-muted/40 border border-border rounded px-1.5 py-0.5">
                        {u.loginMethod || "local"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-1">
                          {canManage && (
                            <button title="Editar nome" onClick={() => setEditUser(u)}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(canManage || isSelf) && (
                            <button title="Alterar senha" onClick={() => setPwUser(u)}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isSelf && !isProtectedAdmin && (
                            <button title="Excluir usuário" onClick={() => setDelUser(u)}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isProtectedAdmin && !isSelf && (
                            <span className="text-[10px] text-muted-foreground/40">protegido</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 block text-right">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/20 border border-border/60 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Apenas administradores podem criar, editar ou remover usuários.
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen}
        onSubmit={(d) => createMut.mutate(d)} isLoading={createMut.isPending} />

      <PasswordDialog
        user={pwUser} onClose={() => setPwUser(null)}
        onSubmit={(pw) => pwMut.mutate({ id: pwUser.id, password: pw })}
        isLoading={pwMut.isPending}
      />

      <PasswordDialog
        user={myPwOpen ? { name: me?.name, email: me?.email, self: true } : null}
        onClose={() => setMyPwOpen(false)}
        onSubmit={(pw) => myPwMut.mutate({ password: pw })}
        isLoading={myPwMut.isPending}
      />

      <EditNameDialog
        user={editUser} onClose={() => setEditUser(null)}
        onSubmit={(name) => profileMut.mutate({ id: editUser.id, name })}
        isLoading={profileMut.isPending}
      />

      <Dialog open={delUser !== null} onOpenChange={v => !v && setDelUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-500/12 border border-red-500/25 flex items-center justify-center">
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </div>
              Excluir usuário
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            Tem certeza que deseja remover <span className="text-foreground font-semibold">{delUser?.name || delUser?.email}</span>?
            Esta ação não pode ser desfeita.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDelUser(null)}>Cancelar</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => delMut.mutate({ id: delUser.id })}
              disabled={delMut.isPending}>
              {delMut.isPending ? "Removendo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onSubmit, isLoading }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (d: { email: string; name: string; password: string; role: "admin" | "user" }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [showPw, setShowPw] = useState(false);

  const reset = () => { setName(""); setEmail(""); setPassword(""); setRole("user"); setShowPw(false); };
  const valid = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/12 border border-primary/25 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5 text-primary" />
            </div>
            Novo usuário
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome completo</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João Silva" className="h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">E-mail</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="joao@expag.com.br" className="h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Senha <span className="text-muted-foreground/50 font-normal normal-case">(mín. 8 caracteres)</span>
            </Label>
            <div className="relative">
              <Input value={password} onChange={e => setPassword(e.target.value)}
                type={showPw ? "text" : "password"} placeholder="Senha inicial" className="h-10 text-sm pr-10" />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Perfil de acesso</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "user",  label: "Operador",      sub: "Acesso operacional", icon: UserIcon },
                { v: "admin", label: "Administrador", sub: "Acesso total",       icon: ShieldCheck },
              ] as const).map(({ v, label, sub, icon: Icon }) => (
                <button key={v} type="button" onClick={() => setRole(v)}
                  className={cn(
                    "flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all",
                    role === v ? "border-primary/40 bg-primary/8" : "border-border hover:border-border/80 bg-card"
                  )}>
                  <Icon className={cn("w-4 h-4", role === v ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-xs font-semibold", role === v ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                  <span className="text-[10px] text-muted-foreground">{sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" disabled={!valid || isLoading}
            onClick={() => onSubmit({ name: name.trim(), email: email.trim(), password, role })}>
            {isLoading ? "Criando..." : "Criar usuário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose, onSubmit, isLoading }: {
  user: any | null; onClose: () => void;
  onSubmit: (pw: string) => void; isLoading: boolean;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);

  const reset = () => { setPw(""); setPw2(""); setShowPw(false); };
  const match = pw.length >= 8 && pw === pw2;

  return (
    <Dialog open={user !== null} onOpenChange={v => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/12 border border-amber-500/25 flex items-center justify-center">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
            </div>
            {user?.self ? "Alterar minha senha" : "Alterar senha"}
          </DialogTitle>
        </DialogHeader>
        {!user?.self && (
          <p className="text-xs text-muted-foreground -mt-1">
            Definindo nova senha para <span className="text-foreground font-medium">{user?.name || user?.email}</span>
          </p>
        )}
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nova senha</Label>
            <div className="relative">
              <Input value={pw} onChange={e => setPw(e.target.value)}
                type={showPw ? "text" : "password"} placeholder="Mín. 8 caracteres" className="h-10 text-sm pr-10" />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Confirmar senha</Label>
            <Input value={pw2} onChange={e => setPw2(e.target.value)}
              type={showPw ? "text" : "password"} placeholder="Repita a senha" className="h-10 text-sm" />
            {pw2.length > 0 && pw !== pw2 && (
              <p className="text-[10px] text-red-400 flex items-center gap-1"><X className="w-3 h-3" /> As senhas não coincidem</p>
            )}
            {match && (
              <p className="text-[10px] text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Senhas conferem</p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={!match || isLoading} onClick={() => onSubmit(pw)}>
            {isLoading ? "Salvando..." : "Salvar senha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditNameDialog({ user, onClose, onSubmit, isLoading }: {
  user: any | null; onClose: () => void;
  onSubmit: (name: string) => void; isLoading: boolean;
}) {
  const [name, setName] = useState("");
  if (user && name === "" && user.name) setTimeout(() => setName(user.name), 0);

  return (
    <Dialog open={user !== null} onOpenChange={v => { if (!v) { onClose(); setName(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/12 border border-primary/25 flex items-center justify-center">
              <Pencil className="w-3.5 h-3.5 text-primary" />
            </div>
            Editar usuário
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome completo</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-10 text-sm" placeholder="Nome do usuário" />
          </div>
          <div className="text-[11px] text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
            E-mail: <span className="text-foreground">{user?.email}</span> <span className="text-muted-foreground/50">(não editável)</span>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={name.trim().length < 2 || isLoading} onClick={() => onSubmit(name.trim())}>
            {isLoading ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
