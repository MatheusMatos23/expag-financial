import { describe, it, expect } from "vitest";
import {
  formatCurrency, formatCurrencyCompact, safeNumber,
  calcVariation, getPriorityOrder, formatPercent,
} from "../client/src/lib/utils";

// Normaliza espaços (Intl pode usar nbsp ou espaço normal)
const norm = (s: string) => s.replace(/\s/g, " ");

describe("formatCurrency", () => {
  it("formata valor positivo em BRL", () => {
    expect(norm(formatCurrency(1234.56))).toBe("R$ 1.234,56");
  });

  it("formata zero", () => {
    expect(norm(formatCurrency(0))).toBe("R$ 0,00");
  });

  it("formata valor negativo", () => {
    expect(formatCurrency(-500)).toContain("500,00");
  });

  it("aceita string numérica", () => {
    expect(norm(formatCurrency("99.9"))).toBe("R$ 99,90");
  });

  it("trata null/undefined como zero", () => {
    expect(norm(formatCurrency(null))).toBe("R$ 0,00");
    expect(norm(formatCurrency(undefined))).toBe("R$ 0,00");
  });

  it("trata string inválida como zero", () => {
    expect(norm(formatCurrency("abc"))).toBe("R$ 0,00");
  });
});

describe("formatCurrencyCompact", () => {
  it("mostra valor completo abaixo de R$1 bilhão", () => {
    expect(norm(formatCurrencyCompact(1_500_000))).toBe("R$ 1.500.000,00");
  });

  it("abrevia apenas valores >= R$1 bilhão", () => {
    const result = formatCurrencyCompact(2_500_000_000);
    expect(result).toContain("B");
    expect(result).toContain("2.50");
  });

  it("trata zero", () => {
    expect(norm(formatCurrencyCompact(0))).toBe("R$ 0,00");
  });
});

describe("safeNumber", () => {
  it("converte string numérica", () => {
    expect(safeNumber("42.5")).toBe(42.5);
  });

  it("retorna número direto", () => {
    expect(safeNumber(100)).toBe(100);
  });

  it("retorna fallback para null", () => {
    expect(safeNumber(null)).toBe(0);
    expect(safeNumber(null, 99)).toBe(99);
  });

  it("retorna fallback para string inválida", () => {
    expect(safeNumber("xyz")).toBe(0);
    expect(safeNumber("xyz", -1)).toBe(-1);
  });

  it("trata undefined", () => {
    expect(safeNumber(undefined)).toBe(0);
  });
});

describe("calcVariation", () => {
  it("calcula variação positiva", () => {
    const v = calcVariation(150, 100);
    expect(v.value).toBe(50);
    expect(v.isPositive).toBe(true);
    expect(v.isNeutral).toBe(false);
  });

  it("calcula variação negativa", () => {
    const v = calcVariation(80, 100);
    expect(v.value).toBe(-20);
    expect(v.isPositive).toBe(false);
  });

  it("trata divisor zero como neutro", () => {
    const v = calcVariation(100, 0);
    expect(v.isNeutral).toBe(true);
    expect(v.value).toBe(0);
  });

  it("variação zero é neutra", () => {
    const v = calcVariation(100, 100);
    expect(v.value).toBe(0);
    expect(v.isNeutral).toBe(true);
  });
});

describe("getPriorityOrder", () => {
  it("critical vem antes de high", () => {
    expect(getPriorityOrder("critical")).toBeLessThan(getPriorityOrder("high"));
  });

  it("high vem antes de medium", () => {
    expect(getPriorityOrder("high")).toBeLessThan(getPriorityOrder("medium"));
  });

  it("medium vem antes de low", () => {
    expect(getPriorityOrder("medium")).toBeLessThan(getPriorityOrder("low"));
  });

  it("prioridade desconhecida vai para o fim", () => {
    expect(getPriorityOrder("xpto")).toBe(99);
  });
});

describe("formatPercent", () => {
  it("formata percentual básico", () => {
    expect(formatPercent(50, 100)).toContain("50");
  });

  it("trata divisor zero", () => {
    const r = formatPercent(10, 0);
    expect(r).toBeDefined();
  });
});
