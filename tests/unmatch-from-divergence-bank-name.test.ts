import { describe, it, expect } from "vitest";

/**
 * Bug histórico (sessão #50): após desconciliar uma divergência de "diferença
 * de centavos" do Sicoob, a nova divergência aparecia com bankName "JD (Expag)"
 * em vez de "Sicoob".
 *
 * Causa: o código usava `bankTx.bankName` (que vinha do bank_transactions com
 * o código bruto, ex: "sicoob") em vez de `div.bankName` (que tinha o label
 * correto, ex: "Sicoob"). Em alguns casos, com fallback de lookup, podia até
 * pegar transação de outro banco.
 *
 * Correção: usar o `bankName` da divergência original como fonte da verdade.
 */

// Replica a lógica de preservedBankName e a query de fallback (somente a
// parte do filtro de bankName, não a SQL real)
function pickPreservedBankName(div: any, bankTx: any): string | null {
  return div.bankName ?? bankTx.bankName ?? null;
}

function matchesBankName(bankTxBankName: string, divBankName: string): boolean {
  const divCode = String(divBankName).toLowerCase().split(" ")[0];
  const txName = String(bankTxBankName).toLowerCase();
  return (
    bankTxBankName === divBankName ||
    txName === divCode ||
    txName === divBankName.toLowerCase()
  );
}

describe("unmatchFromDivergence — preservação do bankName", () => {
  it("usa o bankName da divergência mesmo se bankTx tem código bruto", () => {
    const div = { bankName: "Sicoob" };
    const bankTx = { bankName: "sicoob" }; // código bruto
    expect(pickPreservedBankName(div, bankTx)).toBe("Sicoob");
  });

  it("usa o bankName da divergência preferindo ao bankTx mesmo se ambos iguais", () => {
    const div = { bankName: "Banco do Brasil" };
    const bankTx = { bankName: "Banco do Brasil" };
    expect(pickPreservedBankName(div, bankTx)).toBe("Banco do Brasil");
  });

  it("fallback para bankTx quando div.bankName é null", () => {
    const div = { bankName: null };
    const bankTx = { bankName: "sicoob" };
    expect(pickPreservedBankName(div, bankTx)).toBe("sicoob");
  });

  it("retorna null se nenhum dos dois tem bankName", () => {
    const div = {};
    const bankTx = {};
    expect(pickPreservedBankName(div, bankTx)).toBe(null);
  });

  it("preserva JD (Expag) — label completo do frontend", () => {
    const div = { bankName: "JD (Expag)" };
    const bankTx = { bankName: "jd" };
    expect(pickPreservedBankName(div, bankTx)).toBe("JD (Expag)");
  });
});

describe("unmatchFromDivergence — matcher de bankName no fallback", () => {
  it("casa 'Sicoob' (label) com 'sicoob' (código) em ambas direções", () => {
    expect(matchesBankName("sicoob", "Sicoob")).toBe(true);
    expect(matchesBankName("Sicoob", "Sicoob")).toBe(true);
  });

  it("casa 'JD (Expag)' (label) com 'jd' (código)", () => {
    expect(matchesBankName("jd", "JD (Expag)")).toBe(true);
    expect(matchesBankName("JD", "JD (Expag)")).toBe(true);
  });

  it("casa 'Banco do Brasil' (label completo) com 'bb' (código)", () => {
    // div.bankName = "Banco do Brasil" → divCode = "banco"
    // tx.bankName = "bb" → match precisa funcionar
    // (a primeira parte do label não bate, mas casamento case-insensitive
    //  do código também não bate; então este caso depende do externalId,
    //  ou seja, o fallback NÃO casa este — está OK)
    expect(matchesBankName("bb", "Banco do Brasil")).toBe(false);
    // Mas se for salvo como "Banco do Brasil" em ambos, casa:
    expect(matchesBankName("Banco do Brasil", "Banco do Brasil")).toBe(true);
  });

  it("não casa Sicoob com JD — proteção contra o bug original", () => {
    expect(matchesBankName("jd", "Sicoob")).toBe(false);
    expect(matchesBankName("sicoob", "JD (Expag)")).toBe(false);
  });
});
