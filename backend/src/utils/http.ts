import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") { super(message); }
}

export const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(422).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Please correct the highlighted fields.", details: error.flatten() } });
  if (error instanceof AppError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
  const err = error as { code?: string; message?: string };
  if (err.code === "P2002") return res.status(409).json({ success: false, error: { code: "DUPLICATE_RECORD", message: "A record with these details already exists." } });
  console.error(error);
  return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

export function pageParams(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export const ok = (res: Response, data: unknown, meta?: unknown) => res.json({ success: true, data, ...(meta ? { meta } : {}) });
