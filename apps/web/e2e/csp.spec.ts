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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openApp } from "./fixtures";

// The CSP golden test (UI-TOOLKIT.md section 7.5, TOOLKIT.md T48). It reads the policy that is deployed, the
// `csp` local of infra/site.tf, and compares it, directive by directive, to the list below. A change to the
// header fails this test until the test and UI.md section 4 change together, so an edit is always deliberate.
// The list is today's policy. When the media pack lands (T6) it gains `media-src blob:` in the same pull
// request as the site.tf edit.
const EXPECTED: readonly (readonly [string, string])[] = [
  ["default-src", "'none'"],
  ["script-src", "'self' 'wasm-unsafe-eval'"],
  ["worker-src", "'self'"],
  ["style-src", "'self'"],
  ["img-src", "'self' data: blob:"],
  ["font-src", "'self'"],
  ["connect-src", "'self'"],
  ["manifest-src", "'self'"],
  ["base-uri", "'none'"],
  ["form-action", "'none'"],
  ["frame-ancestors", "'none'"],
];

const EXPECTED_STRING = EXPECTED.map(([name, value]) => `${name} ${value}`).join("; ");

/** The `csp = "..."` local of infra/site.tf (apps/web is the working directory of the e2e run). */
function deployedCsp(): string {
  const text = readFileSync(join(process.cwd(), "..", "..", "infra", "site.tf"), "utf8");
  const match = /^\s*csp\s*=\s*"([^"\n]+)"/m.exec(text);
  if (match === null) throw new Error('no csp = "..." local found in infra/site.tf');
  return match[1] as string;
}

function directives(csp: string): [string, string][] {
  return csp.split(";").map((d) => {
    const part = d.trim();
    const space = part.indexOf(" ");
    return space < 0 ? [part, ""] : [part.slice(0, space), part.slice(space + 1).trim()];
  });
}

test.describe("the CSP golden test", () => {
  test("infra/site.tf holds exactly today's policy, directive by directive", () => {
    const actual = directives(deployedCsp());
    // One by one, so that a failure names the directive.
    for (const [i, [name, value]] of EXPECTED.entries()) {
      expect(actual[i], `directive ${i + 1}`).toEqual([name, value]);
    }
    expect(actual).toHaveLength(EXPECTED.length);
    expect(deployedCsp()).toBe(EXPECTED_STRING);
  });

  test("it has no unsafe-eval, no unsafe-inline, no wildcard and no remote host", () => {
    const csp = deployedCsp();
    expect(csp.replace("wasm-unsafe-eval", "")).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("*");
    expect(csp).not.toMatch(/https?:/);
    expect(csp).not.toContain("media-src"); // until T6 (Q15)
  });

  test("the page is served with that policy", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toBe(EXPECTED_STRING);
    // A chunk gets the same header: a worker's own policy comes from the response of its script.
    const chunk = await page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .map((e) => new URL(e.name).pathname)
          .find((p) => /^\/assets\/.+\.js$/.test(p)) ?? "",
    );
    expect(chunk).not.toBe("");
    const asset = await page.request.get(chunk);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-security-policy"]).toBe(EXPECTED_STRING);
  });
});

test.describe("what the policy allows and refuses", () => {
  // Some tests below provoke a refusal on purpose (that is the point of a positive control); the shared fixture
  // would report the violation event and the console line the browser writes for it.
  test.use({
    ignoredProblems: [
      /securitypolicyviolation: (script|style)-src|Content Security Policy|Refused to/,
    ],
  });

  test("eval is refused: a string timer does not run (the positive control)", async ({ page }) => {
    await openApp(page);
    // page.evaluate itself is exempt from the policy, so the string is compiled by the page: a string timer
    // is evaluated like eval and new Function, and is refused by the same missing 'unsafe-eval'.
    const result = await page.evaluate(async () => {
      const seen: string[] = [];
      document.addEventListener("securitypolicyviolation", (e) => seen.push(e.violatedDirective));
      (window as unknown as { __ran?: boolean }).__ran = false;
      setTimeout("window.__ran = true", 0);
      await new Promise((r) => setTimeout(r, 100));
      return { ran: (window as unknown as { __ran: boolean }).__ran, seen };
    });
    expect(result.ran).toBe(false);
    expect(result.seen).toContain("script-src");
  });

  test("a viewer's route works: an adopted stylesheet in a shadow root raises no violation", async ({
    page,
  }) => {
    await openApp(page);
    const colour = await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(".t { color: rgb(1, 2, 3); }");
      root.adoptedStyleSheets = [sheet];
      const p = document.createElement("p");
      p.className = "t";
      p.textContent = "styled";
      root.append(p);
      const colour = getComputedStyle(p).color;
      host.remove();
      return colour;
    });
    expect(colour).toBe("rgb(1, 2, 3)");
  });

  test("a <style> element and a style attribute are refused", async ({ page }) => {
    await openApp(page);
    const violations = await page.evaluate(async () => {
      const seen: string[] = [];
      document.addEventListener("securitypolicyviolation", (e) => seen.push(e.violatedDirective));
      const style = document.createElement("style");
      style.textContent = "body { outline: 9px solid rgb(9, 9, 9); }";
      document.head.append(style);
      const div = document.createElement("div");
      div.setAttribute("style", "outline: 9px solid rgb(9, 9, 9)");
      document.body.append(div);
      await new Promise((r) => setTimeout(r, 50));
      const outline = getComputedStyle(document.body).outlineWidth;
      const attr = getComputedStyle(div).outlineWidth;
      style.remove();
      div.remove();
      return { seen, outline, attr };
    });
    expect(violations.outline).not.toBe("9px");
    expect(violations.attr).not.toBe("9px");
    expect(violations.seen.some((d) => d.startsWith("style-src"))).toBe(true);
  });

  test("CSSOM styling is allowed: el.style.setProperty", async ({ page }) => {
    await openApp(page);
    const width = await page.evaluate(() => {
      const div = document.createElement("div");
      document.body.append(div);
      div.style.setProperty("width", "123px");
      const w = getComputedStyle(div).width;
      div.remove();
      return w;
    });
    expect(width).toBe("123px");
  });

  test("a blob: image loads (img-src blob:)", async ({ page }) => {
    await openApp(page);
    const loaded = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>';
          const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(true);
          };
          img.onerror = () => resolve(false);
          img.src = url;
        }),
    );
    expect(loaded).toBe(true);
  });
});
