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
 * Property tests for the `bits` vocabulary, which is written in FL (vocab/bits.fth) and has no
 * primitives. They run the baked words; the fixed-answer vectors are in vocab/bits.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { loadBundleNode } from "../sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bits"]));

// A small deterministic generator (mulberry32), so a failure reproduces.
let seed = 0x2f6e2b1;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randBytes(min: number, max: number): Uint8Array {
  const n = min + Math.floor(rand() * (max - min + 1));
  return Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
}

async function bytesOf(
  word: string,
  args: Parameters<typeof runtime.call>[1],
): Promise<Uint8Array> {
  const r = await runtime.call(word, args);
  if (!r.ok) throw new Error(`${word}: ${r.error.code} ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
}

const N = 40;

describe("inverse pairs", () => {
  test("xor twice with the same key is the identity", async () => {
    for (let i = 0; i < N; i++) {
      const data = randBytes(0, 200);
      const key = bytes(randBytes(1, 9));
      const once = await bytesOf("bits:xor", [bytes(data), key]);
      expect(await bytesOf("bits:xor", [bytes(once), key])).toEqual(data);
    }
  });

  test("add then sub is the identity", async () => {
    for (let i = 0; i < N; i++) {
      const data = randBytes(0, 200);
      const key = bytes(randBytes(1, 9));
      const added = await bytesOf("bits:add", [bytes(data), key]);
      expect(await bytesOf("bits:sub", [bytes(added), key])).toEqual(data);
    }
  });

  test("rotate-left n then rotate-right n is the identity", async () => {
    for (let i = 0; i < N; i++) {
      const data = randBytes(0, 200);
      const n = int(1 + Math.floor(rand() * 7));
      const left = await bytesOf("bits:rotate-left", [bytes(data), n]);
      expect(await bytesOf("bits:rotate-right", [bytes(left), n])).toEqual(data);
    }
  });

  test("not twice is the identity", async () => {
    for (let i = 0; i < N; i++) {
      const data = randBytes(0, 200);
      const once = await bytesOf("bits:not", [bytes(data)]);
      expect(await bytesOf("bits:not", [bytes(once)])).toEqual(data);
    }
  });
});

describe("agreement with a plain implementation", () => {
  test("and, or, add, sub with a repeating key", async () => {
    for (let i = 0; i < N; i++) {
      const data = randBytes(0, 100);
      const key = randBytes(1, 7);
      const k = (j: number) => key[j % key.length] as number;
      const cases: [string, (b: number, c: number) => number][] = [
        ["bits:and", (b, c) => b & c],
        ["bits:or", (b, c) => b | c],
        ["bits:add", (b, c) => (b + c) & 255],
        ["bits:sub", (b, c) => (b - c) & 255],
      ];
      for (const [word, f] of cases) {
        const got = await bytesOf(word, [bytes(data), bytes(key)]);
        expect(got).toEqual(Uint8Array.from(data, (b, j) => f(b, k(j))));
      }
    }
  });

  test("shifts and rotations", async () => {
    const data = Uint8Array.from({ length: 256 }, (_, j) => j);
    for (let n = 1; n <= 7; n++) {
      expect(await bytesOf("bits:shift-left", [bytes(data), int(n)])).toEqual(
        Uint8Array.from(data, (b) => (b << n) & 255),
      );
      expect(await bytesOf("bits:shift-right", [bytes(data), int(n)])).toEqual(
        Uint8Array.from(data, (b) => b >> n),
      );
      expect(await bytesOf("bits:rotate-left", [bytes(data), int(n)])).toEqual(
        Uint8Array.from(data, (b) => ((b << n) | (b >> (8 - n))) & 255),
      );
    }
  });
});

describe("performance and limits", () => {
  test("a 64 KiB input with a long key bakes within the default limits", async () => {
    const data = randBytes(65536, 65536);
    const key = bytes(randBytes(4096, 4096));
    const r = await runtime.call("bits:add", [bytes(data), key]);
    expect(r.ok).toBe(true);
  });

  test("xor-brute finds the key of a short message", async () => {
    const plain = Uint8Array.from("attack at dawn", (c) => c.charCodeAt(0));
    const cipher = plain.map((b: number) => b ^ 0x5a);
    const r = await runtime.call("bits:xor-brute", [bytes(cipher), int(1), str("attack")]);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.stack[r.stack.length - 1] as unknown as { v: unknown[] }).v).toHaveLength(1);
  });
});

describe("module", () => {
  test("every word has a doc and the Bitwise category", () => {
    for (const name of [
      "xor",
      "and",
      "or",
      "add",
      "sub",
      "not",
      "shift-left",
      "shift-right",
      "rotate-left",
      "rotate-right",
      "xor-brute",
    ]) {
      const meta = runtime.meta(`bits:${name}`);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Bitwise");
    }
  });
});
