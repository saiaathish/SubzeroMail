import { expect, test } from "@playwright/test";

async function connectDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  const maya = page.getByTestId("thread-thread-maya-contract");
  if (!(await maya.isVisible())) {
    await page.getByTestId("connect-gmail").click();
    await page.getByRole("button", { name: "Connect demo Gmail" }).click();
  }
  await expect(maya).toBeVisible();
}

test.describe("P1.4 Custom Focus rules acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("subzero-e2e-reset") !== "1") {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.sessionStorage.setItem("subzero-e2e-reset", "1");
      }
    });
  });

  test("creates an inspectable rule and applies it before default Focus signals", async ({
    page,
  }) => {
    await connectDemo(page);
    await page.evaluate(async () => {
      const response = await fetch("/api/settings/focus-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ rules: [] }),
      });
      if (!response.ok) throw new Error("Could not reset demo Focus rules.");
    });
    await page.getByRole("button", { name: "BYOK settings" }).click();
    await page.getByRole("link", { name: "Custom Focus rules" }).click();
    await expect(page.getByTestId("focus-rules-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add rule" })).toBeEnabled();

    await page.getByLabel("Bucket").selectOption("other");
    await page.getByLabel("Match field").selectOption("from");
    const pattern = page.getByPlaceholder("@school.edu or newsletters");
    await pattern.fill("alex@northstar.io");
    await expect(pattern).toHaveValue("alex@northstar.io");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(
      page.getByText(/Sender contains “alex@northstar.io”/),
    ).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("thread-thread-alex-pricing")).toBeVisible();
    await page.getByTestId("thread-thread-alex-pricing").click();
    await expect(page.getByLabel("Manual Focus classification")).toHaveValue(
      "other",
    );
    await expect(
      page.getByText("Custom rule: from contains “alex@northstar.io”", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
