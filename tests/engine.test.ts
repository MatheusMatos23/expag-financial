import { describe, it, expect } from "vitest";
import { runReconciliationEngine, type EngineTransaction } from "../server/modules/reconciliation/engine";

// Helper para criar transações de teste
function tx(id: number, amount: number, date: string, desc = "", channel = "pix"): EngineTransaction {
  return { id, amount, transactionDate: date, description: desc, channel };
}

describe("runReconciliationEngine — casos vazios", () => {
  it("retorna output vazio quando não há transações", () => {
    const r = runReconciliationEngine([], []);
    expect(r.matches).toHaveLength(0);
    expect(r.stats.matched).toBe(0);
    expect(r.stats.matchRate).toBe(0);
  });

  it("todas as transações de banco ficam sem match quando API está vazia", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15")];
    const r = runReconciliationEngine(bank, []);
    expect(r.unmatchedBankIds).toHaveLength(2);
    expect(r.matches).toHaveLength(0);
  });

  it("todas as transações de API ficam sem match quando banco está vazio", () => {
    const api = [tx(1, 100, "2026-01-15")];
    const r = runReconciliationEngine([], api);
    expect(r.unmatchedApiIds).toHaveLength(1);
  });
});

describe("runReconciliationEngine — match exato", () => {
  it("casa transações com mesmo valor e data", () => {
    const bank = [tx(1, 1500.00, "2026-01-15", "PIX recebido", "pix")];
    const api  = [tx(101, 1500.00, "2026-01-15", "PIX recebido", "pix")];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].bankId).toBe(1);
    expect(r.matches[0].apiId).toBe(101);
    expect(r.stats.matched).toBe(1);
  });

  it("match exato tem confiança alta", () => {
    const bank = [tx(1, 999.99, "2026-01-15", "Transferência", "ted")];
    const api  = [tx(101, 999.99, "2026-01-15", "Transferência", "ted")];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches[0].confidence).toBeGreaterThanOrEqual(80);
  });

  it("não casa valores muito diferentes", () => {
    const bank = [tx(1, 100, "2026-01-15")];
    const api  = [tx(101, 9999, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches).toHaveLength(0);
    expect(r.unmatchedBankIds).toContain(1);
    expect(r.unmatchedApiIds).toContain(101);
  });
});

describe("runReconciliationEngine — cada transação casa no máximo 1x", () => {
  it("não usa a mesma transação de API duas vezes", () => {
    const bank = [tx(1, 500, "2026-01-15"), tx(2, 500, "2026-01-15")];
    const api  = [tx(101, 500, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    // Apenas uma das duas pode casar com a única API tx
    expect(r.matches).toHaveLength(1);
    expect(r.unmatchedBankIds).toHaveLength(1);
  });

  it("IDs de API nos matches são únicos", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15"), tx(3, 300, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15"), tx(103, 300, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    const apiIds = r.matches.map(m => m.apiId);
    expect(new Set(apiIds).size).toBe(apiIds.length);
  });

  it("IDs de banco nos matches são únicos", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    const bankIds = r.matches.map(m => m.bankId);
    expect(new Set(bankIds).size).toBe(bankIds.length);
  });
});

describe("runReconciliationEngine — estatísticas consistentes", () => {
  it("matched + unmatchedBank = total de banco", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15"), tx(3, 777, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches.length + r.unmatchedBankIds.length).toBe(bank.length);
  });

  it("matched + unmatchedApi = total de API", () => {
    const bank = [tx(1, 100, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 555, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches.length + r.unmatchedApiIds.length).toBe(api.length);
  });

  it("matchRate entre 0 e 100", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.stats.matchRate).toBeGreaterThanOrEqual(0);
    expect(r.stats.matchRate).toBeLessThanOrEqual(100);
  });

  it("100% de match quando tudo casa", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.stats.matchRate).toBe(100);
  });

  it("totais batem com a entrada", () => {
    const bank = [tx(1, 100, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15")];
    const r = runReconciliationEngine(bank, api);
    expect(r.stats.totalBank).toBe(1);
    expect(r.stats.totalApi).toBe(2);
  });
});

describe("runReconciliationEngine — robustez", () => {
  it("aceita amount como string", () => {
    const bank: EngineTransaction[] = [{ id: 1, amount: "1500.50", transactionDate: "2026-01-15", description: "x", channel: "pix" }];
    const api: EngineTransaction[]  = [{ id: 101, amount: "1500.50", transactionDate: "2026-01-15", description: "x", channel: "pix" }];
    const r = runReconciliationEngine(bank, api);
    expect(r.matches).toHaveLength(1);
  });

  it("lida com descrição null", () => {
    const bank = [tx(1, 100, "2026-01-15", "")];
    bank[0].description = null;
    const api = [tx(101, 100, "2026-01-15", "")];
    api[0].description = null;
    const r = runReconciliationEngine(bank, api);
    expect(r.matches.length).toBeGreaterThanOrEqual(0); // não deve lançar erro
  });

  it("processa volume grande sem erro", () => {
    const bank = Array.from({ length: 500 }, (_, i) => tx(i + 1, 100 + i, "2026-01-15"));
    const api  = Array.from({ length: 500 }, (_, i) => tx(i + 1001, 100 + i, "2026-01-15"));
    const r = runReconciliationEngine(bank, api);
    expect(r.stats.totalBank).toBe(500);
    expect(r.matches.length).toBeGreaterThan(0);
  });
});

// ─── ATOMICIDADE ──────────────────────────────────────────────────────────────
describe("runReconciliationEngine — determinismo (base para atomicidade)", () => {
  it("produz o mesmo resultado para a mesma entrada", () => {
    const bank = [tx(1, 100, "2026-01-15"), tx(2, 200, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15"), tx(102, 200, "2026-01-15")];
    const r1 = runReconciliationEngine(bank, api);
    const r2 = runReconciliationEngine(bank, api);
    expect(r1.stats.matched).toBe(r2.stats.matched);
    expect(r1.matches.length).toBe(r2.matches.length);
  });

  it("não modifica os arrays de entrada", () => {
    const bank = [tx(1, 100, "2026-01-15")];
    const api  = [tx(101, 100, "2026-01-15")];
    const bankCopy = JSON.stringify(bank);
    const apiCopy = JSON.stringify(api);
    runReconciliationEngine(bank, api);
    expect(JSON.stringify(bank)).toBe(bankCopy);
    expect(JSON.stringify(api)).toBe(apiCopy);
  });
});
