import { cpSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.resolve(workspace, "desktop");
// Package from a staging directory that is never used by a running desktop
// process. Windows locks Prisma's native engine while the API is running.
const target = path.resolve(desktopRoot, "runtime", "package-backend");
if (!target.startsWith(desktopRoot + path.sep)) throw new Error("Unsafe desktop staging path");
mkdirSync(target, { recursive: true });
copyFileSync(path.join(desktopRoot, "runtime-package.json"), path.join(target, "package.json"));
rmSync(path.join(target, "dist"), { recursive: true, force: true });
rmSync(path.join(target, "prisma"), { recursive: true, force: true });
cpSync(path.resolve(workspace, "backend", "dist"), path.join(target, "dist"), { recursive: true });
cpSync(path.resolve(workspace, "backend", "prisma"), path.join(target, "prisma"), { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (!existsSync(path.join(target, "node_modules", "express"))) {
  const install = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: target, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const prismaCommand = path.join(target, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const generate = spawnSync(prismaCommand, ["generate", "--schema", path.join(target, "prisma", "schema.prisma")], { cwd: target, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://swapnapurti:swapnapurti_local@localhost:55432/swpanpurati?schema=public" } });
if (generate.status !== 0) process.exit(generate.status ?? 1);
const archive = new AdmZip();
archive.addLocalFolder(target);
archive.writeZip(path.resolve(desktopRoot, "runtime", "backend-runtime.zip"));
