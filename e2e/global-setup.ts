import { execFileSync } from "node:child_process";

export default async function globalSetup() {
  if (process.env.PLAYWRIGHT_SEED === "0") return;
  execFileSync("npm", ["run", "seed", "--workspace", "server"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
}
