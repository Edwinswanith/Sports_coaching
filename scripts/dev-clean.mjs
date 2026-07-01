// Pre-dev cleanup: guarantee a single, clean web dev server.
//
// Why: `next dev` silently spills to :3001 when :3000 is busy, so a second
// `npm run dev` quietly starts a SECOND web server. Two servers writing the
// same apps/web/.next corrupt it (EPERM on .next\trace) and the dev server
// then 404s the page AND its own JS/CSS chunks. This script runs as the root
// `predev` hook so every `npm run dev` frees the dev ports and wipes the stale
// cache first, then starts exactly one server on :3000.
//
// Scope: only kills processes LISTENING on the three known dev ports — never a
// broad node.exe sweep — so the API, MCP servers, and editor stay untouched.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = [3000, 3001, 4000];
const isWindows = process.platform === "win32";

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of out.split(/\r?\n/)) {
        // e.g.  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    24956
        if (!/LISTENING/.test(line)) continue;
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const pid of out.split(/\s+/).map((s) => s.trim()).filter(Boolean)) pids.add(pid);
    }
  } catch {
    // netstat/lsof unavailable or nothing bound — treat as no pids.
  }
  return pids;
}

function killPid(pid) {
  try {
    if (isWindows) execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
    else execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    if (killPid(pid)) console.log(`[dev-clean] freed :${port} (killed PID ${pid})`);
  }
}

try {
  rmSync(join(ROOT, "apps", "web", ".next"), { recursive: true, force: true });
  console.log("[dev-clean] removed apps/web/.next");
} catch (err) {
  console.warn(`[dev-clean] could not remove apps/web/.next: ${err.message}`);
}
