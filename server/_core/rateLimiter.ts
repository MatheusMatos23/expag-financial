// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiter — em memória, sem dependências externas
// Protege endpoints sensíveis (login, setup) contra força bruta
// ═══════════════════════════════════════════════════════════════════════════

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Limpeza periódica de buckets expirados (evita vazamento de memória)
setInterval(() => {
  const now = Date.now();
  Array.from(buckets.entries()).forEach(([key, bucket]) => {
    if (now > bucket.resetAt) buckets.delete(key);
  });
}, 60_000).unref?.();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
}

/**
 * Verifica e consome uma requisição do bucket de rate limit.
 * @param key       Identificador único (ex: "login:192.168.1.1")
 * @param maxHits   Número máximo de requisições na janela
 * @param windowMs  Tamanho da janela em milissegundos
 */
export function checkRateLimit(
  key: string,
  maxHits: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    // Nova janela
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxHits - 1, resetInSec: Math.ceil(windowMs / 1000) };
  }

  if (bucket.count >= maxHits) {
    return { allowed: false, remaining: 0, resetInSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: maxHits - bucket.count,
    resetInSec: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/**
 * Extrai o IP do request considerando proxies (Railway usa x-forwarded-for).
 */
export function getClientIp(req: any): string {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0];
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

/**
 * Reseta o contador para uma chave (ex: após login bem-sucedido).
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

// Presets de limites
export const LIMITS = {
  LOGIN:   { max: 8,   windowMs: 15 * 60_000 },  // 8 tentativas / 15 min
  SETUP:   { max: 3,   windowMs: 60 * 60_000 },  // 3 tentativas / 1 hora
  API:     { max: 300, windowMs: 60_000 },        // 300 req / min por IP
  MUTATION:{ max: 120, windowMs: 60_000 },        // 120 mutations / min
} as const;
