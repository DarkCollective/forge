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
 * Tests for the `exif` vocabulary (vocab/exif.fth): Extract EXIF. The samples (src/fixtures/exif.json)
 * come from a small TIFF writer in Python that follows the TIFF 6 and Exif 2.32 layouts (both byte
 * orders, IFD0, the Exif IFD with the Interoperability IFD, the GPS IFD and the thumbnail IFD, every
 * value type the op reads) and were read back with Pillow's `Image.Exif` (little and big endian give
 * the same values, each value as written); the PNG, WebP and JPEG containers are written by Pillow
 * itself (`save(..., exif=...)`). The expected text is formatted by Python from the values that went
 * into the writer, never from this op's output. Tag names are Pillow's ExifTags. Also here: no Exif
 * block, every cut point, counts and offsets that lie, mutated files, 1,000 tags and a JPEG of fill
 * bytes with the VM step counts.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import fixtures from "./fixtures/exif.json";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["exif"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const textOf = (r: Result) => (top(r) as { v: string }).v;
const extract = (d: Uint8Array) => runtime.call("exif:extract", [bytes(d)]);
const fx = fixtures as unknown as Record<string, string>;
const sample = (name: string) => Uint8Array.from(Buffer.from(fx[name] as string, "hex"));
const text = (s: string) => new TextEncoder().encode(s);
const dv = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const EXPECTED = fx.expected as string;

describe("Extract EXIF: the same tags from every container and byte order", () => {
  for (const name of ["jpeg_le", "jpeg_be", "tiff_le", "tiff_be", "png", "webp", "jpeg_pillow"]) {
    test(`${name}`, async () => {
      expect(textOf(await extract(sample(name)))).toBe(EXPECTED);
    });
  }

  test("the layout and some values", () => {
    const lines = EXPECTED.split("\n");
    expect(lines[0]).toBe("Found 44 tags.");
    expect(lines[1]).toBe("");
    expect(lines).toContain("Make: TestCam");
    expect(lines).toContain("ExposureTime: 0.004");
    expect(lines).toContain("FNumber: 2.8");
    expect(lines).toContain("GPSLatitude: 51, 28, 40.12");
    expect(lines).toContain("ExposureBiasValue: -0.333333");
    expect(lines).toContain("MaxApertureValue: 0/0");
    expect(lines).toContain("UserComment: hello comment");
    expect(lines).toContain("MakerNote: [39 bytes, not decoded]");
    expect(lines).toContain("XPTitle: Titel ü");
    expect(lines).toContain("Thumbnail:JpegIFByteCount: 500");
  });
});

describe("no Exif, and not an image", () => {
  test("images without an Exif block give no tags", async () => {
    for (const name of ["jpeg_plain", "png_plain", "webp_plain"]) {
      expect(textOf(await extract(sample(name))), name).toBe("Found 0 tags.\n");
    }
  });

  test("other data, text and empty data are E_COERCE", async () => {
    for (const d of [new Uint8Array(0), text("hello"), text("GIF89a......"), Uint8Array.from([0xff])]) {
      const r = await extract(d);
      expect(code(r)).toBe("E_COERCE");
      expect(msg(r)).toContain("not a JPEG, PNG, WebP or TIFF image");
    }
  });

  test("a TIFF header with a wrong magic, a short header and an Exif block that is not TIFF", async () => {
    expect(code(await extract(text("II*\0")))).toBe("E_COERCE");
    const noTiff = cat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0x12]), text("Exif\0\0"), text("garbage!"), Uint8Array.from([0xff, 0xd9]));
    const r = await extract(noTiff);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("not TIFF data");
  });
});

describe("cut-short and hostile Exif", () => {
  test("every cut point is a result or E_COERCE; before the first IFD is complete it is E_COERCE", { timeout: 120_000 }, async () => {
    const jpeg = sample("jpeg_le");
    // 2 (SOI) + 18 (APP0) + 4 (APP1 marker and length) + 6 (Exif\0\0) = 30: the TIFF block starts there
    for (let k = 0; k < jpeg.length; k++) {
      const r = await extract(jpeg.subarray(0, k));
      expect(["ok", "E_COERCE"], `cut at ${k}`).toContain(code(r));
      if (k > 30 && k < 30 + 2 + 12 * 10) expect(code(r), `cut at ${k}`).toBe("E_COERCE");
    }
    const tiff = sample("tiff_be");
    for (let k = 0; k < tiff.length; k++) {
      const r = await extract(tiff.subarray(0, k));
      expect(["ok", "E_COERCE"], `tiff cut at ${k}`).toContain(code(r));
      // a TIFF is complete only when its last value is there: IFD1 and its data end the file
      if (k < tiff.length - 40) expect(code(r), `tiff cut at ${k}`).toBe("E_COERCE");
    }
  });

  test("counts, types and offsets that lie allocate nothing and fail with the offset", async () => {
    const base = sample("tiff_le");
    const t = (patch: (d: Uint8Array) => void) => {
      const d = base.slice();
      patch(d);
      return d;
    };
    // IFD0 is at 8: a count at 8, then 12-byte entries (tag, type, count, value) from 10
    const cases: [string, Uint8Array][] = [
      ["IFD0 entries 65535", t((d) => dv(d).setUint16(8, 65535, true))],
      ["first value count 2^32-1", t((d) => dv(d).setUint32(10 + 4, 0xffffffff, true))],
      ["first value offset 2^32-1", t((d) => dv(d).setUint32(10 + 8, 0xffffffff, true))],
      ["IFD0 offset 2^32-1", t((d) => dv(d).setUint32(4, 0xffffffff, true))],
      ["IFD0 offset 0", t((d) => dv(d).setUint32(4, 0, true))],
      ["IFD0 offset 4", t((d) => dv(d).setUint32(4, 4, true))],
    ];
    for (const [name, d] of cases) {
      const t0 = Date.now();
      const r = await extract(d);
      expect(["ok", "E_COERCE"], name).toContain(code(r));
      if (!r.ok) expect(msg(r), name).toMatch(/offset|cut short|runs past|TIFF/);
      expect(Date.now() - t0, name).toBeLessThan(2000);
    }
    expect(code(await extract(cases[0]?.[1] as Uint8Array))).toBe("E_COERCE");
    expect(msg(await extract(cases[1]?.[1] as Uint8Array))).toContain("runs past the end of the data");
    // an unknown value type is shown, not read
    const odd = base.slice();
    dv(odd).setUint16(10 + 2, 99, true);
    expect(textOf(await extract(odd))).toContain("(unsupported type 99)");
  });

  test("a pointer to an IFD that points back does not loop", async () => {
    const d = sample("tiff_le").slice();
    // find the Exif IFD pointer entry (tag 0x8769) of IFD0 and make it point at IFD0 itself
    for (let p = 10; p < 10 + 12 * 12; p += 12) {
      if (dv(d).getUint16(p, true) === 0x8769) dv(d).setUint32(p + 8, 8, true);
    }
    const r = await extract(d);
    expect(["ok", "E_COERCE"]).toContain(code(r));
  });

  test("mutated files give a result or E_COERCE, nothing else", async () => {
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const name of ["jpeg_le", "jpeg_be", "png", "webp", "tiff_le"]) {
      const base = sample(name);
      for (let k = 0; k < 80; k++) {
        const d = base.slice();
        for (let j = 0; j < 3; j++) d[next() % d.length] = next() & 0xff;
        const r = await extract(d);
        expect(["ok", "E_COERCE"], `${name} ${k}`).toContain(code(r));
        if (r.ok) expect(textOf(r).length).toBeLessThan(100_000);
      }
    }
  }, 60_000);
});

describe("cost", () => {
  test("a JPEG of nothing but fill bytes, or of empty segments, costs a bounded number of steps", async () => {
    const fill = cat(Uint8Array.from([0xff, 0xd8]), new Uint8Array(65534).fill(0xff));
    const r1 = await extract(fill);
    expect(textOf(r1)).toBe("Found 0 tags.\n");
    expect(r1.ok && r1.steps).toBeLessThan(60_000);
    const seg = new Uint8Array(2 + 4 * 16000);
    seg.set([0xff, 0xd8]);
    for (let i = 0; i < 16000; i++) seg.set([0xff, 0xe0, 0, 2], 2 + 4 * i);
    const r2 = await extract(seg);
    expect(textOf(r2)).toBe("Found 0 tags.\n");
    expect(r2.ok && r2.steps).toBeLessThan(60_000);
  });

  test("an Exif block of 64 KiB with a thousand ASCII tags: the first thousand are shown", async () => {
    const n = 1500;
    const value = "x".repeat(20) + "\0";
    const ifd = new Uint8Array(2 + 12 * n + 4);
    const v = dv(ifd);
    v.setUint16(0, n, true);
    const dataAt = 8 + ifd.length;
    for (let i = 0; i < n; i++) {
      const p = 2 + 12 * i;
      v.setUint16(p, 0x0100 + i, true);
      v.setUint16(p + 2, 2, true);
      v.setUint32(p + 4, value.length, true);
      v.setUint32(p + 8, dataAt + 0, true);
    }
    const head = Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]);
    const tiff = cat(head, ifd, text(value));
    const t0 = Date.now();
    const r = await extract(tiff);
    const out = textOf(r);
    expect(out.startsWith("Found 1000 tags.\n\n")).toBe(true);
    expect(out).toContain("ImageWidth: xxxxxxxxxxxxxxxxxxxx\n");
    expect(Date.now() - t0).toBeLessThan(5000);
    // about 400 VM steps a tag
    expect(r.ok && r.steps).toBeLessThan(900_000);
  }, 60_000);

  test("a 64 KiB JPEG with a real Exif block: steps", async () => {
    const jpeg = sample("jpeg_le");
    const pad = new Uint8Array(65536 - jpeg.length);
    const big = cat(jpeg.subarray(0, jpeg.length - 2), pad, jpeg.subarray(jpeg.length - 2));
    const r = await extract(big);
    expect(textOf(r)).toBe(EXPECTED);
    expect(r.ok && r.steps).toBeLessThan(200_000);
  });
});
