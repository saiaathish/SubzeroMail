import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("loads the MV3 full-page client and useful popup", async () => {
  const extensionPath = join(
    process.cwd(),
    "apps/extension/.output/chrome-mv3",
  );
  const profile = await mkdtemp(join(tmpdir(), "subzero-extension-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      // MV3 service workers do not start in legacy headless Chromium. CI wraps
      // this test in xvfb; local macOS runs use a visible bundled browser.
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-sandbox",
      ],
    });

    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
    const extensionId = new URL(worker.url()).host;
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html`);
    await expect(app.getByText("LOCAL INBOX")).toBeVisible();
    await expect(
      app.getByRole("button", { name: "Needs Reply" }),
    ).toBeVisible();
    await expect(
      app.getByRole("textbox", { name: "Search demo inbox" }),
    ).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByText("WELCOME TO SUBZERO")).toBeVisible();
    await expect(
      popup.getByText("Make Gmail faster without replacing it."),
    ).toBeVisible();
    await popup.getByRole("radio", { name: /Both/ }).check();
    await popup.getByRole("button", { name: "Continue" }).click();
    await expect(popup.getByText("Gmail productivity client")).toBeVisible();
    await expect(
      popup.getByRole("button", { name: /Open Subzero/ }),
    ).toBeVisible();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
