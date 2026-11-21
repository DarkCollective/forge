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
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

// WCAG 2.0, 2.1 and 2.2, levels A and AA (the rule of a11y.spec.ts: no rule is disabled).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Runs axe and fails on any violation. Colour transitions are given time to end before contrast is judged. */
export async function audit(page: Page, label: string): Promise<void> {
  type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];
  let violations: Violation[] = [];
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
    (v) =>
      `${label}: ${v.id} (${v.impact}) x${v.nodes.length}: ` +
      v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" >> "))
        .join(" | "),
  );
  expect(summary, `axe violations\n${summary.join("\n")}`).toEqual([]);
}
