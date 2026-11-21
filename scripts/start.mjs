import { spawnSync } from "node:child_process";
import net from "node:net";
import process from "node:process";
import concurrently from "concurrently";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const mode = process.argv.includes("--web") ? "web" : "desktop";
process.env.DATABASE_URL ||= "postgresql://swapnapurti:swapnapurti_local@localhost:55432/swpanpurati?schema=public";
delete process.env.ELECTRON_RUN_AS_NODE;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 750);
      });
    };
    attempt();
  });
}

async function portIsAvailable(port) {
  const inUse = await new Promise(resolve => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(300);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
  if (inUse) return false;
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function availablePort(preferred) {
  for (let port = preferred; port < preferred + 20; port += 1) if (await portIsAvailable(port)) return port;
  throw new Error(`No free local port was found near ${preferred}.`);
}

console.log("\n  Swapnapurti Library — starting local services\n");
run(docker, ["compose", "up", "-d", "database"]);
await waitForPort(55432);
const apiPort = await availablePort(Number(process.env.PORT || 5000));
const webPort = await availablePort(Number(process.env.VITE_PORT || 5173));
process.env.PORT = String(apiPort);
process.env.VITE_API_PORT = String(apiPort);
process.env.VITE_PORT = String(webPort);
process.env.FRONTEND_URL = `http://localhost:${webPort}`;
console.log(`  API: http://localhost:${apiPort}${apiPort === 5000 ? "" : " (5000 was occupied)"}`);
console.log(`  Web: http://localhost:${webPort}${webPort === 5173 ? "" : " (5173 was occupied)"}\n`);
run(npm, ["run", "db:deploy", "--workspace", "backend"], { shell: true });
run(npm, ["run", "db:seed", "--workspace", "backend"], { shell: true });

const commands = [
  { name: "API", color: "blue", service: "api" },
  { name: "WEB", color: "magenta", service: "web" }
];
if (mode === "desktop") commands.push({ name: "DESKTOP", color: "cyan", service: "desktop" });

const { result } = concurrently(commands.map(item => ({ command: `node scripts/run-dev-service.mjs ${item.service} ${apiPort} ${webPort}`, name: item.name, prefixColor: item.color })), { killOthersOn: ["failure"], prefix: "name" });
try { await result; } catch { process.exitCode = 1; }
