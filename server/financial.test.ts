import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── MOCKS ────────────────────────────────────────────────────────────────────
// Mapeados exatamente com os exports de server/db.ts
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
  createReconciliationSession: vi.fn().mockResolvedValue(1),
  getReconciliationSessions: vi.fn().mockResolvedValue([]),
  getReconciliationSessionById: vi.fn().mockResolvedValue(null),
  updateReconciliationSession: vi.fn().mockResolvedValue(undefined),
  insertBankTransactions: vi.fn().mockResolvedValue(undefined),
  insertApiTransactions: vi.fn().mockResolvedValue(undefined),
  getBankTransactionsBySession: vi.fn().mockResolvedValue([]),
  getApiTransactionsBySession: vi.fn().mockResolvedValue([]),
  updateBankTransactionMatch: vi.fn().mockResolvedValue(undefined),
  updateApiTransactionMatch: vi.fn().mockResolvedValue(undefined),
  createDivergence: vi.fn().mockResolvedValue(1),
  getDivergences: vi.fn().mockResolvedValue([]),
  updateDivergenceStatus: vi.fn().mockResolvedValue(undefined),
  upsertManagerialBalance: vi.fn().mockResolvedValue(undefined),
  getManagerialBalances: vi.fn().mockResolvedValue([]),
  getLatestManagerialBalance: vi.fn().mockResolvedValue(null),
  createRevenue: vi.fn().mockResolvedValue(1),
  getRevenues: vi.fn().mockResolvedValue([]),
  getRevenueSummary: vi.fn().mockResolvedValue([]),
  createExpense: vi.fn().mockResolvedValue(1),
  getExpenses: vi.fn().mockResolvedValue([]),
  getExpenseSummary: vi.fn().mockResolvedValue([]),
  createPayable: vi.fn().mockResolvedValue(1),
  getPayables: vi.fn().mockResolvedValue([]),
  updatePayableStatus: vi.fn().mockResolvedValue(undefined),
  deletePayable: vi.fn().mockResolvedValue(undefined),
  createCreditEntry: vi.fn().mockResolvedValue(1),
  getCreditPortfolio: vi.fn().mockResolvedValue([]),
  getCreditInstallments: vi.fn().mockResolvedValue([]),
  createCreditInstallments: vi.fn().mockResolvedValue(undefined),
  getDRE: vi.fn().mockResolvedValue([]),
  upsertDRE: vi.fn().mockResolvedValue(undefined),
  getCashFlow: vi.fn().mockResolvedValue([]),
  upsertCashFlow: vi.fn().mockResolvedValue(undefined),
  createAlert: vi.fn().mockResolvedValue(undefined),
  getAlerts: vi.fn().mockResolvedValue([]),
  acknowledgeAlert: vi.fn().mockResolvedValue(undefined),
  getCostCenters: vi.fn().mockResolvedValue([]),
  createCostCenter: vi.fn().mockResolvedValue(1),
  getSystemConfig: vi.fn().mockResolvedValue(null),
  setSystemConfig: vi.fn().mockResolvedValue(undefined),
  getDashboardSummary: vi.fn().mockResolvedValue({
    totalRevenue: 0,
    totalExpenses: 0,
    netResult: 0,
    latestBalance: null,
    activeDivergences: 0,
    overduePayables: 0,
    activeAlerts: 0,
    revenueSummary: [],
    expenseSummary: [],
  }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// ─── CONTEXTOS ────────────────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeAdminCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1, openId: "admin-test", email: "admin@expag.com.br",
    name: "Admin Expag", loginMethod: "manus", role: "admin",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => { vi.clearAllMocks(); });

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
describe("Dashboard", () => {
  it("getSummary retorna estrutura correta", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.dashboard.getSummary({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("totalRevenue");
    expect(result).toHaveProperty("netResult");
  });

  it("getAlerts retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.dashboard.getAlerts({});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── CONCILIAÇÃO ──────────────────────────────────────────────────────────────
describe("Conciliação — Sessões", () => {
  it("getSessions retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.reconciliation.getSessions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("getDivergences retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.reconciliation.getDivergences({});
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── MOTOR GERENCIAL ──────────────────────────────────────────────────────────
describe("Motor Gerencial — Saldo", () => {
  it("getManagerialBalance retorna null sem dados", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.reconciliation.getManagerialBalance();
    expect(result).toBeNull();
  });

  it("getManagerialBalanceHistory retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.reconciliation.getManagerialBalanceHistory({ days: 30 });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── CONTROLADORIA — RECEITAS ─────────────────────────────────────────────────
describe("Controladoria — Receitas", () => {
  it("getRevenueSummary retorna estrutura correta", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.getRevenueSummary({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("byType");
  });

  it("createRevenue cria receita com sucesso", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.createRevenue({
      type: "pix", amount: "1500.00", referenceDate: "2026-05-07",
      description: "Recebimento cliente teste",
    });
    expect(result).toHaveProperty("id");
  });
});

// ─── CONTROLADORIA — DESPESAS ─────────────────────────────────────────────────
describe("Controladoria — Despesas", () => {
  it("getExpenseSummary retorna estrutura correta", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.getExpenseSummary({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("byCategory");
  });

  it("createExpense cria despesa com sucesso", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.createExpense({
      category: "folha", amount: "5000.00", referenceDate: "2026-05-07",
      description: "Folha de pagamento maio/2026",
    });
    expect(result).toHaveProperty("id");
  });
});

// ─── CONTROLADORIA — CONTAS A PAGAR ──────────────────────────────────────────
describe("Controladoria — Contas a Pagar", () => {
  it("getPayables retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.getPayables({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("createPayable cria conta a pagar com sucesso", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.createPayable({
      description: "Aluguel escritório", amount: "3000.00",
      dueDate: "2026-05-31", category: "operacional",
    });
    expect(result).toHaveProperty("id");
  });

  it("markPayablePaid atualiza status", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.markPayablePaid({ id: 1 });
    expect(result).toEqual({ success: true });
  });
});

// ─── CONTROLADORIA — CARTEIRA DE CRÉDITO ─────────────────────────────────────
describe("Controladoria — Carteira de Crédito", () => {
  it("getLoans retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.getLoans({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("getLoanSummary retorna estrutura correta", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.controllership.getLoanSummary();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("active");
    expect(result).toHaveProperty("count");
  });
});

// ─── CONTABILIDADE ────────────────────────────────────────────────────────────
describe("Contabilidade — DRE", () => {
  it("getDRE retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.accounting.getDRE({ months: 12 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("Contabilidade — Fluxo de Caixa", () => {
  it("getCashFlow retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.accounting.getCashFlow({ days: 30 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getCostCenters retorna array", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.accounting.getCostCenters();
    expect(Array.isArray(result)).toBe(true);
  });
});
