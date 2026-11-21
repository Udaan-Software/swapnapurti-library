import { spawn } from "node:child_process";
import process from "node:process";

const [service, apiPort, webPort] = process.argv.slice(2);
if (!service || !apiPort || !webPort) throw new Error("Usage: run-dev-service <api|web|desktop> <apiPort> <webPort>");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const folders = { api: "backend", web: "frontend", desktop: "desktop" };
const folder = folders[service];
if (!folder) throw new Error(`Unknown development service: ${service}`);

const env = {
  ...process.env,
  PORT: apiPort,
  VITE_API_PORT: apiPort,
  VITE_PORT: webPort,
  FRONTEND_URL: `http://localhost:${webPort}`,
};
delete env.ELECTRON_RUN_AS_NODE;
const args = ["--prefix", folder, "run", "dev"];
if (service === "web") args.push("--", "--port", webPort, "--strictPort", "--mode", `api${apiPort}`);
const child = spawn(npm, args, { stdio: "inherit", env, shell: process.platform === "win32", windowsHide: true });
child.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
