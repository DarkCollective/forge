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
 * Tests for the `netbios` vocabulary (vocab/netbios.fth, no primitives): Encode NetBIOS Name and Decode NetBIOS
 * Name. The op vectors (vocab/netbios.test.json) hold the cases computed in Python from RFC 1001 section 14.1; these
 * tests add every byte value, every offset, random names and the truncation of an encoded name at every length.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["netbios"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): number[] => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return [...(r.stack[r.stack.length - 1] as { v: Uint8Array }).v];
};
const encode = (data: number[], offset = 65) =>
  runtime.call("netbios:encode", [bytes(Uint8Array.from(data)), int(offset)]);
const decode = (data: number[], offset = 65) =>
  runtime.call("netbios:decode", [bytes(Uint8Array.from(data)), int(offset)]);
const text = (s: string) => [...new TextEncoder().encode(s)];

let seed = 0x7e11;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);

/** The definition of RFC 1001 section 14.1, written out once more here. */
function model(name: number[], offset: number): number[] {
  const padded = [...name, ...Array(16 - name.length).fill(0x20)];
  return padded.flatMap((b) => [(b >> 4) + offset, (b & 15) + offset]);
}

describe("NetBIOS first-level encoding", () => {
  test("every byte value, as the 16th byte of a name, at several offsets", async () => {
    for (const offset of [65, 97, 0, 48, 240]) {
      for (let b = 0; b < 256; b++) {
        const name = [...text("HOST"), ...Array(11).fill(0x20), b];
        const enc = out(await encode(name, offset));
        expect(enc).toEqual(model(name, offset));
        // a trailing 0x20 is the padding and is taken off again; any other last byte stays
        const back = out(await decode(enc, offset));
        expect(back).toEqual(b === 0x20 ? text("HOST") : name);
      }
    }
  });

  test("random names of 0 to 16 bytes round trip, up to the padding", async () => {
    for (let i = 0; i < 200; i++) {
      const len = below(17);
      const name = Array.from({ length: len }, () => 1 + below(255)).map((b) =>
        b === 0x20 ? 0x41 : b,
      );
      const enc = out(await encode(name));
      expect(enc.length).toBe(32);
      expect(enc).toEqual(model(name, 65));
      expect(out(await decode(enc))).toEqual(len === 0 ? [0x20] : name);
    }
  });

  test("a name cut at every length: only even lengths up to 32 decode", async () => {
    const enc = out(await encode(text("WORKGROUP")));
    for (let cut = 0; cut <= enc.length + 2; cut++) {
      const piece = enc.concat([65, 65]).slice(0, cut);
      const r = await decode(piece);
      if (cut % 2 === 0 && cut <= 32) expect(r.ok, `cut ${cut}`).toBe(true);
      else expect(code(r), `cut ${cut}`).toBe("E_COERCE");
    }
  });

  test("hostile input: a long name is refused before anything is built", async () => {
    expect(code(await encode(Array(65536).fill(65)))).toBe("E_RANGE");
    expect(code(await decode(Array(65536).fill(65)))).toBe("E_COERCE");
    expect(code(await decode(Array(65536).fill(0)))).toBe("E_COERCE");
    const r = await decode(Array(32).fill(0xff));
    expect(code(r)).toBe("E_COERCE");
  });

  test("the offset bounds", async () => {
    expect(code(await encode(text("A"), 240))).toBe("ok");
    expect(code(await encode(text("A"), 241))).toBe("E_RANGE");
    expect(code(await encode(text("A"), -1))).toBe("E_RANGE");
    expect(code(await decode(text("AA"), 241))).toBe("E_RANGE");
    expect(code(await decode(text("AA"), -5))).toBe("E_RANGE");
    expect(out(await decode(Array(32).fill(240 + 15), 240))).toEqual(Array(16).fill(0xff));
  });
});
