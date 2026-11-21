import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../config/prisma.js";

export async function audit(req: Request, action: string, entityType: string, entityId?: string, changes?: unknown, reason?: string) {
  const safeChanges = changes === undefined ? undefined : JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue;
  await prisma.auditLog.create({ data: { adminId: req.auth?.admin.id, action, entityType, entityId, changes: safeChanges, reason, ipAddress: req.ip } });
}
