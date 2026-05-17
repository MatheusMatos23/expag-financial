import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseGenericStatement } from "../server/reconciliation/genericParser";

// Helper: cria um buffer XLSX a partir de uma matriz de linhas
function makeXlsx(rows: any[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extrato");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseGenericStatement — layout padrão", () => {
  it("lê extrato com colunas Data / Histórico / Valor / C-D", () => {
    const buf = makeXlsx([
      ["Data", "Histórico", "Valor", "Tipo"],
      ["15/01/2026", "PIX recebido João", "1.500,00", "C"],
      ["16/01/2026", "Pagamento fornecedor", "320,50", "D"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].amount).toBe(1500);
    expect(r.transactions[0].type).toBe("credit");
    expect(r.transactions[1].type).toBe("debit");
  });
});

describe("parseGenericStatement — colunas em posições diferentes", () => {
  it("detecta colunas mesmo fora de ordem", () => {
    // Valor vem ANTES da data, descrição no fim
    const buf = makeXlsx([
      ["Valor R$", "Tipo", "Data Lançamento", "Descrição"],
      ["2.000,00", "C", "10/02/2026", "TED recebida"],
      ["150,00", "D", "11/02/2026", "Tarifa mensal"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].amount).toBe(2000);
    expect(r.transactions[0].type).toBe("credit");
  });

  it("lida com colunas extras no meio", () => {
    const buf = makeXlsx([
      ["Agência", "Conta", "Data", "Doc", "Histórico", "Valor", "C/D"],
      ["0001", "12345", "20/03/2026", "999", "Recebimento PIX", "5.000,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe(5000);
  });
});

describe("parseGenericStatement — linhas de cabeçalho variáveis", () => {
  it("ignora linhas de título antes do cabeçalho", () => {
    const buf = makeXlsx([
      ["BANCO EXEMPLO S.A."],
      ["Extrato de conta corrente"],
      ["Período: 01/01/2026 a 31/01/2026"],
      [],
      ["Data", "Histórico", "Valor", "Tipo"],
      ["05/01/2026", "Depósito", "800,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe(800);
  });

  it("ignora linhas de saldo", () => {
    const buf = makeXlsx([
      ["Data", "Histórico", "Valor", "Tipo"],
      ["01/01/2026", "Saldo Anterior", "10.000,00", "C"],
      ["05/01/2026", "PIX recebido", "500,00", "C"],
      ["31/01/2026", "Saldo", "10.500,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    // Apenas a transação real — saldos ignorados
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].description).toContain("PIX");
  });
});

describe("parseGenericStatement — formatos de número", () => {
  it("aceita formato brasileiro 1.234,56", () => {
    const buf = makeXlsx([
      ["Data", "Descrição", "Valor", "Tipo"],
      ["10/01/2026", "Teste", "1.234.567,89", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions[0].amount).toBe(1234567.89);
  });

  it("aceita valor com sinal negativo (sem coluna C/D)", () => {
    const buf = makeXlsx([
      ["Data", "Descrição", "Valor"],
      ["10/01/2026", "Crédito", "1.000,00"],
      ["11/01/2026", "Débito", "-500,00"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions[0].type).toBe("credit");
    expect(r.transactions[1].type).toBe("debit");
    expect(r.transactions[1].amount).toBe(500);
  });

  it("aceita valor com sufixo R$", () => {
    const buf = makeXlsx([
      ["Data", "Descrição", "Valor", "Tipo"],
      ["10/01/2026", "Teste", "R$ 750,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions[0].amount).toBe(750);
  });
});

describe("parseGenericStatement — colunas separadas de crédito/débito", () => {
  it("lê extrato com coluna de Crédito e coluna de Débito separadas", () => {
    const buf = makeXlsx([
      ["Data", "Histórico", "Crédito", "Débito"],
      ["10/01/2026", "Recebimento", "1.000,00", ""],
      ["11/01/2026", "Pagamento", "", "300,00"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].type).toBe("credit");
    expect(r.transactions[0].amount).toBe(1000);
    expect(r.transactions[1].type).toBe("debit");
    expect(r.transactions[1].amount).toBe(300);
  });
});

describe("parseGenericStatement — detecção sem cabeçalho", () => {
  it("detecta colunas por conteúdo quando não há cabeçalho", () => {
    // Sem linha de cabeçalho — só dados
    const rows: any[][] = [];
    for (let i = 1; i <= 10; i++) {
      rows.push([`${String(i).padStart(2,"0")}/01/2026`, `Transacao ${i}`, `${i * 100},00`]);
    }
    const buf = makeXlsx(rows);
    const r = parseGenericStatement(buf);
    expect(r.transactions.length).toBeGreaterThan(5);
  });
});

describe("parseGenericStatement — robustez", () => {
  it("retorna aviso quando não detecta colunas", () => {
    const buf = makeXlsx([
      ["xxx", "yyy", "zzz"],
      ["abc", "def", "ghi"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("expõe quais colunas foram detectadas", () => {
    const buf = makeXlsx([
      ["Data", "Histórico", "Valor", "Tipo"],
      ["15/01/2026", "Teste", "100,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.detectedColumns.date).toBe("A");
    expect(r.detectedColumns.amount).toBe("C");
    expect(r.detectedColumns.headerDetected).toBe(true);
  });

  it("aceita datas em formato ISO", () => {
    const buf = makeXlsx([
      ["Data", "Descrição", "Valor", "Tipo"],
      ["2026-01-15", "Teste ISO", "200,00", "C"],
    ]);
    const r = parseGenericStatement(buf);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].date).toBe("2026-01-15");
  });
});
