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
// The display functions of the help dialog over every real example of the built help.json (WP 6.13a):
// nothing is dropped or shown as "[object Object]", hex and base64 values say what they are, json
// results render, and the truncation rule holds for long values. Synthetic cases are in help-view.test.ts.
import { readFileSync } from "node:fs";
import type { HelpDoc } from "@forge/ops";
import { describe, expect, test } from "vitest";
import { SHOW_LIMIT, showControls, viewExpect, viewParams, viewValue } from "./help-view.js";
import type { ValueView } from "./help-view.js";

const help = JSON.parse(
  readFileSync(new URL("../../../../packages/ops/dist/help.json", import.meta.url), "utf8"),
) as HelpDoc;

const examples = help.ops.flatMap((op) =>
  op.examples.map((ex) => ({ label: `${op.qname}: ${ex.title}`, ex })),
);

const chars = (s: string): number => [...s].length;

/** What a value view must satisfy for a value written as `value` in `enc`. */
function checkValue(where: string, v: ValueView, value: string, enc: string): void {
  const full = showControls(value);
  expect(v.label, `${where}: label`).toBe(enc === "utf8" ? "text" : enc);
  expect(v.empty, `${where}: empty`).toBe(value === "");
  if (chars(full) <= SHOW_LIMIT) {
    expect(v.text, `${where}: dropped`).toBe(full);
    expect(v.cut, `${where}: cut`).toBeNull();
  } else {
    expect(chars(v.text), `${where}: truncation length`).toBe(SHOW_LIMIT);
    expect(full.startsWith(v.text), `${where}: truncation is a prefix`).toBe(true);
    expect(v.cut, `${where}: cut says so`).toBe(
      `The first ${SHOW_LIMIT} of ${chars(full)} characters.`,
    );
  }
  expect(v.text, where).not.toContain("[object Object]");
  expect(v.reading ?? "", where).not.toContain("[object Object]");
}

describe("the help dialog's display of every real example", () => {
  test("there are examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  test("inputs: text, hex and base64 are labelled, nothing is dropped, long ones are cut", () => {
    for (const { label, ex } of examples) {
      expect(["utf8", "hex", "latin1", "base64"], `${label}: input encoding`).toContain(
        ex.input.enc,
      );
      checkValue(
        `${label}: input`,
        viewValue(ex.input.value, ex.input.enc),
        ex.input.value,
        ex.input.enc,
      );
    }
  });

  test("parameters: one line each, every value visible", () => {
    for (const { label, ex } of examples) {
      const lines = viewParams(ex.params);
      expect(
        lines.map((l) => l.name),
        `${label}: parameter names`,
      ).toEqual(Object.keys(ex.params));
      for (const line of lines) {
        const raw = ex.params[line.name];
        const where = `${label}: parameter ${line.name}`;
        if (typeof raw === "object" && raw !== null) {
          const r = raw as { value: string; enc: string };
          checkValue(where, line.value, r.value, r.enc);
        } else if (typeof raw === "string") {
          checkValue(where, line.value, raw, "utf8");
        } else {
          expect(line.value.text, where).toBe(String(raw));
        }
      }
    }
  });

  test("results: values, json and errors render completely", () => {
    const kinds = new Set<string>();
    for (const { label, ex } of examples) {
      const out = viewExpect(ex.expect);
      const where = `${label}: result`;
      kinds.add(out.kind);
      expect(out.kind, `${where}: a known shape`).not.toBe("unknown");
      const expected = ex.expect as Record<string, unknown>;
      if (out.kind === "value") {
        const v = expected as { value: string; enc: string };
        checkValue(where, out.value, v.value, v.enc);
      } else if (out.kind === "error") {
        expect(out.code, where).toBe(expected.error);
      } else if (out.kind === "json") {
        const full = showControls(JSON.stringify(expected.json, null, 2));
        expect(out.text, where).not.toContain("[object Object]");
        if (chars(full) <= SHOW_LIMIT) {
          expect(out.text, `${where}: dropped`).toBe(full);
          expect(out.cut, where).toBeNull();
          // What is shown is the expected value, not just something that looks like it.
          expect(JSON.parse(out.text) as unknown, where).toEqual(expected.json);
        } else {
          expect(chars(out.text), where).toBe(SHOW_LIMIT);
          expect(out.cut, where).toBe(`The first ${SHOW_LIMIT} of ${chars(full)} characters.`);
        }
      }
    }
    // The data really contains the shapes this test is about.
    expect([...kinds]).toEqual(expect.arrayContaining(["value", "json", "error"]));
  });
});
