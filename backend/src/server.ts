import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { startReminderJobs } from "./services/reminders.js";

const server = app.listen(env.PORT, () => console.log(`Swapnapurti API listening on http://localhost:${env.PORT}`));
// Run in-app reminder maintenance while the local API is active.
const stopReminderJobs = startReminderJobs();
async function shutdown() { stopReminderJobs(); server.close(); await prisma.$disconnect(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
