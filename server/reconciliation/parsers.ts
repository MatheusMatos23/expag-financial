import * as XLSX from "xlsx";

export interface ParsedTransaction {
  date: string;
  amount: number;
  type: "credit" | "debit";
  description: string;
  externalId?: string;
  channel?: string;
  clientName?: string;
}

function parseBRDate(str: string): string {
  if (!str) return "";
  const s = String(str).trim();
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return s.slice(0, 10);
  return "";
}

function parseBRNumber(str: string): number {
  if (str === null || str === undefined) return 0;
  const s = String(str).replace(/[^\d,.-]/g, "").trim();
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
  if (d.includes("boleto") || d.includes("título") || d.includes("tit")) return "BOLETO";
  if (d.includes("doc")) return "DOC";
  if (d.includes("tarifa") || d.includes("taxa")) return "TARIFA";
  return "OUTRO";
}

export function parseSicoob(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });
  const results: ParsedTransaction[] = [];
  for (const row of rows) {
    const dateStr = parseBRDate(row[0]);
    if (!dateStr || dateStr < "2020-01-01") continue;
    const desc = String(row[2] ?? "").trim();
    if (!desc || desc.toUpperCase().includes("SALDO")) continue;
    const valStr = String(row[3] ?? "").trim();
    const isDebit = valStr.endsWith("D");
    const isCredit = valStr.endsWith("C");
    if (!isDebit && !isCredit) continue;
    const amount = parseBRNumber(valStr.replace(/ [CD]$/, "").replace(/\*/g, ""));
    if (amount === 0) continue;
    results.push({ date: dateStr, amount, type: isDebit ? "debit" : "credit", description: desc, externalId: String(row[1] ?? "").trim() || undefined, channel: detectChannel(desc) });
  }
  return results;
}

export function parseBB(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });
  const results: ParsedTransaction[] = [];
  let headerFound = false;
  for (const row of rows) {
    if (!headerFound) {
      if (String(row[0] ?? "").toLowerCase().includes("data") && String(row[7] ?? "").toLowerCase().includes("hist")) { headerFound = true; }
      continue;
    }
    const dateStr = parseBRDate(row[0]);
    if (!dateStr || dateStr < "2020-01-01") continue;
    const hist = String(row[7] ?? "").trim();
    if (!hist || hist.toLowerCase().includes("saldo anterior")) continue;
    const cdFlag = String(row[9] ?? "").trim().toUpperCase();
    if (cdFlag !== "C" && cdFlag !== "D") continue;
    const amount = parseBRNumber(String(row[8] ?? ""));
    if (amount === 0) continue;
    const detail = String(row[10] ?? "").trim();
    const e2eMatch = detail.match(/E[A-Z0-9]{20,}/i);
    const externalId = e2eMatch ? e2eMatch[0] : String(row[5] ?? "").trim() || undefined;
    results.push({ date: dateStr, amount, type: cdFlag === "D" ? "debit" : "credit", description: hist, externalId, channel: detectChannel(hist) });
  }
  return results;
}

export function parseJD(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true });
  const results: ParsedTransaction[] = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] ?? "").toUpperCase() === "ID") { headerIdx = i; break; }
  }
  if (headerIdx < 0) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const op = String(row[3] ?? "").toLowerCase().trim();
    if (op !== "credito" && op !== "debito") continue;
    const val = parseFloat(String(row[4] ?? "0"));
    if (isNaN(val) || val === 0) continue;
    const dateStr = parseJSDate(row[6]);
    if (!dateStr) continue;
    const e2e = String(row[2] ?? "").trim().replace(/^'/, "");
    results.push({ date: dateStr, amount: Math.abs(val), type: op === "debito" ? "debit" : "credit", description: String(row[1] ?? "Pix").trim(), externalId: e2e || String(row[0] ?? "").trim().replace(/^'/, ""), channel: "PIX" });
  }
  return results;
}

export function parseAPI(buffer: Buffer): ParsedTransaction[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false });
  const results: ParsedTransaction[] = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] ?? "").toUpperCase() === "COD") { headerIdx = i; break; }
  }
  if (headerIdx < 0) return results;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const valRaw = parseFloat(String(row[8] ?? "0").replace(",", "."));
    if (isNaN(valRaw) || valRaw === 0) continue;
    const dateStr = parseBRDate(String(row[7] ?? "").split(" ")[0]);
    if (!dateStr) continue;
    const op = String(row[12] ?? "").trim();
    const auth = String(row[13] ?? "").trim();
    results.push({
      date: dateStr, amount: Math.abs(valRaw), type: valRaw > 0 ? "credit" : "debit",
      description: String(row[10] ?? op).trim() || op,
      externalId: auth && auth !== " - " && auth !== "-" ? auth : undefined,
      channel: detectChannel(op), clientName: String(row[2] ?? "").trim()
    });
  }
  return results;
}

export function parseStatement(buffer: Buffer, bank: "sicoob" | "bb" | "jd" | "api"): ParsedTransaction[] {
  switch (bank) {
    case "sicoob": return parseSicoob(buffer);
    case "bb":     return parseBB(buffer);
    case "jd":     return parseJD(buffer);
    case "api":    return parseAPI(buffer);
  }
}
