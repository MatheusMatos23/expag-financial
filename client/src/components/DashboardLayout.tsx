import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";
import {
  AlertCircle, AlertTriangle, ArrowLeftRight, BadgeDollarSign, BarChart3,
  BookOpen, Building2, ChevronRight, CreditCard, Eye, EyeOff, FileText,
  LayoutDashboard, Lock, LogOut, Mail, PanelLeft, Receipt, TrendingUp, Wallet,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ExpagLogo } from "./ExpagLogo";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { trpc } from "@/lib/trpc";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────

function AuthScreen() {
  const [mode, setMode] = useState<"loading" | "login" | "setup">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/has-users")
      .then(r => r.json())
      .then(d => setMode(d.hasUsers ? "login" : "setup"))
      .catch(() => setMode("login"));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        setError(`Resposta inválida do servidor (${res.status}): ${text.slice(0, 100)}`);
        return;
      }
      if (!res.ok) { setError(data.error ?? "Erro ao fazer login."); return; }
      window.location.reload();
    } catch (err: any) {
      setError("Erro de rede: " + (err?.message ?? "desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erro ao criar usuário."); return; }
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (loginRes.ok) window.location.reload();
      else setMode("login");
    } catch {
      setError("Erro de conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isSetup = mode === "setup";

  const FEATURES = [
    { icon: ArrowLeftRight, label: "Conciliação bancária", sub: "Motor O(n log n) com confidence scoring" },
    { icon: BarChart3,      label: "Dashboard executivo", sub: "KPIs em tempo real com alertas automáticos" },
    { icon: TrendingUp,     label: "Controladoria completa", sub: "DRE, fluxo de caixa e carteira de crédito" },
    { icon: CreditCard,     label: "Carteira de Crédito", sub: "Controle de operações e inadimplência" },
  ];

  return (
    <div className="flex min-h-screen bg-background overflow-hidden">

      {/* ── LEFT — Branding premium ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] shrink-0 flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #0d1a38 0%, #060c18 60%, #0a1628 100%)" }}>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(rgba(59,130,246,1) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

        {/* Blue glow top-right */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }} />
        {/* Blue glow bottom-left */}
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full opacity-8"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }} />

        <div className="relative z-10 flex flex-col justify-between h-full p-10 xl:p-14">
          {/* Logo — maior e com tagline */}
          <div>
            <ExpagLogo collapsed={false} className="scale-[1.6] origin-left mb-2" />
            <p className="text-[10px] text-white/30 tracking-widest uppercase mt-5 ml-0.5">Financial System</p>
          </div>

          {/* Main headline — meio do painel */}
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-primary/70 uppercase mb-4">
              Sistema Financeiro Institucional
            </p>
            <h2 className="text-3xl xl:text-[2.5rem] font-bold text-white leading-[1.15] tracking-tight">
              Gestão financeira<br />de nível institucional
            </h2>
            <p className="text-sm text-white/35 mt-5 leading-relaxed max-w-[300px]">
              Conciliação bancária, controladoria, DRE e carteira de crédito integrados em um único painel operacional.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="rounded-xl p-4 border"
                style={{ background: "rgba(59,130,246,0.07)", borderColor: "rgba(59,130,246,0.15)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
                  style={{ background: "rgba(59,130,246,0.18)" }}>
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xs font-semibold text-white/85 leading-tight">{label}</p>
                <p className="text-[10px] text-white/35 mt-1.5 leading-relaxed">{sub}</p>
              </div>
            ))}
          </div>

          {/* Bottom status */}
          <div className="flex items-center gap-2.5 pt-5 border-t"
            style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-[10px] text-white/35 tracking-wide">Sistema operacional · Todos os serviços ativos</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT — Form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">

        {/* Subtle top border glow */}
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)" }} />

        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex justify-center">
            <ExpagLogo collapsed={false} />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {isSetup ? "Configurar acesso" : "Bem-vindo de volta"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {isSetup
                ? "Configure o primeiro administrador do sistema."
                : "Entre com suas credenciais para acessar o painel."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={isSetup ? handleSetup : handleLogin} className="space-y-4">
            {isSetup && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-medium text-muted-foreground">Nome completo</Label>
                <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Seu nome" className="h-11 bg-card border-border"
                  autoComplete="name" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email *</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="admin@expag.com.br"
                  className="pl-10 h-11 bg-card border-border"
                  required autoComplete="email" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                Senha * {isSetup && <span className="text-muted-foreground/50 font-normal">(mín. 8 caracteres)</span>}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                <Input id="password" type={showPass ? "text" : "password"}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={isSetup ? "Crie uma senha segura" : "Sua senha"}
                  className="pl-10 pr-10 h-11 bg-card border-border"
                  required autoComplete={isSetup ? "new-password" : "current-password"} />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 leading-relaxed">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading}
              className="w-full h-11 font-semibold text-sm mt-2">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Aguarde...
                </span>
              ) : isSetup ? "Criar Administrador" : "Entrar no Sistema"}
            </Button>
          </form>

          {/* Dev bypass */}
          {import.meta.env.VITE_APP_ID === "local-dev" && (
            <div className="mt-6 pt-5 border-t border-border/50">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => { window.location.href = "/api/dev-login"; }}>
                Entrar como dev local
              </Button>
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-[11px] text-muted-foreground/40 mt-8">
            Expag Financial System · Uso interno e exclusivo
          </p>
        </div>
      </div>
    </div>
  );
}

const menuGroups = [
  {
    label: "Visão Geral",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/" },
      { icon: AlertTriangle, label: "Alertas", path: "/alertas" },
    ],
  },
  {
    label: "Camada 1 · Conciliação",
    items: [
      { icon: ArrowLeftRight, label: "Conciliações", path: "/conciliacao" },
      { icon: FileText, label: "Divergências", path: "/divergencias" },
      { icon: Wallet, label: "Saldo Gerencial", path: "/saldo-gerencial" },
    ],
  },
  {
    label: "Camada 2 · Controladoria",
    items: [
      { icon: TrendingUp, label: "Receitas", path: "/receitas" },
      { icon: Receipt, label: "Despesas", path: "/despesas" },
      { icon: BadgeDollarSign, label: "Contas a Pagar", path: "/contas-a-pagar" },
      { icon: CreditCard, label: "Carteira de Crédito", path: "/carteira-credito" },
    ],
  },
  {
    label: "Camada 3 · Contabilidade",
    items: [
      { icon: BarChart3, label: "DRE", path: "/dre" },
      { icon: BookOpen, label: "Fluxo de Caixa", path: "/fluxo-caixa" },
      { icon: Building2, label: "Centros de Custo", path: "/centros-custo" },
    ],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 220;
const MAX_WIDTH = 400;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children, setSidebarWidth,
}: { children: React.ReactNode; setSidebarWidth: (w: number) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { data: alerts } = trpc.dashboard.getAlerts.useQuery({ status: 'active' });
  const alertCount = alerts?.length ?? 0;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const currentLabel = menuGroups.flatMap(g => g.items).find(i => i.path === location)?.label ?? "Dashboard";

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-2 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-sidebar-foreground/60" />
              </button>
              <ExpagLogo collapsed={isCollapsed} />
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2">
            {menuGroups.map((group) => (
              <SidebarGroup key={group.label} className="px-2 py-1">
                {!isCollapsed && (
                  <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-2 mb-1">
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isActive = location === item.path || (item.path !== '/' && location.startsWith(item.path));
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className="h-9 transition-all font-normal text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                        >
                          <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                          <span className="text-sm">{item.label}</span>
                          {item.path === '/alertas' && alertCount > 0 && !isCollapsed && (
                            <span className="ml-auto text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-1.5 py-0.5 font-medium">
                              {alertCount}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors w-full text-left focus:outline-none">
                  <Avatar className="h-8 w-8 border border-sidebar-border shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase() ?? 'U'}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate text-sidebar-foreground">{user?.name || "-"}</p>
                      <p className="text-[10px] text-sidebar-foreground/50 truncate">{user?.email || "-"}</p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-background">
        {isMobile && (
          <div className="flex border-b border-border h-14 items-center justify-between bg-background px-4 sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-8 w-8 rounded-lg" />
              <span className="font-medium text-sm text-foreground">{currentLabel}</span>
            </div>
          </div>
        )}
        <main className="flex-1 p-6 min-h-screen">{children}</main>
      </SidebarInset>
    </>
  );
}
