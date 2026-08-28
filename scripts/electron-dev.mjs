// Modo escritorio en desarrollo: levanta el dev server de Vite mediante su API
// y lanza Electron apuntando a la URL resuelta (sin sondear puertos).
import { spawn } from "node:child_process";
import electronPath from "electron";
import { createServer } from "vite";

const server = await createServer({ mode: "development" });
await server.listen();
server.printUrls();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  await server.close();
  throw new Error("Vite no expuso ninguna URL local");
}

// ELECTRON_RUN_AS_NODE hace que el binario arranque como Node y no como app;
// algunos entornos (terminales de editores/agentes) lo dejan puesto
const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], { stdio: "inherit", env });

const shutdown = async (code) => {
  await server.close().catch(() => {});
  process.exit(code ?? 0);
};

child.on("close", (code) => shutdown(code));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
