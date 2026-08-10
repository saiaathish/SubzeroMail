import { expect, test, type Page } from "@playwright/test";

async function waitForInbox(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("main", { name: "Subzero Mail inbox" }),
  ).toBeVisible();
  const firstThread = page.getByTestId("thread-thread-maya-contract");
  if (!(await firstThread.isVisible())) {
    await page.getByTestId("connect-gmail").click();
    await page.getByRole("button", { name: "Connect demo Gmail" }).click();
  }
  await expect(firstThread).toBeVisible();
  await expect(page.getByTestId("ask-inbox")).toBeVisible();
}

test.describe("@smoke P1.1 Ask Inbox demo acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test("answers with a source that opens the supporting Gmail thread, and shows no-evidence honestly", async ({
    page,
  }) => {
    await waitForInbox(page);
    const question = page.getByLabel("Ask Inbox question");

    await question.fill("What price did Alex finally agree to?");
    await page.getByTestId("ask-inbox-submit").click();
    const answer = page.getByTestId("ask-inbox-answer");
    await expect(answer).toContainText(
      "$4,800 works if onboarding is included.",
    );
    const source = page.getByRole("button", {
      name: "Source: msg-alex-3",
    });
    await expect(source).toBeVisible();
    await source.click();
    await expect(page.getByTestId("thread-thread-alex-pricing")).toHaveClass(
      /selected/,
    );
    await expect(page.getByTestId("message-msg-alex-3")).toBeVisible();

    await question.fill("Where is the precursor isotope?");
    await page.getByTestId("ask-inbox-submit").click();
    await expect(answer).toContainText(
      "Not enough evidence to answer this from the retrieved mail.",
    );
    await expect(page.getByRole("button", { name: /Source:/ })).toHaveCount(0);
  });
});
