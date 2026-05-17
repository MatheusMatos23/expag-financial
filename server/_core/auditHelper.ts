import type { TrpcContext } from "./context";
import * as db from "../db";

/**
 * Extrai o IP do request, considerando proxies (Railway usa x-forwarded-for).
 */
function extractIp(req: TrpcContext["req"]): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0];
  return req.socket?.remoteAddress ?? null;
}

/**
 * Registra uma ação de auditoria a partir do contexto tRPC.
 * Falha silenciosa — nunca interrompe a operação principal.
 */
export async function audit(
  ctx: TrpcContext,
  params: {
    action: string;
    category: string;
    summary: string;
    entityType?: string;
    entityId?: string | number;
    metadata?: Record<string, any>;
  },
): Promise<void> {
  await db.logAudit({
    userId:     ctx.user?.id ?? null,
    userName:   ctx.user?.name ?? null,
    userEmail:  ctx.user?.email ?? null,
    action:     params.action,
    category:   params.category,
    entityType: params.entityType ?? null,
    entityId:   params.entityId ?? null,
    summary:    params.summary,
    metadata:   params.metadata ?? null,
    ipAddress:  extractIp(ctx.req),
  });
}
