import { describe, it, expect } from "vitest";

// Replica a lógica de toMysqlDate (server/db.ts) para teste isolado —
// evita importar server/db.ts inteiro (que puxa conexão de banco).
function toMysqlDate(raw: any): string {
  if (raw instanceof Date) {
    return isNaN(raw.getTime())
      ? new Date().toISOString().slice(0, 10)
      : raw.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

describe("toMysqlDate — conversão de data para o MySQL", () => {
  it("converte objeto Date para AAAA-MM-DD", () => {
    const d = new Date("2026-04-17T00:00:00Z");
    expect(toMysqlDate(d)).toBe("2026-04-17");
  });

  it("mantém string ISO já no formato correto", () => {
    expect(toMysqlDate("2026-04-17")).toBe("2026-04-17");
  });

  it("corta string ISO com horário", () => {
    expect(toMysqlDate("2026-04-17T22:28:00")).toBe("2026-04-17");
  });

  it("NÃO produz 'Fri Apr 17' a partir de um Date (o bug original)", () => {
    const d = new Date("2026-04-17T00:00:00Z");
    const result = toMysqlDate(d);
    expect(result).not.toContain("Apr");
    expect(result).not.toContain("Fri");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("usa data de hoje como fallback para valor inválido", () => {
    const result = toMysqlDate("texto invalido");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("trata null e undefined sem quebrar", () => {
    expect(toMysqlDate(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toMysqlDate(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
