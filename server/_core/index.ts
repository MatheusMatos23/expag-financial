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

  // ── Body parsers ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Funções de auth ───────────────────────────────────────────────────────
  async function handleLogin(req: any, res: any) {
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
  }

  // ── HTTP server com interceptação auth antes do Express ───────────────────
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0];

    // Intercepta /api/auth/login no nível HTTP puro
    if (req.method === "POST" && url === "/api/auth/login") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          (req as any).body = body ? JSON.parse(body) : {};
        } catch {
          (req as any).body = {};
        }
        await handleLogin(req, res).catch((err) => {
          console.error("[AUTH] Unhandled:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Erro interno." }));
          }
        });
      });
      return;
    }

    // /api/auth/has-users
    if (req.method === "GET" && url === "/api/auth/has-users") {
      dbModule.getDb().then(async (db) => {
        try {
          if (!db) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ hasUsers: false })); return; }
          const result = await db.select({ count: sql<number>`COUNT(*)` }).from(usersTable);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ hasUsers: (result[0]?.count ?? 0) > 0 }));
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ hasUsers: false }));
        }
      });
      return;
    }

    // /api/auth/setup
    if (req.method === "POST" && url === "/api/auth/setup") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const { email, password, name } = data;
          if (!email || !password) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Email e senha são obrigatórios." })); return; }
          if (password.length < 8) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Senha deve ter pelo menos 8 caracteres." })); return; }
          const existing = await dbModule.getUserByEmail(email.trim().toLowerCase());
          if (existing) { res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Usuário já existe." })); return; }
          const openId = emailToOpenId(email);
          const passwordHash = await hashPassword(password);
          await dbModule.upsertUser({ openId, email: email.trim().toLowerCase(), name: name?.trim() || email.split("@")[0], loginMethod: "local", role: "admin", lastSignedIn: new Date() });
          const user = await dbModule.getUserByOpenId(openId);
          if (user) await dbModule.updateUserPassword(user.id, passwordHash);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "Usuário admin criado com sucesso!" }));
        } catch (err) {
          console.error("[AUTH] Setup error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Erro interno." }));
        }
      });
      return;
    }

    // Tudo mais → Express
    app(req as any, res as any);
  });

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = process.env.NODE_ENV === "production"
    ? preferredPort
    : await findAvailablePort(preferredPort);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
