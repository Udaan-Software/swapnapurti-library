import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().default("postgresql://swapnapurti:swapnapurti_local@localhost:55432/swpanpurati?schema=public"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().default("swapnapurti_session"),
  SESSION_DAYS: z.coerce.number().int().positive().default(7),
  ADMIN_SETUP_EMAIL: z.string().email().optional(),
  ADMIN_SETUP_PASSWORD: z.string().min(12).optional()
});

export const env = schema.parse(process.env);
