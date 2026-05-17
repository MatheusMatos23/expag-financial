// ═══════════════════════════════════════════════════════════════════════════
// Gerador de Relatório de Conciliação em PDF
// Usa pdf-lib (puro JS, sem dependências nativas) — roda no navegador
// ═══════════════════════════════════════════════════════════════════════════
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

export interface ReconciliationReportData {
  sessionId: number;
  referenceDate: string;
  status: string;
  createdAt: string;
  generatedBy: string;
  // Métricas
  matchRate: number;
  totalTransactions: number;
  matchedCount: number;
  divergentCount: number;
  pendingCount: number;
  // Totais financeiros
  totalBankCredits: number;
  totalBankDebits: number;
  totalApiCredits: number;
  totalApiDebits: number;
  totalDifference: number;
  // Divergências em aberto
  openDivergences: Array<{
    id: number;
    type: string;
    description: string;
    amount: number;
    priority: string;
    bankName?: string;
  }>;
  // Distribuição de matches
  matchBreakdown: Array<{ name: string; value: number }>;
}

// ── Paleta ────────────────────────────────────────────────────────────────────
const COLORS = {
  ink:      rgb(0.06, 0.09, 0.16),
  primary:  rgb(0.23, 0.35, 0.88),
  muted:    rgb(0.35, 0.42, 0.55),
  light:    rgb(0.92, 0.94, 0.97),
  border:   rgb(0.85, 0.88, 0.93),
  positive: rgb(0.02, 0.59, 0.41),
  negative: rgb(0.73, 0.11, 0.11),
  warning:  rgb(0.71, 0.33, 0.04),
  white:    rgb(1, 1, 1),
};

function fmtBRL(v: number): string {
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const TYPE_LABELS: Record<string, string> = {
  bank_surplus: "Sobra no banco",
  bank_shortage: "Falta no banco",
  amount_mismatch: "Divergência de valor",
  date_mismatch: "Divergência de data",
  duplicate: "Duplicidade",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa",
};

export async function generateReconciliationPdf(data: ReconciliationReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font     = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28;  // A4
  const PAGE_H = 841.89;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // ── Helper: nova página quando necessário ──
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      drawFooter(page, font);
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const drawText = (text: string, x: number, size: number, opts?: {
    font?: PDFFont; color?: any; bold?: boolean;
  }) => {
    page.drawText(text, {
      x, y, size,
      font: opts?.bold ? fontBold : (opts?.font ?? font),
      color: opts?.color ?? COLORS.ink,
    });
  };

  // ════════ CABEÇALHO ════════
  // Faixa superior
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: COLORS.primary });

  drawText("EXPAG", MARGIN, 22, { bold: true, color: COLORS.primary });
  y -= 8;
  drawText("Sistema Financeiro", MARGIN + 88, 10, { color: COLORS.muted });
  y -= 26;
  drawText("Relatório de Conciliação Bancária", MARGIN, 16, { bold: true });
  y -= 20;
  drawText(`Sessão #${data.sessionId}  ·  Referência: ${fmtDate(data.referenceDate)}`, MARGIN, 10, { color: COLORS.muted });
  y -= 14;
  drawText(`Gerado em ${fmtDateTime(new Date().toISOString())} por ${data.generatedBy}`, MARGIN, 9, { color: COLORS.muted });
  y -= 20;

  // Linha divisória
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
    thickness: 1, color: COLORS.border,
  });
  y -= 28;

  // ════════ RESUMO EXECUTIVO ════════
  drawText("Resumo Executivo", MARGIN, 12, { bold: true });
  y -= 22;

  // 4 KPI cards
  const kpiW = (CONTENT_W - 3 * 10) / 4;
  const kpis = [
    { label: "Taxa de Conciliação", value: `${data.matchRate}%`,
      color: data.matchRate >= 90 ? COLORS.positive : data.matchRate >= 70 ? COLORS.warning : COLORS.negative },
    { label: "Transações",   value: String(data.totalTransactions), color: COLORS.ink },
    { label: "Conciliadas",  value: String(data.matchedCount),      color: COLORS.positive },
    { label: "Divergências", value: String(data.divergentCount),    color: COLORS.negative },
  ];
  kpis.forEach((kpi, i) => {
    const x = MARGIN + i * (kpiW + 10);
    page.drawRectangle({
      x, y: y - 48, width: kpiW, height: 48,
      color: COLORS.light, borderColor: COLORS.border, borderWidth: 0.5,
    });
    page.drawText(kpi.label.toUpperCase(), {
      x: x + 8, y: y - 14, size: 6.5, font: fontBold, color: COLORS.muted,
    });
    page.drawText(kpi.value, {
      x: x + 8, y: y - 36, size: 18, font: fontBold, color: kpi.color,
    });
  });
  y -= 48 + 28;

  // ════════ TOTAIS FINANCEIROS ════════
  ensureSpace(140);
  drawText("Totais Financeiros", MARGIN, 12, { bold: true });
  y -= 20;

  const finRows: Array<[string, string, any]> = [
    ["Créditos — Banco",   fmtBRL(data.totalBankCredits), COLORS.ink],
    ["Débitos — Banco",    fmtBRL(data.totalBankDebits),  COLORS.ink],
    ["Créditos — Sistema (API)", fmtBRL(data.totalApiCredits), COLORS.ink],
    ["Débitos — Sistema (API)",  fmtBRL(data.totalApiDebits),  COLORS.ink],
  ];
  finRows.forEach(([label, value, color], i) => {
    const rowY = y - i * 20;
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGIN, y: rowY - 6, width: CONTENT_W, height: 20, color: COLORS.light,
      });
    }
    page.drawText(label, { x: MARGIN + 8, y: rowY, size: 9, font, color: COLORS.muted });
    const vWidth = fontBold.widthOfTextAtSize(value, 9);
    page.drawText(value, { x: PAGE_W - MARGIN - 8 - vWidth, y: rowY, size: 9, font: fontBold, color });
  });
  y -= finRows.length * 20 + 6;

  // Linha de diferença — destacada
  page.drawRectangle({
    x: MARGIN, y: y - 8, width: CONTENT_W, height: 24,
    color: Math.abs(data.totalDifference) < 0.01
      ? rgb(0.90, 0.97, 0.94) : rgb(0.99, 0.93, 0.93),
  });
  page.drawText("Diferença Total (Banco − Sistema)", {
    x: MARGIN + 8, y: y, size: 9.5, font: fontBold, color: COLORS.ink,
  });
  const diffStr = fmtBRL(data.totalDifference);
  const diffColor = Math.abs(data.totalDifference) < 0.01 ? COLORS.positive : COLORS.negative;
  const diffW = fontBold.widthOfTextAtSize(diffStr, 9.5);
  page.drawText(diffStr, {
    x: PAGE_W - MARGIN - 8 - diffW, y: y, size: 9.5, font: fontBold, color: diffColor,
  });
  y -= 24 + 28;

  // ════════ DISTRIBUIÇÃO DE MATCHES ════════
  if (data.matchBreakdown.length > 0) {
    ensureSpace(100);
    drawText("Distribuição de Conciliações", MARGIN, 12, { bold: true });
    y -= 20;
    data.matchBreakdown.forEach((m, i) => {
      const rowY = y - i * 18;
      page.drawText(`${m.name}`, { x: MARGIN + 8, y: rowY, size: 9, font, color: COLORS.muted });
      const vStr = String(m.value);
      const vW = fontBold.widthOfTextAtSize(vStr, 9);
      page.drawText(vStr, { x: PAGE_W - MARGIN - 8 - vW, y: rowY, size: 9, font: fontBold, color: COLORS.ink });
    });
    y -= data.matchBreakdown.length * 18 + 24;
  }

  // ════════ DIVERGÊNCIAS EM ABERTO ════════
  ensureSpace(80);
  drawText(`Divergências em Aberto (${data.openDivergences.length})`, MARGIN, 12, { bold: true });
  y -= 20;

  if (data.openDivergences.length === 0) {
    page.drawRectangle({
      x: MARGIN, y: y - 8, width: CONTENT_W, height: 24, color: rgb(0.90, 0.97, 0.94),
    });
    page.drawText("Nenhuma divergencia em aberto — conciliacao integra.", {
      x: MARGIN + 8, y: y, size: 9, font, color: COLORS.positive,
    });
    y -= 24;
  } else {
    // Cabeçalho da tabela
    const cols = [
      { label: "ID",        x: MARGIN + 4,   w: 36 },
      { label: "TIPO",      x: MARGIN + 44,  w: 120 },
      { label: "PRIORIDADE",x: MARGIN + 168, w: 70 },
      { label: "VALOR",     x: PAGE_W - MARGIN - 90, w: 86 },
    ];
    page.drawRectangle({
      x: MARGIN, y: y - 6, width: CONTENT_W, height: 18, color: COLORS.primary,
    });
    cols.forEach(col => {
      page.drawText(col.label, {
        x: col.x, y: y, size: 7, font: fontBold, color: COLORS.white,
      });
    });
    y -= 22;

    // Limita a 30 linhas no PDF (o resto via CSV)
    const rows = data.openDivergences.slice(0, 30);
    rows.forEach((d, i) => {
      ensureSpace(20);
      if (i % 2 === 1) {
        page.drawRectangle({
          x: MARGIN, y: y - 5, width: CONTENT_W, height: 16, color: COLORS.light,
        });
      }
      const typeLabel = TYPE_LABELS[d.type] ?? d.type;
      const prioLabel = PRIORITY_LABELS[d.priority] ?? d.priority;
      const prioColor = d.priority === "critical" ? COLORS.negative
        : d.priority === "high" ? COLORS.warning : COLORS.muted;

      page.drawText(`#${d.id}`, { x: MARGIN + 4, y, size: 8, font, color: COLORS.ink });
      page.drawText(typeLabel.slice(0, 28), { x: MARGIN + 44, y, size: 8, font, color: COLORS.ink });
      page.drawText(prioLabel, { x: MARGIN + 168, y, size: 8, font: fontBold, color: prioColor });
      const vStr = fmtBRL(d.amount);
      const vW = font.widthOfTextAtSize(vStr, 8);
      page.drawText(vStr, { x: PAGE_W - MARGIN - 4 - vW, y, size: 8, font, color: COLORS.ink });
      y -= 16;
    });

    if (data.openDivergences.length > 30) {
      y -= 6;
      drawText(`+ ${data.openDivergences.length - 30} divergencia(s) adicional(is) — ver exportacao CSV completa.`,
        MARGIN, 8, { color: COLORS.muted });
      y -= 14;
    }
  }

  // ════════ ASSINATURA ════════
  y -= 30;
  ensureSpace(80);
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 200, y },
    thickness: 0.5, color: COLORS.ink,
  });
  y -= 12;
  drawText("Responsável pela conciliação", MARGIN, 8, { color: COLORS.muted });
  y -= 11;
  drawText(data.generatedBy, MARGIN, 9, { bold: true });

  drawFooter(page, font);
  return pdf.save();
}

function drawFooter(page: PDFPage, font: PDFFont) {
  const PAGE_W = page.getWidth();
  page.drawText(
    "Documento gerado automaticamente pelo Expag — Sistema Financeiro. Confidencial.",
    { x: 48, y: 28, size: 7, font, color: COLORS.muted },
  );
  page.drawText(
    new Date().toLocaleDateString("pt-BR"),
    { x: PAGE_W - 48 - 50, y: 28, size: 7, font, color: COLORS.muted },
  );
}

// ── Dispara o download no navegador ────────────────────────────────────────────
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  // Cria uma cópia limpa no ArrayBuffer para o Blob (evita problemas de tipo)
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
