import { describe, it, expect } from "vitest";

// Replica a heurística do frontend para detectar pares de contrapartida.
// Critério: ambos com matchType='manual' E pelo menos um com channel='MANUAL'.
function isCounterpartPair(bank: any, api: any): boolean {
  return (
    bank?.matchType === 'manual' &&
    api?.matchType === 'manual' &&
    (bank?.channel === 'MANUAL' || api?.channel === 'MANUAL')
  );
}

describe("isCounterpartPair — distinguir conciliação automática vs contrapartida", () => {
  it("detecta par criado por 'Lançar contrapartida' (channel MANUAL)", () => {
    const bank = { matchType: 'manual', channel: 'MANUAL' };
    const api  = { matchType: 'manual', channel: 'PIX' };
    expect(isCounterpartPair(bank, api)).toBe(true);
  });

  it("detecta quando o lado da API foi o lançamento manual", () => {
    const bank = { matchType: 'manual', channel: 'PIX' };
    const api  = { matchType: 'manual', channel: 'MANUAL' };
    expect(isCounterpartPair(bank, api)).toBe(true);
  });

  it("não confunde conciliação automática do motor com contrapartida", () => {
    const bank = { matchType: 'exact', channel: 'PIX' };
    const api  = { matchType: 'exact', channel: 'PIX' };
    expect(isCounterpartPair(bank, api)).toBe(false);
  });

  it("não confunde conciliação manual de divergências existentes com contrapartida", () => {
    // Conciliação manual de uma divergência usa matchType='manual' mas o channel
    // permanece o original (PIX, TED, etc) — não MANUAL
    const bank = { matchType: 'manual', channel: 'PIX' };
    const api  = { matchType: 'manual', channel: 'PIX' };
    expect(isCounterpartPair(bank, api)).toBe(false);
  });

  it("trata transações sem matchType sem quebrar", () => {
    expect(isCounterpartPair(null, null)).toBe(false);
    expect(isCounterpartPair({}, {})).toBe(false);
    expect(isCounterpartPair({ matchType: 'manual' }, { matchType: 'manual' })).toBe(false);
  });
});
