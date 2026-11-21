import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { asyncHandler, AppError, ok } from "../../utils/http.js";
import { hashToken, randomToken, requireAuth } from "../../middleware/auth.js";
import { audit } from "../../services/audit.js";

export const authRouter = Router();
const credentials = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(12) });
const cookieOptions = { httpOnly: true, secure: env.FRONTEND_URL.startsWith("https://"), sameSite: "lax" as const, path: "/", maxAge: env.SESSION_DAYS * 86400000 };

authRouter.get("/status", asyncHandler(async (_req, res) => ok(res, { setupRequired: await prisma.admin.count() === 0 })));
authRouter.post("/setup", rateLimit({ windowMs: 15 * 60_000, limit: 5 }), asyncHandler(async (req, res) => {
  if (await prisma.admin.count()) throw new AppError(409, "Administrator setup is already complete.");
  const body = credentials.extend({ name: z.string().min(2).max(80) }).parse(req.body);
  const admin = await prisma.admin.create({ data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12) } });
  await prisma.auditLog.create({ data: { adminId: admin.id, action: "ADMIN_SETUP", entityType: "Admin", entityId: admin.id } });
  ok(res.status(201), { message: "Administrator created. Please sign in." });
}));
authRouter.post("/login", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), asyncHandler(async (req, res) => {
  const body = credentials.parse(req.body);
  const admin = await prisma.admin.findUnique({ where: { email: body.email } });
  if (!admin || !admin.active || !(await bcrypt.compare(body.password, admin.passwordHash))) throw new AppError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
  const token = randomToken(); const csrfToken = randomToken();
  await prisma.$transaction([
    prisma.session.create({ data: { adminId: admin.id, tokenHash: hashToken(token), csrfToken, expiresAt: new Date(Date.now() + env.SESSION_DAYS * 86400000), ipAddress: req.ip, userAgent: req.get("user-agent") } }),
    prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
  ]);
  res.cookie(env.SESSION_COOKIE_NAME, token, cookieOptions);
  res.cookie("csrf-token", csrfToken, { ...cookieOptions, httpOnly: false });
  ok(res, { admin: { id: admin.id, name: admin.name, email: admin.email }, csrfToken });
}));
authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => ok(res, { admin: { id: req.auth!.admin.id, name: req.auth!.admin.name, email: req.auth!.admin.email }, csrfToken: req.auth!.session.csrfToken })));
authRouter.post("/logout", requireAuth, asyncHandler(async (req, res) => {
  await prisma.session.delete({ where: { id: req.auth!.session.id } });
  res.clearCookie(env.SESSION_COOKIE_NAME); res.clearCookie("csrf-token"); ok(res, { message: "Signed out." });
}));
authRouter.post("/change-password", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(12) }).parse(req.body);
  if (!(await bcrypt.compare(body.currentPassword, req.auth!.admin.passwordHash))) throw new AppError(400, "Current password is incorrect.");
  await prisma.$transaction([prisma.admin.update({ where: { id: req.auth!.admin.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } }), prisma.session.deleteMany({ where: { adminId: req.auth!.admin.id, id: { not: req.auth!.session.id } } })]);
  await audit(req, "PASSWORD_CHANGED", "Admin", req.auth!.admin.id); ok(res, { message: "Password updated." });
}));
