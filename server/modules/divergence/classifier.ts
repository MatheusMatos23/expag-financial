/**
 * Divergence Classification Engine
 *
 * Rule-based auto-classifier for financial divergences.
 * Each divergence is classified by type, priority, SLA deadline
 * and suggested action for the operations team.
 *
 * Classification hierarchy:
 * 1. Apply ordered rule set based on divergence type (surplus/shortage)
 * 2. Rules are ranked by specificity — more specific rules first
 * 3. Priority is derived from monetary amount thresholds
 * 4. SLA deadline is calculated from priority + business days
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type DivergenceType = "bank_surplus" | "bank_shortage";

export type DivergenceCategory =
  // bank_surplus: dinheiro no banco que não está na API
  | "receita_nao_lancada"
  | "pix_sem_cliente"
  | "receita_financeira"
  | "estorno"
  | "devolucao"
  | "deposito_nao_identificado"
  | "tarifa_nao_apropriada"
  | "ted_orfa"
  | "receita_operacional"
  | "emprestimo_operacional"
  | "uso_saldo_clientes"
  // bank_shortage: transação na API sem correspondência no banco
  | "despesa_nao_lancada"
  | "tarifa_bancaria"
  | "imposto"
  | "repasse_externo"
  | "ajuste_manual"
  | "saida_operacional"
  | "liquidacao_divergente"
  | "outros";

export type DivergencePriority = "low" | "medium" | "high" | "critical";

export interface ClassificationInput {
  divergenceType: DivergenceType;
  amount: string;
  description: string | null;
  channel: string | null;
  bankName: string | null;
  clientId?: string | null;
  clientName?: string | null;
  referenceDate: string;
}

export interface ClassificationResult {
  category: DivergenceCategory;
  priority: DivergencePriority;
  slaDeadline: string;        // ISO date YYYY-MM-DD
  suggestedAction: string;    // Plain text for ops team
  autoConfidence: number;     // 0-100: how confident the auto-classification is
}

// ─── CLASSIFICATION RULES ─────────────────────────────────────────────────────

interface ClassificationRule {
  name: string;
  applies: (input: ClassificationInput) => boolean;
  category: DivergenceCategory;
  confidence: number;
}

// ── Rules for bank_surplus (money in bank NOT found in API) ──
const SURPLUS_RULES: ClassificationRule[] = [
  {
    name: "imposto_iof_surplus",
    applies: ({ description }) =>
      /\b(IOF|IMPOSTO|ISS|CSLL|PIS|COFINS|IRRF|DARF)\b/i.test(description ?? ""),
    category: "receita_financeira",
    confidence: 88,
  },
  {
    name: "estorno",
    applies: ({ description }) =>
      /\b(ESTORNO|ESTD|ESTORNADO|CANCEL|REVERSAO)\b/i.test(description ?? ""),
    category: "estorno",
    confidence: 90,
  },
  {
    name: "devolucao",
    applies: ({ description }) =>
      /\b(DEVOLUCAO|DEVOL|DEVOLV|RETORNO)\b/i.test(description ?? ""),
    category: "devolucao",
    confidence: 88,
  },
  {
    name: "receita_financeira",
    applies: ({ description }) =>
      /\b(JUROS|RENDIMENTO|CDI|SELIC|APLICACAO|RESGATE|YIELD|RENDE|CDB|LCI|LCA)\b/i.test(
        description ?? ""
      ),
    category: "receita_financeira",
    confidence: 92,
  },
  {
    name: "tarifa_nao_apropriada",
    applies: ({ description }) =>
      /\b(TARIFA|TAXA|MANUT|ANUIDADE|PACOTE|CESTA|CUSTO\s*SERV)\b/i.test(
        description ?? ""
      ),
    category: "tarifa_nao_apropriada",
    confidence: 82,
  },
  {
    name: "pix_sem_cliente",
    applies: ({ channel, clientId, description }) =>
      /pix/i.test(channel ?? "") && !clientId && !/cliente/i.test(description ?? ""),
    category: "pix_sem_cliente",
    confidence: 88,
  },
  {
    name: "ted_orfa",
    applies: ({ channel, description }) =>
      /ted/i.test(channel ?? "") || /\bTED\b/i.test(description ?? ""),
    category: "ted_orfa",
    confidence: 78,
  },
  {
    name: "emprestimo",
    applies: ({ description }) =>
      /\b(EMPREST|CREDITO RURAL|FINANCIAMENTO|CCB|CCE|CEDULA|CREDITO PESSOAL)\b/i.test(
        description ?? ""
      ),
    category: "emprestimo_operacional",
    confidence: 84,
  },
  {
    name: "uso_custodia",
    applies: ({ description }) =>
      /\b(CUSTODIA|SALDO CLIENTE|USO SALDO|FLOAT)\b/i.test(description ?? ""),
    category: "uso_saldo_clientes",
    confidence: 80,
  },
  {
    name: "cliente_identificado",
    applies: ({ clientId }) => Boolean(clientId && clientId.trim()),
    category: "receita_nao_lancada",
    confidence: 72,
  },
  {
    name: "deposito_generico",
    applies: ({ description, channel }) =>
      /\b(DEPOSITO|DEP\.|APORTE)\b/i.test(description ?? "") ||
      /deposito/i.test(channel ?? ""),
    category: "deposito_nao_identificado",
    confidence: 62,
  },
];

// ── Rules for bank_shortage (transaction in API NOT found in bank) ──
const SHORTAGE_RULES: ClassificationRule[] = [
  {
    name: "imposto_tributo",
    applies: ({ description }) =>
      /\b(IMPOSTO|IOF|ISS|IRRF|CSLL|PIS|COFINS|DARF|GNRE)\b/i.test(
        description ?? ""
      ),
    category: "imposto",
    confidence: 92,
  },
  {
    name: "tarifa_bancaria",
    applies: ({ description }) =>
      /\b(TARIFA|TAXA|MANUT|ANUIDADE|PACOTE|CESTA|CUSTO\s*SERV)\b/i.test(
        description ?? ""
      ),
    category: "tarifa_bancaria",
    confidence: 85,
  },
  {
    name: "repasse_externo",
    applies: ({ description }) =>
      /\b(REPASSE|REMESSA|PAGAMENTO\s*A\s*FORNEC|PAGTO\s*FORN)\b/i.test(
        description ?? ""
      ),
    category: "repasse_externo",
    confidence: 78,
  },
  {
    name: "liquidacao_divergente",
    applies: ({ description, channel }) =>
      /\b(LIQUIDAC|LIQUID|SETTLEMENT|CLEARING|COMPENSAC)\b/i.test(
        description ?? ""
      ) ||
      (/pix/i.test(channel ?? "") || /ted/i.test(channel ?? "")),
    category: "liquidacao_divergente",
    confidence: 75,
  },
  {
    name: "pagamento_despesa",
    applies: ({ description }) =>
      /\b(PAGAMENTO|PAGTO|PGTO|PAGO|QUITACAO|BOLETO)\b/i.test(description ?? ""),
    category: "despesa_nao_lancada",
    confidence: 70,
  },
];

// ─── PRIORITY ─────────────────────────────────────────────────────────────────

// Thresholds in BRL
const PRIORITY_THRESHOLDS: Array<{ min: number; priority: DivergencePriority }> = [
  { min: 100_000, priority: "critical" },
  { min: 10_000, priority: "high" },
  { min: 1_000, priority: "medium" },
  { min: 0, priority: "low" },
];

export function calculatePriority(amount: string): DivergencePriority {
  const value = parseFloat(amount);
  if (isNaN(value)) return "medium";
  for (const { min, priority } of PRIORITY_THRESHOLDS) {
    if (value >= min) return priority;
  }
  return "low";
}

// ─── SLA (business days) ──────────────────────────────────────────────────────

// SLA in business days per priority
const SLA_BUSINESS_DAYS: Record<DivergencePriority, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 15,
};

function addBusinessDays(startDate: string, days: number): string {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added++; // Skip Sun and Sat
  }
  return date.toISOString().split("T")[0];
}

export function calculateSLADeadline(
  referenceDate: string,
  priority: DivergencePriority
): string {
  return addBusinessDays(referenceDate, SLA_BUSINESS_DAYS[priority]);
}

// ─── SUGGESTED ACTIONS ────────────────────────────────────────────────────────

const SUGGESTED_ACTIONS: Record<DivergenceCategory, string> = {
  receita_nao_lancada:
    "Identificar a origem da receita e lançar no sistema de controladoria",
  pix_sem_cliente:
    "Identificar o pagador do PIX junto ao banco e vincular ao cliente correspondente",
  receita_financeira:
    "Apropriar o rendimento financeiro ao centro de custo e registrar na DRE",
  estorno:
    "Localizar a transação original, registrar o estorno e ajustar os lançamentos",
  devolucao:
    "Identificar o motivo da devolução, registrar no sistema e comunicar área responsável",
  deposito_nao_identificado:
    "Solicitar ao banco a identificação do depositante e registrar a origem",
  tarifa_nao_apropriada:
    "Validar a tarifa com o extrato bancário e apropriar ao centro de custo correto",
  ted_orfa:
    "Identificar o remetente da TED junto ao banco e vincular ao registro correto",
  receita_operacional:
    "Registrar a receita operacional no sistema e associar ao contrato/cliente",
  emprestimo_operacional:
    "Registrar a operação de crédito no módulo de carteira e gerar as parcelas",
  uso_saldo_clientes:
    "Verificar o uso de custódia, ajustar o saldo de clientes e documentar a operação",
  despesa_nao_lancada:
    "Lançar a despesa no sistema de controladoria e associar ao fornecedor/contrato",
  tarifa_bancaria:
    "Registrar a tarifa bancária e apropriar ao centro de custo financeiro",
  imposto:
    "Registrar o pagamento do tributo e atualizar o controle fiscal/DARF",
  repasse_externo:
    "Confirmar o repasse com o destinatário e registrar no sistema operacional",
  ajuste_manual:
    "Realizar ajuste manual mediante aprovação da controladoria e registrar evidência",
  saida_operacional:
    "Identificar a natureza da saída e classificar na categoria operacional correta",
  liquidacao_divergente:
    "Verificar a liquidação junto à adquirente/API e corrigir o registro no sistema",
  outros:
    "Analisar manualmente, identificar a natureza da divergência e classificar corretamente",
};

// ─── MAIN CLASSIFIER ──────────────────────────────────────────────────────────

export function classifyDivergence(
  input: ClassificationInput
): ClassificationResult {
  const rules =
    input.divergenceType === "bank_surplus" ? SURPLUS_RULES : SHORTAGE_RULES;

  // Default categories if no rule matches
  const defaultCategory: DivergenceCategory =
    input.divergenceType === "bank_surplus"
      ? "deposito_nao_identificado"
      : "outros";

  let bestCategory: DivergenceCategory = defaultCategory;
  let bestConfidence = 0;

  // Apply rules ordered by priority — pick highest confidence match
  for (const rule of rules) {
    if (rule.applies(input) && rule.confidence > bestConfidence) {
      bestCategory = rule.category;
      bestConfidence = rule.confidence;
    }
  }

  const priority = calculatePriority(input.amount);
  const slaDeadline = calculateSLADeadline(input.referenceDate, priority);

  return {
    category: bestCategory,
    priority,
    slaDeadline,
    suggestedAction: SUGGESTED_ACTIONS[bestCategory],
    autoConfidence: bestConfidence > 0 ? bestConfidence : 40,
  };
}

/**
 * Batch classify multiple divergences efficiently.
 * Returns array in same order as input.
 */
export function classifyBatch(
  inputs: ClassificationInput[]
): ClassificationResult[] {
  return inputs.map(classifyDivergence);
}
