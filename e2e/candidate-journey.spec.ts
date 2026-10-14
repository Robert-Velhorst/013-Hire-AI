import { expect, test } from "@playwright/test";

test("authenticated candidate journey stays local, functional, and billing-safe", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const badResponses: string[] = [];
  const externalRequests: string[] = [];
  const baseUrl = new URL(test.info().project.use.baseURL as string);

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseUrl.origin) externalRequests.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await expect(page).toHaveURL(/\/api\/oauth\/login$/);
  await page.getByRole("button", { name: "Continue to Hire.AI" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  await page.getByRole("button", { name: /review jobs/i }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByRole("heading", { name: /job search/i })).toBeVisible();
  await page.getByPlaceholder(/search/i).first().fill("Hire.AI E2E Remote Product Engineer");
  await expect(page.getByText("Hire.AI E2E Remote Product Engineer", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review Queue", exact: true }).click();
  await expect(page).toHaveURL(/\/review-queue$/);
  await expect(page.getByRole("heading", { level: 1, name: /review queue/i })).toBeVisible();
  await expect(page.getByTestId("review-queue-section-job-decisions")).toBeVisible();

  await page.getByRole("button", { name: /applications/i }).click();
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByRole("heading", { name: /applications/i }).first()).toBeVisible();
  await expect(page.getByTestId("application-card").first()).toBeVisible();

  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: /^settings$/i }).click();
  await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  await expect(page.getByText(/privacy.*security/i)).toBeVisible();
  await expect(page.getByText(/export.*data/i)).toBeVisible();

  await page.getByRole("button", { name: /open account menu/i }).click();
  await page.getByRole("menuitem", { name: /billing/i }).click();
  await expect(page.getByTestId("billing-compliance-control")).toBeVisible();
  await expect(page.getByRole("heading", { name: /payment history/i })).toBeVisible();
  expect(await page.getByTestId("retry-success-fee-checkout").count()).toBe(0);

  expect(externalRequests, "The flow must not contact providers, payment services, or other external hosts.").toEqual([]);
  expect(requestFailures, "The browser flow must not contain failed network requests.").toEqual([]);
  expect(badResponses, "The browser flow must not return HTTP errors.").toEqual([]);
  expect(consoleErrors, "The browser flow must not emit console errors.").toEqual([]);
  expect(pageErrors, "The browser flow must not throw uncaught page errors.").toEqual([]);
});
