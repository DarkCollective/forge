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
import { test, expect } from "./fixtures";

const PAGES = [
  ["/about/", /About/i],
  ["/privacy/", /Privacy/i],
  ["/terms/", /Terms/i],
  ["/security/", /Security/i],
  ["/accessibility/", /Accessibility/i],
] as const;

for (const [path, heading] of PAGES) {
  test(`${path} is served and renders`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    await expect(page.getByRole("main")).toBeVisible();
    // The page is styled (the stylesheet loaded and applied): the body has a non-default font.
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).not.toMatch(/^"?Times/);
  });

  test(`${path} without the trailing slash is rewritten like CloudFront`, async ({ page }) => {
    const response = await page.goto(path.replace(/\/$/, ""));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
  });
}

test.describe("not found", () => {
  // Chromium logs "Failed to load resource" for the 404 document itself; nothing else is allowed.
  test.use({
    ignoredProblems: [/Failed to load resource: the server responded with a status of 404/],
  });

  test("an unknown path returns 404 with the styled 404 page", async ({ page }) => {
    const response = await page.goto("/does/not/exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Forge|Open Forge|home/i }).first()).toBeVisible();
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).not.toMatch(/^"?Times/);
  });
});

for (const [path, type] of [
  ["/robots.txt", "text/plain"],
  ["/sitemap.xml", "xml"],
  ["/.well-known/security.txt", "text/plain"],
  ["/favicon.svg", "image/svg+xml"],
] as const) {
  test(`${path} is served as ${type}`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
    expect((await response.text()).length).toBeGreaterThan(10);
  });
}

test("responses carry the production security headers", async ({ request }) => {
  const h = (await request.get("/")).headers();
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(h["content-security-policy"]).toContain("default-src 'none'");
});
