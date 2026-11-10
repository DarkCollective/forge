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

// hexcontent is FL (vocab/hexcontent.fth); these tests drive its public words through the runtime.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hexcontent"]));

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

describe("hexcontent round trip", () => {
  test("decode(encode(x)) == x for random bytes, both scopes", async () => {
    const next = rng(31);
    for (let trial = 0; trial < 60; trial++) {
      const data = Uint8Array.from({ length: Math.floor(next() * 50) }, () =>
        // Half printable ASCII (including the special ones) so literal runs and hex runs mix.
        next() < 0.5 ? 0x20 + Math.floor(next() * 95) : Math.floor(next() * 256),
      );
      for (const scope of ["non-printable", "all"]) {
        const enc = await runtime.call("hexcontent:encode", [bytes(data), str(scope)]);
        expect(enc.ok).toBe(true);
        const text = top(enc).v as string;
        expect(text.includes("||")).toBe(false);
        expect((text.match(/\|/g) ?? []).length % 2).toBe(0);
        const dec = await runtime.call("hexcontent:decode", [str(text)]);
        expect(dec.ok).toBe(true);
        expect(top(dec).v).toEqual(data);
      }
    }
  });

  test("adjacent hex bytes share one section", async () => {
    const enc = await runtime.call("hexcontent:encode", [
      bytes(Uint8Array.of(0x41, 0x00, 0x01, 0x7c, 0x42)),
      str("non-printable"),
    ]);
    expect(top(enc).v).toBe("A|00 01 7C|B");
  });

  test("64 KiB round trip", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 2654435761) >>> 24);
    const enc = await runtime.call("hexcontent:encode", [bytes(data), str("non-printable")]);
    const dec = await runtime.call("hexcontent:decode", [str(top(enc).v as string)]);
    expect(top(dec).v).toEqual(data);
  }, 60_000);
});

describe("hexcontent:decode errors", () => {
  for (const bad of ["abc|41", "|4|", "|zz|", "|41|b|"]) {
    test(`${JSON.stringify(bad)} is E_COERCE`, async () => {
      const r = await runtime.call("hexcontent:decode", [str(bad)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    });
  }
});

describe("module", () => {
  test("the scope parameter has help and a default", () => {
    const meta = runtime.meta("hexcontent:encode");
    expect(meta.params.map((p) => p.name)).toEqual(["scope"]);
    expect(meta.params[0]?.doc).toBeTruthy();
    expect(meta.params[0]?.default).toBe("non-printable");
  });
});
