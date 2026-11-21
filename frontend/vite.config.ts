import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({mode}) => { const modePort=/^api(\d+)$/.exec(mode)?.[1];const apiPort=Number(modePort||process.env.VITE_API_PORT||5000);const webPort=Number(process.env.VITE_PORT||5173);console.log(`Swapnapurti proxy target: http://localhost:${apiPort}`);return { plugins: [react(), tailwindcss()], server: { port:webPort,strictPort:true,proxy: { "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true }, "/health": { target: `http://localhost:${apiPort}` } } }, test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" } } });
