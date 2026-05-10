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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // ── Auth local (email + senha) ────────────────────────────────────────────
  {
    const { hashPassword, verifyPassword, emailToOpenId } = await import("./localAuth");
    const { COOKIE_NAME, ONE_YEAR_MS } = await import("@shared/const");
    const { getSessionCookieOptions } = await import("./cookies");
    const { sdk } = await import("./sdk");
    const dbModule = await import("../db");

    // POST /api/auth/login — verifica email + senha, cria sessão
    app.post("/api/auth/login", async (req, res) => {
      try {
        const { email, password } = req.body as { email?: string; password?: string };
        if (!email || !password) {
          return res.status(400).json({ error: "Email e senha são obrigatórios." });
        }

        const user = await dbModule.getUserByEmail(email.trim().toLowerCase());

        // Usuário não existe ou sem senha configurada
        if (!user || !user.passwordHash) {
          return res.status(401).json({ error: "Credenciais inválidas." });
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: "Credenciais inválidas." });
        }

        // Atualiza lastSignedIn
        await dbModule.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

        const token = await sdk.createSessionToken(user.openId, {
          name: user.name ?? email,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.json({ ok: true, name: user.name, role: user.role });
      } catch (err) {
        console.error("[Auth Login] Error:", err);
        res.status(500).json({ error: "Erro interno no servidor." });
      }
    });

    // POST /api/auth/setup — cria o primeiro usuário admin (só funciona se não houver nenhum)
    app.post("/api/auth/setup", async (req, res) => {
      try {
        const { email, password, name } = req.body as {
          email?: string; password?: string; name?: string;
        };
        if (!email || !password) {
          return res.status(400).json({ error: "Email e senha são obrigatórios." });
        }
        if (password.length < 8) {
          return res.status(400).json({ error: "Senha deve ter pelo menos 8 caracteres." });
        }

        const existing = await dbModule.getUserByEmail(email.trim().toLowerCase());
        if (existing) {
          return res.status(409).json({ error: "Usuário já existe." });
        }

        const openId       = emailToOpenId(email);
        const passwordHash = await hashPassword(password);

        await dbModule.upsertUser({
          openId,
          email:        email.trim().toLowerCase(),
          name:         name?.trim() || email.split("@")[0],
          loginMethod:  "local",
          role:         "admin",
          lastSignedIn: new Date(),
        });
        await dbModule.updateUserPassword(
          (await dbModule.getUserByOpenId(openId))!.id,
          passwordHash
        );

        res.json({ ok: true, message: "Usuário admin criado com sucesso!" });
      } catch (err) {
        console.error("[Auth Setup] Error:", err);
        res.status(500).json({ error: "Erro interno no servidor." });
      }
    });

    // GET /api/auth/has-users — verifica se já existe algum usuário cadastrado
    app.get("/api/auth/has-users", async (_req, res) => {
      try {
        const db = await dbModule.getDb();
        if (!db) return res.json({ hasUsers: false });
        const { users: usersTable } = await import("../../drizzle/schema");
        const { sql } = await import("drizzle-orm");
        const result = await db.select({ count: sql<number>`COUNT(*)` }).from(usersTable);
        res.json({ hasUsers: (result[0]?.count ?? 0) > 0 });
      } catch {
        res.json({ hasUsers: false });
      }
    });

    // Dev local bypass (mantido para desenvolvimento)
    if (process.env.NODE_ENV === "development" && process.env.VITE_APP_ID === "local-dev") {
      app.get("/api/dev-login", async (req, res) => {
        try {
          await dbModule.upsertUser({
            openId: "local-dev", name: "Dev Local",
            email: "dev@local.dev", loginMethod: "local", lastSignedIn: new Date(),
          });
          const token = await sdk.createSessionToken("local-dev", {
            name: "Dev Local", expiresInMs: ONE_YEAR_MS,
          });
          const cookieOptions = getSessionCookieOptions(req);
          res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
          res.redirect(302, "/");
        } catch (err) {
          res.status(500).json({ error: String(err) });
        }
      });
      console.log("🔓 Dev login ativo em GET /api/dev-login");
    }
  }
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
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
