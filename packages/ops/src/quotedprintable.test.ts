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

// quotedprintable is FL (vocab/quotedprintable.fth); these tests drive its public words.
const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["quotedprintable"]));

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

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

async function roundTrip(data: Uint8Array): Promise<{ text: string; back: unknown }> {
  const enc = await runtime.call("quotedprintable:encode", [bytes(data)]);
  expect(enc.ok).toBe(true);
  const text = top(enc).v as string;
  const dec = await runtime.call("quotedprintable:decode", [bytes(ascii(text))]);
  expect(dec.ok).toBe(true);
  return { text, back: top(dec).v };
}

/** The output of encode is 7-bit, and no line (CRLF or LF) is longer than 76 characters. */
function checkShape(text: string): void {
  const sevenBit = [...text].every((c) => "\t\n\r".includes(c) || (c >= " " && c <= "~"));
  expect(sevenBit).toBe(true);
  for (const line of text.split(/\r?\n/)) expect(line.length).toBeLessThanOrEqual(76);
}

describe("quotedprintable round trip", () => {
  test("decode(encode(x)) == x for random bytes, with line breaks and white space", async () => {
    const next = rng(11);
    // Bias the alphabet to the interesting bytes: =, CR, LF, space, tab, high bytes, letters.
    const pool = [61, 13, 10, 32, 9, 0, 255, 200, 65, 66, 67, 97];
    for (let trial = 0; trial < 120; trial++) {
      const data = Uint8Array.from({ length: Math.floor(next() * 200) }, () =>
        next() < 0.7
          ? (pool[Math.floor(next() * pool.length)] as number)
          : Math.floor(next() * 256),
      );
      const { text, back } = await roundTrip(data);
      checkShape(text);
      expect(back).toEqual(data);
    }
  });

  test("long lines of random printable text round trip within 76 characters", async () => {
    const next = rng(23);
    for (let trial = 0; trial < 30; trial++) {
      const data = Uint8Array.from({ length: 100 + Math.floor(next() * 600) }, () =>
        next() < 0.1 ? 61 : 32 + Math.floor(next() * 95),
      );
      const { text, back } = await roundTrip(data);
      checkShape(text);
      expect(back).toEqual(data);
    }
  });

  test("64 KiB of binary and of text round trip", async () => {
    const binary = Uint8Array.from({ length: 65536 }, (_, i) => (i * 2654435761) >>> 24);
    const textual = Uint8Array.from({ length: 65536 }, (_, i) => 32 + ((i * 7) % 95));
    for (const data of [binary, textual]) {
      const { text, back } = await roundTrip(data);
      checkShape(text);
      expect(back).toEqual(data);
    }
  }, 60_000);
});

describe("quotedprintable:encode line rules", () => {
  async function enc(s: string): Promise<string> {
    return top(await runtime.call("quotedprintable:encode", [bytes(ascii(s))])).v as string;
  }

  test("a trailing space is encoded, an inner one is not", async () => {
    expect(await enc("a b ")).toBe("a b=20");
  });

  test("a lone CR is =0D and a CRLF is kept", async () => {
    expect(await enc("a\rb\r\nc")).toBe("a=0Db\r\nc");
  });

  test("white space before a line break is encoded", async () => {
    expect(await enc(" \t\r\n \n")).toBe(" =09\r\n=20\n");
  });

  test("a cut never falls inside an =XX", async () => {
    for (let n = 70; n < 80; n++) {
      const text = await enc("A".repeat(n) + "=".repeat(5));
      for (const piece of text.split("=\r\n")) expect(piece).not.toMatch(/=[0-9A-F]?$/);
      checkShape(text);
    }
  });
});

describe("quotedprintable:decode rules", () => {
  async function dec(s: string): Promise<{ ok: boolean; v?: unknown; code?: string }> {
    const r = await runtime.call("quotedprintable:decode", [bytes(ascii(s))]);
    return r.ok ? { ok: true, v: top(r).v } : { ok: false, code: r.error.code };
  }

  test("trailing white space is removed, white space before a soft break is kept", async () => {
    expect(await dec("a \r\n")).toEqual({ ok: true, v: ascii("a\r\n") });
    expect(await dec("a =\r\nb")).toEqual({ ok: true, v: ascii("a b") });
  });

  test("a soft break may be followed by transport padding", async () => {
    expect(await dec("a= \r\nb")).toEqual({ ok: true, v: ascii("ab") });
  });

  test("malformed = is E_COERCE", async () => {
    for (const bad of ["=", "x=g1", "=4", "= 41", "=-1", "=\rA"]) {
      const r = await dec(bad === "=" ? "==" : bad);
      expect(r).toEqual({ ok: false, code: "E_COERCE" });
    }
  });
});

describe("module", () => {
  test("both words have a doc string and the Encodings category", () => {
    for (const w of ["quotedprintable:encode", "quotedprintable:decode"]) {
      const meta = runtime.meta(w);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Encodings");
    }
  });
});
