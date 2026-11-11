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
 * Tests of the `gost-mac` vocabulary (vocab/gost-mac.fth, with the private primitive `_imit`). The MACs (from an
 * independent Python IMIT that reproduces the CEK_MAC of the RFC 4357 key wrap references), the key, IV and length
 * handling and the errors are in vocab/gost-mac.test.json. These cover what a vector cannot: that this MAC equals
 * the CEK_MAC of `gost28147:wrap-key` for every S-box (the two keep separate copies of the S-box tables), a
 * truncated MAC being the start of a longer one, and 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["gost-mac", "gost28147"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result): Uint8Array => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
};
const steps = (r: Result): number => (r.ok ? r.steps : -1);
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

const KEY = Uint8Array.from({ length: 32 }, (_, i) => 0x10 + i);
const SBOXES = ["E-TEST", "E-A", "E-B", "E-C", "E-D", "E-Z", "D-TEST", "D-A"];

const sign = (data: Uint8Array, sbox = "E-TEST", iv = new Uint8Array(0), bits = 32, key = KEY) =>
  runtime.call("gost-mac:sign", [bytes(data), bytes(key), bytes(iv), str(sbox), int(bits)]);

describe("gost-mac", () => {
  test("equals the CEK_MAC of gost28147:wrap-key for every S-box (the IV is the UKM)", async () => {
    const cek = Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3);
    const ukm = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const sbox of SBOXES) {
      const wrapped = top(
        await runtime.call("gost28147:wrap-key", [
          bytes(cek),
          bytes(KEY),
          bytes(ukm),
          str(sbox),
          str("NO"),
        ]),
      );
      const mac = top(await sign(cek, sbox, ukm, 32));
      expect(hex(mac), sbox).toBe(hex(wrapped.subarray(32)));
    }
  });

  test("a shorter MAC is the start of a longer one", async () => {
    const data = new TextEncoder().encode("a prefix property");
    const full = top(await sign(data, "E-A", new Uint8Array(0), 64));
    expect(full).toHaveLength(8);
    for (let bits = 8; bits <= 64; bits += 8) {
      expect(hex(top(await sign(data, "E-A", new Uint8Array(0), bits)))).toBe(
        hex(full.subarray(0, bits / 8)),
      );
    }
  });

  test("data is zero-padded to blocks: 'a' and 'a' followed by seven zero bytes have the same MAC", async () => {
    const a = top(await sign(new Uint8Array([0x61])));
    const b = top(await sign(new Uint8Array([0x61, 0, 0, 0, 0, 0, 0, 0])));
    expect(hex(a)).toBe(hex(b));
    expect(hex(top(await sign(new Uint8Array([0x61, 0, 0, 0, 0, 0, 0, 0, 0]))))).not.toBe(hex(a));
  });

  test("no data gives the first bytes of the IV register unchanged", async () => {
    const iv = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(hex(top(await sign(new Uint8Array(0), "E-TEST", iv, 64)))).toBe("0908070605040302");
  });

  test("verify: matches, and rejects a flipped bit anywhere in the MAC or the message", async () => {
    const data = new TextEncoder().encode("verify every bit");
    const mac = top(await sign(data, "E-B", new Uint8Array(0), 64));
    const verify = (m: Uint8Array, d: Uint8Array) =>
      runtime.call("gost-mac:verify", [
        bytes(d),
        bytes(KEY),
        bytes(new Uint8Array(0)),
        bytes(m),
        str("E-B"),
      ]);
    const text = async (m: Uint8Array, d: Uint8Array) => {
      const r = await verify(m, d);
      return r.ok ? (r.stack[r.stack.length - 1] as unknown as { v: string }).v : code(r);
    };
    expect(await text(mac, data)).toBe("The signature matches");
    for (let i = 0; i < 64; i++) {
      const m = Uint8Array.from(mac);
      m[i >> 3] = (m[i >> 3] ?? 0) ^ (1 << (i & 7));
      expect(await text(m, data)).toBe("The signature does not match");
    }
    for (let i = 0; i < data.length * 8; i++) {
      const d = Uint8Array.from(data);
      d[i >> 3] = (d[i >> 3] ?? 0) ^ (1 << (i & 7));
      expect(await text(mac, d)).toBe("The signature does not match");
    }
  });

  test("64 KiB: one primitive call, a few steps", async () => {
    const data = new Uint8Array(65536).map((_, i) => (i * 11) & 255);
    const r = await sign(data, "E-A", new Uint8Array(0), 64);
    expect(top(r)).toHaveLength(8);
    expect(steps(r)).toBeLessThan(300);
  });

  test("the words are pure", () => {
    expect(runtime.meta("gost-mac:sign").effects).toEqual([]);
    expect(runtime.meta("gost-mac:verify").effects).toEqual([]);
  });

  test("a key, IV or MAC length out of range is E_RANGE", async () => {
    expect(
      code(await sign(new Uint8Array(1), "E-TEST", new Uint8Array(0), 32, KEY.subarray(1))),
    ).toBe("E_RANGE");
    expect(code(await sign(new Uint8Array(1), "E-TEST", new Uint8Array(3)))).toBe("E_RANGE");
    expect(code(await sign(new Uint8Array(1), "E-TEST", new Uint8Array(0), 12))).toBe("E_RANGE");
  });
});
