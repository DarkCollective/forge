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

/*
 * Tests for the `base64-offsets` vocabulary (vocab/base64-offsets.fth). The op vectors
 * (vocab/base64-offsets.test.json) hold the cases computed with Python's base64; these tests check the rule on
 * every length from 0 to 40 bytes against a Base64 encoder written here, the alphabets and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { asBytes, code, loadRuntime, rng, steps, text } from "./data-format-test.js";

const { str, bool } = valueHelpers;
const runtime = await loadRuntime(["base64-offsets"]);

const show = (d: Uint8Array, alphabet = "A-Za-z0-9+/=", variable = true, input = "raw") =>
  runtime.call("base64-offsets:show", [asBytes(d), str(alphabet), bool(variable), str(input)]);

const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 written here (no padding), in the alphabet `alpha`. */
function b64(d: Uint8Array, alpha = STD): string {
  let out = "";
  for (let i = 0; i < d.length; i += 3) {
    const n = ((d[i] as number) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0);
    out += alpha[(n >> 18) & 63] as string;
    out += alpha[(n >> 12) & 63] as string;
    if (i + 1 < d.length) out += alpha[(n >> 6) & 63] as string;
    if (i + 2 < d.length) out += alpha[n & 63] as string;
  }
  return out;
}
/** The expected lines, from the rule in the doc of the op. */
function expected(d: Uint8Array, alpha: string, pad: string, variable: boolean): string {
  const lines: string[] = [];
  for (let k = 0; k < 3; k++) {
    if (d.length === 0) {
      lines.push("");
      continue;
    }
    const z = new Uint8Array(k + d.length);
    z.set(d, k);
    const t = b64(z, alpha);
    const start = variable ? k : k > 0 ? k + 1 : 0;
    const end = t.length - (variable ? 0 : z.length % 3 ? 1 : 0);
    lines.push(t.slice(start, end) + (variable ? pad.repeat((3 - (z.length % 3)) % 3) : ""));
  }
  return `Offset 0 (aligned): ${lines[0]}\nOffset 1: ${lines[1]}\nOffset 2: ${lines[2]}`;
}

describe("show", () => {
  test("every length from 0 to 40 bytes, with and without the variable characters", async () => {
    const rand = rng(60);
    for (let n = 0; n <= 40; n++) {
      const d = Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
      expect(text(await show(d, "A-Za-z0-9+/=", true))).toBe(expected(d, STD, "=", true));
      expect(text(await show(d, "A-Za-z0-9+/=", false))).toBe(expected(d, STD, "=", false));
    }
  });
  test("the offsets are windows into the encoding of the data behind one and two other bytes", async () => {
    const d = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    const lines = text(await show(d, "A-Za-z0-9+/=", false)).split("\n");
    for (const k of [1, 2]) {
      const z = new Uint8Array(k + d.length);
      z.set(d, k);
      expect(b64(z)).toContain((lines[k] as string).slice(k === 1 ? 11 : 10));
    }
  });
  test("alphabets: ranges, 64 or 65 characters, a different order", async () => {
    const d = Uint8Array.from([0xfb, 0xff, 0xfe, 1, 2]);
    const url = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    expect(text(await show(d, "A-Za-z0-9-_", true))).toBe(expected(d, url, "", true));
    expect(text(await show(d, "A-Za-z0-9-_~", true))).toBe(expected(d, url, "~", true));
    const odd = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    expect(text(await show(d, "./0-9A-Za-z=", true))).toBe(expected(d, odd, "=", true));
    expect(text(await show(d, "./0-9A-Za-z", false))).toBe(expected(d, odd, "", false));
  });
  test("input types", async () => {
    const raw = new TextEncoder().encode("Hello");
    const want = text(await show(raw));
    expect(
      text(await show(new TextEncoder().encode("48 65\n6c6C6f"), "A-Za-z0-9+/=", true, "hex")),
    ).toBe(want);
    expect(
      text(await show(new TextEncoder().encode("SGVsbG8="), "A-Za-z0-9+/=", true, "base64")),
    ).toBe(want);
    expect(
      text(await show(new TextEncoder().encode("SGVsbG8"), "A-Za-z0-9+/=", true, "base64")),
    ).toBe(want);
    expect(code(await show(new TextEncoder().encode("4"), "A-Za-z0-9+/=", true, "hex"))).toBe(
      "E_COERCE",
    );
  });
  test("alphabet errors", async () => {
    const d = new Uint8Array(3);
    for (const a of ["", "A-Za-z0-9+", "A-Za-z0-9+//", "A-Za-z0-9+\u00e9", "A-Za-z0-9+/==="])
      expect(code(await show(d, a))).toBe("E_RANGE");
  });
});

describe("cost at 64 KiB", () => {
  test("64 KiB of data", { timeout: 60_000 }, async () => {
    const rand = rng(61);
    const d = Uint8Array.from({ length: 65_536 }, () => Math.floor(rand() * 256));
    const t0 = Date.now();
    const r = await show(d);
    const ms = Date.now() - t0;
    expect(text(r)).toBe(expected(d, STD, "=", true));
    expect(steps(r)).toBeLessThan(40_000);
    process.stderr.write(`\nbase64-offsets 65,536 bytes: ${steps(r)} steps ${ms} ms\n`);
  });
});
