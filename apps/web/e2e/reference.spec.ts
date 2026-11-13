/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// WP 6.17: the generated operation reference pages under /ops/ (UI.md section 8.2), served by the
// production-header server like every other page.
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, openApp, cards, expectOutput, input, opSearch } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const catalogue = JSON.parse(
  readFileSync(new URL("../../../packages/ops/dist/catalogue.json", import.meta.url), "utf8"),
) as { ops: { qname: string; vocab: string; name: string }[] };
const OPS = catalogue.ops.length;
const PAGE = "/ops/pbkdf2/derive/";

async function audit(page: Page, label: string): Promise<void> {
  let violations: { id: string; nodes: { target: unknown[] }[] }[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().map((a) => a.finished));
    });
    violations = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations;
    if (violations.length === 0 || violations.some((v) => v.id !== "color-contrast")) break;
    await page.waitForTimeout(300);
  }
  const summary = violations.map(
    (v) => `${label}: ${v.id} x${v.nodes.length}: ${v.nodes[0]?.target.join(" >> ")}`,
  );
  expect(summary, `axe violations\n${summary.join("\n")}`).toEqual([]);
}

test("a reference page renders its content", async ({ page }) => {
  const response = await page.goto(PAGE);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("pbkdf2:derive operation | Forge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("pbkdf2:derive");
  await expect(page.getByRole("heading", { level: 2, name: "Use this when" })).toBeVisible();
  await expect(page.locator(".use-when")).toContainText("You have a password and a salt");
  for (const name of ["Description", "Signature", "Parameters", "Examples", "Further reading"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.locator("dl.params dt")).toHaveCount(4);
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
  await expect(page.getByText("RFC 6070 section 2, PBKDF2 HMAC-SHA1 test vector 1")).toBeVisible();
  await expect(page.getByText("0c60c80f961f0e71f3a9b524af6012062fe037a6").first()).toBeVisible();
  // landmarks and the shared navigation
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Site" }).getByRole("link")).toHaveText([
    "Operations",
    "About",
    "Privacy",
    "Terms",
    "Security",
    "Accessibility",
  ]);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://forge.darkcollective.com/ops/pbkdf2/derive/",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /^You have a password and a salt/,
  );
  // see also and external links
  await expect(page.getByRole("link", { name: "hmac:digest" })).toHaveAttribute(
    "href",
    "/ops/hmac/digest/",
  );
  const ext = page.getByRole("link", { name: /RFC 8018, section 5.2/ });
  await expect(ext).toHaveAttribute("href", "https://www.rfc-editor.org/rfc/rfc8018#section-5.2");
  await expect(ext).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("main")).toContainText("external site: www.rfc-editor.org");
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).not.toMatch(/^"?Times/);
  // trailing-slash-less URL is rewritten like CloudFront
  expect((await page.goto(PAGE.slice(0, -1)))?.status()).toBe(200);
});

test("an op with an inverse links to its page", async ({ page }) => {
  await page.goto("/ops/base64/decode/");
  const inverse = page.locator("#inverse").locator("xpath=following-sibling::p[1]");
  await expect(inverse.getByRole("link", { name: "base64:encode" })).toHaveAttribute(
    "href",
    "/ops/base64/encode/",
  );
  await inverse.getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("base64:encode");
});

test("no script runs except the theme module, and nothing needs JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1400, height: 900 },
  });
  const bare = await context.newPage();
  await bare.goto(PAGE);
  await expect(bare.getByRole("heading", { level: 1 })).toHaveText("pbkdf2:derive");
  await expect(bare.locator(".example")).toHaveCount(3);
  await context.close();

  const scripts: string[] = [];
  const violations: string[] = [];
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
  });
  await p.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`securitypolicyviolation: ${e.violatedDirective}`),
    );
  });
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") violations.push(m.text());
  });
  await p.goto(PAGE);
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts)
    expect(s, "only the theme module").toMatch(/^\/assets\/theme-[\w-]+\.js$/);
  expect(await p.locator("script:not([src])").count()).toBe(0);
  expect(await p.locator("script[src]").count()).toBeLessThanOrEqual(2);
  expect(await p.locator("[style]").count()).toBe(0);
  expect(violations).toEqual([]);
  await ctx.close();
});

for (const theme of ["light", "dark", "contrast"] as const) {
  test(`a reference page and the index are axe clean in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("forge.theme", t), theme);
    for (const path of [PAGE, "/ops/", "/ops/base64/decode/"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await audit(page, `${path} ${theme}`);
    }
  });
}

test("a reference page is readable and axe clean at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of [PAGE, "/ops/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    await audit(page, `${path} 320`);
  }
});

test("the index lists every operation, grouped by category, and its links resolve", async ({
  page,
  request,
}) => {
  await page.goto("/ops/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Operations");
  await expect(page.locator("ul.op-list > li")).toHaveCount(OPS);
  expect(OPS).toBe(458);
  const sections = await page.locator("main section h2").allTextContents();
  expect(sections.length).toBeGreaterThan(10);
  expect([...sections].sort()).toEqual(sections);
  // the jump list reaches every section
  const jumps = await page
    .getByRole("navigation", { name: "Categories" })
    .getByRole("link")
    .evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  expect(jumps.length).toBe(sections.length);
  const first = page.getByRole("navigation", { name: "Categories" }).getByRole("link").first();
  await first.click();
  await expect(page).toHaveURL(/#[a-z0-9-]+$/);
  // every op link answers 200 with its own heading
  const hrefs = await page
    .locator("ul.op-list a")
    .evaluateAll((a) => a.map((x) => x.getAttribute("href") as string));
  expect(new Set(hrefs).size).toBe(OPS);
  const bad: string[] = [];
  for (let i = 0; i < hrefs.length; i += 25) {
    await Promise.all(
      hrefs.slice(i, i + 25).map(async (href) => {
        const r = await request.get(href);
        const text = await r.text();
        const qname = href.split("/").filter(Boolean).slice(1).join(":");
        if (r.status() !== 200 || !text.includes(`<h1><code>${qname}</code></h1>`)) bad.push(href);
      }),
    );
  }
  expect(bad).toEqual([]);
});

/** Every .html under dist/ops plus the static pages. */
function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? htmlFiles(full) : name.endsWith(".html") ? [full] : [];
  });
}

test("the generated tree has no broken internal link", () => {
  const files = htmlFiles(join(dist, "ops"));
  expect(files.length).toBe(OPS + 1);
  const broken: string[] = [];
  for (const file of [
    ...files,
    ...["about", "privacy", "terms", "security", "accessibility"].map((n) =>
      join(dist, n, "index.html"),
    ),
  ]) {
    const html = readFileSync(file, "utf8");
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/<a [^>]*?href="([^"]*)"/g)) {
      const href = (m[1] as string).replace(/&amp;/g, "&");
      if (/^(https?:|mailto:)/.test(href) || href.startsWith("/#")) continue;
      if (href.startsWith("#")) {
        if (!ids.has(href.slice(1))) broken.push(`${file} ${href}`);
        continue;
      }
      const [path, hash] = href.split("#") as [string, string | undefined];
      const target = join(dist, path as string, path?.endsWith("/") ? "index.html" : "");
      if (!existsSync(target) || !statSync(target).isFile()) {
        broken.push(`${file} -> ${href}`);
      } else if (
        hash !== undefined &&
        target.endsWith(".html") &&
        !readFileSync(target, "utf8").includes(` id="${hash}"`)
      ) {
        broken.push(`${file} -> ${href} (no anchor)`);
      }
    }
  }
  expect(broken).toEqual([]);
  expect(existsSync(join(dist, "pages"))).toBe(false);
});

test("Open in Forge loads the example and shows the expected output", async ({ page }) => {
  await page.goto(PAGE);
  const link = page.getByRole("link", { name: /^Open in Forge \(pbkdf2:derive: One iteration/ });
  await link.click();
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator("forge-recipe [role=alert]")).toHaveCount(0);
  await expect(input(page)).toHaveValue("password");
  // the output pane shows the bytes; the expected key is 0c60c8...
  const out = page.locator("forge-output");
  await expect(out.locator(".pill.stale")).toHaveCount(0);
  await expect(out).toContainText(/0c\s*60\s*c8\s*0f/i);
  await expect(out).toContainText(/2f\s*e0\s*37\s*a6/i);
});

test("Open in Forge on a text result shows exactly the expected text", async ({ page }) => {
  await page.goto("/ops/base64/decode/");
  await page
    .getByRole("link", { name: /^Open in Forge \(base64:decode: Decode plain text/ })
    .click();
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(input(page)).toHaveValue("Zm9vYmFy");
  await expectOutput(page, "foobar");
});

test("Open in Forge on a CR LF example bakes the same bytes as Try it (WP 6.18)", async ({
  page,
}) => {
  await page.goto("/ops/csv/to-json/");
  await page
    .getByRole("link", {
      name: /^Open in Forge \(csv:to-json: Rows read as objects keyed by the header/,
    })
    .click();
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  // The link carries the bytes exactly, so the result is the example's expected one. It carries no line
  // ending setting (see build.test.ts); the app infers it from the bytes when the link is opened.
  await expect(page.locator("forge-input").getByLabel("Line ending")).toHaveValue("crlf");
  await expectOutput(
    page,
    JSON.stringify(
      [
        { name: "Ada", age: "36" },
        { name: "Alan", age: "41" },
      ],
      null,
      2,
    ),
  );
});

test("the sitemap lists the pages and keeps the existing entries", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const p of [
    "/",
    "/about/",
    "/privacy/",
    "/terms/",
    "/security/",
    "/accessibility/",
    "/ops/",
  ]) {
    expect(xml).toContain(`<loc>https://forge.darkcollective.com${p}</loc>`);
  }
  for (const op of catalogue.ops) {
    expect(xml).toContain(
      `<loc>https://forge.darkcollective.com/ops/${op.vocab}/${op.name}/</loc>`,
    );
  }
  expect((xml.match(/<loc>/g) ?? []).length).toBe(OPS + 7);
});

test("the site navigation and the More menu reach the index", async ({ page }) => {
  await page.goto("/about/");
  await page
    .getByRole("navigation", { name: "Site" })
    .getByRole("link", { name: "Operations" })
    .click();
  await expect(page).toHaveURL(/\/ops\/$/);
  await openApp(page);
  await page
    .getByRole("button", { name: /^More|Site|Menu/ })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: "Operations" })).toHaveAttribute("href", "/ops/");
});

test("the help dialog has a Reference page link that opens in a new tab", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Alt+1");
  await opSearch(page).fill("pbkdf2:derive");
  await page.keyboard.press("Enter");
  await page.keyboard.press("?");
  const link = page.locator("forge-op-help dialog").getByRole("link", { name: /Reference page/ });
  await expect(link).toHaveAttribute("href", PAGE);
  await expect(link).toHaveAttribute("target", "_blank");
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await expect(popup.getByRole("heading", { level: 1 })).toHaveText("pbkdf2:derive");
  await popup.close();
  // the user's work is still here
  await expect(page.locator("forge-op-help dialog")).toBeVisible();
});
