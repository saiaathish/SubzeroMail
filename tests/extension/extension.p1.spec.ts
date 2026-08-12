import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seedConnectedMailbox } from "./extension-fixtures";

async function openExtension(): Promise<{
  context: BrowserContext;
  app: Page;
  profile: string;
}> {
  const extensionPath = join(
    process.cwd(),
    "apps/extension/.output/chrome-mv3",
  );
  const profile = await mkdtemp(join(tmpdir(), "subzero-extension-p1-"));
  const context = await chromium.launchPersistentContext(profile, {
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
  await seedConnectedMailbox(app);
  await app.reload();
  await expect(app.getByText("GMAIL INBOX")).toBeVisible();
  return { context, app, profile };
}

test("extension P1 surfaces stay local, grounded, and actionable", async () => {
  const { context, app, profile } = await openExtension();
  const consoleErrors: string[] = [];
  app.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await app.getByRole("button", { name: /Maya Chen/ }).click();
    await app.getByRole("button", { name: "Generate summary" }).click();
    await expect(
      app
        .locator('section[aria-label="Thread summary"]')
        .getByText(/Could you send/),
    ).toBeVisible();

    await app.getByRole("button", { name: "Reply R" }).click();
    await app
      .getByRole("textbox", { name: "Reply intent" })
      .fill("Confirm Thursday works and ask for the final clause.");
    await app.getByRole("button", { name: "Generate" }).click();
    await expect(
      app.getByRole("textbox", { name: "Message body" }),
    ).toHaveValue(/Thanks for your message/);

    await app.getByRole("button", { name: "Ask Inbox" }).click();
    await app
      .getByRole("textbox", { name: "Ask Inbox question" })
      .fill("What price did Alex agree to?");
    await app.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(app.getByText(/Based on the matching thread/)).toBeVisible();
    await expect(app.getByText("SOURCE MESSAGES")).toBeVisible();

    await app.getByRole("button", { name: "Open Loops" }).click();
    await app.getByRole("button", { name: "Detect from inbox" }).click();
    await expect(
      app.getByText(/Open Loops refreshed|No grounded open commitments/),
    ).toBeVisible();
    await expect(app.getByText("I owe").first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("sign out clears the connected account state while preserving theme", async () => {
  const { context, app, profile } = await openExtension();
  try {
    await seedConnectedMailbox(app, "light");
    await app.reload();
    await expect(
      app.getByRole("button", { name: /Gmail connected/ }),
    ).toBeVisible();
    await app.getByRole("button", { name: /Gmail connected/ }).click();
    await app
      .getByRole("menuitem", { name: "Sign out and clear cache" })
      .click();
    await expect(
      app.getByText("Signed out. Local Gmail cache cleared."),
    ).toBeVisible();
    await expect(
      app.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    await expect(app.getByText("Demo fixture")).toHaveCount(0);
    await expect(
      app.getByText("Your inbox starts with a connection."),
    ).toHaveCount(1);
    await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
