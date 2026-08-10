import { expect, test, type Page } from "@playwright/test";

const detectedText =
  "Reply to Maya Chen about Contract review before Thursday.";

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

test.describe("P1.2 Open Loops acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test("detects a source-backed loop without duplicates, then edits and resolves it", async ({
    page,
  }, testInfo) => {
    await connectDemoInbox(page);
    await page.getByTestId("open-loops-nav").click();
    await expect(page.getByTestId("open-loops-panel")).toBeVisible();

    const sourceButton = page.getByRole("button", {
      name: `Open source for ${detectedText}`,
      exact: true,
    });
    await page.getByRole("button", { name: "Detect open loops" }).click();
    await expect(sourceButton).toHaveCount(1);

    // Reprocessing preserves one persisted loop rather than adding a duplicate.
    await page.getByRole("button", { name: "Detect open loops" }).click();
    await expect(sourceButton).toHaveCount(1);

    await sourceButton.click();
    await expect(page.getByTestId("open-loops-panel")).toHaveCount(0);
    await expect(page.getByTestId("thread-thread-maya-contract")).toHaveClass(
      /selected/,
    );
    await expect(page.getByTestId("message-msg-maya-2")).toBeVisible();

    await page.getByTestId("open-loops-nav").click();
    await expect(sourceButton).toHaveCount(1);
    await page.getByRole("button", { name: `Edit ${detectedText}` }).click();

    const updatedText = `${detectedText} Verified in ${testInfo.project.name} ${Date.now()}`;
    await page.getByLabel("Open Loop description").fill(updatedText);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(updatedText, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Resolve ${updatedText}` }).click();
    await expect(page.getByRole("region", { name: "Resolved" })).toContainText(
      updatedText,
    );
  });
});
