import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ValidationReport } from "../packages/shared/src/index";

export async function smoke(
  url: string,
  output: string,
): Promise<ValidationReport> {
  const origin = new URL(url).origin,
    errors: string[] = [];
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  let blank = false;
  await mkdir(output, { recursive: true });
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height },
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      let count = 0;
      await context.route("**/*", (route) => {
        const target = new URL(route.request().url());
        count++;
        if (
          count > 120 ||
          target.origin !== origin ||
          !["GET", "HEAD"].includes(route.request().method())
        )
          return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        errors.push(`${name}: JS ${error.message}`.slice(0, 500)),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          errors.push(`${name}: console ${message.text()}`.slice(0, 500));
      });
      page.on("requestfailed", (request) =>
        errors.push(
          `${name}: request ${new URL(request.url()).pathname}`.slice(0, 500),
        ),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(
            `${name}: HTTP ${response.status()} ${new URL(response.url()).pathname}`.slice(
              0,
              500,
            ),
          );
      });
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        if (!response?.ok()) {
          errors.push(`${name}: document unavailable`);
          blank = true;
        }
        await page.waitForTimeout(800);
        const visible = await page.evaluate(() => {
          const body = document.body;
          if (!body) return false;
          const style = getComputedStyle(body);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          )
            return false;
          return (
            body.innerText.trim().length > 3 ||
            [...body.querySelectorAll("img,canvas,svg,video")].some((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 8 && r.height > 8;
            })
          );
        });
        if (!visible) {
          blank = true;
          errors.push(`${name}: blank screen`);
        }
        const missingImages = await page.evaluate(
          () =>
            [...document.images].filter(
              (i) => !i.complete || i.naturalWidth === 0,
            ).length,
        );
        if (missingImages)
          errors.push(`${name}: ${missingImages} broken images`);
        // No clicks on untrusted payment/login/mutation controls. Smoke navigation is GET-only.
        const link = await page.locator("a[href]").evaluateAll(
          (elements, base) =>
            elements
              .map((e) => (e as HTMLAnchorElement).href)
              .find((href) => {
                const u = new URL(href);
                return (
                  u.origin === new URL(base).origin &&
                  u.pathname.startsWith(new URL(base).pathname) &&
                  !/login|logout|delete|pay|purchase|checkout/i.test(
                    u.pathname,
                  ) &&
                  href !== base
                );
              }),
          url,
        );
        if (link) {
          const nav = await page.goto(link, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
          if (!nav?.ok()) errors.push(`${name}: navigation failed`);
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
        }
      } catch (e) {
        blank = true;
        errors.push(
          `${name}: ${e instanceof Error ? e.message.slice(0, 450) : "navigation failed"}`,
        );
      }
      await page.screenshot({
        path: resolve(output, `${name}.png`),
        fullPage: false,
        timeout: 10000,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const report: ValidationReport = {
    status: blank ? "failed" : errors.length ? "partial" : "ready",
    errors: [...new Set(errors)].slice(0, 100),
    desktop: "desktop.png",
    mobile: "mobile.png",
    checkedAt: Date.now(),
  };
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}
if (process.argv[1]?.endsWith("smoke.ts")) {
  const url = process.env.PREVIEW_URL;
  if (!url || !url.startsWith("https://"))
    throw new Error("HTTPS preview URL required");
  const report = await smoke(
    url,
    process.env.REPORT_DIR || "artifacts/validation",
  );
  console.log(`Browser result: ${report.status}`);
}
