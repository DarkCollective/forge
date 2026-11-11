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
 * Tests for the `brotli` vocabulary (vocab/brotli.fth, primitive in src/prims/brotli.ts, decoder in
 * src/vendor/brotli). The streams come from the brotli CLI 1.2.0 (vocab/brotli.test.json); the vector
 * file also runs in the worker package's vector test. Here: the 64 KiB step counts, the limits through
 * the runtime, and the bomb through the runtime.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["brotli"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);

interface Encoded {
  value: string;
  enc: string;
}
interface Vector {
  name: string;
  input: Encoded;
  expect: Partial<Encoded> & { error?: string };
}
const VECTORS: Vector[] = JSON.parse(
  readFileSync(
    fileURLToPath(import.meta.url).replace(/\/src\/.*$/, "/vocab/brotli.test.json"),
    "utf8",
  ),
);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function fromBase64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s.replace(/=+$/, "")) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
const decode = (e: Encoded): Uint8Array =>
  e.enc === "hex"
    ? Uint8Array.from(e.value.match(/../g) ?? [], (h) => parseInt(h, 16))
    : fromBase64(e.value);
const same = (a: Uint8Array | undefined, b: Uint8Array): boolean =>
  a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
const vector = (name: string): Vector => {
  const v = VECTORS.find((x) => x.name === name);
  if (!v) throw new Error(`no vector named ${name}`);
  return v;
};
const expected = (v: Vector): Uint8Array => decode(v.expect as Encoded);

const call = (data: Uint8Array, limits?: { maxValueBytes: number }) =>
  runtime.call("brotli:decompress", [bytes(data)], limits === undefined ? undefined : { limits });

describe("brotli:decompress", () => {
  test("64 KiB streams inflate within the step budget (the FL word is a few steps; the work is the primitive)", async () => {
    for (const name of [
      "brotli CLI quality 0: 64 KiB prose",
      "brotli CLI quality 5: 64 KiB prose",
      "brotli CLI quality 11: 64 KiB prose",
      "brotli CLI quality 5: 64 KiB random (incompressible)",
      "brotli CLI quality 1: 64 KiB lines",
    ]) {
      const v = vector(name);
      const t0 = Date.now();
      const r = await call(decode(v.input));
      const ms = Date.now() - t0;
      expect(r.ok, name).toBe(true);
      expect(same(out(r) as Uint8Array, expected(v)), name).toBe(true);
      expect(r.ok && r.steps, name).toBeLessThan(1000);
      expect(ms, name).toBeLessThan(10_000);
    }
  }, 60_000);

  test("the output limit comes from the run: the exact size passes, one byte less is E_LIMIT_VALUE", async () => {
    const v = vector("1 MiB of zeros (within the limit)");
    const data = decode(v.input);
    expect(out(await call(data, { maxValueBytes: 1024 * 1024 }))?.length).toBe(1024 * 1024);
    expect(code(await call(data, { maxValueBytes: 1024 * 1024 - 1 }))).toBe("E_LIMIT_VALUE");
  });

  test("the 256 MiB bomb through the runtime stops at a 1 MiB limit", async () => {
    const v = vector("bomb: 256 MiB of zeros in a few hundred bytes stops at the limit");
    const t0 = Date.now();
    const r = await call(decode(v.input), { maxValueBytes: 1024 * 1024 });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  test("empty input, truncated and changed streams are E_COERCE", async () => {
    expect(code(await call(new Uint8Array(0)))).toBe("E_COERCE");
    expect(code(await call(decode(vector("truncated: one byte short").input)))).toBe("E_COERCE");
    expect(
      code(await call(decode(vector("corrupt: a flipped bit in the middle of the stream").input))),
    ).toBe("E_COERCE");
  });

  test("the expected bytes of the empty stream are empty", async () => {
    const r = await call(decode(vector("brotli CLI empty input compressed").input));
    expect(r.ok && out(r)?.length).toBe(0);
    expect(expected(vector("brotli CLI empty input compressed")).length).toBe(0);
  });
});
