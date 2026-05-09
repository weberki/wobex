import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let shuttingDown = false;
let exitCode = 0;
let forceKillTimer = null;

function forceKillTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  child.kill("SIGKILL");
}

function requestChildStop(child) {
  if (!child.pid || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    forceKillTree(child);
    return;
  }

  child.kill("SIGTERM");
}

function finishIfDone() {
  if (!shuttingDown || children.size > 0) {
    return;
  }

  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }

  process.exit(exitCode);
}

function shutdown(code) {
  if (code !== undefined) {
    exitCode = code;
  }

  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    requestChildStop(child);
  }

  forceKillTimer = setTimeout(() => {
    for (const child of children) {
      forceKillTree(child);
    }
    process.exit(exitCode);
  }, 1_500);
  forceKillTimer.unref();

  finishIfDone();
}

function runScript(scriptName) {
  const child = spawn(process.execPath, ["run", scriptName], {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
  });

  children.add(child);

  child.once("error", (error) => {
    console.error(`[desktop-dev] Failed to start ${scriptName}:`, error);
    children.delete(child);
    shutdown(1);
  });

  child.once("exit", (code, signal) => {
    children.delete(child);

    if (!shuttingDown) {
      shutdown(code === 0 && signal === null ? 0 : (code ?? 1));
      return;
    }

    finishIfDone();
  });
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));
process.once("SIGHUP", () => shutdown(129));

runScript("dev:bundle");
runScript("dev:electron");
