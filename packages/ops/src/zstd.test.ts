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
 * Tests for the `zstd` vocabulary (vocab/zstd.fth, primitive in src/prims/zstd.ts). The frames come
 * from the zstd CLI (vocab/zstd.test.json, made by a script kept outside the repository; the CLI's
 * own `zstd -t` checks the corrupt cases). The vector file also runs in the worker package's vector
 * test; here are the 64 KiB step counts, the limits through the runtime, and the verify argument.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["zstd"]));

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
    fileURLToPath(import.meta.url).replace(/\/src\/[^/]*$/, "/vocab/zstd.test.json"),
    "utf8",
  ),
);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 (no Buffer in this package's typings). */
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
/** The expected bytes of a vector that expects bytes. */
const expected = (v: Vector): Uint8Array => decode(v.expect as Encoded);
const vector = (name: string): Vector => {
  const v = VECTORS.find((x) => x.name === name);
  if (!v) throw new Error(`no vector named ${name}`);
  return v;
};

const call = (data: Uint8Array, verify?: boolean, limits?: { maxValueBytes: number }) =>
  runtime.call(
    "zstd:decompress",
    verify === undefined ? [bytes(data), bool(true)] : [bytes(data), bool(verify)],
    limits === undefined ? undefined : { limits },
  );

describe("zstd:decompress", () => {
  test("64 KiB frames inflate within the step budget (the FL word is a few steps; the work is the primitive)", async () => {
    for (const name of [
      "zstd CLI level 3: 64 KiB prose",
      "zstd CLI level 3: 64 KiB random (raw blocks)",
      "zstd CLI level 3: 64 KiB mixed",
      "zstd CLI level 1: 64 KiB lines",
      "zstd CLI from stdin (no content size): 64 KiB prose",
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

  test("the verify argument: a bad checksum is E_COERCE by default and returned when verify is false", async () => {
    const v = vector("corrupt: a flipped bit in the checksum");
    expect(code(await call(decode(v.input)))).toBe("E_COERCE");
    expect(code(await call(decode(v.input), true))).toBe("E_COERCE");
    const r = await call(decode(v.input), false);
    expect(r.ok).toBe(true);
    expect(same(out(r) as Uint8Array, expected(vector("zstd CLI level 3: 64 KiB prose")))).toBe(
      true,
    );
  });

  test("the output limit comes from the run: the exact size passes, one byte less is E_LIMIT_VALUE", async () => {
    const v = vector("zstd CLI level 3: 64 KiB prose");
    const data = decode(v.input);
    expect(out(await call(data, true, { maxValueBytes: 65536 }))?.length).toBe(65536);
    expect(code(await call(data, true, { maxValueBytes: 65535 }))).toBe("E_LIMIT_VALUE");
  });

  test("a 100 MiB zeros bomb with no declared size stops at the default limit quickly", async () => {
    const v = vector("bomb: 100 MiB of zeros with no declared size stops at the limit");
    const t0 = Date.now();
    const r = await call(decode(v.input));
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 60_000);

  test("a dictionary frame, an empty input and a non-zstd input are E_COERCE with the fault named", async () => {
    const dict = await call(
      decode(
        vector("dictionary-compressed frame is E_COERCE (dictionaries are not supported)").input,
      ),
    );
    expect(code(dict)).toBe("E_COERCE");
    expect(dict.ok ? "" : dict.error.message).toMatch(/dictionary/);
    const empty = await call(new Uint8Array(0));
    expect(code(empty)).toBe("E_COERCE");
    const text = new TextEncoder().encode("not zstd at all");
    expect(code(await call(text))).toBe("E_COERCE");
  });

  test("concatenated frames and skippable frames join in order", async () => {
    const v = vector("concatenated frames (cat of three CLI frames)");
    const r = await call(decode(v.input));
    expect(same(out(r) as Uint8Array, expected(v))).toBe(true);
  });
});
