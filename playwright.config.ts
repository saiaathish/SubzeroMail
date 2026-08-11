import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";

const projects: PlaywrightTestConfig["projects"] = [
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  // Extra engine coverage; P0's required Chrome/Firefox checks run above.
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

// Run with SUBZERO_INCLUDE_EDGE=true where Edge is installed (e.g. CI). The
// local test runner does not download a system browser or bypass OS privileges.
if (process.env.SUBZERO_INCLUDE_EDGE === "true") {
  projects.push({
    name: "edge",
    use: { ...devices["Desktop Chrome"], channel: "msedge" },
  });
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Run browser acceptance against the production artifact. The dev server
    // can emit a full HMR reload when an on-demand settings route first
    // compiles, which is especially disruptive to WebKit interactions.
    command:
      "npm run build --workspace=@subzero/web && mkdir -p apps/web/.next/standalone/apps/web/.next/static apps/web/.next/standalone/node_modules/sql.js/dist && cp -R apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/ && cp node_modules/sql.js/dist/sql-wasm.wasm apps/web/.next/standalone/node_modules/sql.js/dist/sql-wasm.wasm && PORT=3100 HOSTNAME=127.0.0.1 node apps/web/.next/standalone/apps/web/server.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUBZERO_DEMO_MODE: "true",
      SUBZERO_DEMO_MODE: "true",
      // Valid 32-byte base64 key: the demo server encrypts BYOK secrets.
      SUBZERO_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    },
  },
  projects,
});
