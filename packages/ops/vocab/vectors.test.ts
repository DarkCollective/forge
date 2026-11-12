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
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";

// Structural check only: this test validates every vocabulary's vector file against
// vectors.schema.json. The vector runner (WP 2.5, packages/worker) runs the ops.
const here = dirname(fileURLToPath(import.meta.url));
const schema: unknown = JSON.parse(readFileSync(join(here, "vectors.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema as object);
const vectorFiles = readdirSync(here)
  .filter((f) => f.endsWith(".test.json"))
  .sort();

const base = {
  op: "base64:encode",
  params: {},
  input: { value: "foobar", enc: "utf8" },
  expect: { value: "Zm9vYmFy", enc: "utf8" },
};

describe("the example key of a vector (LANGUAGE-0.2.md section 6)", () => {
  test("a file with an example validates, with and without a note", () => {
    expect(validate([{ ...base, example: { title: "Encode plain text" } }])).toBe(true);
    expect(validate([{ ...base, example: { title: "Encode", note: "Pads with =." } }])).toBe(true);
  });

  test("an example without a title, with an empty or long title, or with another key fails", () => {
    expect(validate([{ ...base, example: { note: "x" } }])).toBe(false);
    expect(validate([{ ...base, example: {} }])).toBe(false);
    expect(validate([{ ...base, example: { title: "" } }])).toBe(false);
    expect(validate([{ ...base, example: { title: "x".repeat(81) } }])).toBe(false);
    expect(validate([{ ...base, example: { title: "T", note: "x".repeat(401) } }])).toBe(false);
    expect(validate([{ ...base, example: { title: "T", other: 1 } }])).toBe(false);
    expect(validate([{ ...base, example: "T" }])).toBe(false);
  });
});

describe("operation test vector files", () => {
  test("at least one vector file exists", () => {
    expect(vectorFiles.length).toBeGreaterThan(0);
  });

  for (const file of vectorFiles) {
    const vocab = file.slice(0, -".test.json".length);

    test(`${file} validates against vectors.schema.json`, () => {
      const data: unknown = JSON.parse(readFileSync(join(here, file), "utf8"));
      const ok = validate(data);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    test(`${file} has at most 3 examples per op, with distinct titles, each within 2048 characters`, () => {
      type Vector = {
        op: string;
        params: Record<string, unknown>;
        input: { value: string };
        expect: { value?: string };
        example?: { title: string };
      };
      const data = JSON.parse(readFileSync(join(here, file), "utf8")) as Vector[];
      const titles = new Map<string, string[]>();
      for (const v of data) {
        if (v.example === undefined) continue;
        titles.set(v.op, [...(titles.get(v.op) ?? []), v.example.title]);
        const values = [v.input.value, v.expect.value];
        for (const p of Object.values(v.params)) {
          if (typeof p === "object" && p !== null) values.push((p as { value?: string }).value);
        }
        for (const x of values) expect([...(x ?? "")].length).toBeLessThanOrEqual(2048);
      }
      for (const [op, list] of titles) {
        expect(list.length, `${op} has too many examples`).toBeLessThanOrEqual(3);
        expect(new Set(list).size, `${op} repeats an example title`).toBe(list.length);
      }
    });

    test(`${file} holds only vectors of the vocabulary "${vocab}"`, () => {
      const data = JSON.parse(readFileSync(join(here, file), "utf8")) as { op: string }[];
      const wrong = data.filter((v) => v.op.split(":")[0] !== vocab).map((v) => v.op);
      expect(wrong).toEqual([]);
    });
  }
});
