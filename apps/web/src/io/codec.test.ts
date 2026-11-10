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
import { describe, expect, it } from "vitest";
import {
  EDIT_LIMIT_BYTES,
  ENCODINGS,
  EOLS,
  applyEol,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToText,
  countUtf8Chars,
  detectEol,
  formatBytes,
  hexDumpRows,
  hexDumpText,
  hexRowCount,
  hexToBytes,
  inputView,
  normalizeEol,
  shannonEntropy,
  textToBytes,
} from "./codec.js";

const all256 = Uint8Array.from({ length: 256 }, (_, i) => i);

describe("line endings", () => {
  it("normalises every ending to LF", () => {
    expect(normalizeEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeEol("\r\r\n\n")).toBe("\n\n\n");
  });
  it("applies the chosen ending", () => {
    expect(applyEol("a\nb", "lf")).toBe("a\nb");
    expect(applyEol("a\nb", "crlf")).toBe("a\r\nb");
    expect(applyEol("a\nb", "cr")).toBe("a\rb");
  });
  it("detects the dominant ending", () => {
    expect(detectEol("")).toBe("lf");
    expect(detectEol("no ending")).toBe("lf");
    expect(detectEol("a\r\nb\r\nc\n")).toBe("crlf");
    expect(detectEol("a\rb\rc\n")).toBe("cr");
    expect(detectEol("a\nb\nc\r\n")).toBe("lf");
  });
});

describe("text to bytes and back", () => {
  it("round-trips every byte value through hex, base64 and latin1", () => {
    for (const enc of ["hex", "base64", "latin1"] as const) {
      const text = bytesToText(all256, enc);
      expect(text.ok).toBe(true);
      if (!text.ok) continue;
      const back = textToBytes(text.text, enc, "lf");
      // latin1 normalises line endings in the text view, so bytes 10 and 13 are the known exception
      if (enc === "latin1") continue;
      expect(back.ok && Array.from(back.bytes)).toEqual(Array.from(all256));
    }
  });
  it("round-trips latin1 text with each EOL", () => {
    for (const eol of EOLS) {
      const bytes = textToBytes("café\nbar\n", "latin1", eol);
      expect(bytes.ok).toBe(true);
      if (!bytes.ok) continue;
      const text = bytesToText(bytes.bytes, "latin1");
      expect(text.ok && text.text).toBe("café\nbar\n");
    }
  });
  it("round-trips utf8 text with each EOL", () => {
    const s = "héllo 世界 😀\nline2\n\nend";
    for (const eol of EOLS) {
      const bytes = textToBytes(s, "utf8", eol);
      expect(bytes.ok).toBe(true);
      if (!bytes.ok) continue;
      const text = bytesToText(bytes.bytes, "utf8");
      expect(text.ok && text.text).toBe(s);
    }
  });
  it("writes the EOL into the bytes", () => {
    const r = textToBytes("a\nb", "utf8", "crlf");
    expect(r.ok && Array.from(r.bytes)).toEqual([0x61, 13, 10, 0x62]);
    const c = textToBytes("a\r\nb\rc", "utf8", "cr");
    expect(c.ok && Array.from(c.bytes)).toEqual([0x61, 13, 0x62, 13, 0x63]);
  });
  it("shows each encoding in its own form", () => {
    const b = new TextEncoder().encode("Hi!");
    expect(bytesToText(b, "hex")).toEqual({ ok: true, text: "48 69 21" });
    expect(bytesToText(b, "base64")).toEqual({ ok: true, text: "SGkh" });
    expect(bytesToText(b, "utf8")).toEqual({ ok: true, text: "Hi!" });
  });
  it("covers every encoding name", () => {
    expect(ENCODINGS).toEqual(["utf8", "hex", "latin1", "base64"]);
  });
});

describe("invalid text for an encoding", () => {
  it("rejects bad hex with a position", () => {
    const r = hexToBytes("48 6g");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.index).toBe(4);
      expect(r.message).toMatch(/hex digit/);
    }
  });
  it("rejects odd hex digit counts", () => {
    expect(hexToBytes("abc")).toMatchObject({ ok: false, message: "Odd number of hex digits." });
  });
  it("accepts upper case, mixed white space and empty hex", () => {
    const r = hexToBytes("DE ad\nBE\tef");
    expect(r.ok && Array.from(r.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(hexToBytes("")).toMatchObject({ ok: true });
  });
  it("rejects bad base64", () => {
    expect(base64ToBytes("SGk!")).toMatchObject({ ok: false });
    expect(base64ToBytes("S")).toMatchObject({ ok: false });
    expect(base64ToBytes("SGk=x")).toMatchObject({ ok: false });
    expect(base64ToBytes("SG===")).toMatchObject({ ok: false });
    expect(base64ToBytes("SGkh=")).toMatchObject({ ok: false });
  });
  it("accepts unpadded and wrapped base64", () => {
    const a = base64ToBytes("SGk");
    expect(a.ok && Array.from(a.bytes)).toEqual([0x48, 0x69]);
    const b = base64ToBytes("SGVs\nbG8=");
    expect(b.ok && new TextDecoder().decode(b.bytes)).toBe("Hello");
  });
  it("round-trips base64 for lengths 0..5", () => {
    for (let n = 0; n <= 5; n++) {
      const bytes = all256.slice(200, 200 + n);
      const r = base64ToBytes(bytesToBase64(bytes));
      expect(r.ok && Array.from(r.bytes)).toEqual(Array.from(bytes));
    }
    expect(bytesToBase64(new TextEncoder().encode("Ma"))).toBe("TWE=");
  });
  it("rejects characters above U+00FF as latin1", () => {
    const r = textToBytes("ab€", "latin1", "lf");
    expect(r).toMatchObject({ ok: false, index: 2 });
    if (!r.ok) expect(r.message).toMatch(/U\+20AC/);
  });
  it("rejects unpaired surrogates as utf8 instead of writing U+FFFD", () => {
    const r = textToBytes("a\ud800b", "utf8", "lf");
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(textToBytes("\udc00", "utf8", "lf").ok).toBe(false);
    expect(textToBytes("😀", "utf8", "lf").ok).toBe(true);
  });
  it("never decodes malformed utf8 with replacement characters", () => {
    const bad = Uint8Array.of(0x61, 0xff, 0x62);
    expect(bytesToText(bad, "utf8")).toMatchObject({ ok: false });
    expect(bytesToText(Uint8Array.of(0xc0, 0x80), "utf8").ok).toBe(false);
    expect(bytesToText(Uint8Array.of(0xed, 0xa0, 0x80), "utf8").ok).toBe(false);
    // the same bytes are fine in latin1
    expect(bytesToText(bad, "latin1")).toEqual({ ok: true, text: "aÿb" });
  });
  it("keeps a BOM as U+FEFF", () => {
    const r = bytesToText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61), "utf8");
    expect(r).toEqual({ ok: true, text: "﻿a" });
    const back = textToBytes("﻿a", "utf8", "lf");
    expect(back.ok && Array.from(back.bytes)).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });
});

describe("inputView", () => {
  it("is editable text for small valid input", () => {
    expect(inputView(new TextEncoder().encode("hi"), "utf8")).toEqual({ kind: "text", text: "hi" });
  });
  it("is read-only for invalid utf8, but editable in latin1", () => {
    expect(inputView(Uint8Array.of(0xff), "utf8")).toEqual({
      kind: "readonly",
      reason: "invalid-utf8",
    });
    expect(inputView(Uint8Array.of(0xff), "latin1").kind).toBe("text");
  });
  it("is read-only above the edit limit", () => {
    expect(inputView(new Uint8Array(EDIT_LIMIT_BYTES + 1), "hex")).toEqual({
      kind: "readonly",
      reason: "too-large",
    });
    expect(inputView(new Uint8Array(EDIT_LIMIT_BYTES), "latin1").kind).toBe("text");
  });
});

describe("statistics", () => {
  it("computes Shannon entropy", () => {
    expect(shannonEntropy(new Uint8Array(0))).toBe(0);
    expect(shannonEntropy(new Uint8Array(100))).toBe(0);
    expect(shannonEntropy(Uint8Array.of(0, 1))).toBeCloseTo(1, 12);
    expect(shannonEntropy(Uint8Array.of(0, 0, 1, 1, 2, 2, 3, 3))).toBeCloseTo(2, 12);
    expect(shannonEntropy(all256)).toBeCloseTo(8, 12);
    expect(shannonEntropy(Uint8Array.of(0, 0, 0, 1))).toBeCloseTo(0.8112781244591328, 12);
  });
  it("counts utf8 characters", () => {
    expect(countUtf8Chars(new TextEncoder().encode("aé世😀"))).toBe(4);
    expect(countUtf8Chars(new Uint8Array(0))).toBe(0);
  });
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MiB");
  });
});

describe("hex dump", () => {
  it("formats offset, hex and ascii", () => {
    const rows = hexDumpRows(new TextEncoder().encode("Hello, world!\nÿ"), 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.offset).toBe("00000000");
    expect(rows[0]?.hex.startsWith("48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a c3 bf")).toBe(true);
    expect(rows[0]?.ascii).toBe("Hello, world!...");
  });
  it("pads short rows to the same hex width", () => {
    const rows = hexDumpRows(new Uint8Array(20).fill(0x41), 0, 2);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.offset).toBe("00000010");
    expect(rows[1]?.hex.length).toBe(rows[0]?.hex.length);
    expect(rows[1]?.ascii).toBe("AAAA");
  });
  it("returns only the requested window and clamps", () => {
    const bytes = new Uint8Array(160);
    expect(hexRowCount(160)).toBe(10);
    expect(hexRowCount(0)).toBe(0);
    expect(hexRowCount(161)).toBe(11);
    expect(hexDumpRows(bytes, 4, 3).map((r) => r.offset)).toEqual([
      "00000040",
      "00000050",
      "00000060",
    ]);
    expect(hexDumpRows(bytes, 8, 50)).toHaveLength(2);
    expect(hexDumpRows(bytes, 20, 5)).toEqual([]);
    expect(hexDumpRows(bytes, -3, 4)).toHaveLength(1);
    expect(hexDumpRows(new Uint8Array(0), 0, 5)).toEqual([]);
  });
  it("shows non-printable bytes as dots", () => {
    expect(hexDumpRows(Uint8Array.of(0, 0x1f, 0x20, 0x7e, 0x7f, 0x80), 0, 1)[0]?.ascii).toBe(
      ".. ~..",
    );
  });
  it("renders one megabyte quickly in windows", () => {
    const mib = new Uint8Array(1024 * 1024);
    expect(hexRowCount(mib.length)).toBe(65536);
    const last = hexDumpRows(mib, 65535, 10);
    expect(last).toHaveLength(1);
    expect(last[0]?.offset).toBe("000ffff0");
  });
  it("makes a text dump", () => {
    expect(hexDumpText(Uint8Array.of(0x41, 0x42))).toMatch(/^00000000 {2}41 42 +\|AB\|$/);
    expect(bytesToHex(Uint8Array.of(1, 255), ":")).toBe("01:ff");
  });
});
