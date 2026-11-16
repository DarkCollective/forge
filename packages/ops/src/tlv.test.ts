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
 * Tests for the `tlv` vocabulary (vocab/tlv.fth, all FL). The op vectors (vocab/tlv.test.json) hold
 * elements assembled with Python's int.to_bytes; these tests add the cut points (a cut at the end of an element is
 * a shorter, valid run), mutated bytes, hostile lengths, round trips over random element lists and the cost at
 * 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import {
  asBytes,
  code,
  cutPoints,
  message,
  mutations,
  rng,
  steps,
  text,
} from "./data-format-test.js";
import { loadBundleNode } from "./sources-node.js";

const { int, bool } = valueHelpers;
const bundle = await loadBundleNode(["tlv"]);
const runtime = assembleRuntime(bundle);

const parse = (d: Uint8Array, tag = 1, len = 1, ber = false, indent = 0) =>
  runtime.call("tlv:parse", [asBytes(d), int(tag), int(len), bool(ber), int(indent)]);

function build(
  elems: [number, Uint8Array][],
  tw: number,
  lw: number,
  ber: boolean,
): { data: Uint8Array; ends: number[] } {
  const out: number[] = [];
  const ends: number[] = [0];
  for (const [tag, val] of elems) {
    for (let i = tw - 1; i >= 0; i--) out.push(Math.floor(tag / 256 ** i) % 256);
    if (ber) {
      if (val.length < 128) out.push(val.length);
      else {
        const nb = val.length > 0xffff ? 3 : val.length > 0xff ? 2 : 1;
        out.push(0x80 | nb);
        for (let i = nb - 1; i >= 0; i--) out.push(Math.floor(val.length / 256 ** i) % 256);
      }
    } else for (let i = 0; i < lw; i++) out.push(Math.floor(val.length / 256 ** i) % 256);
    out.push(...val);
    ends.push(out.length);
  }
  return { data: Uint8Array.from(out), ends };
}

describe("parse", () => {
  test("random element lists round trip for several widths and BER lengths", async () => {
    const rand = rng(58);
    for (const [tw, lw, ber] of [
      [1, 1, false],
      [2, 2, false],
      [3, 4, false],
      [1, 8, false],
      [1, 1, true],
      [2, 1, true],
    ] as const) {
      const elems: [number, Uint8Array][] = Array.from({ length: 40 }, () => [
        Math.floor(rand() * 256 ** Math.min(tw, 3)),
        Uint8Array.from({ length: Math.floor(rand() * (ber ? 300 : lw === 1 ? 250 : 400)) }, () =>
          Math.floor(rand() * 256),
        ),
      ]);
      const { data } = build(elems, tw, lw, ber);
      const got = JSON.parse(text(await parse(data, tw, lw, ber))) as {
        key: number[];
        length: number;
        value: number[];
      }[];
      expect(got).toHaveLength(elems.length);
      got.forEach((g, i) => {
        const [tag, val] = elems[i] as [number, Uint8Array];
        expect(g.key.map((x) => x.toString(16).padStart(2, "0")).join("")).toBe(
          tag.toString(16).padStart(tw * 2, "0"),
        );
        expect(g.length).toBe(val.length);
        expect(g.value).toEqual(Array.from(val));
      });
    }
  });
  test("every cut point is E_COERCE except the ends of whole elements", async () => {
    for (const [tw, lw, ber] of [
      [1, 1, false],
      [2, 2, false],
      [1, 1, true],
    ] as const) {
      const elems: [number, Uint8Array][] = [
        [1, Uint8Array.of(1, 2, 3)],
        [2, new Uint8Array(0)],
        [3, new Uint8Array(200).fill(7)],
        [4, Uint8Array.of(9)],
      ];
      const { data, ends } = build(elems, tw, lw, ber);
      const bad = await cutPoints(data, (d) => parse(d, tw, lw, ber));
      expect(bad.map((b) => b.cut)).toEqual(ends.slice(0, -1));
      expect(bad.every((b) => b.code === "ok")).toBe(true);
    }
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    const { data } = build(
      [
        [1, Uint8Array.of(1, 2, 3)],
        [2, new Uint8Array(0)],
        [3, new Uint8Array(200).fill(7)],
      ],
      1,
      1,
      true,
    );
    expect(
      await mutations(data, (d) => parse(d, 1, 1, true), [0x00, 0x7f, 0x80, 0x81, 0x84, 0xff]),
    ).toEqual([]);
  });
  test("a hostile length allocates nothing", async () => {
    const t0 = Date.now();
    for (const [h, lw, ber] of [
      ["01ffffffffffffffff", 8, false],
      ["0101ffffffff", 4, false],
      ["01 86 ffffffffffff".replace(/ /g, ""), 1, true],
    ] as const) {
      const d = Uint8Array.from(h.match(/../g)?.map((x) => Number.parseInt(x, 16)) ?? []);
      const r = await parse(d, 1, lw, ber);
      expect(code(r)).toBe("E_COERCE");
      expect(message(r)).toContain("truncated");
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  test("the widths are checked", async () => {
    expect(code(await parse(new Uint8Array(2), 0, 0))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 0, 1))).toBe("ok");
    expect(code(await parse(new Uint8Array(2), 17, 1))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 1, -1))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 1, 9))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 1, 1, false, 33))).toBe("E_RANGE");
  });
  test("the value budget stops a result that is too big", async () => {
    const { data } = build(
      Array.from({ length: 5000 }, () => [1, Uint8Array.of(1)] as [number, Uint8Array]),
      1,
      1,
      false,
    );
    const r = await runtime.call(
      "tlv:parse",
      [asBytes(data), int(1), int(1), bool(false), int(0)],
      { limits: { maxValueBytes: 100_000 } },
    );
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});

// The walk over the elements used to be a primitive, because growing the result a record at a time was quadratic.
// The collector makes it linear: about 60 to 70 steps per element. 64 KiB of the smallest elements, under the untrusted
// limits of the worker (UNTRUSTED_LIMITS: 5 million steps, 256 MiB in total).
describe("cost at 64 KiB under the untrusted limits", () => {
  const strict = assembleRuntime(bundle, {
    limits: {
      maxSteps: 5_000_000,
      maxDataDepth: 10_000,
      maxValueBytes: 16 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
      maxIntBits: 16_384,
      maxMillis: 10_000,
    },
  });
  async function measure(
    label: string,
    data: Uint8Array,
    tw: number,
    lw: number,
    ber: boolean,
    count: number,
    bound: number,
  ) {
    const t0 = Date.now();
    const r = await strict.call("tlv:parse", [asBytes(data), int(tw), int(lw), bool(ber), int(0)]);
    const ms = Date.now() - t0;
    expect(code(r)).toBe("ok");
    expect(JSON.parse(text(r))).toHaveLength(count);
    process.stderr.write(
      `\ntlv ${label}: ${data.length} bytes, ${count} elements: ${steps(r)} steps ${ms} ms\n`,
    );
    expect(steps(r)).toBeLessThan(bound);
  }

  test(
    "65,535 bytes of elements with a one-byte value (tag, length, value)",
    { timeout: 60_000 },
    async () => {
      const elems = Array.from(
        { length: 21_845 },
        (_, i) => [i % 256, Uint8Array.of(i % 251)] as [number, Uint8Array],
      );
      const { data } = build(elems, 1, 1, false);
      // Measured 1.53 million steps.
      await measure("one-byte values", data, 1, 1, false, 21_845, 1_800_000);
    },
  );

  test("64 KiB of elements with no value (tag, length 0)", { timeout: 60_000 }, async () => {
    const elems = Array.from(
      { length: 32_768 },
      (_, i) => [i % 256, new Uint8Array(0)] as [number, Uint8Array],
    );
    const { data } = build(elems, 1, 1, false);
    // Measured 2.29 million steps.
    await measure("empty values", data, 1, 1, false, 32_768, 2_700_000);
  });

  test(
    "64 KiB of one-byte elements (length 0, no tag), fixed and BER lengths",
    { timeout: 60_000 },
    async () => {
      // The smallest element a run can have: no tag and a length byte of 0.
      const data = new Uint8Array(65_536);
      // Measured 4.00 million (fixed) and 4.39 million (BER) steps; the limit is 5 million.
      await measure("length-only", data, 0, 1, false, 65_536, 4_700_000);
      await measure("length-only BER", data, 0, 1, true, 65_536, 4_700_000);
    },
  );
});
