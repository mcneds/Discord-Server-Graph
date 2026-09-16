import { expect, test } from "@playwright/test";

test("smoke: import, navigate views, inspect edge shared users", async ({ page }) => {
  const samplePath = process.env.MUTUAL_SAMPLE_JSON;
  test.skip(!samplePath, "Set MUTUAL_SAMPLE_JSON to run smoke test with a real export file.");

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(samplePath!);

  await expect(page.getByText("Deriving graph in worker...")).toBeVisible();
  await expect(page.getByText("Server Graph")).toBeVisible({ timeout: 120000 });

  await page.getByRole("button", { name: "Server Table" }).click();
  await expect(page.getByText("Server Connectivity Table")).toBeVisible();

  const firstRow = page.locator("tbody tr").first();
  await firstRow.click();
  await expect(page.getByText("Server Insights")).toBeVisible();

  await page.evaluate(() => {
    const debug = (window as Window & { __mutualGraphDebug?: { selectFirstEdge: () => void } }).__mutualGraphDebug;
    debug?.selectFirstEdge();
  });

  await expect(page.getByText("Pair Inspector")).toBeVisible();
  await expect(page.getByText("Shared users")).toBeVisible();
});
