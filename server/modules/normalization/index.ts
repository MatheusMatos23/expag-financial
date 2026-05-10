/**
 * Financial Transaction Normalization Module
 *
 * Responsible for standardizing ALL incoming financial data before
 * entering the reconciliation pipeline. Handles multi-format inputs
 * from different Brazilian banks and payment APIs.
 *
 * Supports:
 * - Multi-format date parsing (DD/MM/YYYY, Excel serial, ISO, etc.)
 * - Brazilian currency parsing (R$ 1.234,56 and 1234.56)
 * - Description cleaning, deduplication and normalization
 * - Bank name standardization (ISPB code → friendly name)
 * - Channel normalization (PIX, TED, DOC, etc.)
 * - Content hashing for duplicate detection
 */

// ─── PUBLIC INTERFACES ────────────────────────────────────────────────────────

export interface RawTransactionRow {
  [key: string]: unknown;
}

export interface NormalizedTransaction {
  transactionDate: string;   // ISO date: YYYY-MM-DD
  description: string;       // Cleaned, uppercase
  amount: string;            // Always positive decimal string (e.g. "1234.56")
  type: "credit" | "debit";
  channel: string | null;    // Standardized: PIX | TED | DOC | BOLETO | etc.
  bankCode: string | null;   // Numeric bank code (e.g. "341")
  bankName: string | null;   // Friendly name (e.g. "Itaú Unibanco")
  clientId: string | null;
  clientName: string | null;
  externalId: string | null;
  contentHash: string;       // For duplicate detection within same session
}

export interface NormalizationError {
  field: string;
  value: unknown;
  message: string;
}

export interface NormalizationResult {
  transaction: NormalizedTransaction | null;
  errors: NormalizationError[];
  warnings: string[];
}

export interface BatchNormalizationResult {
  normalized: NormalizedTransaction[];
  errors: Array<{ row: number; errors: NormalizationError[] }>;
  warnings: string[];
  stats: {
    input: number;
    success: number;
    failed: number;
  };
}

// ─── DATE NORMALIZATION ────────────────────────────────────────────────────────

// Excel date serial starts from 1899-12-30 (Lotus 1-2-3 legacy bug)
const EXCEL_EPOCH_MS = new Date(1899, 11, 30).getTime();

function parseExcelSerial(serial: number): string | null {
  if (serial < 1 || serial > 99999) return null;
  const ms = EXCEL_EPOCH_MS + serial * 86_400_000;
  return new Date(ms).toISOString().split("T")[0];
}

const DATE_PARSERS: Array<{
  regex: RegExp;
  parse: (m: RegExpMatchArray) => string;
}> = [
  // DD/MM/YYYY — Brazilian standard
  {
    regex: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    parse: (m) => `${m[3]}-${m[2]}-${m[1]}`,
  },
  // DD-MM-YYYY
  {
    regex: /^(\d{2})-(\d{2})-(\d{4})$/,
    parse: (m) => `${m[3]}-${m[2]}-${m[1]}`,
  },
  // YYYY-MM-DD — ISO
  {
    regex: /^(\d{4})-(\d{2})-(\d{2})$/,
    parse: (m) => m[0],
  },
  // DD/MM/YY
  {
    regex: /^(\d{2})\/(\d{2})\/(\d{2})$/,
    parse: (m) => `20${m[3]}-${m[2]}-${m[1]}`,
  },
  // D/M/YYYY (single-digit day or month)
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    parse: (m) =>
      `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
  },
  // YYYYMMDD
  {
    regex: /^(\d{4})(\d{2})(\d{2})$/,
    parse: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
];

export function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Excel serial number
  if (typeof raw === "number") return parseExcelSerial(raw);

  const str = String(raw).trim();

  for (const { regex, parse } of DATE_PARSERS) {
    const m = str.match(regex);
    if (m) {
      const iso = parse(m);
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return iso;
    }
  }

  // Last resort: native parser
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];

  return null;
}

// ─── AMOUNT NORMALIZATION ──────────────────────────────────────────────────────

export function normalizeAmount(
  raw: unknown
): { amount: string; signalledDebit: boolean } | null {
  if (raw === null || raw === undefined || raw === "") return null;

  let str = String(raw).trim();

  // Detect debit signals before stripping
  const signalledDebit =
    str.startsWith("-") ||
    /\bD\b|\bDB?\b|\bCR?\b/i.test(str) === false
      ? str.startsWith("-")
      : false;

  // Strip currency symbol and whitespace
  str = str.replace(/R\$\s*/gi, "").replace(/BRL\s*/gi, "").trim();

  // Remove debit/credit markers and sign
  str = str.replace(/^[-+]/, "").replace(/\s*(D|DR|DB|C|CR)\s*$/i, "").trim();

  // Detect number format:
  // Brazilian: 1.234,56  →  has dot as thousands, comma as decimal
  // US/ISO:    1,234.56  →  has comma as thousands, dot as decimal
  const isBrazilian = /^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(str);
  const isUS = /^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(str);

  if (isBrazilian) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (isUS) {
    str = str.replace(/,/g, "");
  } else {
    // Ambiguous: remove everything except digits and the last separator
    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Comma is decimal separator (Brazilian style without thousands)
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  }

  const amount = parseFloat(str);
  if (isNaN(amount) || amount < 0) return null;

  return { amount: amount.toFixed(2), signalledDebit };
}

// ─── DESCRIPTION NORMALIZATION ─────────────────────────────────────────────────

const ABBREVIATION_MAP: Record<string, string> = {
  "PGTO": "PAGAMENTO",
  "PGT": "PAGAMENTO",
  "TRF": "TRANSFERENCIA",
  "TRANSF": "TRANSFERENCIA",
  "DEP": "DEPOSITO",
  "DEPOS": "DEPOSITO",
  "REC": "RECEBIMENTO",
  "RECEB": "RECEBIMENTO",
  "CRED": "CREDITO",
  "DEB": "DEBITO",
  "DOC": "DOC",
  "PIX": "PIX",
  "TED": "TED",
};

export function normalizeDescription(raw: unknown): string {
  if (!raw) return "SEM DESCRICAO";

  let desc = String(raw)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^\x20-\x7E]/g, " ")   // Remove non-ASCII
    .replace(/\s{2,}/g, " ")          // Collapse multiple spaces
    .trim();

  // Expand known abbreviations
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    desc = desc.replace(new RegExp(`\\b${abbr}\\b`, "g"), full);
  }

  return desc || "SEM DESCRICAO";
}

// ─── BANK NORMALIZATION ────────────────────────────────────────────────────────

interface BankInfo {
  code: string;
  name: string;
}

const BANK_REGISTRY: Array<{ keywords: string[]; info: BankInfo }> = [
  { keywords: ["ITAU", "ITAÚ", "341"], info: { code: "341", name: "Itaú Unibanco" } },
  { keywords: ["BRADESCO", "237"], info: { code: "237", name: "Bradesco" } },
  { keywords: ["SANTANDER", "033"], info: { code: "033", name: "Santander" } },
  { keywords: ["BANCO DO BRASIL", "BB", "001"], info: { code: "001", name: "Banco do Brasil" } },
  { keywords: ["CAIXA ECONOMICA", "CEF", "104"], info: { code: "104", name: "Caixa Econômica Federal" } },
  { keywords: ["NUBANK", "260"], info: { code: "260", name: "Nu Pagamentos" } },
  { keywords: ["INTER", "077"], info: { code: "077", name: "Banco Inter" } },
  { keywords: ["C6 BANK", "C6BANK", "336"], info: { code: "336", name: "C6 Bank" } },
  { keywords: ["STONE", "197"], info: { code: "197", name: "Stone" } },
  { keywords: ["PAGBANK", "PAGSEGURO", "290"], info: { code: "290", name: "PagBank" } },
  { keywords: ["SICREDI", "748"], info: { code: "748", name: "Sicredi" } },
  { keywords: ["SICOOB", "756"], info: { code: "756", name: "Sicoob" } },
  { keywords: ["ORIGINAL", "212"], info: { code: "212", name: "Banco Original" } },
  { keywords: ["NEON", "735"], info: { code: "735", name: "Neon" } },
  { keywords: ["MERCADO PAGO", "323"], info: { code: "323", name: "MercadoPago" } },
  { keywords: ["BTG PACTUAL", "208"], info: { code: "208", name: "BTG Pactual" } },
  { keywords: ["SAFRA", "422"], info: { code: "422", name: "Banco Safra" } },
  { keywords: ["VOTORANTIM", "655"], info: { code: "655", name: "Banco Votorantim" } },
  { keywords: ["MODAL", "746"], info: { code: "746", name: "Banco Modal" } },
];

export function normalizeBank(raw: string | null | undefined): BankInfo | null {
  if (!raw) return null;
  const upper = String(raw).toUpperCase().trim();

  for (const { keywords, info } of BANK_REGISTRY) {
    if (keywords.some((k) => upper.includes(k))) return info;
  }

  // 8-digit ISPB code
  if (/^\d{8}$/.test(upper)) return { code: upper, name: `Banco ${upper}` };

  return { code: "000", name: raw.trim() };
}

// ─── CHANNEL NORMALIZATION ─────────────────────────────────────────────────────

const CHANNEL_REGISTRY: Array<{ keywords: string[]; normalized: string }> = [
  { keywords: ["PIX"], normalized: "PIX" },
  { keywords: ["TED"], normalized: "TED" },
  { keywords: ["DOC"], normalized: "DOC" },
  { keywords: ["TEF"], normalized: "TEF" },
  { keywords: ["BOLETO", "BILLET"], normalized: "BOLETO" },
  { keywords: ["CHEQUE", "CHECK"], normalized: "CHEQUE" },
  { keywords: ["CARTAO", "CARD", "CREDITO"], normalized: "CARTAO" },
  { keywords: ["DINHEIRO", "CASH", "ESPECIE"], normalized: "DINHEIRO" },
  { keywords: ["DEBITO AUTOMATICO", "DEBITO AUTO"], normalized: "DEBITO_AUTOMATICO" },
  { keywords: ["TRANSFERENCIA"], normalized: "TRANSFERENCIA" },
];

export function normalizeChannel(raw: unknown): string | null {
  if (!raw) return null;
  const upper = String(raw).toUpperCase().trim();
  if (!upper) return null;

  for (const { keywords, normalized } of CHANNEL_REGISTRY) {
    if (keywords.some((k) => upper.includes(k))) return normalized;
  }

  return upper;
}

// ─── CONTENT HASH (deduplication) ────────────────────────────────────────────

export function generateContentHash(
  sessionId: number,
  date: string,
  amount: string,
  description: string,
  type: "credit" | "debit"
): string {
  // Deterministic content fingerprint for duplicate detection
  const content = [sessionId, date, amount, type, description.slice(0, 40)].join("|");

  // djb2 hash — fast and collision-resistant for this use case
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
    hash = hash >>> 0; // Keep as 32-bit unsigned
  }
  return hash.toString(36).padStart(7, "0");
}

// ─── FIELD EXTRACTION (handle multiple column name conventions) ───────────────

const FIELD_ALIASES: Record<string, string[]> = {
  date: ["date", "data", "DATA", "Date", "dt", "DT", "competencia", "DTMOVTO", "dtlancamento"],
  description: ["description", "descricao", "DESCRICAO", "Descricao", "historico", "HISTORICO", "memo", "MEMO", "complemento", "natureza"],
  amount: ["amount", "valor", "VALOR", "Valor", "vlr", "VLR", "value", "VALUE", "montante"],
  channel: ["channel", "canal", "CANAL", "Canal", "tipo", "TIPO", "modalidade", "forma_pagamento"],
  bankName: ["bankName", "banco", "BANCO", "Banco", "bank", "BANK", "inst_financeira"],
  clientId: ["clientId", "cliente_id", "CLIENTE_ID", "id_cliente", "customer_id"],
  clientName: ["clientName", "cliente", "CLIENTE", "Cliente", "customer", "sacado", "pagador"],
  externalId: ["externalId", "id", "ID", "codigo", "CODIGO", "codigo_transacao", "nsu", "NSU", "tid", "TID", "end_to_end"],
};

function extractField(row: RawTransactionRow, fieldName: string): unknown {
  const aliases = FIELD_ALIASES[fieldName] ?? [fieldName];
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== "") {
      return row[alias];
    }
  }
  return undefined;
}

// ─── MAIN NORMALIZER ──────────────────────────────────────────────────────────

export function normalizeTransaction(
  sessionId: number,
  row: RawTransactionRow,
  inputType: "credit" | "debit"
): NormalizationResult {
  const errors: NormalizationError[] = [];
  const warnings: string[] = [];

  // Date
  const rawDate = extractField(row, "date");
  const transactionDate = normalizeDate(rawDate);
  if (!transactionDate) {
    errors.push({ field: "date", value: rawDate, message: "Data inválida ou ausente" });
  }

  // Amount
  const rawAmount = extractField(row, "amount");
  const amountResult = normalizeAmount(rawAmount);
  if (!amountResult) {
    errors.push({ field: "amount", value: rawAmount, message: "Valor inválido ou ausente" });
  }

  // Description
  const rawDesc = extractField(row, "description");
  const description = normalizeDescription(rawDesc);
  if (!rawDesc) warnings.push("Descrição ausente — usando placeholder");

  // Bank
  const rawBank = extractField(row, "bankName") as string | null;
  const bankInfo = normalizeBank(rawBank);

  // Channel
  const rawChannel = extractField(row, "channel");
  const channel = normalizeChannel(rawChannel);

  // Client
  const clientId = extractField(row, "clientId");
  const clientName = extractField(row, "clientName");
  const externalId = extractField(row, "externalId");

  if (errors.length > 0) {
    return { transaction: null, errors, warnings };
  }

  const amount = amountResult!.amount;
  const contentHash = generateContentHash(sessionId, transactionDate!, amount, description, inputType);

  return {
    transaction: {
      transactionDate: transactionDate!,
      description,
      amount,
      type: inputType,
      channel,
      bankCode: bankInfo?.code ?? null,
      bankName: bankInfo?.name ?? (rawBank ? String(rawBank).trim() : null),
      clientId: clientId ? String(clientId).trim() || null : null,
      clientName: clientName ? String(clientName).trim() || null : null,
      externalId: externalId ? String(externalId).trim() || null : null,
      contentHash,
    },
    errors: [],
    warnings,
  };
}

export function normalizeBatch(
  sessionId: number,
  rows: RawTransactionRow[],
  inputType: "credit" | "debit"
): BatchNormalizationResult {
  const normalized: NormalizedTransaction[] = [];
  const errors: Array<{ row: number; errors: NormalizationError[] }> = [];
  const warnings: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = normalizeTransaction(sessionId, rows[i], inputType);
    if (result.transaction) {
      normalized.push(result.transaction);
    } else {
      errors.push({ row: i + 1, errors: result.errors });
    }
    if (result.warnings.length > 0) {
      warnings.push(...result.warnings.map((w) => `Linha ${i + 1}: ${w}`));
    }
  }

  return {
    normalized,
    errors,
    warnings,
    stats: { input: rows.length, success: normalized.length, failed: errors.length },
  };
}
