import { defineConfig, devices } from "@playwright/test";

const mobileUrl = process.env.MOBILE_WEB_URL ?? "http://localhost:8081";
const apiUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: mobileUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Pixel 5"],
  },
  webServer: [
    {
      command: `NODE_ENV=test API_BASE_URL=${apiUrl} npm run dev:server`,
      url: `${apiUrl}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `EXPO_PUBLIC_API_BASE_URL=${apiUrl} npm run web --workspace apps/mobile -- --port 8081`,
      url: mobileUrl,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
