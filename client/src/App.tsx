import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./i18n/I18nContext";
import DashboardLayout from "./components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy load all pages for code splitting — reduz o bundle inicial significativamente
const Dashboard        = lazy(() => import("@/pages/Dashboard"));
const Reconciliation   = lazy(() => import("@/pages/Reconciliation"));
const ReconciliationSession = lazy(() => import("@/pages/ReconciliationSession"));
const Divergences      = lazy(() => import("@/pages/Divergences"));
const ManagerialBalance = lazy(() => import("@/pages/ManagerialBalance"));
const NID              = lazy(() => import("@/pages/NID"));
const Boletos          = lazy(() => import("@/pages/Boletos"));
const Users            = lazy(() => import("@/pages/Users"));
const AuditLog         = lazy(() => import("@/pages/AuditLog"));
const Controladoria    = lazy(() => import("@/pages/Controladoria"));
const Revenues         = lazy(() => import("@/pages/Revenues"));
const Expenses         = lazy(() => import("@/pages/Expenses"));
const Payables         = lazy(() => import("@/pages/Payables"));
const CreditPortfolio  = lazy(() => import("@/pages/CreditPortfolio"));
const DRE                = lazy(() => import("@/pages/DRE"));
const CashFlow           = lazy(() => import("@/pages/CashFlow"));
const InternalMovements  = lazy(() => import("@/pages/InternalMovements"));
const ExecutiveDashboard = lazy(() => import("@/pages/ExecutiveDashboard"));
const ApuracaoManual     = lazy(() => import("@/pages/ApuracaoManual"));
const CostCenters        = lazy(() => import("@/pages/CostCenters"));
const Alerts           = lazy(() => import("@/pages/Alerts"));
const NotFound         = lazy(() => import("@/pages/NotFound"));

function PageLoader() {
  return (
    <div className="space-y-4 p-1">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function Router() {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/"                   component={Dashboard} />
          <Route path="/executivo"          component={ExecutiveDashboard} />
          <Route path="/apuracao"           component={ApuracaoManual} />
          <Route path="/conciliacao"        component={Reconciliation} />
          <Route path="/conciliacao/:id"    component={ReconciliationSession} />
          <Route path="/divergencias"       component={Divergences} />
          <Route path="/nid"                 component={NID} />
          <Route path="/boletos"             component={Boletos} />
          <Route path="/saldo-gerencial"    component={ManagerialBalance} />
          <Route path="/controladoria"      component={Controladoria} />
          <Route path="/receitas"           component={Revenues} />
          <Route path="/despesas"           component={Expenses} />
          <Route path="/contas-a-pagar"     component={Payables} />
          <Route path="/carteira-credito"   component={CreditPortfolio} />
          <Route path="/dre"                component={DRE} />
          <Route path="/fluxo-caixa"        component={CashFlow} />
          <Route path="/movimentacoes-internas" component={InternalMovements} />
          <Route path="/centros-custo"      component={CostCenters} />
          <Route path="/alertas"            component={Alerts} />
          <Route path="/usuarios"           component={Users} />
          <Route path="/auditoria"          component={AuditLog} />
          <Route path="/404"                component={NotFound} />
          <Route                            component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <I18nProvider>
          <TooltipProvider>
            <Toaster richColors position="top-right" />
            <Router />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
