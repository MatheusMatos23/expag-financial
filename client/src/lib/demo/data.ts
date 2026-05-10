/**
 * Demo Data — Expag Financial System
 * Dados realistas de uma fintech brasileira de médio porte.
 * Contexto: empresa de crédito/pagamentos com ~R$ 8M em custódia.
 */

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().slice(0, 7);
}
const today = daysAgo(0);

// ─── MANAGERIAL BALANCE HISTORY (30 days) ─────────────────────────────────────

export const demoBalanceHistory = Array.from({ length: 30 }, (_, i) => {
  const base = 8_250_000 + Math.sin(i * 0.4) * 320_000 + i * 15_000;
  const client = 5_100_000 + Math.cos(i * 0.3) * 180_000;
  const committed = 420_000 + Math.sin(i * 0.6) * 30_000;
  const div = 85_000 - i * 2_000;
  const realCash = base - client - committed + div;
  const ownCash = base - client;
  const freeCash = ownCash - committed;
  return {
    id: 30 - i,
    referenceDate: daysAgo(29 - i),
    bankBalance: base.toFixed(2),
    clientBalance: client.toFixed(2),
    committedBalance: committed.toFixed(2),
    divergenceBalance: Math.max(0, div).toFixed(2),
    realCash: realCash.toFixed(2),
    ownCash: ownCash.toFixed(2),
    committedCash: committed.toFixed(2),
    freeCash: freeCash.toFixed(2),
    thirdPartyResources: client.toFixed(2),
    futureObligations: committed.toFixed(2),
    fundingNeeded: "0.00",
    openDivergences: Math.max(0, Math.floor(85 - i * 2)).toString(),
    createdAt: new Date(daysAgo(29 - i)).toISOString(),
    updatedAt: new Date(daysAgo(29 - i)).toISOString(),
  };
});

export const demoLatestBalance = demoBalanceHistory[demoBalanceHistory.length - 1];

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────

export const demoDashboardSummary = {
  totalRevenue: 1_847_320.45,
  totalExpenses: 892_150.30,
  netResult: 955_170.15,
  latestBalance: demoLatestBalance,
  activeDivergences: 23,
  overduePayables: 4,
  activeAlerts: 3,
  revenueSummary: [
    { type: "pix", total: "820450.00", count: 1842 },
    { type: "ted", total: "512300.00", count: 286 },
    { type: "boleto", total: "298750.00", count: 419 },
    { type: "cartao_credito", total: "148620.45", count: 523 },
    { type: "antecipacao", total: "67200.00", count: 12 },
  ],
  expenseSummary: [
    { category: "folha", total: "320000.00", count: 1 },
    { category: "infraestrutura", total: "185400.00", count: 24 },
    { category: "marketing", total: "98200.00", count: 8 },
    { category: "tarifas_bancarias", total: "72150.00", count: 312 },
    { category: "impostos", total: "142000.00", count: 6 },
    { category: "outros", total: "74400.30", count: 31 },
  ],
};

// ─── CASHFLOW (14 days) ───────────────────────────────────────────────────────

export const demoCashFlow = Array.from({ length: 14 }, (_, i) => {
  const inflows = 85_000 + Math.random() * 65_000 + (i % 5 === 0 ? 120_000 : 0);
  const outflows = 42_000 + Math.random() * 28_000 + (i % 7 === 0 ? 85_000 : 0);
  return {
    id: i + 1,
    referenceDate: daysAgo(13 - i),
    projectedInflows: (inflows * 1.05).toFixed(2),
    projectedOutflows: (outflows * 1.05).toFixed(2),
    realizedInflows: inflows.toFixed(2),
    realizedOutflows: outflows.toFixed(2),
    openingBalance: (2_100_000 + i * 15_000).toFixed(2),
    closingBalance: (2_100_000 + i * 15_000 + inflows - outflows).toFixed(2),
    netFlow: (inflows - outflows).toFixed(2),
  };
});

// ─── RECONCILIATION SESSIONS ──────────────────────────────────────────────────

export const demoSessions = [
  {
    id: 8,
    userId: 1,
    referenceDate: daysAgo(0),
    status: "completed",
    totalBankCredits: "1245820.50",
    totalBankDebits: "982340.20",
    totalApiCredits: "1229850.50",
    totalApiDebits: "975200.00",
    matchedCount: 1847,
    divergentCount: 23,
    pendingCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 7,
    userId: 1,
    referenceDate: daysAgo(1),
    status: "completed",
    totalBankCredits: "987450.00",
    totalBankDebits: "754320.80",
    totalApiCredits: "981200.00",
    totalApiDebits: "751000.00",
    matchedCount: 1523,
    divergentCount: 18,
    pendingCount: 0,
    createdAt: new Date(daysAgo(1)).toISOString(),
    updatedAt: new Date(daysAgo(1)).toISOString(),
  },
  {
    id: 6,
    userId: 1,
    referenceDate: daysAgo(2),
    status: "completed",
    totalBankCredits: "1102340.00",
    totalBankDebits: "889200.00",
    totalApiCredits: "1098500.00",
    totalApiDebits: "882000.00",
    matchedCount: 1698,
    divergentCount: 31,
    pendingCount: 0,
    createdAt: new Date(daysAgo(2)).toISOString(),
    updatedAt: new Date(daysAgo(2)).toISOString(),
  },
  {
    id: 5,
    userId: 1,
    referenceDate: daysAgo(5),
    status: "completed",
    totalBankCredits: "756230.00",
    totalBankDebits: "612800.00",
    totalApiCredits: "751000.00",
    totalApiDebits: "609000.00",
    matchedCount: 1124,
    divergentCount: 12,
    pendingCount: 0,
    createdAt: new Date(daysAgo(5)).toISOString(),
    updatedAt: new Date(daysAgo(5)).toISOString(),
  },
  {
    id: 4,
    userId: 1,
    referenceDate: daysAgo(8),
    status: "error",
    totalBankCredits: null,
    totalBankDebits: null,
    totalApiCredits: null,
    totalApiDebits: null,
    matchedCount: 0,
    divergentCount: 0,
    pendingCount: 0,
    createdAt: new Date(daysAgo(8)).toISOString(),
    updatedAt: new Date(daysAgo(8)).toISOString(),
  },
];

// ─── DIVERGENCES ──────────────────────────────────────────────────────────────

const DIVERGENCE_CATEGORIES = [
  "pix_sem_cliente", "deposito_nao_identificado", "ted_orfa",
  "receita_financeira", "tarifa_nao_apropriada", "imposto",
  "estorno", "receita_nao_lancada", "liquidacao_divergente",
];
const PRIORITIES = ["critical", "critical", "high", "high", "high", "medium", "medium", "medium", "low", "low"];
const STATUS_LIST = ["pendente", "em_analise", "identificado", "regularizado", "escalado_diretoria"];
const BANKS = ["Itaú Unibanco", "Bradesco", "Santander", "Banco do Brasil", "Caixa Econômica Federal", "Nubank", "C6 Bank", "Stone"];
const CLIENTS = [
  "TechSol Serviços Ltda", "Mercan Digital ME", "Fluxo Pagamentos SA",
  "G&V Comércio Eireli", "Alfa Soluções EPP", "Nexus Tech Ltda",
  "Prime Distribuidora SA", "Smart Commerce ME",
];
const RESPONSIBLES = ["Ana Oliveira", "Carlos Mendes", "Fernanda Lima", "", "", ""];

export const demoDivergences = Array.from({ length: 47 }, (_, i) => {
  const priority = PRIORITIES[i % PRIORITIES.length] as string;
  const amount = priority === "critical"
    ? (120000 + Math.random() * 380000).toFixed(2)
    : priority === "high"
    ? (10500 + Math.random() * 89000).toFixed(2)
    : priority === "medium"
    ? (1100 + Math.random() * 8800).toFixed(2)
    : (50 + Math.random() * 950).toFixed(2);
  const status = STATUS_LIST[i % STATUS_LIST.length];
  const isSurplus = i % 3 !== 0;
  const slaBusinessDays = priority === "critical" ? 1 : priority === "high" ? 3 : priority === "medium" ? 7 : 15;
  const slaDate = new Date();
  slaDate.setDate(slaDate.getDate() + slaBusinessDays - Math.floor(Math.random() * 3));

  return {
    id: i + 1,
    sessionId: 8,
    divergenceDate: daysAgo(Math.floor(Math.random() * 5)),
    bankName: isSurplus ? BANKS[i % BANKS.length] : null,
    clientId: !isSurplus ? `CLI-${1000 + i}` : null,
    clientName: !isSurplus ? CLIENTS[i % CLIENTS.length] : null,
    divergenceType: isSurplus ? "bank_surplus" : "bank_shortage",
    amount,
    origin: ["PIX", "TED", "BOLETO", "DOC"][i % 4],
    category: DIVERGENCE_CATEGORIES[i % DIVERGENCE_CATEGORIES.length],
    status,
    priority,
    responsible: RESPONSIBLES[i % RESPONSIBLES.length] || null,
    slaDeadline: slaDate.toISOString().split("T")[0],
    observation: status === "em_analise"
      ? "Em análise junto ao banco para identificação da origem da transação."
      : null,
    actionTaken: status === "regularizado" || status === "identificado"
      ? "Transação identificada e lançada no sistema de controladoria."
      : null,
    bankTransactionId: isSurplus ? 1000 + i : null,
    apiTransactionId: !isSurplus ? 2000 + i : null,
    createdAt: new Date(daysAgo(Math.floor(Math.random() * 5))).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

// ─── REVENUES ─────────────────────────────────────────────────────────────────

const REV_TYPES = ["pix", "ted", "boleto", "cartao_credito", "antecipacao", "spread", "tarifa_servico"];
const REV_DESCS: Record<string, string[]> = {
  pix: ["Recebimento PIX - Liquidação D0", "PIX Recebido - Cliente Aprovado", "Entrada PIX - Operação Normal"],
  ted: ["TED Crédito - Repasse Operacional", "Recebimento TED - Contrato #", "TED Entrada - Liquidação"],
  boleto: ["Liquidação Boleto Vencimento", "Boleto Compensado - Cobrança", "Recebimento Boleto - Parcela"],
  cartao_credito: ["Crédito Cartão - MDR Líquido", "Antecipação Cartão Aprovada", "Recebimento Crédito Bandeira"],
  antecipacao: ["Antecipação Recebíveis - Taxa 2.8%a.m.", "Operação Antecipação - Contrato"],
  spread: ["Spread Operacional - Taxa Floating", "Receita Spread CDI + 3.2%"],
  tarifa_servico: ["Tarifa Manutenção Conta Digital", "Fee Processamento Transações"],
};

export const demoRevenues = Array.from({ length: 68 }, (_, i) => {
  const type = REV_TYPES[i % REV_TYPES.length];
  const descs = REV_DESCS[type] ?? ["Receita operacional"];
  const amount = type === "antecipacao"
    ? (50000 + Math.random() * 100000).toFixed(2)
    : type === "spread"
    ? (8000 + Math.random() * 45000).toFixed(2)
    : (500 + Math.random() * 15000).toFixed(2);
  return {
    id: i + 1,
    type,
    description: descs[i % descs.length],
    amount,
    referenceDate: daysAgo(Math.floor(Math.random() * 30)),
    status: i % 8 === 0 ? "previsto" : "realizado",
    costCenterId: (i % 3) + 1,
    bankTransactionId: null,
    createdAt: new Date(daysAgo(Math.floor(Math.random() * 30))).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

export const demoRevenueSummary = { total: 1847320.45, byType: demoDashboardSummary.revenueSummary, count: 68 };

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

const EXP_CATEGORIES = ["folha", "infraestrutura", "marketing", "tarifas_bancarias", "impostos", "juridico", "outros"];
const EXP_DESCS: Record<string, string[]> = {
  folha: ["Folha de Pagamento - Competência", "Adiantamento Salarial - 1ª Parcela", "13º Salário - Parcela"],
  infraestrutura: ["AWS - Infraestrutura Cloud", "Servidor Dedicado - Mensal", "Ferramentas SaaS - Licenças"],
  marketing: ["Google Ads - Campanha Performance", "Meta Ads - Lead Generation", "Influencer - Contrato"],
  tarifas_bancarias: ["Tarifa TED Enviada", "Manutenção Conta PJ - Pacote", "Tarifa Emissão Boleto"],
  impostos: ["ISS - Guia Recolhimento", "DARF PIS/COFINS", "IRRF - Retido na Fonte"],
  juridico: ["Honorários Advocatícios - Mensal", "Consultoria Regulatória BCB"],
  outros: ["Material de Escritório", "Treinamento e Capacitação", "Despesas de Viagem"],
};

export const demoExpenses = Array.from({ length: 52 }, (_, i) => {
  const category = EXP_CATEGORIES[i % EXP_CATEGORIES.length];
  const descs = EXP_DESCS[category] ?? ["Despesa operacional"];
  const amount = category === "folha"
    ? (80000 + Math.random() * 50000).toFixed(2)
    : category === "impostos"
    ? (20000 + Math.random() * 30000).toFixed(2)
    : (800 + Math.random() * 12000).toFixed(2);
  return {
    id: i + 1,
    category,
    description: descs[i % descs.length],
    amount,
    referenceDate: daysAgo(Math.floor(Math.random() * 30)),
    status: i % 6 === 0 ? "previsto" : "realizado",
    costCenterId: (i % 3) + 1,
    createdAt: new Date(daysAgo(Math.floor(Math.random() * 30))).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

export const demoExpenseSummary = { total: 892150.30, byCategory: demoDashboardSummary.expenseSummary };

// ─── PAYABLES ─────────────────────────────────────────────────────────────────

const PAYABLE_SUPPLIERS = [
  "Amazon Web Services", "Google LLC", "Meta Platforms Inc",
  "Escritório Jurídico Pinheiro & Assoc.", "Imobiliária Centro Empresarial",
  "Operadora de Saúde OMNI", "Vale Alimentação VR", "Conta Azul LTDA",
  "Receita Federal do Brasil", "Prefeitura Municipal SP",
];

export const demoPayables = Array.from({ length: 28 }, (_, i) => {
  const daysUntilDue = -5 + i * 3;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + daysUntilDue);
  const status = daysUntilDue < 0 ? "vencido" : i % 5 === 0 ? "pago" : "pendente";
  return {
    id: i + 1,
    description: PAYABLE_SUPPLIERS[i % PAYABLE_SUPPLIERS.length],
    amount: (1200 + Math.random() * 45000).toFixed(2),
    dueDate: dueDate.toISOString().split("T")[0],
    paidDate: status === "pago" ? daysAgo(Math.floor(Math.random() * 5)) : null,
    status,
    category: EXP_CATEGORIES[i % EXP_CATEGORIES.length],
    supplier: PAYABLE_SUPPLIERS[i % PAYABLE_SUPPLIERS.length],
    recurrent: i % 4 === 0,
    recurrenceDay: i % 4 === 0 ? (5 + i) : null,
    notes: null,
    createdAt: new Date(daysAgo(30 - i)).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

// ─── CREDIT PORTFOLIO ─────────────────────────────────────────────────────────

const CREDIT_CLIENTS = [
  "Mercado Veloz Comércio Ltda", "TurboLog Transportes EPP",
  "Açaí Premium Distribuidora", "Salve Digital Marketing ME",
  "ConstruFlex Materiais Eireli", "AgroMax Agropecuária SA",
  "Brilha Estética Franchising", "CodeFarm Tecnologia Ltda",
];
const FUNDING = ["capital_proprio", "uso_custodia", "externo"] as const;

export const demoCreditPortfolio = Array.from({ length: 18 }, (_, i) => {
  const principal = (15000 + Math.random() * 185000).toFixed(2);
  const paidInstallments = Math.floor(Math.random() * 12);
  const totalInstallments = 12 + (i % 3) * 6;
  const outstanding = (parseFloat(principal) * (1 - paidInstallments / totalInstallments)).toFixed(2);
  const overdue = i % 7 === 0;
  return {
    id: i + 1,
    clientId: `CLI-${1000 + i * 7}`,
    clientName: CREDIT_CLIENTS[i % CREDIT_CLIENTS.length],
    principal,
    interestRate: (1.8 + Math.random() * 1.4).toFixed(4),
    totalInstallments,
    paidInstallments,
    totalInterestEarned: (parseFloat(principal) * 0.024 * paidInstallments).toFixed(2),
    outstandingBalance: outstanding,
    status: overdue ? "inadimplente" : paidInstallments === totalInstallments ? "quitado" : "ativo",
    startDate: daysAgo(paidInstallments * 30 + 15),
    expectedEndDate: new Date(Date.now() + (totalInstallments - paidInstallments) * 30 * 86400000).toISOString().split("T")[0],
    lastPaymentDate: paidInstallments > 0 ? daysAgo(Math.floor(Math.random() * 30)) : null,
    fundingSource: FUNDING[i % 3],
    notes: null,
    createdAt: new Date(daysAgo(paidInstallments * 30 + 15)).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

// ─── DRE (12 months) ──────────────────────────────────────────────────────────

export const demoDRE = Array.from({ length: 12 }, (_, i) => {
  const m = monthsAgo(11 - i);
  const gross = 1_200_000 + i * 55_000 + Math.sin(i) * 80_000;
  const fin = gross * 0.18;
  const ops = gross * 0.32;
  const taxes = gross * 0.12;
  const ebitda = gross - fin - ops;
  const net = gross - fin - ops - taxes;
  return {
    id: i + 1,
    referenceMonth: m,
    grossRevenue: gross.toFixed(2),
    financialCosts: fin.toFixed(2),
    operationalCosts: ops.toFixed(2),
    taxes: taxes.toFixed(2),
    ebitda: ebitda.toFixed(2),
    netResult: net.toFixed(2),
    ebitdaMargin: ((ebitda / gross) * 100).toFixed(2),
    netMargin: ((net / gross) * 100).toFixed(2),
    createdAt: new Date(m + "-15").toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

// ─── ALERTS ───────────────────────────────────────────────────────────────────

export const demoAlerts = [
  {
    id: 1, type: "critical_divergence",
    title: "Divergências Críticas na Conciliação",
    message: "3 divergências críticas detectadas na conciliação de hoje totalizando R$ 847.320,00",
    severity: "critical", status: "active",
    referenceId: 8, referenceType: "reconciliation_session",
    acknowledgedBy: null, acknowledgedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 2, type: "low_cash",
    title: "Caixa Livre Abaixo do Limite",
    message: "O caixa livre está em R$ 1.284.650 — abaixo do limite mínimo configurado de R$ 1.500.000",
    severity: "warning", status: "active",
    referenceId: null, referenceType: null,
    acknowledgedBy: null, acknowledgedAt: null,
    createdAt: new Date(daysAgo(1)).toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 3, type: "overdue_payable",
    title: "Contas a Pagar Vencidas",
    message: "4 contas a pagar encontram-se vencidas, totalizando R$ 127.450,00 em atraso",
    severity: "warning", status: "active",
    referenceId: null, referenceType: null,
    acknowledgedBy: null, acknowledgedAt: null,
    createdAt: new Date(daysAgo(2)).toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 4, type: "high_divergence_volume",
    title: "Volume de Divergências Elevado",
    message: "Conciliação de ontem apresentou 31 divergências — 73% acima da média dos últimos 7 dias",
    severity: "warning", status: "acknowledged",
    referenceId: 6, referenceType: "reconciliation_session",
    acknowledgedBy: 1, acknowledgedAt: new Date(daysAgo(1)).toISOString(),
    createdAt: new Date(daysAgo(2)).toISOString(), updatedAt: new Date(daysAgo(1)).toISOString(),
  },
];

// ─── COST CENTERS ─────────────────────────────────────────────────────────────

export const demoCostCenters = [
  { id: 1, code: "OP", name: "Operações Financeiras", description: "Captação e operações de crédito", active: true, createdAt: new Date().toISOString() },
  { id: 2, code: "TEC", name: "Tecnologia & Produto", description: "Infraestrutura, desenvolvimento e plataforma", active: true, createdAt: new Date().toISOString() },
  { id: 3, code: "ADM", name: "Administrativo & Comercial", description: "Backoffice, jurídico, marketing e RH", active: true, createdAt: new Date().toISOString() },
];

// ─── RECONCILIATION SESSION DETAIL ────────────────────────────────────────────

export function getDemoSessionDetail(id: number) {
  const session = demoSessions.find((s) => s.id === id) ?? demoSessions[0];
  return {
    session,
    bankCredits: Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i, sessionId: session.id, type: "credit",
      transactionDate: daysAgo(Math.floor(Math.random() * 2)),
      description: ["PIX RECEBIDO - CLIENTE", "TED CREDITO - OPERACAO", "DEPOSITO IDENTIFICADO"][i % 3],
      amount: (2000 + Math.random() * 50000).toFixed(2),
      channel: ["PIX", "TED", "BOLETO"][i % 3],
      bankName: BANKS[i % BANKS.length],
      externalId: `EXT-${Date.now()}-${i}`,
      matchStatus: i < 10 ? "matched" : "divergent",
      matchedApiTransactionId: i < 10 ? 200 + i : null,
      matchType: i < 10 ? "exact" : null,
      createdAt: new Date().toISOString(),
    })),
    bankDebits: Array.from({ length: 8 }, (_, i) => ({
      id: 200 + i, sessionId: session.id, type: "debit",
      transactionDate: daysAgo(Math.floor(Math.random() * 2)),
      description: ["PAGAMENTO FORNECEDOR", "TARIFA BANCARIA", "TRANSFERENCIA SAIDA"][i % 3],
      amount: (500 + Math.random() * 20000).toFixed(2),
      channel: ["TED", "PIX", "BOLETO"][i % 3],
      bankName: BANKS[i % BANKS.length],
      externalId: null,
      matchStatus: i < 7 ? "matched" : "divergent",
      matchedApiTransactionId: i < 7 ? 300 + i : null,
      matchType: i < 7 ? "partial" : null,
      createdAt: new Date().toISOString(),
    })),
    apiCredits: Array.from({ length: 11 }, (_, i) => ({
      id: 300 + i, sessionId: session.id, type: "credit",
      transactionDate: daysAgo(Math.floor(Math.random() * 2)),
      description: ["Liquidacao PIX - Cliente", "Credito TED - Operacao", "Recebimento Boleto"][i % 3],
      amount: (2000 + Math.random() * 50000).toFixed(2),
      channel: ["PIX", "TED", "BOLETO"][i % 3],
      clientId: `CLI-${1000 + i}`,
      clientName: CLIENTS[i % CLIENTS.length],
      externalId: `API-${Date.now()}-${i}`,
      matchStatus: i < 10 ? "matched" : "divergent",
      matchedBankTransactionId: i < 10 ? 100 + i : null,
      matchType: i < 10 ? "exact" : null,
      createdAt: new Date().toISOString(),
    })),
    apiDebits: Array.from({ length: 7 }, (_, i) => ({
      id: 400 + i, sessionId: session.id, type: "debit",
      transactionDate: daysAgo(Math.floor(Math.random() * 2)),
      description: ["Pagamento Fornecedor API", "Tarifa Servico API", "Repasse Externo"][i % 3],
      amount: (500 + Math.random() * 20000).toFixed(2),
      channel: ["TED", "PIX", "BOLETO"][i % 3],
      clientId: null, clientName: null,
      externalId: `API-OUT-${Date.now()}-${i}`,
      matchStatus: i < 6 ? "matched" : "divergent",
      matchedBankTransactionId: i < 6 ? 200 + i : null,
      matchType: i < 6 ? "partial" : null,
      createdAt: new Date().toISOString(),
    })),
  };
}

// ─── MATCHING RATE TREND (7 days) ─────────────────────────────────────────────

export const demoMatchRateTrend = Array.from({ length: 7 }, (_, i) => ({
  date: daysAgo(6 - i),
  matchRate: 92 + Math.sin(i * 0.7) * 4,
  divergences: Math.floor(12 + Math.random() * 20),
  volume: Math.floor(1200 + Math.random() * 800),
}));
