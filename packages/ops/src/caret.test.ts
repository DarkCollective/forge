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
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// caret is FL (vocab/caret.fth); these tests drive its public words through the runtime.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["caret"]));

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * The notation is not injective (as for cat -v): a literal ^ (0x5E) or M (0x4D) and the byte
 * 0xDE (written M-^) can be read as the start of an escape, so round trips avoid those bytes.
 */
const AMBIGUOUS = new Set([0x5e, 0x4d, 0xde]);

describe("caret round trip", () => {
  test("decode(encode(x)) == x for random bytes without the ambiguous ones", async () => {
    const next = rng(77);
    for (let trial = 0; trial < 80; trial++) {
      const data = Uint8Array.from({ length: Math.floor(next() * 60) }, () => {
        let b = Math.floor(next() * 256);
        while (AMBIGUOUS.has(b)) b = Math.floor(next() * 256);
        return b;
      });
      const enc = await runtime.call("caret:encode", [bytes(data)]);
      expect(enc.ok).toBe(true);
      const printable = [...(top(enc).v as string)].every(
        (c) => c === "\t" || c === "\n" || (c >= " " && c <= "~"),
      );
      expect(printable).toBe(true);
      const dec = await runtime.call("caret:decode", [str(top(enc).v as string)]);
      expect(dec.ok).toBe(true);
      expect(top(dec).v).toEqual(data);
    }
  });

  test("every byte but the ambiguous ones, one at a time", async () => {
    for (let b = 0; b < 256; b++) {
      if (AMBIGUOUS.has(b)) continue;
      const enc = await runtime.call("caret:encode", [bytes(Uint8Array.of(b))]);
      const dec = await runtime.call("caret:decode", [str(top(enc).v as string)]);
      expect(top(dec).v).toEqual(Uint8Array.of(b));
    }
  });

  test("the ambiguous literal ^ stays a literal ^ in the encoding (as in cat -v)", async () => {
    const enc = await runtime.call("caret:encode", [bytes(Uint8Array.of(0x5e, 0x20))]);
    expect(top(enc).v).toBe("^ ");
  });

  test("64 KiB round trip", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => {
      const b = (i * 2654435761) >>> 24;
      return AMBIGUOUS.has(b) ? 0x41 : b;
    });
    const enc = await runtime.call("caret:encode", [bytes(data)]);
    const dec = await runtime.call("caret:decode", [str(top(enc).v as string)]);
    expect(top(dec).v).toEqual(data);
  }, 60_000);
});

describe("caret:decode errors", () => {
  for (const bad of ["^a", "^", "M-", "^ ", "é", "M-é", "x^\u0001"]) {
    test(`${JSON.stringify(bad)} is E_COERCE`, async () => {
      const r = await runtime.call("caret:decode", [str(bad)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    });
  }
});

describe("module", () => {
  test("both words have a doc string and the Encodings category", () => {
    for (const w of ["caret:encode", "caret:decode"]) {
      const meta = runtime.meta(w);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Encodings");
    }
  });
});
