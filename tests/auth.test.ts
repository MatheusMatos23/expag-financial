import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, emailToOpenId } from "../server/_core/localAuth";

describe("hashPassword + verifyPassword", () => {
  it("gera hash no formato esperado", async () => {
    const hash = await hashPassword("senhaSegura123");
    expect(hash).toMatch(/^pbkdf2\$[a-f0-9]+\$[a-f0-9]+$/);
  });

  it("verifica senha correta", async () => {
    const hash = await hashPassword("minhaSenha2026");
    const ok = await verifyPassword("minhaSenha2026", hash);
    expect(ok).toBe(true);
  });

  it("rejeita senha incorreta", async () => {
    const hash = await hashPassword("senhaCerta");
    const ok = await verifyPassword("senhaErrada", hash);
    expect(ok).toBe(false);
  });

  it("hashes diferentes para a mesma senha (salt único)", async () => {
    const h1 = await hashPassword("igual");
    const h2 = await hashPassword("igual");
    expect(h1).not.toBe(h2);
  });

  it("ambos os hashes da mesma senha verificam corretamente", async () => {
    const h1 = await hashPassword("teste");
    const h2 = await hashPassword("teste");
    expect(await verifyPassword("teste", h1)).toBe(true);
    expect(await verifyPassword("teste", h2)).toBe(true);
  });

  it("rejeita hash em formato inválido", async () => {
    expect(await verifyPassword("qualquer", "formato-invalido")).toBe(false);
    expect(await verifyPassword("qualquer", "")).toBe(false);
    expect(await verifyPassword("qualquer", "md5$abc$def")).toBe(false);
  });

  it("é sensível a maiúsculas/minúsculas", async () => {
    const hash = await hashPassword("CaseSensitive");
    expect(await verifyPassword("casesensitive", hash)).toBe(false);
  });

  it("lida com caracteres especiais", async () => {
    const senha = "P@ssw0rd!#$%áéíõ";
    const hash = await hashPassword(senha);
    expect(await verifyPassword(senha, hash)).toBe(true);
  });
});

describe("emailToOpenId", () => {
  it("gera openId consistente para o mesmo email", () => {
    const a = emailToOpenId("user@expag.com.br");
    const b = emailToOpenId("user@expag.com.br");
    expect(a).toBe(b);
  });

  it("emails diferentes geram openIds diferentes", () => {
    const a = emailToOpenId("user1@expag.com.br");
    const b = emailToOpenId("user2@expag.com.br");
    expect(a).not.toBe(b);
  });

  it("é case-insensitive no email", () => {
    const a = emailToOpenId("User@Expag.com.br");
    const b = emailToOpenId("user@expag.com.br");
    expect(a).toBe(b);
  });
});
