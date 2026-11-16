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
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base64"]));
const enc = (s: string) => ascii(s);

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const text = (b: Uint8Array) => String.fromCharCode(...b);

async function decode(data: Uint8Array, alphabet = "standard") {
  return runtime.call("base64:decode", [bytes(data), str(alphabet)]);
}
async function encode(data: Uint8Array, alphabet = "standard", padding = true) {
  return runtime.call("base64:encode", [bytes(data), str(alphabet), bool(padding)]);
}
function stackTop(r: { ok: boolean; stack: readonly Value[] }): Value | undefined {
  return r.stack[r.stack.length - 1];
}

const RFC4648 = [
  ["", ""],
  ["f", "Zg=="],
  ["fo", "Zm8="],
  ["foo", "Zm9v"],
  ["foob", "Zm9vYg=="],
  ["fooba", "Zm9vYmE="],
  ["foobar", "Zm9vYmFy"],
] as const;

describe("base64:encode", () => {
  test.each(RFC4648)("RFC 4648 section 10: %j", async (plain, coded) => {
    const r = await encode(enc(plain));
    expect(r.ok).toBe(true);
    expect(stackTop(r)).toEqual(str(coded));
  });

  test("padding false omits the =", async () => {
    expect(stackTop(await encode(enc("f"), "standard", false))).toEqual(str("Zg"));
    expect(stackTop(await encode(enc("fo"), "standard", false))).toEqual(str("Zm8"));
    expect(stackTop(await encode(enc("foo"), "standard", false))).toEqual(str("Zm9v"));
  });

  test("the url alphabet uses - and _", async () => {
    expect(stackTop(await encode(Uint8Array.of(0xfb, 0xff), "url"))).toEqual(str("-_8="));
    expect(stackTop(await encode(Uint8Array.of(0xfb, 0xff)))).toEqual(str("+/8="));
  });

  test("a large input is encoded in chunks", async () => {
    const data = new Uint8Array(100_000).map((_, i) => i % 251);
    const r = await encode(data);
    const back = await decode(ascii((stackTop(r) as { v: string }).v));
    expect((stackTop(back) as { v: Uint8Array }).v).toEqual(data);
  });

  test("does not return an alias of its argument and rejects an oversize result", async () => {
    const small = assembleRuntime(await loadBundleNode(["base64"]), {
      limits: { maxValueBytes: 10000 },
    });
    const ok = await small.call("base64:encode", [bytes(enc("foo")), str("standard"), bool(true)]);
    expect(ok.ok).toBe(true);
    const r = await small.call("base64:encode", [
      bytes(new Uint8Array(6000)),
      str("standard"),
      bool(true),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_VALUE");
  });

  test("64 KiB takes far fewer steps than the default limit of 10 million", async () => {
    const data = new Uint8Array(65536).map((_, i) => (i * 131 + (i >> 8)) & 255);
    for (const alphabet of ["standard", "url"]) {
      const r = await encode(data, alphabet, alphabet === "standard");
      expect(r.ok).toBe(true);
      expect(r.steps).toBeLessThan(2_000_000);
      const back = await decode(ascii(String((stackTop(r) as { v: string }).v)), alphabet);
      expect((stackTop(back) as { v: Uint8Array }).v).toEqual(data);
      expect(back.steps).toBeLessThan(2_000_000);
    }
  });
});

describe("base64:decode", () => {
  test.each(RFC4648)("RFC 4648 section 10: %j", async (plain, coded) => {
    const r = await decode(ascii(coded));
    expect(r.ok).toBe(true);
    expect(text((stackTop(r) as { v: Uint8Array }).v)).toBe(plain);
  });

  test("padding is optional", async () => {
    expect(text((stackTop(await decode(ascii("Zg"))) as { v: Uint8Array }).v)).toBe("f");
    expect(text((stackTop(await decode(ascii("Zm8"))) as { v: Uint8Array }).v)).toBe("fo");
  });

  test("ASCII white space is ignored", async () => {
    const r = await decode(ascii("Zm9v\nYmFy"));
    expect(text((stackTop(r) as { v: Uint8Array }).v)).toBe("foobar");
    const spaced = await decode(ascii(" Z g\t= =\r\v\f"));
    expect(text((stackTop(spaced) as { v: Uint8Array }).v)).toBe("f");
  });

  test("the url alphabet", async () => {
    const r = await decode(ascii("-_8"), "url");
    expect((stackTop(r) as { v: Uint8Array }).v).toEqual(Uint8Array.of(0xfb, 0xff));
  });

  test("url characters in the standard alphabet are E_COERCE", async () => {
    const r = await decode(ascii("-_8"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.from).toBe("str");
      expect(r.error.detail.to).toBe("bytes");
      expect(String(r.error.detail.reason)).toContain("alphabet");
    }
  });

  test.each([
    ["Zg=", "padding"],
    ["Zh==", "non-zero bits"],
    ["Zm9=", "non-zero bits"],
    ["Z", "single character"],
    ["Zm9v!", "alphabet"],
    ["Zg=a", "after the padding"],
    ["Zg===", "padding"],
    ["Zm9v====", "padding"],
    ["Zm9vZ===", "single"],
  ])("%j is E_COERCE (%s)", async (input, why) => {
    const r = await decode(ascii(input));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(String(r.error.detail.reason)).toContain(why);
    }
  });

  test("a byte above 0x7f is not in the alphabet", async () => {
    const r = await decode(Uint8Array.of(0xc3, 0xa9));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(String(r.error.detail.reason)).toContain("0xc3");
  });

  test("an empty input decodes to nothing", async () => {
    const r = await decode(new Uint8Array(0));
    expect((stackTop(r) as { v: Uint8Array }).v).toEqual(new Uint8Array(0));
  });

  test("any padding-free length except 1 mod 4 round-trips", async () => {
    for (let n = 0; n < 40; n++) {
      const data = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      for (const alphabet of ["standard", "url"]) {
        for (const padding of [true, false]) {
          const coded = stackTop(await encode(data, alphabet, padding)) as { v: string };
          const back = await decode(ascii(coded.v), alphabet);
          expect((stackTop(back) as { v: Uint8Array }).v).toEqual(data);
        }
      }
    }
  });
});

describe("module", () => {
  test("both words are in the vocabulary with doc and category", () => {
    for (const name of ["base64:decode", "base64:encode"]) {
      const meta = runtime.meta(name);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Encodings");
    }
  });

  test("the parameter help comes from vocab/base64.fth", () => {
    const meta = runtime.meta("base64:encode");
    expect(meta.params.map((p) => p.doc)).toEqual([
      "The alphabet to use: standard (+ /) or url (- _).",
      "Append = padding to a multiple of four characters.",
    ]);
  });
});
