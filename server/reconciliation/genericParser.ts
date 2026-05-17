import * as XLSX from "xlsx";
import type { ParsedTransaction } from "./parsers";

// ═══════════════════════════════════════════════════════════════════════════
// PARSER GENÉRICO INTELIGENTE
// Detecta automaticamente as colunas de data, valor, descrição e crédito/débito
// em QUALQUER planilha de extrato bancário — independente da posição das colunas
// ou de quantas linhas de cabeçalho/rodapé existam.
// ═══════════════════════════════════════════════════════════════════════════

// ── Dicionário de palavras-chave por tipo de coluna ──────────────────────────
// Quanto mais específica a palavra, maior o peso na pontuação.
const COLUMN_KEYWORDS = {
  date: [
    "data", "dt", "date", "data lançamento", "data lancamento",
    "data movimento", "data da transação", "data transacao", "competência",
    "data oper", "dt mov",
  ],
  amount: [
    "valor", "value", "amount", "vlr", "valor r$", "valor (r$)",
    "montante", "quantia", "valor da transação", "valor transacao",
  ],
  description: [
    "histórico", "historico", "descrição", "descricao", "description",
    "lançamento", "lancamento", "memo", "detalhe", "observação", "observacao",
    "complemento", "transação", "transacao", "movimento",
  ],
  creditDebit: [
    "tipo", "c/d", "d/c", "débito/crédito", "debito/credito", "natureza",
    "inf", "inf.", "sinal", "operação", "operacao",
  ],
  document: [
    "documento", "doc", "nº documento", "numero documento", "num doc",
    "nº doc", "controle", "referência", "referencia", "id", "código",
    "codigo", "nosso número", "nosso numero",
  ],
  credit: [
    "crédito", "credito", "entrada", "entradas", "receita", "recebimento",
  ],
  debit: [
    "débito", "debito", "saída", "saida", "pagamento", "despesa",
  ],
} as const;

type ColumnRole = "date" | "amount" | "description" | "creditDebit" | "document" | "credit" | "debit";

interface ColumnMap {
  date: number;
  amount: number;
  description: number;
  creditDebit: number;     // -1 se não houver coluna C/D separada
  document: number;        // -1 se não houver
  creditCol: number;       // coluna de crédito separada (extratos com 2 colunas de valor)
  debitCol: number;        // coluna de débito separada
  headerRowIndex: number;
}

// ── Normaliza texto para comparação (sem acento, minúsculo, sem espaço extra) ──
function normalize(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // remove acentos
    .replace(/\s+/g, " ")
    .trim();
}

// ── Verifica se um valor parece uma data BR ou ISO ──────────────────────────
function looksLikeDate(v: any): boolean {
  if (v instanceof Date) return true;
  const s = String(v ?? "").trim();
  if (/^\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  return false;
}

// ── Verifica se um valor parece um número monetário ─────────────────────────
function looksLikeMoney(v: any): boolean {
  if (typeof v === "number") return true;
  const s = String(v ?? "").trim();
  if (!s) return false;
  // Aceita: 1.234,56 / 1234.56 / -320,00 / 3.000,00 C / R$ 50,00
  const cleaned = s.replace(/r\$/i, "").replace(/[cd]\s*$/i, "").replace(/\u00a0/g, "").trim();
  return /^[+-]?[\d.,]+$/.test(cleaned) && /\d/.test(cleaned);
}

// ── Converte data (BR, ISO ou serial Excel) para ISO ────────────────────────
function toIsoDate(v: any): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Serial date do Excel
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  const br = s.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2]}-${br[1]}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return s.slice(0, 10);
  return "";
}

// ── Converte string monetária BR para número absoluto ──────────────────────
function toAmount(v: any): number {
  if (typeof v === "number") return Math.abs(v);
  let s = String(v ?? "")
    .replace(/\u00a0/g, "")
    .replace(/r\$/gi, "")
    .replace(/\s*[cd]\s*$/i, "")
    .replace(/^[+-]/, "")
    .trim()
    .replace(/[^\d.,]/g, "");
  if (!s) return 0;
  // Decide separador decimal: o último entre ',' e '.' é o decimal
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    // padrão BR: 1.234,56
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // padrão US: 1,234.56
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s.replace(/,/g, "");
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : Math.abs(n);
}

// ── Detecta o sinal (crédito/débito) de um valor monetário ──────────────────
function detectSign(v: any): "credit" | "debit" | null {
  const s = String(v ?? "").trim();
  if (/^-/.test(s) || /\bd\s*$/i.test(s)) return "debit";
  if (/^\+/.test(s) || /\bc\s*$/i.test(s)) return "credit";
  if (typeof v === "number") return v < 0 ? "debit" : "credit";
  return null;
}

// ── Pontua uma célula de cabeçalho contra um papel de coluna ────────────────
function scoreHeader(cell: string, role: ColumnRole): number {
  const norm = normalize(cell);
  if (!norm) return 0;
  let best = 0;
  for (const kw of COLUMN_KEYWORDS[role]) {
    if (norm === kw) best = Math.max(best, 100);                    // match exato
    else if (norm.includes(kw) || kw.includes(norm)) best = Math.max(best, 60); // match parcial
  }
  return best;
}

// ── Detecta a linha de cabeçalho e mapeia as colunas ────────────────────────
function detectColumns(rows: any[][]): ColumnMap | null {
  let bestHeaderRow = -1;
  let bestScore = 0;
  let bestMap: Partial<ColumnMap> = {};

  // Examina as primeiras 25 linhas procurando o cabeçalho
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;

    const map: Partial<ColumnMap> = {
      date: -1, amount: -1, description: -1, creditDebit: -1,
      document: -1, creditCol: -1, debitCol: -1,
    };
    let rowScore = 0;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "");
      if (!cell.trim()) continue;

      // Testa cada papel e fica com o melhor
      const scores: Record<string, number> = {
        date: scoreHeader(cell, "date"),
        amount: scoreHeader(cell, "amount"),
        description: scoreHeader(cell, "description"),
        creditDebit: scoreHeader(cell, "creditDebit"),
        document: scoreHeader(cell, "document"),
        credit: scoreHeader(cell, "credit"),
        debit: scoreHeader(cell, "debit"),
      };
      const topRole = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (topRole[1] < 50) continue;

      rowScore += topRole[1];
      const role = topRole[0];
      if (role === "date" && map.date === -1) map.date = c;
      else if (role === "amount" && map.amount === -1) map.amount = c;
      else if (role === "description" && map.description === -1) map.description = c;
      else if (role === "creditDebit" && map.creditDebit === -1) map.creditDebit = c;
      else if (role === "document" && map.document === -1) map.document = c;
      else if (role === "credit" && map.creditCol === -1) map.creditCol = c;
      else if (role === "debit" && map.debitCol === -1) map.debitCol = c;
    }

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestHeaderRow = r;
      bestMap = map;
    }
  }

  // Se não achou cabeçalho confiável, tenta detecção por conteúdo
  if (bestHeaderRow === -1 || bestScore < 100) {
    return detectByContent(rows);
  }

  // Valida: precisa ter pelo menos data e (valor OU colunas crédito/débito)
  const m = bestMap as ColumnMap;
  m.headerRowIndex = bestHeaderRow;
  const hasAmount = m.amount !== -1 || (m.creditCol !== -1 || m.debitCol !== -1);
  if (m.date === -1 || !hasAmount) {
    return detectByContent(rows);
  }
  return m;
}

// ── Detecção por conteúdo: quando não há cabeçalho reconhecível ─────────────
// Examina as linhas de dados e descobre quais colunas contêm datas e valores.
function detectByContent(rows: any[][]): ColumnMap | null {
  const colStats: Array<{ dateHits: number; moneyHits: number; textLen: number; total: number }> = [];

  for (const row of rows.slice(0, 60)) {
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (!colStats[c]) colStats[c] = { dateHits: 0, moneyHits: 0, textLen: 0, total: 0 };
      const v = row[c];
      if (v === null || v === undefined || v === "") continue;
      colStats[c].total++;
      if (looksLikeDate(v)) colStats[c].dateHits++;
      else if (looksLikeMoney(v)) colStats[c].moneyHits++;
      else colStats[c].textLen += String(v).length;
    }
  }

  if (colStats.length < 2) return null;

  // Coluna de data = maior proporção de datas
  let dateCol = -1, dateRatio = 0;
  let amountCol = -1, amountRatio = 0;
  let descCol = -1, descLen = 0;

  colStats.forEach((s, c) => {
    if (s.total < 3) return;
    const dRatio = s.dateHits / s.total;
    const mRatio = s.moneyHits / s.total;
    if (dRatio > dateRatio && dRatio > 0.5) { dateRatio = dRatio; dateCol = c; }
    if (mRatio > amountRatio && mRatio > 0.5) { amountRatio = mRatio; amountCol = c; }
    if (s.textLen > descLen) { descLen = s.textLen; descCol = c; }
  });

  if (dateCol === -1 || amountCol === -1) return null;

  return {
    date: dateCol,
    amount: amountCol,
    description: descCol,
    creditDebit: -1,
    document: -1,
    creditCol: -1,
    debitCol: -1,
    headerRowIndex: -1,  // sem cabeçalho — processa todas as linhas
  };
}

// ── Detecta canal pela descrição ────────────────────────────────────────────
function detectChannel(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes("pix")) return "PIX";
  if (d.includes("ted")) return "TED";
  if (d.includes("boleto") || d.includes("titulo") || d.includes("título")) return "BOLETO";
  if (d.includes("doc")) return "DOC";
  if (d.includes("tarifa") || d.includes("taxa")) return "TARIFA";
  if (d.includes("pagamento")) return "PAGAMENTO";
  if (d.includes("transf")) return "TRANSFERENCIA";
  return "OUTRO";
}

export interface GenericParseResult {
  transactions: ParsedTransaction[];
  detectedColumns: {
    date: string;
    amount: string;
    description: string;
    creditDebit: string;
    headerDetected: boolean;
  };
  warnings: string[];
}

// ── PARSER GENÉRICO PRINCIPAL ───────────────────────────────────────────────
export function parseGenericStatement(buffer: Buffer): GenericParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: "" });

  const warnings: string[] = [];

  const colMap = detectColumns(rows);
  if (!colMap) {
    return {
      transactions: [],
      detectedColumns: { date: "—", amount: "—", description: "—", creditDebit: "—", headerDetected: false },
      warnings: ["Não foi possível detectar as colunas de data e valor automaticamente. Verifique o formato do arquivo."],
    };
  }

  const colLetter = (i: number) => i === -1 ? "—" : XLSX.utils.encode_col(i);
  const detectedColumns = {
    date: colLetter(colMap.date),
    amount: colMap.amount !== -1 ? colLetter(colMap.amount)
      : `${colLetter(colMap.creditCol)}/${colLetter(colMap.debitCol)}`,
    description: colLetter(colMap.description),
    creditDebit: colMap.creditDebit !== -1 ? colLetter(colMap.creditDebit) : "auto",
    headerDetected: colMap.headerRowIndex !== -1,
  };

  const transactions: ParsedTransaction[] = [];
  const startRow = colMap.headerRowIndex === -1 ? 0 : colMap.headerRowIndex + 1;
  let skipped = 0;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // ── Data ──
    const rawDate = row[colMap.date];
    const date = toIsoDate(rawDate);
    if (!date || date < "2015-01-01" || date > "2100-01-01") { skipped++; continue; }

    // ── Descrição ──
    const description = colMap.description !== -1
      ? String(row[colMap.description] ?? "").trim()
      : "";

    // Ignora linhas de saldo
    const descNorm = normalize(description);
    if (descNorm.includes("saldo") && !descNorm.includes("pix")) continue;

    // ── Valor e tipo ──
    let amount = 0;
    let type: "credit" | "debit" = "credit";

    if (colMap.creditCol !== -1 || colMap.debitCol !== -1) {
      // Extrato com colunas separadas de crédito e débito
      const creditVal = colMap.creditCol !== -1 ? toAmount(row[colMap.creditCol]) : 0;
      const debitVal  = colMap.debitCol !== -1 ? toAmount(row[colMap.debitCol]) : 0;
      if (creditVal > 0) { amount = creditVal; type = "credit"; }
      else if (debitVal > 0) { amount = debitVal; type = "debit"; }
      else { skipped++; continue; }
    } else {
      // Coluna única de valor
      const rawAmount = row[colMap.amount];
      amount = toAmount(rawAmount);
      if (amount === 0) { skipped++; continue; }

      // Determina o sinal: 1) coluna C/D dedicada, 2) sinal no próprio valor
      if (colMap.creditDebit !== -1) {
        const cd = normalize(row[colMap.creditDebit]);
        if (cd === "d" || cd.includes("deb") || cd.includes("sa",) || cd === "-") type = "debit";
        else if (cd === "c" || cd.includes("cred") || cd.includes("entr") || cd === "+") type = "credit";
        else {
          const sign = detectSign(rawAmount);
          type = sign ?? "credit";
        }
      } else {
        const sign = detectSign(rawAmount);
        type = sign ?? "credit";
      }
    }

    // ── Documento / ID externo ──
    let externalId: string | undefined;
    if (colMap.document !== -1) {
      const doc = String(row[colMap.document] ?? "").trim();
      if (doc && /^[A-Z0-9]{4,}$/i.test(doc)) externalId = doc;
    }
    // Tenta extrair END2END da descrição (formato E + 28+ chars)
    const e2e = description.match(/\bE[A-Z0-9]{28,}\b/i);
    if (!externalId && e2e) externalId = e2e[0];

    transactions.push({
      date,
      amount,
      type,
      description: description || "(sem descrição)",
      externalId,
      channel: detectChannel(description),
    });
  }

  if (transactions.length === 0) {
    warnings.push("Nenhuma transação válida encontrada. As colunas foram detectadas, mas as linhas de dados não puderam ser lidas.");
  } else if (skipped > transactions.length) {
    warnings.push(`${skipped} linha(s) ignorada(s) — podem conter cabeçalhos, rodapés ou dados incompletos.`);
  }

  return { transactions, detectedColumns, warnings };
}
