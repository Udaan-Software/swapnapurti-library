import { existsSync, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
const source = process.argv[2];
if (!source || !existsSync(source)) { console.error("Usage: npm run restore -- <backup.dump>"); process.exit(2); }
if (process.env.CONFIRM_RESTORE !== "swpanpurati") { console.error("Restore replaces current records. Set CONFIRM_RESTORE=swpanpurati after taking a current backup."); process.exit(2); }
const child = spawn("docker", ["exec", "-i", "swapnapurti-library-database-1", "pg_restore", "-U", "swapnapurti", "-d", "swpanpurati", "--clean", "--if-exists"], { stdio: ["pipe", "inherit", "inherit"] });
createReadStream(source).pipe(child.stdin); child.on("exit", code => process.exit(code ?? 1));
