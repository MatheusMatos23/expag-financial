import * as XLSX from "xlsx";

export interface ParsedTransaction {
  date: string;
  amount: number;
  type: "credit" | "debit";
  description: string;
  externalId?: string;
  channel?: string;
  clientName?: string;
  /** true → tarifa interna; nunca tem correspondência no extrato bancário */
  isTariff?: boolean;
  /** true → transferência entre contas internas */
  isInternal?: boolean;
  /** true → transação rejeitada/cancelada; ignorar totalmente */
  isRejected?: boolean;
  /** true → transação estornada; deve ser pareada com seu par */
  isEstorno?: boolean;
  /** Status original da API: PAGO, ESTORNADO, REJEITADO, etc. */
  apiStatus?: string;
  /** Hora/minuto da transação para matching de estornos */
  timeStr?: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function parseBRDate(str: string): string {
  if (!str) return "";
  const s = String(str).trim();
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return s.slice(0, 10);
  return "";
}

/**
 * Parses Brazilian-formatted number strings.
 * Handles: "1.234,56", "-\xa0320.000,00 D", "3.000.000,00 C", "179.000,00 "
 * Always returns absolute value — direction comes from C/D flag or sign of valRaw.
 */
function parseBRNumber(raw: string): number {
  if (!raw) return 0;
  let s = String(raw)
    .replace(/\u00a0/g, "") // non-breaking space
    .replace(/R\$\s*/gi, "")
    .trim();
  s = s.replace(/\s*[CD]\s*$/, "").trim(); // remove trailing C/D markers
  s = s.replace(/^[+-]/, "").trim();        // remove sign (handled separately)
  s = s.replace(/[^\d.,]/g, "");            // keep only digits, dots, commas
  if (!s) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : Math.abs(n);
}

function parseJSDate(val: any): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return parseBRDate(String(val));
}

function detectChannel(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes("pix")) return "PIX";
  if (d.includes("ted")) return "TED";
  if (d.includes("boleto") || d.includes("titulo") || d.includes("título")) return "BOLETO";
  if (d.includes("doc")) return "DOC";
  if (d.includes("tarifa") || d.includes("taxa") || d.includes("receita tarifas")) return "TARIFA";
  if (d.includes("pagamento")) return "PAGAMENTO";
  if (d.includes("transf") || d.includes("transferencia")) return "TRANSFERENCIA";
  return "OUTRO";
}

// ─── SICOOB ───────────────────────────────────────────────────────────────────
//
// Estrutura multi-linha do extrato Sicoob:
//
// Linha PRINCIPAL (col[0] = DD/MM/YYYY):
//   col[0] DATA | col[1] DOCUMENTO | col[2] HISTÓRICO | col[3] VALOR
//
// Sub-linhas (col[0] vazio) — pertencem à transação anterior:
//   col[2] = nome do beneficiário, CNPJ, "CODIGO TED: Txxxx", código de lote
//
// Cada transação = 1 linha principal + 2-4 sub-linhas.
// A 1ª sub-linha significativa = nome do beneficiário/remetente.

export function parseSicoob(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    raw: false,
    dateNF: "dd/mm/yyyy",
  });

  const results: ParsedTransaction[] = [];

  let pendingDate    = "";
  let pendingDoc     = "";
  let pendingDesc    = "";
  let pendingValStr  = "";
  let pendingSubRows: string[] = [];

  const SKIP_SUBROW = [
    /^Recebimento Pix$/i,
    /^\d+$/,                     // pure numeric codes / lote numbers
    /^\d{2}\.\d{3}\.\d{3}/,     // CNPJ/CPF format
    /^00000+$/,                  // all-zero codes
  ];

  const flushPending = () => {
    if (!pendingDate || !pendingDesc || !pendingValStr) return;

    const descUpper = pendingDesc.toUpperCase();
    if (descUpper.includes("SALDO")) return;

    const trimmedVal = pendingValStr.trim();
    const isDebit  = trimmedVal.endsWith("D");
    const isCredit = trimmedVal.endsWith("C");
    if (!isDebit && !isCredit) return; // rows marked with * are blocked amounts

    const amount = parseBRNumber(trimmedVal);
    if (amount === 0) return;

    let clientName: string | undefined;
    let externalId: string | undefined;

    for (const text of pendingSubRows) {
      if (/^CODIGO TED:/i.test(text)) {
        externalId = text.replace(/^CODIGO TED:\s*/i, "").trim();
        continue;
      }
      // Extrai END2END do Sicoob quando aparece em subrow (formato E + 32 chars)
      if (/^E[A-Z0-9]{28,}/i.test(text)) {
        externalId = text.trim();
        continue;
      }
      if (SKIP_SUBROW.some((re) => re.test(text))) continue;
      if (!clientName && text.length >= 3) clientName = text;
    }

    // Fallbacks para externalId
    if (!externalId) {
      // Doc number numérico do Sicoob (exceto "Pix" e datas)
      const doc = pendingDoc.trim();
      if (doc && doc !== "Pix" && !/^\d{2}\/\d{2}/.test(doc) && /^\d{4,}$/.test(doc)) {
        externalId = doc;
      }
    }

    results.push({
      date: pendingDate,
      amount,
      type: isDebit ? "debit" : "credit",
      description: clientName ? `${pendingDesc} - ${clientName}` : pendingDesc,
      externalId,
      clientName,
      channel: detectChannel(pendingDesc),
    });
  };

  for (const row of allRows) {
    const col0 = String(row[0] ?? "").trim();

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(col0)) {
      flushPending();
      const dateStr = parseBRDate(col0);
      if (!dateStr || dateStr < "2020-01-01") { pendingDate = ""; continue; }
      pendingDate    = dateStr;
      pendingDoc     = String(row[1] ?? "").trim();
      pendingDesc    = String(row[2] ?? "").trim();
      pendingValStr  = String(row[3] ?? "").trim();
      pendingSubRows = [];
    } else if (pendingDate) {
      const text = String(row[2] ?? "").trim();
      if (text) pendingSubRows.push(text);
    }
  }

  flushPending();
  return results;
}

// ─── BANCO DO BRASIL ──────────────────────────────────────────────────────────
//
// Colunas (após linha de cabeçalho com "Data" e "Historico"):
//   col[0] = Data (DD/MM/YYYY)
//   col[5] = Numero Documento
//   col[7] = Historico (descrição)
//   col[8] = Valor R$ ("179.000,00 ")
//   col[9] = Inf. ("C" ou "D")
//   col[10]= Detalhamento Hist. (CPF + nome, ou banco + conta + nome)
//
// Linhas a IGNORAR:
//   - "Saldo Anterior" → hist.replace(/\s+/g,"").toLowerCase() inclui "saldoanterior"
//   - "S A L D O"      → hist.replace(/\s+/g,"").toLowerCase() === "saldo"

export function parseBB(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    raw: false,
    dateNF: "dd/mm/yyyy",
  });

  const results: ParsedTransaction[] = [];
  let headerFound = false;

  for (const row of rows) {
    if (!headerFound) {
      if (
        String(row[0] ?? "").toLowerCase().includes("data") &&
        String(row[7] ?? "").toLowerCase().includes("hist")
      ) {
        headerFound = true;
      }
      continue;
    }

    const dateStr = parseBRDate(String(row[0] ?? ""));
    if (!dateStr || dateStr < "2020-01-01") continue;

    const hist = String(row[7] ?? "").trim();
    if (!hist) continue;

    // Skip saldo lines ("Saldo Anterior" and "S A L D O" end-of-statement row)
    const histNorm = hist.replace(/\s+/g, "").toLowerCase();
    if (histNorm === "saldo" || histNorm.includes("saldoanterior")) continue;

    const cdFlag = String(row[9] ?? "").trim().toUpperCase();
    if (cdFlag !== "C" && cdFlag !== "D") continue;

    const amount = parseBRNumber(String(row[8] ?? ""));
    if (amount === 0) continue;

    const detail = String(row[10] ?? "").trim();

    // Enrich description with detalhamento when meaningful
    const description =
      detail && detail.replace(/\s+/g, "").length > 3
        ? `${hist} | ${detail}`
        : hist;

    // Extract beneficiary name from detalhamento
    let clientName: string | undefined;
    if (detail) {
      // "17/04 22:28 00013310971856 FRANCISCO D..." → name after 11-14 digit ID
      const nameMatch = detail.match(/\d{11,14}\s+(.+)/);
      if (nameMatch) clientName = nameMatch[1].trim();
      // "756 4340 10911906000200 AGILE LOGISTIC" → bank + agencia + conta + name
      if (!clientName) {
        const bankMatch = detail.match(/^\d{3}\s+\d+\s+\d+\s+(.+)/);
        if (bankMatch) clientName = bankMatch[1].trim();
      }
      // "756 5004 032906701000180 EXPAG SOLUCOE" style
      if (!clientName) {
        const parts = detail.trim().split(/\s+/);
        if (parts.length >= 3 && /^\d{3}$/.test(parts[0])) {
          clientName = parts.slice(3).join(" ").trim() || undefined;
        }
      }
    }

    // BB does NOT expose END2END IDs in extracts — doc number is a BB-internal reference
    const docNum = String(row[5] ?? "").trim().replace(/^0+/, "");
    const externalId = docNum || undefined;

    results.push({
      date: dateStr,
      amount,
      type: cdFlag === "D" ? "debit" : "credit",
      description,
      externalId,
      clientName,
      channel: detectChannel(hist),
    });
  }

  return results;
}

// ─── JD ───────────────────────────────────────────────────────────────────────
//
// Colunas (após linha com "ID" em col[0]):
//   col[0] = ID (prefixado com apóstrofo: "'2760735403")
//   col[1] = TRANSAÇÃO ("Pix")
//   col[2] = END2END (chave única de roteamento Pix)
//   col[3] = OPERAÇÃO ("credito" | "debito")
//   col[4] = VALOR (negativo para débito, positivo para crédito)
//   col[6] = DATA CONTÁBIL (objeto Date)

export function parseJD(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true });

  const results: ParsedTransaction[] = [];
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] ?? "").toUpperCase() === "ID") {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return results;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const op = String(row[3] ?? "").toLowerCase().trim();
    if (op !== "credito" && op !== "debito") continue;

    const val = parseFloat(String(row[4] ?? "0"));
    if (isNaN(val) || val === 0) continue;

    const dateStr = parseJSDate(row[6]);
    if (!dateStr || dateStr < "2020-01-01") continue;

    const e2e  = String(row[2] ?? "").trim().replace(/^'/, "");
    const txId = String(row[0] ?? "").trim().replace(/^'/, "");

    results.push({
      date: dateStr,
      amount: Math.abs(val),
      type: op === "debito" ? "debit" : "credit",
      description: String(row[1] ?? "Pix").trim(),
      // E2E is the primary key for JD↔API matching
      externalId: e2e || txId || undefined,
      channel: "PIX",
    });
  }

  return results;
}

// ─── API ──────────────────────────────────────────────────────────────────────
//
// Colunas (header: COD | COD EXTRATO | CLIENTE | CPF/CNPJ | GRUPO | EMPRESA |
//          REPRESENTANTE | DATA | R$ VALOR | R$ SALDO | DESCRIÇÃO | CPF/CNPJ RECEBEDOR |
//          OPERAÇÃO | AUTENTICAÇÃO | ...):
//
//   col[2]  = CLIENTE (nome do cliente da Expag)
//   col[7]  = DATA ("DD/MM/YYYY HH:MM")
//   col[8]  = R$ VALOR (positivo = crédito, negativo = débito)
//   col[10] = DESCRIÇÃO (pode ser null para tarifas)
//   col[12] = OPERAÇÃO
//   col[13] = AUTENTICAÇÃO (END2END para Pix reais; UUID para tarifas)
//
// Classificação:
//   isTariff  = TARIFA_OPERATIONS → nunca reconciliável com banco individualmente
//   isInternal= "TRANSFERÊNCIA ENTRE CONTAS" → entre contas próprias da Expag

const TARIFF_OPERATIONS = new Set([
  "TARIFA PIX ENVIADO",
  "TARIFA PIX RECEBIDO",
  "TARIFA EMISSÃO DE BOLETO",
  "TARIFA TED",
  "TARIFA TRANSFERÊNCIA ENTRE CONTAS RECEBIDA",
  "RECEITA TARIFAS",
  "MANUTENÇÃO DE CONTA",
]);

const INTERNAL_OPERATIONS = new Set([
  "TRANSFERÊNCIA ENTRE CONTAS",
]);

export function parseAPI(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false });

  const results: ParsedTransaction[] = [];
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] ?? "").toUpperCase() === "COD") {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return results;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];

    const valRaw = parseFloat(String(row[8] ?? "0").replace(",", "."));
    if (isNaN(valRaw) || valRaw === 0) continue;

    const dateTimeStr = String(row[7] ?? "").trim();
    const [datePart, timePart] = dateTimeStr.split(" ");
    const dateStr = parseBRDate(datePart ?? "");
    if (!dateStr || dateStr < "2020-01-01") continue;

    const op         = String(row[12] ?? "").trim();
    const auth       = String(row[13] ?? "").trim();
    const descRaw    = String(row[10] ?? "").trim();
    const clientName = String(row[2]  ?? "").trim() || undefined;
    const apiStatus  = String(row[16] ?? "").trim().toUpperCase();

    // STATUS: filtros
    const isRejected = apiStatus === "REJEITADO" || apiStatus === "CANCELADO";
    const isEstorno  = apiStatus === "ESTORNADO";

    // Transações rejeitadas: ignorar completamente
    if (isRejected) continue;

    const isTariff   = TARIFF_OPERATIONS.has(op);
    const isInternal = INTERNAL_OPERATIONS.has(op);

    // END2END: apenas IDs que começam com E + 28+ chars (sem hífens)
    const isE2E = /^E[A-Z0-9]{28,}$/i.test(auth);
    // Para estornos, o auth pode ter prefixo "D_" — normaliza para matching
    const authNorm = auth.startsWith("D_") ? auth.slice(2) : auth;
    const externalId = isE2E ? auth : (isEstorno && authNorm ? authNorm : undefined);

    results.push({
      date: dateStr,
      timeStr: timePart ?? undefined,
      amount: Math.abs(valRaw),
      type: valRaw > 0 ? "credit" : "debit",
      description: descRaw || op,
      externalId: isE2E ? auth : undefined,
      channel: isTariff ? "TARIFA" : detectChannel(op),
      clientName,
      isTariff,
      isInternal,
      isEstorno,
      apiStatus,
    });
  }

  // ── Pré-processamento de estornos ───────────────────────────────────────────
  // Estornos vêm em pares: um com auth "D_xxx" e outro com "xxx" (mesmo base)
  // Quando existe par completo, se cancelam (não geram divergência).
  // Estornos sem par permanecem como divergência.

  const estornos   = results.filter(t => t.isEstorno);
  const nonEstornos = results.filter(t => !t.isEstorno);

  // Agrupa por: base_auth (sem "D_") OU fallback date|amount quando sem auth
  const estornoPairs = new Map<string, ParsedTransaction[]>();
  for (const t of estornos) {
    // Remove prefixo D_ para normalizar a chave
    const rawAuth = t.externalId ?? "";
    const baseAuth = rawAuth.startsWith("D_") ? rawAuth.slice(2) : rawAuth;
    // Chave: base auth se válido, senão date|amount (pares pelo mesmo valor/dia)
    const key = baseAuth.length > 4
      ? `auth|${baseAuth}`
      : `val|${t.date}|${t.amount.toFixed(2)}`;
    if (!estornoPairs.has(key)) estornoPairs.set(key, []);
    estornoPairs.get(key)!.push(t);
  }

  const unparedEstornos: ParsedTransaction[] = [];
  for (const [, pair] of Array.from(estornoPairs)) {
    // Par completo: um com D_ (original) e um sem (estorno) → se cancelam
    const hasOriginal = pair.some(t => !(t.externalId ?? "").startsWith("D_"));
    const hasReverted = pair.some(t =>  (t.externalId ?? "").startsWith("D_"));
    if (pair.length >= 2 && hasOriginal && hasReverted) {
      continue; // par completo — não gera divergência
    }
    // Par incompleto ou só um lado → mantém como divergência
    unparedEstornos.push(...pair);
  }

  return [...nonEstornos, ...unparedEstornos];
}

export function parseStatement(
  buffer: Buffer,
  bank: "sicoob" | "bb" | "jd" | "api"
): ParsedTransaction[] {
  switch (bank) {
    case "sicoob": return parseSicoob(buffer);
    case "bb":     return parseBB(buffer);
    case "jd":     return parseJD(buffer);
    case "api":    return parseAPI(buffer);
  }
}
