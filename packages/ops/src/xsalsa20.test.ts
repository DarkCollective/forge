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
 * Tests for the `xsalsa20` vocabulary (vocab/xsalsa20.fth, with the private primitive of src/prims/xsalsa20.ts). The
 * vectors are in vocab/xsalsa20.test.json. The construction is checked structurally: the subkey is HSalsa20 of the
 * key and the first 16 nonce bytes (noble's `hsalsa`), and the keystream is Salsa20/20 under that subkey with the
 * last 8 nonce bytes, which is what XSalsa20 defines. There is no OpenSSL XSalsa20, so the large input is checked
 * by the round trip and the prefix property.
 */
import { hsalsa, salsa20 } from "@noble/ciphers/salsa.js";
import { int, valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["xsalsa20"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number, seed = 0) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seed) & 0xff);
const KEY = pattern(32, 3);
const NONCE = pattern(24, 5);
const ZEROS = (n: number) => new Uint8Array(n);

async function xsalsa(
  data: Uint8Array,
  opts: { key?: Uint8Array; nonce?: Uint8Array; counter?: number } = {},
) {
  const r = await runtime.call("xsalsa20:encrypt", [
    bytes(data),
    bytes(opts.key ?? KEY),
    bytes(opts.nonce ?? NONCE),
    int(opts.counter ?? 0),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

/** The little-endian 32-bit words of bytes, and back. */
function words(b: Uint8Array): Uint32Array {
  const w = new Uint32Array(b.length / 4);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < w.length; i++) w[i] = dv.getUint32(i * 4, true);
  return w;
}
function unwords(w: Uint32Array): Uint8Array {
  const b = new Uint8Array(w.length * 4);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < w.length; i++) dv.setUint32(i * 4, w[i]!, true);
  return b;
}

describe("xsalsa20:encrypt", () => {
  test("the keystream is Salsa20/20 under the HSalsa20 subkey, with the last 8 nonce bytes", async () => {
    const sigma = Uint32Array.from([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
    const out = new Uint32Array(8);
    hsalsa(sigma, words(KEY), words(NONCE.slice(0, 16)), out);
    const subkey = unwords(out);
    const data = pattern(200, 4);
    const expected = salsa20(subkey, NONCE.slice(16, 24), data, undefined, 0);
    expect(hex((await xsalsa(data)).out!)).toBe(hex(expected));
  });

  test("64 KiB round trip, and the steps stay far inside the default limit", async () => {
    const data = pattern(65536, 2);
    const r = await runtime.call("xsalsa20:encrypt", [
      bytes(data),
      bytes(KEY),
      bytes(NONCE),
      int(0),
    ]);
    expect(r.ok).toBe(true);
    expect(r.steps!).toBeLessThan(5_000_000);
    const enc = (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
    expect(hex((await xsalsa(enc)).out!)).toBe(hex(data));
  });

  test("the counter selects the block: counter 1 is the keystream from byte 64", async () => {
    const zero = (await xsalsa(ZEROS(128))).out!;
    const second = (await xsalsa(ZEROS(64), { counter: 1 })).out!;
    expect(hex(zero.slice(64))).toBe(hex(second));
  });

  test("a different nonce gives a different keystream", async () => {
    const other = pattern(24, 6);
    expect(hex((await xsalsa(ZEROS(64))).out!)).not.toBe(
      hex((await xsalsa(ZEROS(64), { nonce: other })).out!),
    );
  });

  test("bad key and nonce lengths raise E_RANGE", async () => {
    expect(await xsalsa(ZEROS(1), { key: ZEROS(16) })).toEqual({ code: "E_RANGE" });
    expect(await xsalsa(ZEROS(1), { nonce: ZEROS(8) })).toEqual({ code: "E_RANGE" });
    expect(await xsalsa(ZEROS(1), { counter: -1 })).toEqual({ code: "E_PARAM_INVALID" });
  });
});
