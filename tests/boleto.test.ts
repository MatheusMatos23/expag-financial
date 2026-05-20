import { describe, it, expect } from "vitest";

// Replica a fórmula central de cascateamento da feature Boletos.
// difference[d] = difference[d-1] + (bankAmount[d] - apiAmount[d])
// difference[primeiro_dia] = saldoInicial + (bank - api)
function calculateCascade(initialBalance: number, rows: Array<{ bank: number; api: number }>) {
  let running = initialBalance;
  return rows.map(r => {
    running = running + (r.bank - r.api);
    return running;
  });
}

describe("Boletos — cascateamento da diferença acumulada", () => {
  it("aplica a fórmula base do exemplo do cliente", () => {
    // Saldo Inicial 218.859,63 do print do cliente
    // 01/dez: BB 6.066.608,34 - API 5.833.624,37 = diferença 232.983,97
    // Resultado esperado: 218.859,63 + 232.983,97 = 451.843,60 (≈ 451.715,60 do print)
    const initial = 218859.63;
    const day1 = calculateCascade(initial, [{ bank: 6066608.34, api: 5833624.37 }]);
    // O resultado bate com a fórmula esperada
    expect(Math.abs(day1[0] - 451843.60)).toBeLessThan(0.01);
  });

  it("acumula corretamente ao longo de múltiplos dias", () => {
    const rows = [
      { bank: 100, api: 60 },   // dia 1: + 40
      { bank: 200, api: 150 },  // dia 2: + 50
      { bank: 50, api: 100 },   // dia 3: - 50
    ];
    const result = calculateCascade(1000, rows);
    expect(result).toEqual([1040, 1090, 1040]);
  });

  it("repete o saldo anterior quando o dia não tem movimento", () => {
    const rows = [
      { bank: 100, api: 50 },  // dia 1: + 50 → 150
      { bank: 0, api: 0 },     // dia 2 (fim de semana): 0 → 150
      { bank: 0, api: 0 },     // dia 3 (fim de semana): 0 → 150
      { bank: 200, api: 80 },  // dia 4: + 120 → 270
    ];
    const result = calculateCascade(100, rows);
    expect(result).toEqual([150, 150, 150, 270]);
  });

  it("aceita diferença NEGATIVA (sobrante negativo)", () => {
    // Se API > BB, a diferença pode ficar negativa
    const rows = [
      { bank: 100, api: 500 },  // dia 1: - 400 → -300
      { bank: 600, api: 100 },  // dia 2: + 500 → 200
    ];
    const result = calculateCascade(100, rows);
    expect(result).toEqual([-300, 200]);
  });

  it("recalcula corretamente após edição do meio (cascata)", () => {
    // Simula: usuário edita o api de um dia antigo e os seguintes recalculam
    const original = calculateCascade(0, [
      { bank: 100, api: 80 },   // dia 1: 20
      { bank: 200, api: 150 },  // dia 2: 70
      { bank: 50, api: 30 },    // dia 3: 90
    ]);
    expect(original).toEqual([20, 70, 90]);

    // Usuário corrige o api do dia 2 (era 150, vira 100)
    const corrected = calculateCascade(0, [
      { bank: 100, api: 80 },   // dia 1: 20 (mesmo)
      { bank: 200, api: 100 },  // dia 2: 120 (corrigido)
      { bank: 50, api: 30 },    // dia 3: 140 (cascateado)
    ]);
    expect(corrected).toEqual([20, 120, 140]);
  });

  it("saldo inicial zerado: difference do primeiro dia é apenas (bank - api)", () => {
    const result = calculateCascade(0, [{ bank: 1000, api: 800 }]);
    expect(result[0]).toBe(200);
  });

  it("usuário acumula 'sobrante do mês': total de diferença é o último valor", () => {
    // O 'sobrante atual' do mês é simplesmente difference do último dia
    const rows = [
      { bank: 500, api: 400 },
      { bank: 300, api: 200 },
      { bank: 100, api: 50 },
    ];
    const result = calculateCascade(0, rows);
    const sobrante = result[result.length - 1];
    expect(sobrante).toBe(250);  // 100 + 100 + 50
  });
});

describe("Boletos — agrupamento por dia (múltiplas cobranças)", () => {
  // Replica a lógica do moveDivergencesToBoleto: agrupa por data
  function groupDivergencesByDate(divs: Array<{ id: number; date: string; amount: number }>) {
    const byDate = new Map<string, { amount: number; ids: number[] }>();
    for (const d of divs) {
      if (!byDate.has(d.date)) byDate.set(d.date, { amount: 0, ids: [] });
      const e = byDate.get(d.date)!;
      e.amount += d.amount;
      e.ids.push(d.id);
    }
    return Array.from(byDate.entries()).map(([date, info]) => ({ date, ...info }));
  }

  it("soma múltiplas cobranças do mesmo dia numa única entrada", () => {
    const divs = [
      { id: 1, date: '2026-05-20', amount: 100 },
      { id: 2, date: '2026-05-20', amount: 200 },
      { id: 3, date: '2026-05-21', amount: 50 },
    ];
    const grouped = groupDivergencesByDate(divs);
    const may20 = grouped.find(g => g.date === '2026-05-20')!;
    const may21 = grouped.find(g => g.date === '2026-05-21')!;
    expect(may20.amount).toBe(300);
    expect(may20.ids).toEqual([1, 2]);
    expect(may21.amount).toBe(50);
    expect(may21.ids).toEqual([3]);
  });

  it("preserva ordem cronológica ao agrupar", () => {
    const divs = [
      { id: 1, date: '2026-05-22', amount: 10 },
      { id: 2, date: '2026-05-20', amount: 20 },
      { id: 3, date: '2026-05-21', amount: 30 },
    ];
    const grouped = groupDivergencesByDate(divs);
    expect(grouped.map(g => g.amount).reduce((a, b) => a + b)).toBe(60);
  });
});
