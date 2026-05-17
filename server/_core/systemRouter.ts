import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { hashPassword, emailToOpenId } from "./localAuth";
import * as db from "../db";

export const systemRouter = router({
  health: publicProcedure
    .input(z.object({ timestamp: z.number().min(0, "timestamp cannot be negative") }))
    .query(() => ({ ok: true })),

  notifyOwner: adminProcedure
    .input(z.object({ title: z.string().min(1), content: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return { success: delivered } as const;
    }),

  // ── User Management ────────────────────────────────────────────────────────
  // Listar é permitido para qualquer usuário logado (precisa para "responsável" etc)
  getUsers: protectedProcedure.query(async () => db.getUsers()),

  // Criar usuário — somente admin
  createUser: adminProcedure
    .input(z.object({
      email: z.string().email("Email inválido"),
      name: z.string().min(2, "Nome muito curto"),
      password: z.string().min(8, "Senha precisa de 8+ caracteres"),
      role: z.enum(["admin", "user"]).default("user"),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.getUserByEmail(input.email.toLowerCase());
      if (existing) throw new Error("Já existe um usuário com este email.");
      const openId       = emailToOpenId(input.email);
      const passwordHash = await hashPassword(input.password);
      await db.upsertUser({
        openId,
        email: input.email.toLowerCase(),
        name: input.name.trim(),
        loginMethod: "local",
        role: input.role,
        lastSignedIn: new Date(),
      });
      const user = await db.getUserByOpenId(openId);
      if (user) await db.updateUserPassword(user.id, passwordHash);
      return { success: true, id: user?.id };
    }),

  // Excluir usuário — somente admin, com proteções
  deleteUser: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.id === input.id) {
        throw new Error("Você não pode excluir seu próprio usuário.");
      }
      // Não permite remover o último admin
      const target = (await db.getUsers()).find(u => u.id === input.id);
      if (target?.role === "admin") {
        const adminCount = await db.countAdmins();
        if (adminCount <= 1) throw new Error("Não é possível excluir o último administrador.");
      }
      await db.deleteUser(input.id);
      return { success: true };
    }),

  // Alterar senha de qualquer usuário — somente admin
  updateUserPassword: adminProcedure
    .input(z.object({ id: z.number(), password: z.string().min(8, "Senha precisa de 8+ caracteres") }))
    .mutation(async ({ input }) => {
      const hash = await hashPassword(input.password);
      await db.updateUserPassword(input.id, hash);
      return { success: true };
    }),

  // Alterar a própria senha — qualquer usuário logado
  changeOwnPassword: protectedProcedure
    .input(z.object({ password: z.string().min(8, "Senha precisa de 8+ caracteres") }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) throw new Error("Sessão inválida.");
      const hash = await hashPassword(input.password);
      await db.updateUserPassword(ctx.user.id, hash);
      return { success: true };
    }),

  // Alterar papel (admin/user) — somente admin, com proteção do último admin
  updateUserRole: adminProcedure
    .input(z.object({ id: z.number(), role: z.enum(["admin", "user"]) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.id === input.id && input.role === "user") {
        const adminCount = await db.countAdmins();
        if (adminCount <= 1) throw new Error("Você é o único administrador — não pode rebaixar a si mesmo.");
      }
      await db.updateUserRole(input.id, input.role);
      return { success: true };
    }),

  // Editar nome do usuário — somente admin
  updateUserProfile: adminProcedure
    .input(z.object({ id: z.number(), name: z.string().min(2, "Nome muito curto") }))
    .mutation(async ({ input }) => {
      await db.updateUserProfile(input.id, input.name.trim());
      return { success: true };
    }),
});
