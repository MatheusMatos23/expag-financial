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

  // ── User Management ──────────────────────────────────────────────────────
  getUsers: protectedProcedure.query(async () => db.getUsers()),

  createUser: protectedProcedure
    .input(z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8) }))
    .mutation(async ({ input }) => {
      const existing = await db.getUserByEmail(input.email.toLowerCase());
      if (existing) throw new Error("Usuário com este email já existe.");
      const openId       = emailToOpenId(input.email);
      const passwordHash = await hashPassword(input.password);
      await db.upsertUser({ openId, email: input.email.toLowerCase(), name: input.name, loginMethod: "local", role: "user", lastSignedIn: new Date() });
      const user = await db.getUserByOpenId(openId);
      if (user) await db.updateUserPassword(user.id, passwordHash);
      return { success: true };
    }),

  deleteUser: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.id === input.id) throw new Error("Você não pode excluir seu próprio usuário.");
      await db.deleteUser(input.id);
      return { success: true };
    }),

  updateUserPassword: protectedProcedure
    .input(z.object({ id: z.number(), password: z.string().min(8) }))
    .mutation(async ({ input }) => {
      const hash = await hashPassword(input.password);
      await db.updateUserPassword(input.id, hash);
      return { success: true };
    }),
});
