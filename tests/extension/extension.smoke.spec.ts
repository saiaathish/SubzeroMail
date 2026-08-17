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
    // A fresh install must stop at the Gmail connection gate. This deliberately
    // observes the real control without starting OAuth.
    await expect(
      app.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    await expect(
      app.getByText("Your inbox starts with a connection."),
    ).toHaveCount(1);
    await expect(app.getByText("Demo fixture")).toHaveCount(0);
    await expect(app.getByText(/Maya Chen/)).toHaveCount(0);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByText("WELCOME TO SUBZERO")).toBeVisible();
    await expect(
      popup.getByText("Make Gmail faster without replacing it."),
    ).toBeVisible();
    await popup.getByRole("radio", { name: /Both/ }).check();
    // Onboarding exposes the actual Google connection control. Do not click
    // it here: this test must remain OAuth-free and network-independent.
    await expect(
      popup.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    await expect(popup.getByText("Demo fixture")).toHaveCount(0);

    await popup.setViewportSize({ width: 137, height: 604 });
    await popup.reload();
    await expect(
      popup.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    const narrowLayout = await popup.evaluate(() => {
      const root = document.documentElement;
      const cta = document.querySelector<HTMLElement>(".sz-popup__primary");
      const rect = cta?.getBoundingClientRect();
      return {
        overflowX: root.scrollWidth > root.clientWidth,
        ctaRight: rect?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(narrowLayout.overflowX).toBe(false);
    expect(narrowLayout.ctaRight).toBeLessThanOrEqual(137);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
