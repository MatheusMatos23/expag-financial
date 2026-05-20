import { describe, it, expect } from "vitest";

// Replica a lógica de filtro de pares suspeitos:
// - Diferença de valor ≤ R$ 2,00
// - Diferença de dias ≤ 3 (em valor absoluto)
const AMOUNT_TOLERANCE = 2.00;
const DATE_TOLERANCE_DAYS = 3;

function isSuspicious(divAmount: number, divDate: string, pair: { amount: number; date: string }): boolean {
  const amountDiff = Math.abs(pair.amount - divAmount);
  const div = new Date(divDate + "T12:00:00Z").getTime();
  const pd = new Date(pair.date + "T12:00:00Z").getTime();
  const dayDiff = Math.abs((pd - div) / 86400000);
  return amountDiff <= AMOUNT_TOLERANCE && dayDiff <= DATE_TOLERANCE_DAYS;
}

describe("Pares suspeitos — filtro de tolerância", () => {
  it("aceita par com valor R$ 0,95 de diferença no mesmo dia (caso real)", () => {
    // Caso do print do usuário: divergência 14.999,01 vs par 14.998,06
    expect(isSuspicious(14999.01, "2026-04-17", { amount: 14998.06, date: "2026-04-17" })).toBe(true);
  });

  it("aceita par exatamente no limite de R$ 2,00 e 3 dias", () => {
    expect(isSuspicious(100.00, "2026-05-20", { amount: 102.00, date: "2026-05-23" })).toBe(true);
  });

  it("rejeita par com mais de R$ 2,00 de diferença", () => {
    expect(isSuspicious(100.00, "2026-05-20", { amount: 102.01, date: "2026-05-20" })).toBe(false);
  });

  it("rejeita par com mais de 3 dias de diferença", () => {
    expect(isSuspicious(100.00, "2026-05-20", { amount: 100.00, date: "2026-05-24" })).toBe(false);
  });

  it("aceita par com 3 dias para trás (lag de liquidação reverso)", () => {
    expect(isSuspicious(100.00, "2026-05-20", { amount: 100.00, date: "2026-05-17" })).toBe(true);
  });

  it("aceita par com valor exatamente igual e mesmo dia (match perfeito)", () => {
    expect(isSuspicious(500.00, "2026-05-20", { amount: 500.00, date: "2026-05-20" })).toBe(true);
  });

  it("rejeita par muito longe em ambas as dimensões", () => {
    expect(isSuspicious(100.00, "2026-05-20", { amount: 1000.00, date: "2026-06-01" })).toBe(false);
  });
});
