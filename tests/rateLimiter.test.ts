import { describe, it, expect } from "vitest";
import { checkRateLimit, resetRateLimit } from "../server/_core/rateLimiter";

describe("checkRateLimit", () => {
  it("permite a primeira requisição", () => {
    const r = checkRateLimit("test-key-1", 5, 60_000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
  });

  it("conta requisições corretamente", () => {
    const key = "test-key-2";
    checkRateLimit(key, 3, 60_000); // 1
    checkRateLimit(key, 3, 60_000); // 2
    const r = checkRateLimit(key, 3, 60_000); // 3
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("bloqueia após exceder o limite", () => {
    const key = "test-key-3";
    checkRateLimit(key, 2, 60_000); // 1
    checkRateLimit(key, 2, 60_000); // 2
    const r = checkRateLimit(key, 2, 60_000); // 3 — deve bloquear
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("continua bloqueando após o limite", () => {
    const key = "test-key-4";
    for (let i = 0; i < 5; i++) checkRateLimit(key, 3, 60_000);
    const r = checkRateLimit(key, 3, 60_000);
    expect(r.allowed).toBe(false);
  });

  it("chaves diferentes têm contadores independentes", () => {
    checkRateLimit("key-a", 2, 60_000);
    checkRateLimit("key-a", 2, 60_000);
    const blocked = checkRateLimit("key-a", 2, 60_000);
    const fresh = checkRateLimit("key-b", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(fresh.allowed).toBe(true);
  });

  it("resetRateLimit libera a chave", () => {
    const key = "test-key-5";
    checkRateLimit(key, 1, 60_000);
    const blocked = checkRateLimit(key, 1, 60_000);
    expect(blocked.allowed).toBe(false);
    resetRateLimit(key);
    const afterReset = checkRateLimit(key, 1, 60_000);
    expect(afterReset.allowed).toBe(true);
  });

  it("janela expirada reinicia o contador", async () => {
    const key = "test-key-6";
    checkRateLimit(key, 1, 50); // janela de 50ms
    const blocked = checkRateLimit(key, 1, 50);
    expect(blocked.allowed).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    const afterWindow = checkRateLimit(key, 1, 50);
    expect(afterWindow.allowed).toBe(true);
  });

  it("resetInSec é positivo", () => {
    const r = checkRateLimit("test-key-7", 5, 60_000);
    expect(r.resetInSec).toBeGreaterThan(0);
  });
});
