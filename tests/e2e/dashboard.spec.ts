import { test, expect, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { smoke } from "../../scripts/smoke";
async function login(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("Admin password")
    .fill(process.env.BYGA_LOCAL_PASSWORD || "byga-local-fixture-only");
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "From repository to reality." }),
  ).toBeVisible();
}
test.describe
  .serial("local fixtures through Workers, data scanner and real browser validation", () => {
  test("HTML interactive preview, screenshots, cache hit and manual rebuild", async ({
    page,
  }) => {
    await login(page);
    await page
      .getByLabel("Repository URL")
      .fill("https://github.com/fixture/html");
    await page.getByRole("button", { name: "Analyze repository" }).click();
    await expect(page.getByText("Source resolved")).toBeVisible();
    await page.getByRole("button", { name: "Build & Preview" }).click();
    await expect(
      page.getByRole("heading", { name: "Browser validation" }),
    ).toBeVisible();
    await expect(page.locator(".evidence .badge")).toHaveText("ready");
    const frame = page.frameLocator(
      'iframe[title="Untrusted repository preview"]',
    );
    await frame.getByRole("button", { name: "Clicked 0 times" }).click();
    await expect(
      frame.getByRole("button", { name: "Clicked 1 times" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/dashboard-desktop.png",
      fullPage: true,
    });
    const before = await page.locator("tbody tr").count();
    await page.getByRole("button", { name: "Build & Preview" }).click();
    await expect(
      page.getByText("Reused cached SHA + build configuration."),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(before);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "mobile viewport" }).click();
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "Hello, possibility." }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/dashboard-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "Rebuild html", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(before); // Same pinned SHA reuses static cache.
  });
  for (const [repo, app] of [
    ["vite", "."],
    ["monorepo", "apps/web"],
  ] as const)
    test(`${repo} actual Vite output and selected application`, async ({
      page,
    }) => {
      await login(page);
      await page
        .getByLabel("Repository URL")
        .fill(`https://github.com/fixture/${repo}`);
      await page.getByRole("button", { name: "Analyze repository" }).click();
      await page.getByLabel("Application", { exact: true }).selectOption(app);
      await page.getByRole("button", { name: "Build & Preview" }).click();
      await expect(
        page.getByRole("heading", { name: "Browser validation" }),
      ).toBeVisible();
      await expect(page.locator(".evidence .badge")).toHaveText("ready");
      const frame = page.frameLocator("iframe");
      await expect(
        frame.getByRole("heading", {
          name:
            repo === "vite"
              ? "Built for the browser."
              : "One workspace. Many possibilities.",
        }),
      ).toBeVisible();
      const response = await page.request.get("/api/builds");
      const payload = await response.json();
      const selected = payload.data.find(
        (b: { analysis: { repo: string }; config: { root: string } }) =>
          b.analysis.repo === repo,
      );
      expect(selected.config.root).toBe(app);
      const previewResponse = await page.request.get("/api/previews");
      const previews = await previewResponse.json();
      const preview = previews.data.find(
        (p: { buildId: string }) => p.buildId === selected.id,
      );
      const spa = await page.request.get(preview.url + "nested/route");
      expect(spa.status()).toBe(200);
      await page
        .getByRole("button", { name: `Delete ${repo}`, exact: true })
        .click();
      await expect
        .poll(async () => (await page.request.get(preview.url)).status())
        .toBe(410);
    });
  test("failed source build presents diagnostics instead of Ready", async ({
    page,
  }) => {
    await login(page);
    await page
      .getByLabel("Repository URL")
      .fill("https://github.com/fixture/broken");
    await page.getByRole("button", { name: "Analyze repository" }).click();
    await page.getByRole("button", { name: "Build & Preview" }).click();
    await expect(
      page.locator("tbody tr").filter({ hasText: "broken" }).locator(".badge"),
    ).toHaveText("failed");
    await page.getByRole("button", { name: /Build logs/ }).click();
    await expect(page.locator(".logs")).toContainText(
      "Workflow build-untrusted: failure",
    );
  });
});

test("browser evidence distinguishes partial assets and a blank page", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/missing.js") {
      response.writeHead(404);
      response.end("missing");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      request.url === "/blank"
        ? "<!doctype html><html><title>Blank</title><body></body></html>"
        : '<!doctype html><html><title>Partial</title><h1>Visible but incomplete</h1><script src="/missing.js"></script></html>',
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(8790, "127.0.0.1", resolve),
  );
  try {
    const partial = await smoke(
      "http://127.0.0.1:8790/partial",
      "test-results/qa-partial",
    );
    expect(partial.status).toBe("partial");
    expect(partial.errors.join(" ")).toContain("404");
    const blank = await smoke(
      "http://127.0.0.1:8790/blank",
      "test-results/qa-blank",
    );
    expect(blank.status).toBe("failed");
    expect(blank.errors.join(" ")).toContain("blank screen");
  } finally {
    server.close();
  }
});
