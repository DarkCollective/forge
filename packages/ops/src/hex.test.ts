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

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hex"]));

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function decode(data: Uint8Array) {
  return runtime.call("hex:decode", [bytes(data)]);
}
async function encode(data: Uint8Array, delimiter = "none", letterCase = "lower") {
  return runtime.call("hex:encode", [bytes(data), str(delimiter), str(letterCase)]);
}
function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

describe("hex:encode", () => {
  test("two digits per byte", async () => {
    expect(top(await encode(ascii("foobar"))).v).toBe("666f6f626172");
  });

  test("the empty input", async () => {
    expect(top(await encode(new Uint8Array(0))).v).toBe("");
    expect(top(await encode(new Uint8Array(0), "colon")).v).toBe("");
  });

  test("delimiters", async () => {
    expect(top(await encode(ascii("foo"), "space")).v).toBe("66 6f 6f");
    expect(top(await encode(ascii("foo"), "colon")).v).toBe("66:6f:6f");
    expect(top(await encode(ascii("f"), "colon")).v).toBe("66");
  });

  test("upper case", async () => {
    expect(top(await encode(Uint8Array.of(0xff, 0x0a), "colon", "upper")).v).toBe("FF:0A");
    expect(top(await encode(Uint8Array.of(0xab), "none", "lower")).v).toBe("ab");
  });

  test("non-UTF-8 bytes", async () => {
    expect(top(await encode(Uint8Array.of(0x00, 0x80, 0xfe))).v).toBe("0080fe");
  });

  test("rejects a result over maxValueBytes", async () => {
    const small = assembleRuntime(await loadBundleNode(["hex"]), { limits: { maxValueBytes: 10 } });
    const r = await small.call("hex:encode", [bytes(ascii("abc")), str("none"), str("lower")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_VALUE");
  });

  test("64 KiB takes far fewer steps than the default limit of 10 million", async () => {
    const data = new Uint8Array(65536).map((_, i) => (i * 131 + (i >> 8)) & 255);
    for (const delimiter of ["none", "space", "colon"]) {
      const r = await encode(data, delimiter, "upper");
      expect(r.ok).toBe(true);
      expect(r.steps).toBeLessThan(1_000_000);
    }
    const back = await decode(ascii(String(top(await encode(data, "space")).v)));
    expect(top(back).v).toEqual(data);
    expect(back.steps).toBeLessThan(1000);
  });
});

describe("hex:decode", () => {
  test("pairs of digits, either case", async () => {
    const r = await decode(ascii("666F6f"));
    expect(top(r).v).toEqual(ascii("foo"));
  });

  test("ASCII white space between digits is ignored", async () => {
    expect(top(await decode(ascii("66 6F\n6f"))).v).toEqual(ascii("foo"));
    expect(top(await decode(ascii("\t6\r6\v\f"))).v).toEqual(ascii("f"));
    expect(top(await decode(ascii("6 6"))).v).toEqual(ascii("f"));
  });

  test("the empty input", async () => {
    expect(top(await decode(new Uint8Array(0))).v).toEqual(new Uint8Array(0));
    expect(top(await decode(ascii(" \n"))).v).toEqual(new Uint8Array(0));
  });

  test.each([
    ["6", "odd"],
    ["666", "odd"],
    ["zz", "non-hex"],
    ["6g", "non-hex"],
    ["0x66", "non-hex"],
  ])("%j is E_COERCE", async (input, why) => {
    const r = await decode(ascii(input));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.from).toBe("str");
      expect(r.error.detail.to).toBe("bytes");
      expect(r.error.message).toContain(why);
    }
  });

  test("a non-ASCII byte is E_COERCE", async () => {
    const r = await decode(Uint8Array.of(0xc3, 0xa9));
    expect(r.ok).toBe(false);
  });

  test("a digit in the upper-case range and a letter just outside it", async () => {
    expect(top(await decode(ascii("AF"))).v).toEqual(Uint8Array.of(0xaf));
    expect((await decode(ascii("AG"))).ok).toBe(false);
    expect((await decode(ascii("/0"))).ok).toBe(false);
    expect((await decode(ascii(":0"))).ok).toBe(false);
    expect((await decode(ascii("@0"))).ok).toBe(false);
  });
});

describe("module", () => {
  test("both words are in the vocabulary with doc and category", () => {
    for (const name of ["hex:decode", "hex:encode"]) {
      const meta = runtime.meta(name);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Encodings");
    }
  });

  test("the parameter help comes from vocab/hex.fth", () => {
    const meta = runtime.meta("hex:encode");
    expect(meta.params.map((p) => p.name)).toEqual(["delimiter", "case"]);
    expect(meta.params.every((p) => p.doc !== undefined)).toBe(true);
  });
});
