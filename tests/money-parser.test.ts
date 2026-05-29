import { describe, it, expect } from "vitest";
import { parseMoneyFlexible } from "../server/reconciliation/parsers";

describe("parseMoneyFlexible", () => {
  it("formato US com R$ e espaços (caso real da API)", () => {
    expect(parseMoneyFlexible("-R$ 750.00 ")).toEqual({ value: 750, isNegative: true });
    expect(parseMoneyFlexible(" R$ 500.00 ")).toEqual({ value: 500, isNegative: false });
    expect(parseMoneyFlexible(" R$ 159.50 ")).toEqual({ value: 159.5, isNegative: false });
  });

  it("formato US com separador de milhar (vírgula)", () => {
    expect(parseMoneyFlexible(" R$ 7,680.40 ")).toEqual({ value: 7680.4, isNegative: false });
    expect(parseMoneyFlexible(" R$ 74,752.00 ")).toEqual({ value: 74752, isNegative: false });
    expect(parseMoneyFlexible("-R$ 1,234,567.89")).toEqual({ value: 1234567.89, isNegative: true });
  });

  it("formato BR (ponto=milhar, vírgula=decimal)", () => {
    expect(parseMoneyFlexible("1.234,56")).toEqual({ value: 1234.56, isNegative: false });
    expect(parseMoneyFlexible("-1.500,00")).toEqual({ value: 1500, isNegative: true });
    expect(parseMoneyFlexible("427,44")).toEqual({ value: 427.44, isNegative: false });
    expect(parseMoneyFlexible("R$ 3.000.000,00")).toEqual({ value: 3000000, isNegative: false });
  });

  it("números simples sem separador", () => {
    expect(parseMoneyFlexible("350")).toEqual({ value: 350, isNegative: false });
    expect(parseMoneyFlexible("350.00")).toEqual({ value: 350, isNegative: false });
    expect(parseMoneyFlexible("-42")).toEqual({ value: 42, isNegative: true });
  });

  it("casos extremos / inválidos", () => {
    expect(parseMoneyFlexible("")).toEqual({ value: 0, isNegative: false });
    expect(parseMoneyFlexible(null)).toEqual({ value: 0, isNegative: false });
    expect(parseMoneyFlexible(undefined)).toEqual({ value: 0, isNegative: false });
    expect(parseMoneyFlexible("R$ ")).toEqual({ value: 0, isNegative: false });
    expect(parseMoneyFlexible("abc")).toEqual({ value: 0, isNegative: false });
  });

  it("parênteses indicam negativo (contabilidade)", () => {
    expect(parseMoneyFlexible("(750.00)")).toEqual({ value: 750, isNegative: true });
  });

  it("non-breaking space e marcadores C/D", () => {
    expect(parseMoneyFlexible("\u00a0320.000,00 D")).toEqual({ value: 320000, isNegative: false });
    expect(parseMoneyFlexible("3.000,00 C")).toEqual({ value: 3000, isNegative: false });
  });
});
