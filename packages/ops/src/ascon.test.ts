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
 * Tests for the `ascon` vocabulary through the runtime. The reference KAT vectors are in
 * vocab/ascon.test.json and src/prims/ascon.test.ts; these cover 64 KiB inputs within the default
 * limits, the round trip, and the errors of each word.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["ascon"]));

const seq = (from: number, n: number) => Uint8Array.from({ length: n }, (_, i) => from + i);
const key = seq(0, 16);
const nonce = seq(0x10, 16);
const none = new Uint8Array(0);

async function call(word: string, args: Uint8Array[]) {
  const r = await runtime.call(
    word,
    args.map((a) => bytes(a)),
  );
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

describe("ascon", () => {
  const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

  test("64 KiB: hash, mac and an authenticated round trip", async () => {
    expect((await call("ascon:hash", [data])).out?.length).toBe(32);
    expect((await call("ascon:mac", [data, key])).out?.length).toBe(16);
    const enc = await call("ascon:encrypt", [data, key, nonce, seq(0x30, 5)]);
    expect(enc.out?.length).toBe(65536 + 16);
    const dec = await call("ascon:decrypt", [enc.out as Uint8Array, key, nonce, seq(0x30, 5)]);
    expect(Array.from(dec.out as Uint8Array)).toEqual(Array.from(data));
  });

  test("decrypt with a wrong key, nonce, ad or a flipped bit is E_COERCE", async () => {
    const enc = (await call("ascon:encrypt", [seq(1, 20), key, nonce, none])).out as Uint8Array;
    expect((await call("ascon:decrypt", [enc, seq(1, 16), nonce, none])).code).toBe("E_COERCE");
    expect((await call("ascon:decrypt", [enc, key, seq(0x11, 16), none])).code).toBe("E_COERCE");
    expect((await call("ascon:decrypt", [enc, key, nonce, seq(1, 1)])).code).toBe("E_COERCE");
    const flipped = enc.slice();
    flipped[3] = flipped[3]! ^ 0x80;
    expect((await call("ascon:decrypt", [flipped, key, nonce, none])).code).toBe("E_COERCE");
    expect((await call("ascon:decrypt", [none, key, nonce, none])).code).toBe("E_COERCE");
  });

  test("a key or nonce that is not 16 bytes is E_RANGE", async () => {
    for (const n of [0, 15, 17]) {
      expect((await call("ascon:mac", [none, new Uint8Array(n)])).code).toBe("E_RANGE");
      expect((await call("ascon:encrypt", [none, new Uint8Array(n), nonce, none])).code).toBe(
        "E_RANGE",
      );
      expect((await call("ascon:encrypt", [none, key, new Uint8Array(n), none])).code).toBe(
        "E_RANGE",
      );
      expect(
        (await call("ascon:decrypt", [new Uint8Array(16), key, new Uint8Array(n), none])).code,
      ).toBe("E_RANGE");
    }
  });
});
