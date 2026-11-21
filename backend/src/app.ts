import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import path from "node:path";
import { env } from "./config/env.js";
import { errorHandler } from "./utils/http.js";
import { requireAuth, requireCsrf } from "./middleware/auth.js";
import { authRouter } from "./modules/auth/routes.js";
import { membersRouter } from "./modules/members/routes.js";
import { plansRouter, subscriptionsRouter } from "./modules/memberships/routes.js";
import { roomsRouter, shiftsRouter, allocationsRouter, attendanceRouter } from "./modules/study/routes.js";
import { booksRouter, loansRouter, reservationsRouter } from "./modules/books/routes.js";
import { paymentsRouter, expensesRouter, finesRouter } from "./modules/finance/routes.js";
import { dashboardRouter, settingsRouter, notificationsRouter, auditRouter } from "./modules/system/routes.js";

export const app = express();
app.set("trust proxy", 1); app.use(helmet()); app.use(cors({ origin: env.FRONTEND_URL.split(","), credentials: true })); app.use(express.json({ limit: "2mb" })); app.use(cookieParser()); if (env.NODE_ENV !== "test") app.use(pinoHttp()); app.use(rateLimit({ windowMs: 60_000, limit: 300 }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "swapnapurti-api" }));
app.use("/api/v1/auth", authRouter);
app.use("/api/v1", requireAuth, requireCsrf);
app.use("/api/v1/dashboard", dashboardRouter); app.use("/api/v1/members", membersRouter); app.use("/api/v1/membership-plans", plansRouter); app.use("/api/v1/subscriptions", subscriptionsRouter); app.use("/api/v1/study-rooms", roomsRouter); app.use("/api/v1/shifts", shiftsRouter); app.use("/api/v1/seat-allocations", allocationsRouter); app.use("/api/v1/attendance", attendanceRouter); app.use("/api/v1/books", booksRouter); app.use("/api/v1/loans", loansRouter); app.use("/api/v1/reservations", reservationsRouter); app.use("/api/v1/payments", paymentsRouter); app.use("/api/v1/expenses", expensesRouter); app.use("/api/v1/fines", finesRouter); app.use("/api/v1/notifications", notificationsRouter); app.use("/api/v1/settings", settingsRouter); app.use("/api/v1/audit-logs", auditRouter);
if (env.NODE_ENV === "production") {
  const staticRoot = process.env.FRONTEND_DIST ? path.resolve(process.env.FRONTEND_DIST) : path.resolve(process.cwd(), "../frontend/dist");
  app.use(express.static(staticRoot));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(staticRoot, "index.html")));
}
app.use((_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found." } })); app.use(errorHandler);
