import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import * as dbModule from "../db";
import { hashPassword, verifyPassword, emailToOpenId } from "./localAuth";
import { users as usersTable } from "../../drizzle/schema";
import { sql } from "drizzle-orm";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ── Auth local PRIMEIRO — antes de qualquer outro middleware ─────────────
  // Garante que as rotas de auth nunca caiam no catch-all do static files
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.post("/api/auth/login", async (req, res) => {
    console.log("[AUTH] POST /api/auth/login →", req.body?.email);
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) return res.status(400).json({ error: "Email e senha são obrigatórios." });
      const adminEmail    = process.env.ADMIN_EMAIL    ?? "admin@expag.com.br";
      const adminPassword = process.env.ADMIN_PASSWORD ?? "Expag2026!";
      let user = await dbModule.getUserByEmail(email.trim().toLowerCase());
      if (!user && email.trim().toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
        const openId       = emailToOpenId(email);
        const passwordHash = await hashPassword(password);
        await dbModule.upsertUser({ openId, email: email.trim().toLowerCase(), name: "Admin Expag", loginMethod: "local", role: "admin", lastSignedIn: new Date() });
        const created = await dbModule.getUserByOpenId(openId);
        if (created) await dbModule.updateUserPassword(created.id, passwordHash);
        user = await dbModule.getUserByEmail(email.trim().toLowerCase());
        console.log(`[AUTH] Admin criado: ${email}`);
      }
      if (!user || !user.passwordHash) {
        console.log("[AUTH] Credenciais inválidas para:", email);
        return res.status(401).json({ error: "Credenciais inválidas." });
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        console.log("[AUTH] Senha incorreta para:", email);
        return res.status(401).json({ error: "Credenciais inválidas." });
      }
      await dbModule.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      const token = await sdk.createSessionToken(user.openId, { name: user.name ?? email, expiresInMs: ONE_YEAR_MS });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      console.log("[AUTH] Login OK:", email);
      res.json({ ok: true, name: user.name, role: user.role });
    } catch (err) {
      console.error("[AUTH] Login error:", err);
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });

  app.post("/api/auth/setup", async (req, res) => {
    try {
      const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
      if (!email || !password) return res.status(400).json({ error: "Email e senha são obrigatórios." });
      if (password.length < 8) return res.status(400).json({ error: "Senha deve ter pelo menos 8 caracteres." });
      const existing = await dbModule.getUserByEmail(email.trim().toLowerCase());
      if (existing) return res.status(409).json({ error: "Usuário já existe." });
      const openId = emailToOpenId(email);
      const passwordHash = await hashPassword(password);
      await dbModule.upsertUser({ openId, email: email.trim().toLowerCase(), name: name?.trim() || email.split("@")[0], loginMethod: "local", role: "admin", lastSignedIn: new Date() });
      const user = await dbModule.getUserByOpenId(openId);
      if (user) await dbModule.updateUserPassword(user.id, passwordHash);
      res.json({ ok: true, message: "Usuário admin criado com sucesso!" });
    } catch (err) {
      console.error("[Auth Setup] Error:", err);
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });

  app.get("/api/auth/has-users", async (_req, res) => {
    try {
      const db = await dbModule.getDb();
      if (!db) return res.json({ hasUsers: false });
      const result = await db.select({ count: sql<number>`COUNT(*)` }).from(usersTable);
      res.json({ hasUsers: (result[0]?.count ?? 0) > 0 });
    } catch {
      res.json({ hasUsers: false });
    }
  });

  // Dev local bypass
  if (process.env.NODE_ENV === "development" && process.env.VITE_APP_ID === "local-dev") {
    app.get("/api/dev-login", async (req, res) => {
      try {
        await dbModule.upsertUser({ openId: "local-dev", name: "Dev Local", email: "dev@local.dev", loginMethod: "local", lastSignedIn: new Date() });
        const token = await sdk.createSessionToken("local-dev", { name: "Dev Local", expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.redirect(302, "/");
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
    console.log("🔓 Dev login ativo em GET /api/dev-login");
  }
  // ─────────────────────────────────────────────────────────────────────────
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");

  // Em produção (Railway), usar a porta diretamente sem scan
  const port = process.env.NODE_ENV === "production"
    ? preferredPort
    : await findAvailablePort(preferredPort);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
