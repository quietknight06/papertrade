const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const frontendRoot = path.resolve(__dirname, "..");
const backendEntry = path.resolve(frontendRoot, "../backend/index.js");
const viteEntry = path.resolve(frontendRoot, "node_modules/vite/bin/vite.js");
const children = [];

function start(label, entry, args = [], runtimeArgs = []) {
  const child = spawn(process.execPath, [...runtimeArgs, entry, ...args], {
    cwd: frontendRoot,
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !process.exitCode) {
      console.error(`${label} exited with code ${code}`);
      process.exitCode = code;
      shutdown();
    }
  });
  return child;
}

function waitForPort(port, attempts = 100) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (remaining <= 1) reject(new Error(`API did not open port ${port}`));
        else setTimeout(() => check(remaining - 1), 100);
      });
    };
    check(attempts);
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => { shutdown(); process.exit(); });
process.on("SIGTERM", () => { shutdown(); process.exit(); });
process.on("exit", shutdown);

start("API", backendEntry, [], ["--use-system-ca"]);
waitForPort(3002)
  .then(() => start("Vite", viteEntry, ["--host", "127.0.0.1"]))
  .catch((error) => {
    console.error(error.message);
    shutdown();
    process.exit(1);
  });
