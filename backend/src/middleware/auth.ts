import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

export const hashToken = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!token) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Please sign in." } });
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { admin: true } });
  if (!session || session.expiresAt <= new Date() || !session.admin.active) {
    res.clearCookie(env.SESSION_COOKIE_NAME);
    return res.status(401).json({ success: false, error: { code: "SESSION_EXPIRED", message: "Your session has expired." } });
  }
  req.auth = { admin: session.admin, session };
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.endsWith("/login") || req.path.endsWith("/setup")) return next();
  if (!req.auth || req.get("x-csrf-token") !== req.auth.session.csrfToken) {
    return res.status(403).json({ success: false, error: { code: "CSRF_INVALID", message: "Security token is missing or invalid. Refresh and try again." } });
  }
  next();
}
