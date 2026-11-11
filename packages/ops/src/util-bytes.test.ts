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
// The util words promoted at the wave 6 close-out: text-lossless, le-int, need-bytes, names-of and pick-named.
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str, bytes, list, record } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode("all"));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => r.stack[r.stack.length - 1] as Value;

async function value(qname: string, args: Value[]): Promise<unknown> {
  const r = await runtime.call(qname, args);
  expect(r.ok).toBe(true);
  return (top(r) as { v: unknown }).v;
}

describe("util:text-lossless", () => {
  const text = async (b: number[]) =>
    await value("util:text-lossless", [bytes(Uint8Array.from(b))]);

  test("valid UTF-8 is decoded as UTF-8", async () => {
    expect(await text([0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac])).toBe("aé€");
    expect(await text([])).toBe("");
  });

  test("anything else is read as Latin-1, byte for byte", async () => {
    expect(await text([0x61, 0xe9])).toBe("aé");
    expect(await text([0xff, 0xfe, 0x80])).toBe("ÿþ\u0080");
    expect(await text([0xc3])).toBe("Ã");
  });
});

describe("util:le-int and util:need-bytes", () => {
  const data = bytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 255]));
  const le = async (p: number, n: number) =>
    BigInt((await value("util:le-int", [data, int(p), int(n)])) as number | bigint);

  test("reads n little-endian bytes at p", async () => {
    expect(await le(0, 1)).toBe(1n);
    expect(await le(0, 2)).toBe(0x0201n);
    expect(await le(0, 4)).toBe(0x04030201n);
    expect(await le(4, 4)).toBe(0x08070605n);
    expect(await le(0, 8)).toBe(0x0807060504030201n);
    expect(await le(1, 8)).toBe(0xff08070605040302n);
    expect(await le(3, 0)).toBe(0n);
  });

  test("need-bytes passes when the bytes are there and names the data when they are not", async () => {
    const ok = await runtime.call("util:need-bytes", [data, int(5), int(4), str("test data")]);
    expect(ok.ok).toBe(true);
    const bad = await runtime.call("util:need-bytes", [data, int(6), int(4), str("test data")]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe("E_COERCE");
      expect(bad.error.message).toContain("test data is cut short");
    }
  });
});

describe("util:names-of and util:pick-named", () => {
  const rec = (name: string, n: number): Value =>
    record([
      ["name", str(name)],
      ["n", int(n)],
    ]);
  const many = list(["a", "b", "c", "b", "d", "e", "f", "g", "h", "i"].map((s, i) => rec(s, i)));

  test("names-of lists the name fields in order", async () => {
    const r = await runtime.call("util:names-of", [list([rec("x", 1), rec("y", 2)])]);
    expect(r.ok).toBe(true);
    const items = (top(r) as unknown as { v: { v: string }[] }).v.map((x) => x.v);
    expect(items).toEqual(["x", "y"]);
  });

  test("pick-named gives the first record of that name", async () => {
    const r = await runtime.call("util:pick-named", [many, str("b")]);
    expect(r.ok).toBe(true);
    const n = (top(r) as unknown as { v: Map<string, { v: unknown }> }).v.get("n");
    expect(BigInt(n?.v as number | bigint)).toBe(1n);
  });

  test("a missing name is E_RANGE and the message lists the first eight names", async () => {
    const r = await runtime.call("util:pick-named", [many, str("zz")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_RANGE");
      expect(r.error.message).toContain(
        "no entry named zz, the first entries are: a, b, c, b, d, e, f, g",
      );
      expect(r.error.message).not.toContain(", h");
    }
  });

  test("an empty list says there are no entries", async () => {
    const r = await runtime.call("util:pick-named", [list([]), str("q")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_RANGE");
      expect(r.error.message).toContain("there are no entries, so there is no entry named q");
    }
  });
});
