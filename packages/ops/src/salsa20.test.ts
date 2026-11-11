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
 * Tests for the `salsa20` vocabulary (vocab/salsa20.fth, with the private primitive of src/prims/salsa20.ts). The
 * eSTREAM vectors are in vocab/salsa20.test.json. There is no OpenSSL Salsa20, so the large input is checked by its
 * structure: the block counter, the prefix property, and the round trip.
 */
import { int, valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["salsa20"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number, seed = 0) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seed) & 0xff);
const KEY = pattern(32, 3);
const NONCE = pattern(8, 5);
const ZEROS = (n: number) => new Uint8Array(n);

async function salsa(
  data: Uint8Array,
  opts: { key?: Uint8Array; nonce?: Uint8Array; counter?: number } = {},
) {
  const r = await runtime.call("salsa20:encrypt", [
    bytes(data),
    bytes(opts.key ?? KEY),
    bytes(opts.nonce ?? NONCE),
    int(opts.counter ?? 0),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("salsa20:encrypt", () => {
  test("64 KiB round trip, and the steps stay far inside the default limit", async () => {
    const data = pattern(65536, 2);
    const r = await runtime.call("salsa20:encrypt", [
      bytes(data),
      bytes(KEY),
      bytes(NONCE),
      int(0),
    ]);
    expect(r.ok).toBe(true);
    expect(r.steps!).toBeLessThan(5_000_000);
    const enc = (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
    expect(hex((await salsa(enc)).out!)).toBe(hex(data));
  });

  test("the counter selects the block: counter 1 is the keystream from byte 64", async () => {
    const zero = (await salsa(ZEROS(128))).out!;
    const second = (await salsa(ZEROS(64), { counter: 1 })).out!;
    expect(hex(zero.slice(64))).toBe(hex(second));
  });

  test("a shorter input gets a prefix of the longer keystream, for every length to 130", async () => {
    const long = (await salsa(ZEROS(130))).out!;
    for (let n = 0; n <= 130; n++) {
      expect(hex((await salsa(ZEROS(n))).out!)).toBe(hex(long.slice(0, n)));
    }
  });

  test("bad key and nonce lengths raise E_RANGE", async () => {
    expect(await salsa(ZEROS(1), { key: ZEROS(24) })).toEqual({ code: "E_RANGE" });
    expect(await salsa(ZEROS(1), { nonce: ZEROS(12) })).toEqual({ code: "E_RANGE" });
    expect(await salsa(ZEROS(1), { counter: -1 })).toEqual({ code: "E_PARAM_INVALID" });
  });
});
