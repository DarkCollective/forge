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
 * Tests for the `tlv` vocabulary (vocab/tlv.fth, src/prims/tlv.ts). The op vectors (vocab/tlv.test.json) hold
 * elements assembled with Python's int.to_bytes; these tests add the cut points (a cut at the end of an element is
 * a shorter, valid run), mutated bytes, hostile lengths, round trips over random element lists and the cost at
 * 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import {
  asBytes,
  code,
  cutPoints,
  loadRuntime,
  message,
  mutations,
  rng,
  steps,
  text,
} from "./data-format-test.js";

const { int, bool } = valueHelpers;
const runtime = await loadRuntime(["tlv"]);

const parse = (d: Uint8Array, tag = 1, len = 1, ber = false, indent = 0) =>
  runtime.call("tlv:parse", [asBytes(d), int(tag), int(len), bool(ber), int(indent)]);

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
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
    } else for (let i = lw - 1; i >= 0; i--) out.push(Math.floor(val.length / 256 ** i) % 256);
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
        type: string;
        length: number;
        value: string;
      }[];
      expect(got).toHaveLength(elems.length);
      got.forEach((g, i) => {
        const [tag, val] = elems[i] as [number, Uint8Array];
        expect(g.type).toBe(tag.toString(16).padStart(tw * 2, "0"));
        expect(g.length).toBe(val.length);
        expect(g.value).toBe(hex(val));
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
    expect(code(await parse(new Uint8Array(2), 0, 1))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 17, 1))).toBe("E_RANGE");
    expect(code(await parse(new Uint8Array(2), 1, 0))).toBe("E_RANGE");
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

describe("cost at 64 KiB", () => {
  test("about 64 KiB of elements", { timeout: 60_000 }, async () => {
    const elems = Array.from(
      { length: 16_400 },
      (_, i) => [i % 256, Uint8Array.of(i % 251, 7)] as [number, Uint8Array],
    );
    const { data } = build(elems, 1, 1, false);
    expect(data.length).toBeGreaterThan(64 * 1024);
    const t0 = Date.now();
    const r = await parse(data, 1, 1, false, 0);
    const ms = Date.now() - t0;
    expect(JSON.parse(text(r))).toHaveLength(16_400);
    expect(steps(r)).toBeLessThan(100);
    process.stderr.write(
      `\ntlv ${data.length} bytes, 16,400 elements: ${steps(r)} steps ${ms} ms\n`,
    );
  });
});
