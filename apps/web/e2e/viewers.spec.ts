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
import type { Page } from "@playwright/test";
import { audit } from "./audit";
import { addOpByKeyboard, cards, expect, openApp, test } from "./fixtures";

// Extension values in the output pane (UI-TOOLKIT.md section 1). No op makes an ext value yet (the table and
// relation viewers are D3 and R3), so these tests use a test kind. Two seams, both on the page side only:
//  - the bake Worker's `result` message is rewritten on its way in, so the output pane receives an ext output
//    (the string `window.__extOutput`, a JSON object, when it is set);
//  - the viewers are registered through `ForgeOutput.registerViewer`, as a pack's chunk would register them.
// Everything else is the production build served with the production headers.

interface ExtOutput {
  kind: "ext";
  extKind: string;
  text: string;
  truncated: boolean;
  view?: unknown;
}

declare global {
  interface Window {
    __extOutput?: ExtOutput | null;
    __extPartial?: ExtOutput | null;
  }
}

/** Rewrites the output of every successful bake (and the partial value of a failed one) while it is set. */
async function installRewrite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = Worker.prototype.addEventListener;
    Worker.prototype.addEventListener = function (
      this: Worker,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type !== "message" || typeof listener !== "function") {
        return original.call(this, type, listener, options);
      }
      const wrapped = function (this: Worker, event: MessageEvent): void {
        const data = event.data as { type?: string; result?: Record<string, unknown> } | null;
        if (data?.type === "result" && data.result !== undefined) {
          if (data.result["ok"] === true && window.__extOutput) {
            data.result["output"] = window.__extOutput;
          } else if (data.result["ok"] === false && window.__extPartial) {
            data.result["partial"] = window.__extPartial;
          }
        }
        (listener as (e: MessageEvent) => void).call(this, event);
      };
      return original.call(this, type, wrapped as EventListener, options);
    };
  });
}

/** Registers the viewers of the test kinds in the page. */
async function registerTestViewers(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Out = { text: string; view?: { head: string[]; rows: string[][] } };
    const Output = customElements.get("forge-output") as unknown as {
      registerViewer(viewer: unknown): void;
    };
    Output.registerViewer({
      kind: "test-grid",
      noun: "test grid",
      render(output: Out): HTMLElement {
        const view = output.view as { head: string[]; rows: string[][] };
        const table = document.createElement("table");
        table.setAttribute("data-test", "grid");
        const caption = document.createElement("caption");
        caption.textContent = `Test grid of ${view.rows.length} rows`;
        const head = document.createElement("tr");
        for (const h of view.head) {
          const th = document.createElement("th");
          th.scope = "col";
          th.textContent = h;
          head.append(th);
        }
        const thead = document.createElement("thead");
        thead.append(head);
        const tbody = document.createElement("tbody");
        for (const row of view.rows) {
          const tr = document.createElement("tr");
          for (const cell of row) {
            const td = document.createElement("td");
            td.textContent = cell;
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(caption, thead, tbody);
        return table;
      },
      summary: (output: Out) => `${output.view?.rows.length ?? 0} rows`,
      copyText: () => "grid as csv",
      bytesOps: [{ op: "base64:decode", label: "Decode as base64" }],
    });
    Output.registerViewer({
      kind: "test-boom",
      noun: "boom",
      render(): HTMLElement {
        throw new Error("the viewer is broken");
      },
    });
    Output.registerViewer({
      kind: "test-not-an-element",
      noun: "odd",
      render(): HTMLElement {
        return "not an element" as unknown as HTMLElement;
      },
    });
  });
}

const GRID: ExtOutput = {
  kind: "ext",
  extKind: "test-grid",
  text: "a,b\n1,2\n3,4",
  truncated: false,
  view: {
    head: ["a", "b"],
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
  },
};

async function setOutput(page: Page, output: ExtOutput | null): Promise<void> {
  await page.evaluate((o) => {
    window.__extOutput = o;
  }, output);
}

/** Opens the app with one op and some input, so that every change of the input bakes. */
async function start(page: Page): Promise<void> {
  await installRewrite(page);
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await openApp(page);
  await registerTestViewers(page);
  await addOpByKeyboard(page, "hex encode");
}

async function bake(page: Page, text: string): Promise<void> {
  await page.keyboard.press("Alt+3");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

const output = (page: Page) => page.locator("forge-output");
const footer = (page: Page) => page.locator("forge-output .footer");

test.describe("a registered viewer", () => {
  test("draws the table, and the footer, Copy and Convert to bytes follow the kind", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await start(page);
    await setOutput(page, GRID);
    await bake(page, "x");
    await expect(output(page).locator("table[data-test=grid] td")).toHaveText(["1", "2", "3", "4"]);
    await expect(output(page).locator("caption")).toHaveText("Test grid of 2 rows");
    await expect(footer(page)).toContainText("Type: ext{test-grid}");
    await expect(footer(page).locator(".sr-only")).toHaveText("Type: test grid");
    // Move to input is replaced by the Convert menu.
    await expect(output(page).getByRole("button", { name: "Move to input" })).toHaveCount(0);
    await expect(output(page).getByRole("button", { name: "To new tab" })).toHaveCount(0);
    // Copy uses the viewer's text.
    await output(page).getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("grid as csv");
    // Convert to bytes adds the op at the end of the recipe, announced.
    const before = await cards(page).count();
    await output(page).getByRole("button", { name: "Convert to bytes" }).click();
    await page.getByRole("menuitem", { name: "Decode as base64" }).click();
    await expect(cards(page)).toHaveCount(before + 1);
    await expect(
      page.locator("[aria-live]").filter({ hasText: /Added Decode as base64/ }),
    ).toHaveCount(1);
    // After the next bake the output is bytes again, and Move to input is back.
    await setOutput(page, null);
    await bake(page, "aGk=");
    await expect(output(page).getByRole("button", { name: "Move to input" })).toBeVisible();
    await expect(output(page).getByRole("button", { name: "Convert to bytes" })).toHaveCount(0);
  });

  test("the Data here line says what the data is and its shape", async ({ page }) => {
    await start(page);
    await setOutput(page, GRID);
    await bake(page, "x");
    await expect(output(page).locator("table[data-test=grid]")).toBeVisible();
    await expect(page.locator("forge-operations")).toContainText("Data here: test grid (2 rows)");
  });

  test("Download saves the text form", async ({ page }) => {
    await start(page);
    await setOutput(page, GRID);
    await bake(page, "x");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      output(page).getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("forge-output.txt");
  });
});

test.describe("the text fallback", () => {
  test("an unknown kind shows the text form, a sentence, and the value stays", async ({ page }) => {
    await start(page);
    await setOutput(page, {
      kind: "ext",
      extKind: "test-nobody",
      text: "rows=3",
      truncated: false,
      view: { x: 1 },
    });
    await bake(page, "x");
    await expect(output(page).locator(".ext-fallback .note")).toHaveText(
      "No viewer for test-nobody is loaded. Showing the text form.",
    );
    await expect(output(page).locator(".ext-fallback pre.text")).toHaveText("rows=3");
    await expect(footer(page)).toContainText("Type: ext{test-nobody}");
    await expect(page.locator("forge-operations")).toContainText(
      "Data here: test-nobody extension value",
    );
    // Copy and Download work on the text form, and there is no Convert menu.
    await expect(output(page).getByRole("button", { name: "Convert to bytes" })).toHaveCount(0);
    await expect(output(page).getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
  });

  test("the kinds of the language have the normal look, with no sentence", async ({ page }) => {
    await start(page);
    await setOutput(page, { kind: "ext", extKind: "null", text: "null", truncated: false });
    await bake(page, "x");
    await expect(output(page).locator(".ext-fallback pre.text")).toHaveText("null");
    await expect(output(page).locator(".ext-fallback .note")).toHaveCount(0);
    await expect(footer(page)).toContainText("Type: ext{null}");
  });

  test("a viewer that throws, or returns a non-element, does not hide the value", async ({
    page,
  }) => {
    await start(page);
    for (const extKind of ["test-boom", "test-not-an-element"]) {
      await setOutput(page, {
        kind: "ext",
        extKind,
        text: `value of ${extKind}`,
        truncated: false,
        view: {},
      });
      await bake(page, extKind);
      await expect(output(page).locator(".ext-fallback .note")).toHaveText(
        `The viewer for ${extKind} failed. Showing the text form.`,
      );
      await expect(output(page).locator(".ext-fallback pre.text")).toHaveText(
        `value of ${extKind}`,
      );
    }
  });

  test("a cut text says so in the sentence and in the names of Copy and Download", async ({
    page,
  }) => {
    await start(page);
    await setOutput(page, {
      kind: "ext",
      extKind: "test-nobody",
      text: "x".repeat(4000),
      truncated: true,
    });
    await bake(page, "x");
    await expect(output(page).locator(".ext-fallback .note")).toContainText(
      "Showing the first 4,000 characters.",
    );
    await expect(
      output(page).getByRole("button", { name: "Copy the first 4,000 characters" }),
    ).toBeVisible();
    await expect(
      output(page).getByRole("button", { name: "Download the first 4,000 characters" }),
    ).toBeVisible();
  });

  test("hostile text is shown as text and nothing runs", async ({ page }) => {
    await start(page);
    const hostile = "<img src=x onerror=alert(1)></script><svg onload=alert(2)>‮";
    await setOutput(page, { kind: "ext", extKind: "test-nobody", text: hostile, truncated: false });
    await bake(page, "x");
    await expect(output(page).locator(".ext-fallback pre.text")).toHaveText(hostile);
    // The icons are svg, so only the elements the text could have made are counted.
    await expect(output(page).locator("img, script, svg[onload]")).toHaveCount(0);
  });

  test("a hostile cell and column name in a viewer are text too", async ({ page }) => {
    await start(page);
    await setOutput(page, {
      ...GRID,
      view: { head: ["<img src=x onerror=alert(1)>"], rows: [["</script><b>x</b>"]] },
    });
    await bake(page, "x");
    await expect(output(page).locator("table[data-test=grid] th")).toHaveText(
      "<img src=x onerror=alert(1)>",
    );
    await expect(output(page).locator("table[data-test=grid] td")).toHaveText("</script><b>x</b>");
    expect(
      await output(page).evaluate((el) => el.shadowRoot?.querySelectorAll("img, b, script").length),
    ).toBe(0);
  });
});

test.describe("the partial value of a failed bake", () => {
  test("is drawn by the viewer too", async ({ page }) => {
    await installRewrite(page);
    await openApp(page);
    await registerTestViewers(page);
    await addOpByKeyboard(page, "hex decode");
    await page.evaluate((o) => {
      window.__extPartial = o;
    }, GRID);
    await bake(page, "not hex at all");
    await expect(output(page).locator(".error-panel")).toBeVisible();
    await expect(output(page).locator(".error-panel table[data-test=grid] td")).toHaveText([
      "1",
      "2",
      "3",
      "4",
    ]);
  });
});

for (const [label, id] of [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const) {
  test.describe(`${label} theme`, () => {
    test.use({ viewport: { width: 1400, height: 1200 } });

    async function theme(page: Page): Promise<void> {
      await page.getByRole("button", { name: /^Theme/ }).click();
      await page.getByRole("menuitemradio", { name: label }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    }

    test("axe is clean with a viewer and with the text fallback", async ({ page }) => {
      await start(page);
      await theme(page);
      await setOutput(page, GRID);
      await bake(page, "x");
      await expect(output(page).locator("table[data-test=grid]")).toBeVisible();
      await audit(page, `${id} viewer`);
      await setOutput(page, {
        kind: "ext",
        extKind: "test-nobody",
        text: "text form",
        truncated: true,
      });
      await bake(page, "y");
      await expect(output(page).locator(".ext-fallback .note")).toBeVisible();
      await audit(page, `${id} fallback`);
      await setOutput(page, { ...GRID, extKind: "test-boom" });
      await bake(page, "z");
      await expect(output(page).locator(".ext-fallback .note")).toContainText("failed");
      await audit(page, `${id} failed viewer`);
    });
  });
}
