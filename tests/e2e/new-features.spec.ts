import { expect, test, type Page } from "@playwright/test";

// Demo-mode acceptance for the newest release slices. Every interaction runs
// against the local demo fixture (apps/web/data) on the isolated demo server;
// no real Gmail account, OAuth token, or external send is ever touched.

const PAST_DUE_DATE = "2020-01-15";

async function connectDemoInbox(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("main", { name: "Subzero Mail inbox" }),
  ).toBeVisible();
  const mayaThread = page.getByTestId("thread-thread-maya-contract");
  if (!(await mayaThread.isVisible())) {
    await page.getByTestId("connect-gmail").click();
    await page.getByRole("button", { name: "Connect demo Gmail" }).click();
  }
  await expect(mayaThread).toBeVisible();
}

test.describe("New features demo acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test("manual open loop with a past due date surfaces as an overdue Reminder with an Open thread action", async ({
    page,
  }) => {
    await connectDemoInbox(page);

    // Pin the maya thread so the manual form's submit button is enabled.
    await page.getByTestId("thread-thread-maya-contract").click();
    await expect(page.getByTestId("thread-thread-maya-contract")).toHaveClass(
      /selected/,
    );

    await page.getByTestId("open-loops-nav").click();
    await expect(page.getByTestId("open-loops-panel")).toBeVisible();

    const loopText = `E2E manual overdue loop ${Date.now()}`;
    await page.getByLabel("Manual Open Loop", { exact: true }).fill(loopText);
    await page
      .getByLabel("Manual Open Loop due date", { exact: true })
      .fill(PAST_DUE_DATE);
    await page.getByRole("button", { name: "Add open loop" }).click();

    // Explicitly refresh the panel, then the Reminders section must list the
    // loop as overdue with an Open thread action.
    await page.getByRole("button", { name: "Refresh Open Loops" }).click();
    const reminders = page.getByRole("region", { name: "Reminders" });
    const reminderRow = reminders.locator("article", { hasText: loopText });
    await expect(reminderRow).toContainText("Overdue — Due 2020-01-15");
    const openThread = reminderRow.getByRole("button", {
      name: "Open thread",
    });
    await expect(openThread).toBeVisible();

    // The reminder action routes back to the source thread.
    await openThread.click();
    await expect(page.getByTestId("open-loops-panel")).toHaveCount(0);
    await expect(page.getByTestId("thread-thread-maya-contract")).toHaveClass(
      /selected/,
    );
  });

  test("command palette opens with Cmd/Ctrl+K and the keyboard guide is reachable", async ({
    page,
  }) => {
    await connectDemoInbox(page);

    await page.keyboard.press("Meta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByRole("button", { name: "Close command palette" }).click();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);

    await page.keyboard.press("Control+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);

    await page.getByRole("button", { name: "Keyboard guide" }).click();
    const guide = page.getByRole("dialog", { name: "Keyboard-first loop" });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("⌘ / Ctrl K");
    await expect(guide).toContainText("Command palette");
  });
});
