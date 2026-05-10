/**
 * Expag Financial System — Demo Seed
 */

import * as db from "./db";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

function rand(min: number, max: number, decimals = 2): number {
  const v = Math.random() * (max - min) + min;
  return parseFloat(v.toFixed(decimals));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatAmount(n: number): string {
  return n.toFixed(2);
}

function addBusinessDays(date: string, days: number): string {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

// ─── MASTER DATA ──────────────────────────────────────────────────────────────

const CLIENTS = [
  { id: "CLI001", name: "Mercantil Premium LTDA" },
  { id: "CLI002", name: "Distribuidora Norte S.A." },
  { id: "CLI003", name: "Tech Pagamentos S.A." },
  { id: "CLI004", name: "Grupo Financeiro Alfa" },
  { id: "CLI005", name: "Varejo Central Comércio LTDA" },
  { id: "CLI006", name: "Construtora Rio Verde" },
  { id: "CLI007", name: "Agro Exportações do Brasil" },
  { id: "CLI008", name: "Rede Farmácias Saúde+" },
  { id: "CLI009", name: "Logística Expressa S.A." },
  { id: "CLI010", name: "E-commerce Digital Works" },
];

const BANKS = [
  { code: "341", name: "Itaú Unibanco" },
  { code: "237", name: "Bradesco" },
  { code: "033", name: "Santander" },
  { code: "001", name: "Banco do Brasil" },
  { code: "260", name: "Nu Pagamentos" },
  { code: "077", name: "Banco Inter" },
];

const PIX_DESCRIPTIONS = [
  "PIX RECEBIDO - {client}",
  "TRANSFERENCIA PIX - {client}",
  "PIX IN - PAGAMENTO {client}",
  "REC PIX {client}",
  "PIX CLIENTE {client}",
];

const TED_DESCRIPTIONS = [
  "TED RECEBIDA - {client}",
  "CREDITO TED - {client}",
  "TED TRANSFERENCIA - {client}",
];

const DEBIT_DESCRIPTIONS = [
  "PIX ENVIADO - {client}",
  "PAGAMENTO TED - {client}",
  "TRANSF SAIDA - {client}",
  "PIX OUT - REPASSE {client}",
  "PAGTO BOLETO {client}",
];

const EXPENSE_DESCRIPTIONS = [
  "FOLHA PAGAMENTO FUNCIONARIOS",
  "PROLABORE SOCIOS",
  "ALUGUEL ESCRITORIO CENTRAL",
  "CONTA LUZ ESCRITORIO",
  "TELEFONIA E INTERNET",
  "SOFTWARE E LICENCAS SaaS",
  "MATERIAL DE ESCRITORIO",
  "COMBUSTIVEL FROTA",
  "MANUTENCAO EQUIPAMENTOS",
  "SERVICOS CONTABILIDADE",
];

const COST_CENTERS = [
  { name: "Operações Financeiras", type: "operacional" },
  { name: "Tecnologia da Informação", type: "operacional" },
  { name: "Recursos Humanos", type: "administrativo" },
  { name: "Comercial e Vendas", type: "comercial" },
  { name: "Jurídico e Compliance", type: "administrativo" },
];

// ─── MAIN SEED FUNCTION ───────────────────────────────────────────────────────

export async function runSeed() {
  console.log("🌱 Iniciando seed de dados demo...\n");

  // ── 1. Cost Centers ──
  console.log("📁 Criando centros de custo...");
  for (const cc of COST_CENTERS) {
    await db.createCostCenter(cc);
  }

  // ── 2. Managerial Balance History (60 days) ──
  console.log("💰 Gerando histórico de saldo gerencial (60 dias)...");
  let bankBalance = 4_850_000;
  let clientBalance = 2_100_000;
  let committedBalance = 380_000;

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    // Simulate realistic daily fluctuations
    bankBalance += rand(-120_000, 280_000);
    bankBalance = Math.max(bankBalance, 2_000_000);
    clientBalance += rand(-80_000, 150_000);
    clientBalance = Math.max(clientBalance, 1_000_000);
    committedBalance += rand(-30_000, 50_000);
    committedBalance = Math.max(committedBalance, 200_000);

    const divergenceBalance = rand(15_000, 95_000);
    const ownCash = bankBalance - clientBalance;
    const realCash = bankBalance - clientBalance - committedBalance + divergenceBalance;
    const freeCash = ownCash - committedBalance;

    await db.upsertManagerialBalance({
      referenceDate: isoDate(daysAgo),
      bankBalance: formatAmount(bankBalance),
      clientBalance: formatAmount(clientBalance),
      committedBalance: formatAmount(committedBalance),
      divergenceBalance: formatAmount(divergenceBalance),
      openDivergences: Math.floor(rand(3, 28, 0)),
      thirdPartyResources: formatAmount(clientBalance * 0.35),
      futureObligations: formatAmount(committedBalance * 0.6),
      fundingNeeded: freeCash < 100_000 ? formatAmount(200_000 - freeCash) : "0.00",
    });
  }

  // ── 3. DRE History (12 months) ──
  console.log("📊 Gerando DRE mensal (12 meses)...");
  for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo--) {
    const refDate = new Date();
    refDate.setMonth(refDate.getMonth() - monthsAgo);
    const refMonth = refDate.toISOString().slice(0, 7);

    const grossRevenue = rand(1_800_000, 3_200_000);
    const financialCosts = grossRevenue * rand(0.08, 0.14);
    const operationalCosts = grossRevenue * rand(0.22, 0.32);
    const taxes = grossRevenue * rand(0.04, 0.07);
    const netRevenue = grossRevenue - financialCosts - taxes;
    const grossProfit = netRevenue - operationalCosts;
    const adminExpenses = grossRevenue * rand(0.05, 0.09);
    const ebitda = grossProfit - adminExpenses;
    const depAmort = ebitda * rand(0.02, 0.04);
    const ebit = ebitda - depAmort;
    const irCsll = Math.max(0, ebit * 0.25);
    const netProfit = ebit - irCsll;

    await db.upsertDRE({
      referenceMonth: refMonth,
      grossRevenue: formatAmount(grossRevenue),
      financialCosts: formatAmount(financialCosts),
      operationalCosts: formatAmount(operationalCosts),
      taxes: formatAmount(taxes),
      netRevenue: formatAmount(netRevenue),
      adminExpenses: formatAmount(adminExpenses),
    });
  }

  // ── 4. Cash Flow History (30 days) ──
  console.log("📈 Gerando fluxo de caixa (30 dias)...");
  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const inflows = rand(180_000, 520_000);
    const outflows = rand(120_000, 380_000);
    const pixIn = inflows * rand(0.55, 0.75);
    const tedIn = inflows * rand(0.15, 0.25);
    const boletoIn = inflows - pixIn - tedIn;
    const pixOut = outflows * rand(0.40, 0.60);
    const tedOut = outflows * rand(0.20, 0.35);
    const boletoOut = outflows - pixOut - tedOut;

    await db.upsertCashFlow({
      referenceDate: isoDate(daysAgo),
      realizedInflows: formatAmount(inflows),
      realizedOutflows: formatAmount(outflows),
    });
  }

  // ── 5. Revenues (current + last month) ──
  console.log("💸 Gerando receitas (60 dias)...");
  const revenueTypes = [
    { type: "pix", weight: 0.45, min: 1_500, max: 85_000 },
    { type: "ted", weight: 0.20, min: 5_000, max: 150_000 },
    { type: "boleto", weight: 0.15, min: 800, max: 45_000 },
    { type: "credito", weight: 0.08, min: 2_000, max: 30_000 },
    { type: "antecipacao", weight: 0.07, min: 10_000, max: 200_000 },
    { type: "tarifa", weight: 0.05, min: 500, max: 8_000 },
  ];

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const numRevs = Math.floor(rand(3, 9, 0));
    for (let i = 0; i < numRevs; i++) {
      const rtype = pick(revenueTypes);
      const client = pick(CLIENTS);
      await db.createRevenue({
        type: rtype.type,
        amount: formatAmount(rand(rtype.min, rtype.max)),
        referenceDate: isoDate(daysAgo),
        description: `${rtype.type.toUpperCase()} - ${client.name}`,
        clientId: client.id,
        clientName: client.name,
        status: daysAgo > 2 ? "realizado" : pick(["realizado", "previsto"]),
      });
    }
  }

  // ── 6. Expenses (current + last month) ──
  console.log("🧾 Gerando despesas (60 dias)...");
  const expenseCategories = [
    { cat: "folha", min: 35_000, max: 120_000, freq: 2 },
    { cat: "infra", min: 5_000, max: 25_000, freq: 8 },
    { cat: "impostos", min: 8_000, max: 60_000, freq: 5 },
    { cat: "operacional", min: 2_000, max: 18_000, freq: 10 },
    { cat: "marketing", min: 3_000, max: 22_000, freq: 6 },
    { cat: "juridico", min: 4_000, max: 15_000, freq: 4 },
    { cat: "tecnologia", min: 6_000, max: 30_000, freq: 7 },
    { cat: "administrativo", min: 1_500, max: 8_000, freq: 12 },
  ];

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    for (const ecat of expenseCategories) {
      if (Math.random() < 1 / ecat.freq) {
        await db.createExpense({
          category: ecat.cat,
          amount: formatAmount(rand(ecat.min, ecat.max)),
          referenceDate: isoDate(daysAgo),
          description: pick(EXPENSE_DESCRIPTIONS),
          status: daysAgo > 1 ? "realizado" : "previsto",
        });
      }
    }
  }

  // ── 7. Payables ──
  console.log("📋 Gerando contas a pagar...");
  const payableItems = [
    { desc: "Aluguel Sede Social", cat: "administrativo", amount: 28_500, daysUntil: 12 },
    { desc: "Folha de Pagamento - Maio/2026", cat: "folha", amount: 187_300, daysUntil: 5 },
    { desc: "DARF - IRPJ/CSLL Trimestral", cat: "impostos", amount: 43_200, daysUntil: 3 },
    { desc: "Licença Salesforce CRM", cat: "tecnologia", amount: 8_900, daysUntil: 18 },
    { desc: "Seguro Empresarial Multirisco", cat: "administrativo", amount: 12_400, daysUntil: 25 },
    { desc: "Consultoria Jurídica Mensal", cat: "juridico", amount: 15_000, daysUntil: 8 },
    { desc: "Google Cloud Platform", cat: "tecnologia", amount: 6_780, daysUntil: 20 },
    { desc: "Conta de Energia - Sede", cat: "operacional", amount: 4_320, daysUntil: -5 }, // vencida
    { desc: "Prolabore Sócios - Maio/2026", cat: "folha", amount: 45_000, daysUntil: 1 },
    { desc: "Remuneração Auditoria Externa", cat: "juridico", amount: 22_000, daysUntil: 30 },
    { desc: "FGTS e INSS - Competência Abr/2026", cat: "impostos", amount: 31_500, daysUntil: -2 }, // vencida
    { desc: "Assinatura Adobe Creative", cat: "tecnologia", amount: 3_200, daysUntil: 15 },
    { desc: "Correios e Sedex - Contratos", cat: "operacional", amount: 2_100, daysUntil: 22 },
    { desc: "Manutenção Infraestrutura TI", cat: "infra", amount: 18_500, daysUntil: 10 },
  ];

  for (const p of payableItems) {
    const dueDate = p.daysUntil >= 0
      ? isoDate(-p.daysUntil)
      : isoDate(Math.abs(p.daysUntil));

    await db.createPayable({
      description: p.desc,
      amount: formatAmount(p.amount),
      dueDate,
      category: p.cat,
    });
  }

  // ── 8. Credit Portfolio ──
  console.log("💳 Gerando carteira de crédito...");
  const loanConfigs = [
    { client: CLIENTS[0], principal: 850_000, rate: 0.018, installments: 36, daysAgo: 120, status: "ativo" as const },
    { client: CLIENTS[2], principal: 320_000, rate: 0.022, installments: 24, daysAgo: 200, status: "ativo" as const },
    { client: CLIENTS[4], principal: 1_200_000, rate: 0.015, installments: 48, daysAgo: 60, status: "ativo" as const },
    { client: CLIENTS[6], principal: 450_000, rate: 0.020, installments: 18, daysAgo: 350, status: "inadimplente" as const },
    { client: CLIENTS[8], principal: 180_000, rate: 0.025, installments: 12, daysAgo: 400, status: "quitado" as const },
    { client: CLIENTS[1], principal: 680_000, rate: 0.017, installments: 30, daysAgo: 90, status: "ativo" as const },
  ];

  for (const loan of loanConfigs) {
    const startDate = isoDate(loan.daysAgo);
    const endDate = (() => {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + loan.installments);
      return d.toISOString().split("T")[0];
    })();

    const r = loan.rate;
    const n = loan.installments;
    const P = loan.principal;
    const monthlyPayment = r > 0
      ? P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
      : P / n;

    const paidInstallments = loan.status === "quitado"
      ? n
      : Math.floor(loan.daysAgo / 30);

    const outstandingBalance = loan.status === "quitado"
      ? 0
      : P * Math.pow(1 + r, paidInstallments) - monthlyPayment * ((Math.pow(1 + r, paidInstallments) - 1) / r);

    const creditId = await db.createCreditEntry({
      clientId: loan.client.id,
      clientName: loan.client.name,
      principal: formatAmount(loan.principal),
      interestRate: formatAmount(loan.rate),
      totalInstallments: loan.installments,
      startDate,
      expectedEndDate: endDate,
      fundingSource: pick(["capital_proprio", "uso_custodia", "externo"]),
    });

    // Generate installments for active loans
    if (loan.status !== "quitado") {
      const installments: Parameters<typeof db.createCreditInstallments>[0] = [];
      let balance = P;
      for (let i = 1; i <= Math.min(n, paidInstallments + 6); i++) {
        const dueDate = (() => {
          const d = new Date(startDate);
          d.setMonth(d.getMonth() + i);
          return d.toISOString().split("T")[0];
        })();
        const interest = balance * r;
        const principalPart = monthlyPayment - interest;
        balance -= principalPart;

        const isPaid = i <= paidInstallments;
        const isOverdue = !isPaid && new Date(dueDate) < new Date();

        installments.push({
          creditId: creditId as number,
          installmentNumber: i,
          dueDate,
          principalAmount: formatAmount(principalPart),
          interestAmount: formatAmount(interest),
          totalAmount: formatAmount(monthlyPayment),
        });
      }
      await db.createCreditInstallments(installments);
    }
  }

  // ── 9. Reconciliation Sessions (3 sessions) ──
  console.log("🔁 Gerando sessões de conciliação com dados reais...");

  for (let sessionIdx = 0; sessionIdx < 3; sessionIdx++) {
    const daysAgo = [14, 7, 1][sessionIdx];
    const refDate = isoDate(daysAgo);

    const sessionId = await db.createReconciliationSession({
      userId: 1,
      referenceDate: refDate,
    });

    const numTx = [120, 95, 78][sessionIdx];
    const bankCredits: Parameters<typeof db.insertBankTransactions>[0] = [];
    const bankDebits: Parameters<typeof db.insertBankTransactions>[0] = [];
    const apiCredits: Parameters<typeof db.insertApiTransactions>[0] = [];
    const apiDebits: Parameters<typeof db.insertApiTransactions>[0] = [];

    // Generate matched pairs (85% match rate)
    const matchedCount = Math.floor(numTx * 0.85);
    for (let i = 0; i < matchedCount; i++) {
      const client = pick(CLIENTS);
      const bank = pick(BANKS);
      const amount = formatAmount(rand(500, 95_000));
      const channel = pick(["PIX", "TED", "BOLETO"]);
      const dayOffset = Math.floor(rand(0, 2, 0));
      const txDate = isoDate(daysAgo + dayOffset);
      const descTemplate = channel === "PIX"
        ? pick(PIX_DESCRIPTIONS)
        : pick(TED_DESCRIPTIONS);
      const description = descTemplate.replace("{client}", client.name);

      bankCredits.push({
        sessionId, type: "credit", transactionDate: txDate,
        description, amount,
        channel, bankName: bank.name, externalId: `EXT-${sessionId}-${i}`,
      });
      apiCredits.push({
        sessionId, type: "credit",
        transactionDate: isoDate(daysAgo),
        description: `${channel} ${client.name.toUpperCase()}`,
        amount, channel,
        clientId: client.id, clientName: client.name,
        externalId: `API-${sessionId}-${i}`,
      });
    }

    // Generate debit pairs
    const debitCount = Math.floor(numTx * 0.6);
    for (let i = 0; i < debitCount; i++) {
      const client = pick(CLIENTS);
      const bank = pick(BANKS);
      const amount = formatAmount(rand(1_000, 50_000));
      const channel = pick(["PIX", "TED"]);
      const description = pick(DEBIT_DESCRIPTIONS).replace("{client}", client.name);

      bankDebits.push({
        sessionId, type: "debit",
        transactionDate: isoDate(daysAgo),
        description, amount, channel, bankName: bank.name,
      });
      apiDebits.push({
        sessionId, type: "debit",
        transactionDate: isoDate(daysAgo),
        description: `SAIDA ${channel} ${client.name.toUpperCase()}`,
        amount, channel,
        clientId: client.id, clientName: client.name,
      });
    }

    // Unmatched bank credits (divergências)
    const divergenceAmounts = [
      rand(1_200, 8_500),
      rand(12_000, 45_000),
      rand(95_000, 215_000), // crítica
      rand(3_500, 18_000),
      rand(800, 6_000),
    ];
    for (const amount of divergenceAmounts) {
      const bank = pick(BANKS);
      const channel = pick(["PIX", "TED"]);
      bankCredits.push({
        sessionId, type: "credit",
        transactionDate: isoDate(daysAgo),
        description: channel === "PIX"
          ? `PIX RECEBIDO SEM IDENTIFICACAO - ${bank.name}`
          : `TED CREDITO NAO IDENTIFICADO - ${bank.name}`,
        amount: formatAmount(amount),
        channel, bankName: bank.name,
      });
    }

    // Unmatched API debits (bank_shortage)
    const shortageAmounts = [rand(5_000, 30_000), rand(800, 4_500)];
    for (const amount of shortageAmounts) {
      const client = pick(CLIENTS);
      apiDebits.push({
        sessionId, type: "debit",
        transactionDate: isoDate(daysAgo),
        description: `TARIFA BANCARIA DEBITO AUTOMATICO ${pick(BANKS).name}`,
        amount: formatAmount(amount),
        channel: "DEBITO_AUTOMATICO",
        clientId: client.id, clientName: client.name,
      });
    }

    // Insert all transactions
    await db.insertBankTransactions(bankCredits);
    await db.insertBankTransactions(bankDebits);
    await db.insertApiTransactions(apiCredits);
    await db.insertApiTransactions(apiDebits);

    // Mark matched pairs
    const bkTxs = await db.getBankTransactionsBySession(sessionId);
    const apiTxs = await db.getApiTransactionsBySession(sessionId);

    for (let i = 0; i < matchedCount && i < bkTxs.length && i < apiTxs.length; i++) {
      await db.updateBankTransactionMatch(bkTxs[i].id, {
        matchStatus: "matched", matchedApiTransactionId: apiTxs[i].id, matchType: "exact",
      });
      await db.updateApiTransactionMatch(apiTxs[i].id, {
        matchStatus: "matched", matchedBankTransactionId: bkTxs[i].id, matchType: "exact",
      });
    }

    // Create divergences with realistic classifications
    const divergenceConfigs = [
      { type: "bank_surplus" as const, amount: formatAmount(divergenceAmounts[0]), category: "pix_sem_cliente", priority: "medium" as const, desc: "PIX RECEBIDO SEM IDENTIFICACAO", channel: "PIX" },
      { type: "bank_surplus" as const, amount: formatAmount(divergenceAmounts[1]), category: "ted_orfa", priority: "high" as const, desc: "TED CREDITO NAO IDENTIFICADO", channel: "TED" },
      { type: "bank_surplus" as const, amount: formatAmount(divergenceAmounts[2]), category: "deposito_nao_identificado", priority: "critical" as const, desc: "CREDITO ELEVADO SEM ORIGEM", channel: "TED" },
      { type: "bank_surplus" as const, amount: formatAmount(divergenceAmounts[3]), category: "receita_nao_lancada", priority: "medium" as const, desc: "PIX SEM LANCAMENTO CORRESPONDENTE", channel: "PIX" },
      { type: "bank_surplus" as const, amount: formatAmount(divergenceAmounts[4]), category: "tarifa_nao_apropriada", priority: "low" as const, desc: "TARIFA BANCO NAO LANCADA", channel: "PIX" },
      { type: "bank_shortage" as const, amount: formatAmount(shortageAmounts[0]), category: "tarifa_bancaria", priority: "high" as const, desc: "TARIFA BANCARIA DEBITO AUTOMATICO", channel: "DEBITO_AUTOMATICO" },
      { type: "bank_shortage" as const, amount: formatAmount(shortageAmounts[1]), category: "tarifa_bancaria", priority: "low" as const, desc: "TARIFA BANCARIA DEBITO AUTOMATICO", channel: "DEBITO_AUTOMATICO" },
    ];

    const statusOptions = ["pendente", "em_analise", "pendente", "identificado", "pendente"] as const;

    for (const cfg of divergenceConfigs) {
      await db.createDivergence({
        sessionId,
        divergenceDate: refDate,
        divergenceType: cfg.type,
        amount: cfg.amount,
        category: cfg.category,
        priority: cfg.priority,
        slaDeadline: addBusinessDays(refDate, cfg.priority === "critical" ? 1 : cfg.priority === "high" ? 3 : cfg.priority === "medium" ? 7 : 15),
        bankName: pick(BANKS).name,
        responsible: sessionIdx === 0 ? pick(["Ana Silva", "Carlos Mendes", "Beatriz Costa", ""]) : undefined,
        origin: cfg.channel,
      });
    }

    // Update session summary
    const totalMatched = matchedCount;
    const totalDivergent = divergenceConfigs.length;
    const totalBankCred = bankCredits.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalBankDeb = bankDebits.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalApiCred = apiCredits.reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalApiDeb = apiDebits.reduce((s, t) => s + parseFloat(t.amount), 0);

    await db.updateReconciliationSession(sessionId, {
      status: "completed",
      matchedCount: totalMatched,
      divergentCount: totalDivergent,
      pendingCount: 0,
      totalBankCredits: formatAmount(totalBankCred),
      totalBankDebits: formatAmount(totalBankDeb),
      totalApiCredits: formatAmount(totalApiCred),
      totalApiDebits: formatAmount(totalApiDeb),
    });

    console.log(`   ✓ Sessão ${sessionId} (${refDate}): ${totalMatched} conciliados, ${totalDivergent} divergências`);
  }

  // ── 10. Alerts ──
  console.log("🔔 Gerando alertas do sistema...");
  const alertConfigs = [
    {
      type: "critical_divergence", title: "Divergência Crítica: R$ 215.000",
      message: "Crédito não identificado de R$ 215.000 detectado na conciliação de hoje. Requer análise imediata da tesouraria.",
      severity: "critical" as const,
    },
    {
      type: "low_cash", title: "Caixa Livre Abaixo do Limite Operacional",
      message: "O caixa livre está próximo do limite mínimo operacional. Avaliar necessidade de reforço de capital.",
      severity: "warning" as const,
    },
    {
      type: "payable_overdue", title: "2 Contas a Pagar Vencidas",
      message: "FGTS/INSS e Conta de Energia estão vencidos. Regularização urgente para evitar multas.",
      severity: "critical" as const,
    },
    {
      type: "match_rate_drop", title: "Taxa de Conciliação Abaixo de 90%",
      message: "A sessão de conciliação de hoje apresentou taxa de matching de 85%, abaixo da meta de 90%.",
      severity: "warning" as const,
    },
    {
      type: "funding_gap", title: "Análise de Funding: D+7",
      message: "Projeção indica necessidade de captação de R$ 320.000 nos próximos 7 dias para cobrir compromissos.",
      severity: "warning" as const,
    },
  ];

  for (const alert of alertConfigs) {
    await db.createAlert(alert);
  }

  console.log("\n✅ Seed concluído com sucesso!");
  console.log("─────────────────────────────────");
  console.log("📊 Dados gerados:");
  console.log("  · 5 Centros de custo");
  console.log("  · 60 dias de saldo gerencial");
  console.log("  · 12 meses de DRE");
  console.log("  · 30 dias de fluxo de caixa");
  console.log("  · ~300 receitas");
  console.log("  · ~80 despesas");
  console.log("  · 14 contas a pagar");
  console.log("  · 6 operações de crédito");
  console.log("  · 3 sessões de conciliação");
  console.log("  · ~21 divergências classificadas");
  console.log("  · 5 alertas do sistema");
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────

runSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Erro no seed:", err);
    process.exit(1);
  });
