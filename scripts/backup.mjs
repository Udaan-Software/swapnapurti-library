import { createWriteStream, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
const directory = path.resolve("backups"); mkdirSync(directory, { recursive: true });
const target = path.join(directory, `swpanpurati_${stamp}.dump`);
const child = spawn("docker", ["exec", "swapnapurti-library-database-1", "pg_dump", "-U", "swapnapurti", "-d", "swpanpurati", "--format=custom"], { stdio: ["ignore", "pipe", "inherit"] });
child.stdout.pipe(createWriteStream(target));
child.on("exit", code => { if (code) process.exit(code); console.log(`Backup created: ${target}`); });
