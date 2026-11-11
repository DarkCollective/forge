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
 * Tests for the `plist` vocabulary (vocab/plist.fth, src/prims/plist.ts). The op vectors (vocab/plist.test.json)
 * hold property lists written by Python's plistlib in both forms; these tests add truncation at every cut point,
 * mutated bytes, hostile counts and offsets, nesting, the value budget and the cost at 64 KiB.
 */
import { describe, expect, test } from "vitest";
import {
  asBytes,
  code,
  cutPoints,
  fromHex,
  loadRuntime,
  message,
  mutations,
  steps,
  text,
} from "./data-format-test.js";

const runtime = await loadRuntime(["plist"]);

const view = (d: Uint8Array, limits?: { maxValueBytes: number }) =>
  runtime.call("plist:view", [asBytes(d)], limits === undefined ? undefined : { limits });
const xml = (s: string) => new TextEncoder().encode(s);

// python plistlib.dumps({"a":[1,2.5,"x",True,datetime(2020,1,2,3,4,5)],"b":{"c":b"\0\1","d":"é€"}}, fmt=FMT_BINARY, sort_keys=False)
const BINARY = fromHex(
  "62706c6973743030d20102030951615162a5040506070810012340040000000000005178093341c1deca92800000d20a0b0c0d516351644200016200e920ac080d0f1117192224252e3335373a0000000000000101000000000000000e0000000000000000000000000000003f",
);
const OUTLINE =
  'plist => {\n\ta => [\n\t\t0 => 1\n\t\t1 => 2.5\n\t\t2 => "x"\n\t\t3 => true\n\t\t4 => 2020-01-02T03:04:05Z\n\t]\n\tb => {\n\t\tc => AAE=\n\t\td => "é€"\n\t}\n}\n/plist\n';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>a</key><array><integer>1</integer><real>2.5</real><string>x</string><true/><date>2020-01-02T03:04:05Z</date></array>
<key>b</key><dict><key>c</key><data>AAE=</data><key>d</key><string>é€</string></dict></dict></plist>`;

describe("view", () => {
  test("the same outline from the XML and the binary form", async () => {
    expect(text(await view(BINARY))).toBe(OUTLINE);
    expect(text(await view(xml(XML)))).toBe(OUTLINE);
  });
  test("every cut point of the binary list is E_COERCE", async () => {
    expect(await cutPoints(BINARY, (d) => view(d))).toEqual([]);
  });
  test("every cut point of the XML list is E_COERCE", async () => {
    const bad: number[] = [];
    const data = xml(XML);
    for (let cut = 0; cut < data.length; cut++) {
      // a cut in the middle of a UTF-8 character is invalid text, which is E_COERCE too
      const c = code(await view(data.subarray(0, cut)));
      if (c !== "E_COERCE") bad.push(cut);
    }
    expect(bad).toEqual([]);
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    expect(
      await mutations(BINARY, (d) => view(d), [0x00, 0x01, 0x08, 0x7f, 0xa0, 0xd0, 0xff]),
    ).toEqual([]);
    expect(await mutations(xml(XML), (d) => view(d), [0x00, 0x3c, 0x3e, 0x26, 0x2f, 0xff])).toEqual(
      [],
    );
  });
  test("hostile counts and offsets in a binary list allocate nothing", async () => {
    const trailer = (objs: number, top: number, table: number, offSize = 1, refSize = 1) => {
      const t = new Uint8Array(32);
      t[6] = offSize;
      t[7] = refSize;
      new DataView(t.buffer).setBigUint64(8, BigInt(objs));
      new DataView(t.buffer).setBigUint64(16, BigInt(top));
      new DataView(t.buffer).setBigUint64(24, BigInt(table));
      return t;
    };
    const mk = (body: number[], table: number[], t: Uint8Array) =>
      Uint8Array.from([...xml("bplist00"), ...body, ...table, ...t]);
    // a dictionary of 2^32-1 entries, an array of 2^32-1 items, a string of 2^32-1 bytes, data of 2^32-1 bytes
    for (const head of [
      [0xdf, 0x12, 0xff, 0xff, 0xff, 0xff],
      [0xaf, 0x12, 0xff, 0xff, 0xff, 0xff],
      [0x5f, 0x12, 0xff, 0xff, 0xff, 0xff],
      [0x4f, 0x12, 0xff, 0xff, 0xff, 0xff],
      [0x6f, 0x12, 0xff, 0xff, 0xff, 0xff],
    ]) {
      const t0 = Date.now();
      const r = await view(mk(head, [8], trailer(1, 0, 8 + head.length)));
      expect(code(r)).toBe("E_COERCE");
      expect(message(r)).toContain("truncated");
      expect(Date.now() - t0).toBeLessThan(2000);
    }
    expect(code(await view(mk([0x08], [8], trailer(1, 0, 9, 1, 0))))).toBe("E_COERCE");
    expect(code(await view(mk([0x08], [200], trailer(1, 0, 9))))).toBe("E_COERCE");
    expect(code(await view(mk([0x08], [8], trailer(2 ** 40, 0, 9))))).toBe("E_COERCE");
    expect(text(await view(mk([0x08], [8], trailer(1, 0, 9))))).toBe("plist => false\n/plist\n");
  });
  test("a million nested arrays stop at the depth limit", async () => {
    const r = await view(xml(`<plist>${"<array>".repeat(500_000)}`));
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("deeper than 64");
  });
  test("the value budget stops a result that is too big", async () => {
    const big = xml(`<plist><array>${"<integer>1</integer>".repeat(20_000)}</array></plist>`);
    expect(code(await view(big, { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await view(big))).toBe("ok");
  });
  test("XML details: byte order mark, CDATA, comments and character references", async () => {
    expect(
      text(
        await view(
          xml("\ufeff<plist><string><![CDATA[a<b]]>&#x41;&amp;<!-- c -->z</string></plist>"),
        ),
      ),
    ).toBe('plist => "a<bA&z"\n/plist\n');
    expect(code(await view(new Uint8Array([0xff, 0xfe, 0x3c])))).toBe("E_COERCE");
  });
});

describe("cost at 64 KiB", () => {
  test("about 64 KiB of XML", { timeout: 60_000 }, async () => {
    const items = Array.from(
      { length: 1500 },
      (_, i) =>
        `<key>key ${i}</key><dict><key>n</key><integer>${i}</integer><key>s</key><string>text &amp; ${i}</string></dict>`,
    ).join("");
    const d = xml(`<plist><dict>${items}</dict></plist>`);
    expect(d.length).toBeGreaterThan(64 * 1024);
    const t0 = Date.now();
    const r = await view(d);
    const ms = Date.now() - t0;
    expect(text(r).split("\n")).toHaveLength(1500 * 4 + 4);
    expect(steps(r)).toBeLessThan(100);
    process.stderr.write(`\nplist ${d.length} bytes of XML: ${steps(r)} steps ${ms} ms\n`);
  });
});
