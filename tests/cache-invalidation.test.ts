import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Bug histórico (sessão #51 — auditoria geral):
 * Após mover uma divergência para Receitas ou Despesas, a lista de divergências
 * mostrava o item movido por até 10 segundos (TTL do cache backend de
 * 'divergences_all'). Idem para upsertManagerialBalance, NDI, ajustes manuais.
 *
 * Causa: as funções state-changing em db.ts não chamavam
 * `invalidateReconciliationCaches()` após mudar dados, mesmo quando tinham
 * efeito direto sobre os caches.
 *
 * Correção: adicionado o invalidate no final de cada uma.
 *
 * Este teste lê o source de db.ts e verifica que TODAS as funções listadas
 * chamam invalidateReconciliationCaches() (ou _cache.clear/_cache.delete) no
 * seu corpo. Não roda a função — só garante que o gatilho está presente,
 * funcionando como guarda contra regressão se alguém remover por engano.
 */

const dbSource = readFileSync(join(__dirname, "..", "server", "db.ts"), "utf-8");

/** Recorta o corpo de uma função `export async function NAME`.
 *  Precisa pular tipos de retorno como `: Promise<{...}>` antes do corpo. */
function extractFunctionBody(src: string, fnName: string): string | null {
  const startRe = new RegExp(`export async function ${fnName}\\s*\\(`);
  const m = startRe.exec(src);
  if (!m) return null;

  // Acha o ')' que fecha os parâmetros (balanceando parênteses)
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    const ch = src[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    i++;
  }
  // Agora i está após o ) de fechamento dos parâmetros.
  // Pula tipo de retorno se existir — chave do corpo é o primeiro '{' depois
  // que NÃO esteja entre <>.
  let angle = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") angle++;
    else if (ch === ">") angle--;
    else if (ch === "{" && angle === 0) break;
    i++;
  }
  if (src[i] !== "{") return null;

  const braceOpen = i;
  let depth = 1;
  i = braceOpen + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(braceOpen, i);
}

const REQUIRES_INVALIDATION = [
  "moveDivergencesToRevenue",
  "moveDivergencesToExpense",
  "upsertManagerialBalance",
  "resolveNdi",
  "markDivergencesAsNdi",
  "unmarkNdi",
  "createManualAdjustment",
  "upsertDRE",
  "upsertCashFlow",
  // funções que já tinham invalidação — verifica que continuam tendo
  "manualReconcileDivergences",
  "unmatchFromDivergence",
  "unmatchPair",
  "moveDivergencesToBoleto",
  "updateDivergenceStatus",
  "postCounterpartEntry",
  "clearOperationalData",
];

describe("Cache invalidation guardrails — server/db.ts", () => {
  for (const fnName of REQUIRES_INVALIDATION) {
    it(`${fnName} chama invalidateReconciliationCaches ou _cache.clear`, () => {
      const body = extractFunctionBody(dbSource, fnName);
      expect(body, `função ${fnName} não encontrada em db.ts`).not.toBeNull();
      const hasInvalidate =
        body!.includes("invalidateReconciliationCaches") ||
        body!.includes("_cache.clear") ||
        body!.includes("_cache.delete") ||
        // delega para outra função que invalida (Boleto)
        body!.includes("recalculateBoletoDifferences") ||
        body!.includes("upsertBoletoEntry");
      expect(hasInvalidate, `${fnName} muda estado mas não invalida cache`).toBe(true);
    });
  }
});
