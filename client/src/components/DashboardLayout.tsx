import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  LayoutDashboard, Lock, LogOut, Mail, PanelLeft, Receipt, ReceiptText, Repeat, TrendingUp, Wallet, Users, ScrollText,
  Sun, Moon, Languages, Check,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ExpagLogo } from "./ExpagLogo";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n } from "@/i18n/I18nContext";
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

      {/* ── LEFT — Branding panel ── */}
      <div className="hidden lg:flex lg:w-[460px] xl:w-[520px] shrink-0 flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(150deg, #07102a 0%, #030509 55%, #050d1f 100%)" }}>

        {/* Subtle dot grid */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(79,110,247,0.18) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
          }} />

        {/* Glow orb top */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(79,110,247,0.12) 0%, transparent 65%)" }} />

        {/* Glow orb bottom */}
        <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(79,110,247,0.07) 0%, transparent 70%)" }} />

        {/* Thin vertical accent line */}
        <div className="absolute right-0 top-[15%] bottom-[15%] w-px"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(79,110,247,0.3) 40%, rgba(79,110,247,0.3) 60%, transparent)" }} />

        <div className="relative z-10 flex flex-col justify-between h-full p-10 xl:p-14">

          {/* Logo */}
          <div className="space-y-3">
            <ExpagLogo collapsed={false} size="lg" />
            <div className="flex items-center gap-2 mt-1">
              <div className="h-px flex-1 bg-gradient-to-r from-[rgba(79,110,247,0.4)] to-transparent" />
              <span className="text-[9px] font-semibold tracking-[0.22em] text-[#4f6ef7]/60 uppercase">Financial System</span>
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 bg-[rgba(79,110,247,0.1)] border border-[rgba(79,110,247,0.2)] rounded-full px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#4f6ef7] animate-pulse" />
              <span className="text-[10px] font-semibold text-primary tracking-wide">Plataforma Institucional</span>
            </div>
            <h2 className="text-[2.1rem] xl:text-[2.5rem] font-bold text-white leading-[1.1] tracking-[-0.03em]">
              Gestão financeira<br />
              <span style={{ background: "linear-gradient(90deg, #7b97f9, #4f6ef7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                de nível institucional
              </span>
            </h2>
            <p className="text-sm text-white/30 leading-relaxed max-w-[290px]">
              Conciliação bancária, controladoria, DRE e carteira de crédito — tudo integrado.
            </p>
          </div>

          {/* Feature list — mais elegante */}
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-3.5 group">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                  style={{ background: "rgba(79,110,247,0.12)", border: "1px solid rgba(79,110,247,0.18)" }}>
                  <Icon className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-white/75 leading-tight">{label}</p>
                  <p className="text-[10px] text-white/28 mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2.5 pt-5 border-t border-white/5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
              style={{ boxShadow: "0 0 6px rgba(52,211,153,0.8)" }} />
            <span className="text-[10px] text-white/30 tracking-wide">Todos os sistemas operacionais</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT — Form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">

        {/* Background subtle glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(79,110,247,0.05) 0%, transparent 100%)" }} />

        <div className="w-full max-w-[360px] relative z-10">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex justify-center">
            <ExpagLogo collapsed={false} size="lg" />
          </div>

          {/* Card form */}
          <div className="rounded-2xl p-8"
            style={{
              background: "rgba(10,15,30,0.7)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(79,110,247,0.15)",
              boxShadow: "0 0 0 1px rgba(79,110,247,0.06), 0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}>

            {/* Card header */}
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(79,110,247,0.15)", border: "1px solid rgba(79,110,247,0.25)" }}>
                  <Lock className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground tracking-[0.1em] uppercase">
                  {isSetup ? "Configuração inicial" : "Autenticação"}
                </span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-[#eef1f8]">
                {isSetup ? "Criar administrador" : "Acessar sistema"}
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1.5">
                {isSetup
                  ? "Configure o acesso inicial ao Expag Financial."
                  : "Entre com suas credenciais institucionais."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={isSetup ? handleSetup : handleLogin} className="space-y-4">
              {isSetup && (
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Nome completo
                  </Label>
                  <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="h-11 text-sm"
                    style={{ background: "rgba(5,8,16,0.6)", border: "1px solid rgba(22,31,58,0.9)", color: "#eef1f8" }}
                    autoComplete="name" />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@expag.com.br"
                    className="pl-10 h-11 text-sm"
                    style={{ background: "rgba(5,8,16,0.6)", border: "1px solid rgba(22,31,58,0.9)", color: "#eef1f8" }}
                    required autoComplete="email" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Senha {isSetup && <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">(mín. 8 caracteres)</span>}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                  <Input id="password" type={showPass ? "text" : "password"}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={isSetup ? "Crie uma senha segura" : "••••••••"}
                    className="pl-10 pr-10 h-11 text-sm"
                    style={{ background: "rgba(5,8,16,0.6)", border: "1px solid rgba(22,31,58,0.9)", color: "#eef1f8" }}
                    required autoComplete={isSetup ? "new-password" : "current-password"} />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg"
                  style={{ background: "rgba(232,64,64,0.08)", border: "1px solid rgba(232,64,64,0.2)" }}>
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400 leading-relaxed">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full h-11 rounded-lg font-semibold text-sm text-white transition-all mt-1 disabled:opacity-60"
                style={{
                  background: loading
                    ? "rgba(79,110,247,0.5)"
                    : "linear-gradient(135deg, #4f6ef7 0%, #3b5ae0 100%)",
                  border: "1px solid rgba(79,110,247,0.5)",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(79,110,247,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
                }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin" />
                    Verificando...
                  </span>
                ) : isSetup ? "Criar administrador" : "Entrar"}
              </button>
            </form>
          </div>

          {/* Dev bypass */}
          {import.meta.env.VITE_APP_ID === "local-dev" && (
            <div className="mt-4">
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground"
                onClick={() => { window.location.href = "/api/dev-login"; }}>
                Entrar como dev local
              </Button>
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-[10px] text-muted-foreground/50 mt-6 tracking-wide">
            Expag Financial System · Uso exclusivo interno
          </p>
        </div>
      </div>
    </div>
  );
}

const menuGroups = [
  {
    labelKey: "nav.overview" as const,
    items: [
      { icon: LayoutDashboard, labelKey: "nav.dashboard" as const, path: "/" },
      { icon: AlertTriangle, labelKey: "nav.alerts" as const, path: "/alertas" },
      { icon: Users, labelKey: "nav.users" as const, path: "/usuarios" },
      { icon: ScrollText, labelKey: "nav.audit" as const, path: "/auditoria" },
    ],
  },
  {
    labelKey: "nav.layer1" as const,
    items: [
      { icon: ArrowLeftRight, labelKey: "nav.reconciliation" as const, path: "/conciliacao" },
      { icon: FileText, labelKey: "nav.divergences" as const, path: "/divergencias" },
      { icon: AlertTriangle, labelKey: "nav.nid" as const, path: "/nid" },
      { icon: ReceiptText, labelKey: "nav.boletos" as const, path: "/boletos" },
      { icon: Wallet, labelKey: "nav.managerialBalance" as const, path: "/saldo-gerencial" },
    ],
  },
  {
    labelKey: "nav.layer2" as const,
    items: [
      { icon: LayoutDashboard, labelKey: "nav.controllership" as const, path: "/controladoria" },
      { icon: TrendingUp, labelKey: "nav.revenues" as const, path: "/receitas" },
      { icon: Receipt, labelKey: "nav.expenses" as const, path: "/despesas" },
      { icon: BadgeDollarSign, labelKey: "nav.payables" as const, path: "/contas-a-pagar" },
      { icon: CreditCard, labelKey: "nav.creditPortfolio" as const, path: "/carteira-credito" },
    ],
  },
  {
    labelKey: "nav.layer3" as const,
    items: [
      { icon: BarChart3, labelKey: "nav.dre" as const, path: "/dre" },
      { icon: BookOpen, labelKey: "nav.cashFlow" as const, path: "/fluxo-caixa" },
      { icon: Repeat, labelKey: "nav.internalMovements" as const, path: "/movimentacoes-internas" },
      { icon: Building2, labelKey: "nav.costCenters" as const, path: "/centros-custo" },
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
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
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

  const allNavItems = menuGroups.flatMap(g => g.items as Array<{ icon: any; labelKey: any; path: string }>);
  const currentItem = allNavItems.find(i => i.path === location);
  const currentLabel = currentItem ? t(currentItem.labelKey) : t("nav.dashboard");

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar" disableTransition={isResizing}>
          <SidebarHeader className="h-[58px] justify-center border-b border-sidebar-border/60">
            <div className={cn("flex items-center px-2 w-full", isCollapsed ? "justify-center" : "gap-3")}>
              {!isCollapsed && (
                <button
                  onClick={toggleSidebar}
                  className="h-8 w-8 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none shrink-0"
                >
                  <PanelLeft className="h-4 w-4 text-sidebar-foreground/60" />
                </button>
              )}
              {isCollapsed ? (
                <button
                  onClick={toggleSidebar}
                  className="h-8 w-8 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none"
                  title="Expandir menu"
                >
                  <ExpagLogo collapsed={true} />
                </button>
              ) : (
                <ExpagLogo collapsed={false} />
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2">
            {menuGroups.map((group) => (
              <SidebarGroup key={group.labelKey} className="px-2 py-0.5">
                {!isCollapsed && (
                  <SidebarGroupLabel className="!h-auto !mt-3 !mb-1 !opacity-100 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 px-2">
                    {t(group.labelKey)}
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
                          tooltip={t(item.labelKey)}
                          className={cn(
                            "h-8 transition-all duration-100 rounded-lg relative overflow-hidden",
                            "font-normal tracking-tight",
                            isActive
                              ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-[25%] bottom-[25%] w-[2px] bg-primary rounded-r-full" />
                          )}
                          <item.icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "")} />
                          <span className="text-[13px]">{t(item.labelKey)}</span>
                          {item.path === '/alertas' && alertCount > 0 && !isCollapsed && (
                            <span className="ml-auto text-[10px] bg-red-500/15 text-red-400 border border-red-500/25 rounded-full px-1.5 min-w-[18px] text-center font-semibold leading-[18px]">
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
                <button className={cn(
                  "flex items-center rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors w-full focus:outline-none",
                  isCollapsed ? "justify-center" : "gap-3 text-left"
                )}>
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
              <DropdownMenuContent align="end" side="top" className="w-56">
                {/* Cabeçalho do usuário */}
                <div className="px-2 py-2">
                  <p className="text-xs font-semibold text-foreground truncate">{user?.name || "-"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email || "-"}</p>
                </div>
                <DropdownMenuSeparator />

                {/* Tema */}
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {t("common.theme")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => { if (theme !== "light") toggleTheme(); }}
                  className="cursor-pointer gap-2"
                >
                  <Sun className="h-4 w-4" />
                  <span className="flex-1">{t("common.themeLight")}</span>
                  {theme === "light" && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { if (theme !== "dark") toggleTheme(); }}
                  className="cursor-pointer gap-2"
                >
                  <Moon className="h-4 w-4" />
                  <span className="flex-1">{t("common.themeDark")}</span>
                  {theme === "dark" && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Idioma */}
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {t("common.language")}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setLanguage("pt")} className="cursor-pointer gap-2">
                  <span className="text-base leading-none">🇧🇷</span>
                  <span className="flex-1">Português</span>
                  {language === "pt" && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("en")} className="cursor-pointer gap-2">
                  <span className="text-base leading-none">🇺🇸</span>
                  <span className="flex-1">English</span>
                  {language === "en" && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive gap-2">
                  <LogOut className="h-4 w-4" />
                  <span>{t("common.logout")}</span>
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
