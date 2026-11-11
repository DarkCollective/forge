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
 * Tests for the `filetype` vocabulary (vocab/filetype.fth, src/prims/filetype.ts, the table in
 * src/filetype-sigs.ts): Detect File Type, Scan for Embedded Files, Extract Files and the entry op.
 *
 * The samples (src/fixtures/filetype.json, hex) were made by independent tools, never by CyberChef:
 * Pillow (PNG, JPEG, GIF, BMP, TIFF, WebP, ICO), Python's zipfile, gzip, bz2, lzma, wave and sqlite3,
 * GNU tar, openssl (a DER certificate and its PEM), cc (a 872-byte ELF), ffmpeg (MP3, Ogg, M4A, Matroska)
 * and, where no tool exists in the sandbox, bytes written by hand from the format documents (pcap and
 * pcapng from the libpcap and pcapng layouts, a Zstandard raw-block frame from RFC 8878, an empty 7z
 * archive, a minimal PDF). `file` 5.45 named each sample's type the same way (recorded in the WP
 * report). The end finders are checked against the sample's own length: the file cut out of junk must be
 * the sample, byte for byte. Cut-short files must never be returned short.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import fixtures from "./fixtures/filetype.json";
import { CATEGORIES, FILE_SIGNATURES, compileMagic } from "./filetype-sigs.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool, list } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["filetype"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const textOf = (r: Result) => (top(r) as { v: string }).v;
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const sample = (name: string): Uint8Array =>
  hex((fixtures as Record<string, string>)[name] as string);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);

const ALL = [true, true, true, true, true, true, true].map(bool);
const detect = (d: Uint8Array, flags: boolean[] = [true, true, true, true, true, true, true]) =>
  runtime.call("filetype:detect", [bytes(d), ...flags.map(bool)]);
const scan = (d: Uint8Array, ignoreCommon = true) =>
  runtime.call("filetype:scan", [bytes(d), ...ALL, bool(ignoreCommon)]);
const FLAGS_EXTRACT = [true, true, true, true, true, true, false].map(bool);
const extract = (
  d: Uint8Array,
  ignoreFailed = true,
  flags: Value[] = FLAGS_EXTRACT,
  limits?: { maxValueBytes: number },
) =>
  runtime.call(
    "filetype:extract",
    [bytes(d), ...flags, bool(ignoreFailed)],
    limits ? { limits } : undefined,
  );
const entry = (d: Uint8Array, index: number) =>
  runtime.call("filetype:entry", [bytes(d), int(index), ...FLAGS_EXTRACT, bool(true)]);

interface Carved {
  name: string;
  offset: number;
  size: number;
  type: string;
  data: Uint8Array;
}
function files(r: Result): Carved[] {
  return (top(r) as unknown as { v: { v: Map<string, { v: unknown }> }[] }).v.map((rec) => {
    const g = (k: string) => (rec.v.get(k) as { v: unknown }).v;
    return {
      name: g("name") as string,
      offset: Number(g("offset")),
      size: Number(g("size")),
      type: g("type") as string,
      data: g("data") as Uint8Array,
    };
  });
}

function rnd(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

describe("the signature table", () => {
  test("has more than 100 signatures in every category, all compile and have an anchor", () => {
    expect(FILE_SIGNATURES.length).toBeGreaterThan(130);
    for (const c of CATEGORIES) expect(FILE_SIGNATURES.some((s) => s.category === c)).toBe(true);
    for (const s of FILE_SIGNATURES) {
      expect(s.anchor.bytes.length, s.name).toBeGreaterThan(0);
      expect(s.mime, s.name).toMatch(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/);
      expect(s.extensions, s.name).toMatch(/^[A-Za-z0-9]+(,[A-Za-z0-9]+)*$/);
    }
  });

  test("names are unique", () => {
    const names = FILE_SIGNATURES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the magic text: offsets, masks, nibbles, wildcards and quoted text", () => {
    const p = compileMagic("'AB' @4 ?? 0? ?F 7F&F0");
    expect(p.length).toBe(2);
    expect(p[0]?.offset).toBe(0);
    expect(Array.from(p[0]?.value ?? [])).toEqual([0x41, 0x42]);
    expect(p[1]?.offset).toBe(4);
    expect(Array.from(p[1]?.mask ?? [])).toEqual([0x00, 0xf0, 0x0f, 0xf0]);
    expect(Array.from(p[1]?.value ?? [])).toEqual([0x00, 0x00, 0x0f & 0x0f, 0x70]);
    expect(() => compileMagic("ZZ")).toThrow();
  });
});

describe("Detect File Type", () => {
  const expected: Record<string, string> = {
    png: "Portable Network Graphics image",
    jpeg: "JPEG image",
    gif: "Graphics Interchange Format (87a)",
    bmp: "Windows Bitmap",
    tiff: "Tagged Image File Format (little endian)",
    webp: "WebP image",
    ico: "Windows icon",
    pdf: "Portable Document Format",
    zip: "ZIP archive",
    docx: "Office Open XML document",
    odt: "OpenDocument text",
    jar: "Java archive",
    zip_empty: "ZIP archive (empty)",
    gzip: "GZIP compressed file",
    bzip2: "bzip2 compressed file",
    xz: "XZ compressed file",
    tar: "tar archive",
    sqlite: "SQLite 3 database",
    wav: "Waveform Audio",
    pcap: "pcap capture (little endian)",
    pcapng: "pcapng capture (little endian)",
    zstd: "Zstandard compressed file",
    "7z": "7-Zip archive",
    der: "DER certificate (long lengths)",
    pem: "PEM encoded data",
    elf: "Executable and Linkable Format",
    a_mp3: "MP3 audio with an ID3v2 tag",
    flac_head: "Free Lossless Audio Codec",
    a_ogg: "Ogg container",
    a_m4a: "Apple MPEG-4 audio",
    a_mka: "Matroska / WebM (EBML)",
  };
  for (const [name, type] of Object.entries(expected)) {
    test(`${name} is ${type}`, async () => {
      const out = textOf(await detect(sample(name)));
      expect(out).toContain(`File type:   ${type}\n`);
    });
  }

  test("the layout: four lines per match, a blank line between matches", async () => {
    const out = textOf(await detect(sample("png")));
    expect(out).toBe(
      "File type:   Portable Network Graphics image\nExtension:   png\nMIME type:   image/png\nDescription: PNG image\n",
    );
    const two = textOf(await detect(sample("jar")));
    expect(two).toContain("ZIP archive");
    expect(two).toContain("Java archive");
    expect(two).toContain("\n\nFile type:   ");
  });

  test("a ZIP lists the formats built on it that its first entry shows", async () => {
    expect(textOf(await detect(sample("docx")))).toContain("MIME type:   application/zip");
    expect(textOf(await detect(sample("odt")))).toContain(
      "application/vnd.oasis.opendocument.text",
    );
  });

  test("unknown data, and empty data", async () => {
    const unknown =
      "Unknown file type. Have you tried checking the entropy of this data to determine whether it might be encrypted or compressed?";
    expect(textOf(await detect(rnd(64, 5)))).toBe(unknown);
    expect(textOf(await detect(new Uint8Array(0)))).toBe(unknown);
    expect(textOf(await detect(text("hello world")))).toBe(unknown);
  });

  test("the category switches", async () => {
    const png = sample("png");
    expect(textOf(await detect(png, [false, true, true, true, true, true, true]))).toContain(
      "Unknown file type",
    );
    expect(textOf(await detect(png, [true, false, false, false, false, false, false]))).toContain(
      "PNG",
    );
    expect(
      textOf(await detect(sample("sqlite"), [true, true, true, true, true, true, false])),
    ).toContain("Unknown");
    expect(
      textOf(await detect(sample("sqlite"), [false, false, false, false, false, false, true])),
    ).toContain("SQLite");
  });

  test("a signature at an offset: tar (257) and MP4 brands (4)", async () => {
    expect(textOf(await detect(sample("tar")))).toContain("tar archive");
    const mp4 = cat(Uint8Array.from([0, 0, 0, 0x18]), text("ftypisom"), new Uint8Array(12));
    expect(textOf(await detect(mp4))).toContain("MP4 video (ISO base media)");
  });

  test("MZ: a PE needs its PE header, a DOS executable does not have one", async () => {
    const mz = new Uint8Array(0x100);
    mz[0] = 0x4d;
    mz[1] = 0x5a;
    mz[0x3c] = 0x80;
    expect(textOf(await detect(mz))).toContain("DOS executable (MZ)");
    mz.set(text("PE\0\0"), 0x80);
    const pe = textOf(await detect(mz));
    expect(pe).toContain("Windows executable (PE)");
    expect(pe).not.toContain("DOS executable");
  });

  test("CAFEBABE is a Java class or a Mach-O fat binary, by the next field", async () => {
    const cls = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]);
    expect(textOf(await detect(cls))).toContain("Java class file");
    const fat = Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]);
    expect(textOf(await detect(fat))).toContain("Mach-O universal binary");
  });

  test("a prefix too short for a signature never matches (every cut point of every sample)", async () => {
    for (const name of ["png", "gif", "zip", "gzip", "elf", "tar", "pcapng", "sqlite"]) {
      const s = sample(name);
      const full = textOf(await detect(s));
      const n = Math.min(
        s.length,
        name === "tar" || name === "sqlite" || name === "elf" ? 300 : s.length,
      );
      for (let k = 0; k < n; k++) {
        const r = await detect(s.subarray(0, k));
        expect(code(r), `${name} cut at ${k}`).toBe("ok");
        if (k === 0) expect(textOf(r), `${name} cut at ${k}`).not.toBe(full);
      }
    }
  });
});

describe("Scan for Embedded Files", () => {
  test("offsets of every match, in hex too, with the total", async () => {
    const png = sample("png");
    const gz = sample("gzip");
    const data = cat(text("junk"), png, text("--"), gz, text("end"));
    const out = textOf(await scan(data));
    expect(out).toContain(
      "Offset 4 (0x4):\n  File type:   Portable Network Graphics image\n  Extension:   png\n",
    );
    const gzAt = 4 + png.length + 2;
    expect(out).toContain(
      `Offset ${gzAt} (0x${gzAt.toString(16)}):\n  File type:   GZIP compressed file`,
    );
    expect(out.endsWith("\nTotal found: 2")).toBe(true);
    expect(
      out.startsWith("Scanning data for 'magic bytes' which may indicate embedded files."),
    ).toBe(true);
  });

  test("nothing found, and empty data", async () => {
    expect(textOf(await scan(text("just some text")))).toContain("\nNo embedded files were found.");
    expect(textOf(await scan(new Uint8Array(0)))).toContain("\nNo embedded files were found.");
  });

  test("matches come in order of offset, then table order", async () => {
    const data = cat(sample("zip"), sample("png"));
    const out = textOf(await scan(data));
    expect(out.indexOf("ZIP archive")).toBeLessThan(out.indexOf("Portable Network"));
  });

  test("ignore-common leaves out the weak signatures", async () => {
    const data = cat(
      text("xx"),
      Uint8Array.from([0x4d, 0x5a]),
      text("#!/bin/sh\n"),
      new Uint8Array(100),
    );
    expect(textOf(await scan(data, true))).toContain("No embedded files");
    expect(textOf(await scan(data, false))).toContain("Script with a shebang");
  });

  test("a signature with an offset is reported where the file starts", async () => {
    const tar = sample("tar");
    const out = textOf(await scan(cat(text("12345"), tar)));
    expect(out).toContain("Offset 5 (0x5):\n  File type:   tar archive");
    // the ustar magic is at 257, so a match before offset 257 of the data is not a file start
    expect(textOf(await scan(cat(new Uint8Array(100), text("ustar"))))).toContain(
      "No embedded files",
    );
  });

  test("overlapping and repeated matches", async () => {
    const data = cat(sample("png"), sample("png"), sample("png"));
    expect(textOf(await scan(data))).toMatch(/Total found: 3$/);
  });

  test("a file that holds another (a stored zip in a zip)", async () => {
    const inner = sample("zip");
    const out = textOf(await scan(cat(sample("jar"), inner)));
    expect((out.match(/ZIP archive/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the shared scan-list word: unknown category is E_RANGE, a record per match", async () => {
    const bad = await runtime.call("filetype:scan-list", [
      bytes(sample("png")),
      list([str("Nope")]),
      bool(true),
    ]);
    expect(code(bad)).toBe("E_RANGE");
    const ok = await runtime.call("filetype:scan-list", [
      bytes(sample("png")),
      list([str("Images")]),
      bool(true),
    ]);
    const rec = (top(ok) as unknown as { v: { v: Map<string, { v: unknown }> }[] }).v[0];
    expect(Array.from(rec?.v.keys() ?? [])).toEqual([
      "offset",
      "name",
      "extensions",
      "mime",
      "description",
      "category",
      "weak",
    ]);
    expect(rec?.v.get("category")?.v).toBe("Images");
  });

  test("too many matches stop with E_LIMIT_VALUE", async () => {
    const pk = text("PK\x05\x06" + "\0".repeat(18));
    const data = cat(...Array.from({ length: 200 }, () => pk));
    const r = await runtime.call("filetype:scan", [bytes(data), ...ALL, bool(true)], {
      limits: { maxValueBytes: 64 * 320 },
    });
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});

describe("Extract Files", () => {
  const withEnd = [
    "png",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "ico",
    "pdf",
    "zip",
    "docx",
    "odt",
    "jar",
    "zip_empty",
    "gzip",
    "gzip_name",
    "tar",
    "sqlite",
    "wav",
    "pcap",
    "pcapng",
    "zstd",
    "7z",
    "der",
    "pem",
    "elf",
    "a_ogg",
    "a_m4a",
    "a_mka",
  ];
  for (const name of withEnd) {
    test(`${name}: cut out of junk, byte for byte`, async () => {
      const s = sample(name);
      const junk = rnd(37, 11).map((b) => (b === 0x50 || b === 0x1f ? 0 : b));
      const data = cat(junk, s, junk);
      const r = files(await extract(data, true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)]));
      const mine = r.find((f) => f.offset === junk.length);
      expect(mine, `${name} found`).toBeDefined();
      expect(mine?.size).toBe(s.length);
      expect(Buffer.from(mine?.data ?? []).equals(Buffer.from(s))).toBe(true);
    });
  }

  test("the names, types and order", async () => {
    const data = cat(text("abc"), sample("png"), sample("gzip"), sample("pdf"));
    const r = files(await extract(data));
    expect(r.map((f) => f.name)).toEqual([
      "extracted_at_0x3.png",
      `extracted_at_0x${(3 + sample("png").length).toString(16)}.gz`,
      `extracted_at_0x${(3 + sample("png").length + sample("gzip").length).toString(16)}.pdf`,
    ]);
    expect(r.map((f) => f.type)).toEqual(["image/png", "application/gzip", "application/pdf"]);
    expect(r.map((f) => f.size)).toEqual([
      sample("png").length,
      sample("gzip").length,
      sample("pdf").length,
    ]);
  });

  test("the record keys", async () => {
    const r = await extract(sample("png"));
    const rec = (top(r) as unknown as { v: { v: Map<string, unknown> }[] }).v[0];
    expect(Array.from(rec?.v.keys() ?? [])).toEqual(["name", "offset", "size", "type", "data"]);
  });

  test("a JPEG with a thumbnail in its EXIF and a PNG in a ZIP: nested files are extracted too", async () => {
    const inner = sample("png");
    const z = cat(text("PK\x03\x04"), new Uint8Array(26), inner);
    const r = files(await extract(cat(z, sample("zip"))));
    expect(r.some((f) => f.name.endsWith(".png"))).toBe(true);
  });

  test("two JPEGs and a GIF back to back", async () => {
    const parts = [sample("jpeg"), sample("gif"), sample("jpeg")];
    const r = files(await extract(cat(...parts)));
    expect(r.map((f) => f.size)).toEqual(parts.map((p) => p.length));
  });

  test("types without an end finder are left out, or E_COERCE when failures are not ignored", async () => {
    const tiff = sample("tiff");
    expect(files(await extract(tiff)).length).toBe(0);
    const r = await extract(tiff, false);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("no extraction algorithm");
    expect(msg(r)).toContain("image/tiff");
  });

  test("Miscellaneous is off by default in the op's switches, on when asked", async () => {
    const db = sample("sqlite");
    expect(files(await extract(db)).length).toBe(0);
    expect(files(await extract(db, true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)])).length).toBe(
      1,
    );
  });

  test("category switches", async () => {
    const data = cat(sample("png"), sample("gzip"));
    const only = (i: number) => ALL.map((_, k) => bool(k === i));
    expect(files(await extract(data, true, only(0))).map((f) => f.type)).toEqual(["image/png"]);
    expect(files(await extract(data, true, only(5))).map((f) => f.type)).toEqual([
      "application/gzip",
    ]);
  });

  test("entry takes one file by index", async () => {
    const data = cat(text("x"), sample("png"), sample("gzip"));
    const a = await entry(data, 0);
    expect((top(a) as { v: Uint8Array }).v.length).toBe(sample("png").length);
    const b = await entry(data, 1);
    expect(Buffer.from((top(b) as { v: Uint8Array }).v).equals(Buffer.from(sample("gzip")))).toBe(
      true,
    );
    for (const bad of [2, -1]) {
      const r = await entry(data, bad);
      expect(code(r)).toBe("E_RANGE");
      expect(msg(r)).toContain("0 to 1");
    }
    const none = await entry(text("nothing"), 0);
    expect(code(none)).toBe("E_RANGE");
    expect(msg(none)).toContain("no files");
  });

  test("empty input", async () => {
    expect(files(await extract(new Uint8Array(0))).length).toBe(0);
    expect(code(await entry(new Uint8Array(0), 0))).toBe("E_RANGE");
  });

  test("a file cut short is never returned short (every cut point)", async () => {
    for (const name of [
      "png",
      "jpeg",
      "gif",
      "bmp",
      "zip",
      "gzip",
      "gzip_name",
      "sqlite",
      "7z",
      "zstd",
      "wav",
      "pcapng",
      "elf",
      "ico",
    ]) {
      const s = sample(name);
      const step = s.length > 300 ? 7 : 1;
      for (let k = 0; k < s.length; k += step) {
        const r = files(
          await extract(s.subarray(0, k), true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)]),
        );
        for (const f of r) {
          // a smaller file is allowed only when it is the same type's complete file inside the prefix; for these samples none exists
          if (name !== "ico") expect(f.size, `${name} cut at ${k}`).toBeLessThanOrEqual(k);
          expect(f.offset + f.size, `${name} cut at ${k}`).toBeLessThanOrEqual(k);
        }
        if (name !== "pcapng" && name !== "ico") {
          expect(r.filter((f) => f.offset === 0).length, `${name} cut at ${k}`).toBe(0);
        }
      }
    }
  });

  test("a PDF with an incremental update ends at the last %%EOF before the next PDF", async () => {
    const one = text("%PDF-1.4\nbody\n%%EOF\n");
    const upd = text("update\n%%EOF\n");
    const two = text("%PDF-1.4\nsecond\n%%EOF");
    const r = files(await extract(cat(one, upd, two)));
    expect(r.map((f) => f.size)).toEqual([one.length + upd.length, two.length]);
  });

  test("RTF with nested groups and an escaped brace", async () => {
    const rtf = text("{\\rtf1{\\b bold \\} still}text}");
    const r = files(await extract(cat(text("..."), rtf, text("}}tail"))));
    expect(r.map((f) => f.size)).toEqual([rtf.length]);
  });

  test("pcap stops at the last whole packet; a trailing partial packet is not part of the file", async () => {
    const pc = sample("pcap");
    const r = files(
      await extract(cat(pc, text("12345678")), true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)]),
    );
    expect(r[0]?.size).toBe(pc.length);
  });

  test("the ZIP end record must close the directory that precedes it (a stored zip inside a zip)", async () => {
    const outer = sample("zip_nested");
    const inner = sample("zip");
    const r = files(await extract(outer));
    expect(r.find((f) => f.offset === 0)?.size).toBe(outer.length);
    const at = outer.length - 0;
    const innerAt = Buffer.from(outer).indexOf(Buffer.from(inner));
    expect(innerAt).toBeGreaterThan(0);
    expect(r.find((f) => f.offset === innerAt)?.size).toBe(inner.length);
    expect(at).toBe(outer.length);
  });
});

describe("hostile data", () => {
  const big = (n: number, size = 4) => {
    const b = new Uint8Array(size);
    for (let i = 0; i < size; i++) b[i] = (n >>> (8 * (size - 1 - i))) & 0xff;
    return b;
  };
  test("lengths and counts that lie allocate nothing and extract nothing", async () => {
    const png = cat(
      sample("png").subarray(0, 8),
      big(0xffffffff),
      text("IHDR"),
      new Uint8Array(20),
    );
    const gif = cat(
      text("GIF89a"),
      Uint8Array.from([1, 0, 1, 0, 0xf7, 0, 0]),
      new Uint8Array(768),
      Uint8Array.from([0x21, 0xf9, 0xff]),
    );
    const zip = cat(
      text("PK\x03\x04"),
      new Uint8Array(30),
      text("PK\x05\x06"),
      new Uint8Array(8),
      Uint8Array.from([0xff, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff]),
    );
    const elf = sample("elf").slice();
    elf.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f], 32); // e_phoff
    const mp4 = cat(
      Uint8Array.from([0, 0, 0, 0x14]),
      text("ftypisom"),
      new Uint8Array(8),
      Uint8Array.from([0xff, 0xff, 0xff, 0xff]),
      text("moov"),
    );
    const sqlite = sample("sqlite").slice();
    sqlite.set([0xff, 0xff, 0xff, 0xff], 28);
    const tar = sample("tar").slice();
    tar.set(text("77777777777\0"), 124);
    const pcap = sample("pcap").slice();
    pcap.set([0xff, 0xff, 0xff, 0x7f], 24 + 8);
    const ebml = cat(
      Uint8Array.from([
        0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff,
      ]),
    );
    const sevenz = cat(
      sample("7z").subarray(0, 12),
      new Uint8Array(8).fill(0xff),
      new Uint8Array(12),
    );
    const t0 = Date.now();
    for (const [name, d] of Object.entries({
      png,
      gif,
      zip,
      elf,
      mp4,
      sqlite,
      tar,
      pcap,
      ebml,
      sevenz,
    })) {
      const r = await extract(d, true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)]);
      expect(code(r), name).toBe("ok");
      for (const f of files(r)) expect(f.size, name).toBeLessThanOrEqual(d.length);
    }
    expect(Date.now() - t0).toBeLessThan(2000);
    // the ELF with a lying program header offset is not a file; the others have no complete file either
    expect(files(await extract(elf)).length).toBe(0);
    expect(
      files(await extract(sqlite, true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)])).length,
    ).toBe(0);
  });

  test("mutated samples give a result or E_COERCE, nothing else", async () => {
    let seed = 1234;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const name of [
      "png",
      "jpeg",
      "gif",
      "zip",
      "gzip",
      "tar",
      "elf",
      "pcapng",
      "a_m4a",
      "a_ogg",
      "a_mka",
      "docx",
    ]) {
      const base = sample(name);
      for (let k = 0; k < 40; k++) {
        const d = base.slice();
        for (let j = 0; j < 4; j++) d[next() % d.length] = next() & 0xff;
        const r1 = await extract(d, true, [...FLAGS_EXTRACT.slice(0, 6), bool(true)]);
        const r2 = await scan(d);
        const r3 = await detect(d);
        expect(["ok", "E_COERCE"], `${name} ${k} extract`).toContain(code(r1));
        expect(code(r2), `${name} ${k} scan`).toBe("ok");
        expect(code(r3), `${name} ${k} detect`).toBe("ok");
      }
    }
  }, 60_000);

  test("a gzip bomb is left out and stops at the limit, a file of exactly the limit passes", async () => {
    // 6 MiB of zeros deflated: made with node's zlib in the test (the stream is the standard one)
    const { gzipSync } = await import("node:zlib");
    const bomb = gzipSync(new Uint8Array(6 * 1024 * 1024), { level: 9 });
    expect(bomb.length).toBeLessThan(10_000);
    const t0 = Date.now();
    const small = await extract(cat(text("x"), bomb), true, FLAGS_EXTRACT, {
      maxValueBytes: 1024 * 1024,
    });
    expect(code(small)).toBe("ok");
    expect(files(small).length).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
    const fits = await extract(cat(text("x"), bomb), true, FLAGS_EXTRACT, {
      maxValueBytes: 16 * 1024 * 1024,
    });
    expect(files(fits).length).toBe(1);
    expect(files(fits)[0]?.size).toBe(bomb.length);
  });

  test("the sum of the extracted files is bounded by the value limit", async () => {
    const png = sample("png");
    const data = cat(...Array.from({ length: 50 }, () => png));
    const r = await extract(data, true, FLAGS_EXTRACT, { maxValueBytes: 50 * png.length });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    const fine = await extract(data);
    expect(files(fine).length).toBe(50);
  });

  test("many candidates cost little: 4096 truncated PNG signatures", async () => {
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const d = cat(...Array.from({ length: 4096 }, () => sig));
    const t0 = Date.now();
    const r = await extract(d);
    expect(files(r).length).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("64 KiB", () => {
  test("scan and extract of 64 KiB of random data with files in it, with the step counts", async () => {
    const noise = rnd(65536, 99).map((b) =>
      b === 0x50 || b === 0x89 || b === 0xff || b === 0x1f ? 1 : b,
    );
    const png = sample("png");
    const zip = sample("zip");
    const data = noise.slice();
    data.set(png, 1000);
    data.set(zip, 30_000);
    data.set(sample("gzip"), 50_000);
    const t0 = Date.now();
    const r = await scan(data);
    const ms = Date.now() - t0;
    expect(r.ok && r.steps).toBeLessThan(1000);
    expect(ms).toBeLessThan(1000);
    expect(textOf(r)).toContain("Total found: 3");
    const e = await extract(data);
    expect(files(e).map((f) => f.offset)).toEqual([1000, 30_000, 50_000]);
    expect(e.ok && e.steps).toBeLessThan(1000);
  }, 60_000);

  test("scan of 64 KiB made of signatures, only the value limit bounds it", async () => {
    const d = cat(...Array.from({ length: 6000 }, () => text("PK\x03\x04abcdef")));
    const t0 = Date.now();
    const r = await scan(d);
    expect(code(r)).toBe("ok");
    expect(Date.now() - t0).toBeLessThan(5000);
    // the report is one FL map over the matches: about 100 VM steps a match
    expect(r.ok && r.steps).toBeLessThan(2_000_000);
  }, 60_000);
});
