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

/* Tests for the data identification (WP 6.23a). */
import { gzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { FILE_SIGNATURES } from "../filetype-sigs.js";
import { GENERIC_IDS, dataView, identifyData } from "./index.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 123456789;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("signatures", () => {
  test("gzip", () => {
    expect(identifyData(gzipSync(enc("hello hello hello")))).toEqual({
      id: "gzip",
      name: "gzip data",
      family: "gzip",
      certainty: "high",
    });
  });

  test("PNG", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(identifyData(png)).toMatchObject({ id: "png", name: "PNG image", certainty: "high" });
  });

  test("a plain ZIP is zip, an OOXML ZIP is ooxml in family zip, a JAR is jar in family zip", () => {
    const plain = zipSync({ "a.txt": enc("x") });
    expect(identifyData(plain)).toMatchObject({ id: "zip", family: "zip" });
    const ooxml = zipSync({ "[Content_Types].xml": enc("<Types/>") });
    expect(identifyData(ooxml)).toMatchObject({ id: "ooxml", family: "zip", certainty: "high" });
    const jar = zipSync({ "META-INF/MANIFEST.MF": enc("Manifest-Version: 1.0\n") });
    expect(identifyData(jar)).toMatchObject({ id: "jar", family: "zip" });
  });

  test("ELF and PDF", () => {
    expect(identifyData(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]))?.id).toBe("elf");
    expect(identifyData(enc("%PDF-1.7\n%..."))?.id).toBe("pdf");
  });

  test("a weak signature is low certainty, and only when nothing else matches", () => {
    const mz = new Uint8Array(64);
    mz[0] = 0x4d;
    mz[1] = 0x5a;
    expect(identifyData(mz)).toMatchObject({ id: "dos-mz", certainty: "low" });
    // Text that merely starts with the same letters is text.
    expect(identifyData(enc("MZ is a prefix of this sentence."))?.id).toBe("ascii-text");
  });
});

describe("generic kinds", () => {
  test("PEM with its label", () => {
    const pem = enc("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    expect(identifyData(pem)).toEqual({
      id: "pem",
      name: "PEM data (CERTIFICATE)",
      family: "pem",
      certainty: "high",
    });
    expect(identifyData(enc("-----BEGIN RSA PRIVATE KEY-----\nAA\n"))?.name).toBe(
      "PEM data (RSA PRIVATE KEY)",
    );
  });

  test("JSON", () => {
    expect(identifyData(enc('{"a": [1, 2.5e3, true, null, "x\\n"], "b": {}}\n'))).toEqual({
      id: "json",
      name: "JSON text",
      family: "json",
      certainty: "high",
    });
    expect(identifyData(enc("[]"))?.id).toBe("json");
    expect(identifyData(enc('{"a": 1,}'))?.id).not.toBe("json");
    expect(identifyData(enc("{not json}"))?.id).toBe("ascii-text");
    expect(identifyData(enc('{"a":1} trailing'))?.id).not.toBe("json");
  });

  test("a truncated JSON prefix that is consistent so far is medium", () => {
    const big = enc('{"items": [' + '{"k": "value", "n": 12345},'.repeat(400) + '{"k": 1}]}');
    expect(big.length).toBeGreaterThan(4096);
    expect(identifyData(big)).toMatchObject({ id: "json", certainty: "medium" });
    const bad = enc('{"items": [' + "oops ".repeat(2000));
    expect(identifyData(bad)?.id).not.toBe("json");
  });

  test("XML", () => {
    const xml = enc(
      '<?xml version="1.0"?>\n<!-- c -->\n<a x="1"><b/><c>t &amp; u</c><![CDATA[<]]></a>\n',
    );
    expect(identifyData(xml)).toEqual({
      id: "xml",
      name: "XML document",
      family: "xml",
      certainty: "high",
    });
    expect(identifyData(enc("<a><b></a></b>"))?.id).not.toBe("xml");
    expect(identifyData(enc("<a>unclosed"))?.id).not.toBe("xml");
    expect(identifyData(enc("<a/><b/>"))?.id).not.toBe("xml");
    const big = enc("<root>" + "<item id='1'>text</item>\n".repeat(400) + "</root>");
    expect(identifyData(big)).toMatchObject({ id: "xml", certainty: "medium" });
  });

  test("Base64", () => {
    const b64 = "SGVsbG8sIFdvcmxkISBUaGlzIGlzIGEgdGVzdC4=";
    expect(identifyData(enc(b64))).toMatchObject({
      id: "base64",
      name: "Base64 text",
      certainty: "high",
    });
    expect(identifyData(enc(b64.slice(0, 20) + "\n" + b64.slice(20)))?.id).toBe("base64");
    expect(identifyData(enc("SGVsbG8sIFdvcmxkIQ-_"))?.name).toBe("Base64 text (URL-safe)");
  });

  test("hex", () => {
    expect(identifyData(enc("00112233445566778899aabbccddeeff"))).toMatchObject({
      id: "hex",
      name: "hex text",
      certainty: "high",
    });
    expect(identifyData(enc("abc"))?.id).not.toBe("hex");
  });

  test("ambiguous short words get low certainty", () => {
    expect(identifyData(enc("hello1"))).toMatchObject({ id: "base64", certainty: "low" });
    expect(identifyData(enc("deadbeef"))).toMatchObject({ id: "hex", certainty: "low" });
    expect(identifyData(enc("12345678"))).toMatchObject({ id: "hex", certainty: "low" });
    expect(identifyData(enc("SGVsbG8sIFdvcmxkISBUaGlzIGlzIGEgdGVzdC4="))?.certainty).toBe("high");
  });

  test("UTF-8 text, with a line-ending note when uniform", () => {
    expect(identifyData(enc("héllo wörld, this is text.\r\nSecond line.\r\n"))).toEqual({
      id: "utf8-text",
      name: "UTF-8 text, CRLF line endings",
      family: "utf8-text",
      certainty: "high",
    });
    expect(identifyData(enc("naïve\nlines\nhere\n"))?.name).toBe("UTF-8 text, LF line endings");
    expect(identifyData(enc("naïve\rlines\rhere\r"))?.name).toBe("UTF-8 text, CR line endings");
    expect(identifyData(enc("naïve\nmixed\r\nendings"))?.name).toBe("UTF-8 text");
    expect(identifyData(enc("naïve one line"))?.name).toBe("UTF-8 text");
  });

  test("ASCII text", () => {
    expect(identifyData(enc("just some plain words, here.\n"))).toEqual({
      id: "ascii-text",
      name: "ASCII text, LF line endings",
      family: "utf8-text",
      certainty: "high",
    });
  });

  test("text of unknown validity (over the whole-data cap) is medium", () => {
    const big = new Uint8Array(1_048_577).fill(0x61);
    for (let i = 5; i < big.length; i += 6) big[i] = 0x20;
    expect(identifyData(big)).toMatchObject({ id: "utf8-text", certainty: "medium" });
  });

  test("random-looking bytes are low certainty", () => {
    expect(identifyData(randomBytes(4096))).toEqual({
      id: "random-bytes",
      name: "random-looking bytes",
      family: "random-bytes",
      certainty: "low",
    });
  });

  test("empty and unidentifiable data", () => {
    expect(identifyData(new Uint8Array(0))).toBeNull();
    expect(identifyData(new Uint8Array([0xfe, 0xfd, 0xfc, 0xfb, 0xfa]))).toBeNull();
    expect(identifyData(new Uint8Array(100))).toBeNull();
  });

  test("a view gives the same answer as bytes, and every generic id is listed", () => {
    const b = enc('{"a": 1}');
    expect(identifyData(dataView(b))).toEqual(identifyData(b));
    for (const id of [
      "pem",
      "json",
      "xml",
      "base64",
      "hex",
      "utf8-text",
      "ascii-text",
      "random-bytes",
    ])
      expect(GENERIC_IDS).toContain(id);
  });
});

/** The bytes of a row: each part at its offset (value under mask), the rest zero. */
function bufferOf(sig: (typeof FILE_SIGNATURES)[number]): Uint8Array {
  let end = 0;
  for (const p of sig.parts) end = Math.max(end, p.offset + p.value.length);
  const d = new Uint8Array(Math.max(end + 64, 128));
  for (const p of sig.parts)
    for (let k = 0; k < p.value.length; k++) d[p.offset + k] = p.value[k] as number;
  // The fields a row's `verify` reads, which the magic alone does not fix.
  if (sig.verify === "pe") {
    d[0x3c] = 0x40;
    d.set([0x50, 0x45, 0, 0], 0x40);
  }
  if (sig.verify === "class") d.set([0, 52], 6);
  if (sig.verify === "fat") d.set([0, 0, 0, 2], 4);
  return d;
}

/** Rows whose own bytes identify as something else, and why. */
const EXCEPTIONS: Record<string, string> = {};

describe("every Detect File Type row identifies itself", () => {
  for (const sig of FILE_SIGNATURES) {
    test(sig.id + " " + sig.displayName, () => {
      const r = identifyData(bufferOf(sig));
      expect(r, "identified").not.toBeNull();
      if (sig.id in EXCEPTIONS) return;
      // By its own id, or as the family of a more specific refinement.
      expect(r?.id === sig.id || r?.family === sig.id, `${sig.id} identified as ${r?.id}`).toBe(
        true,
      );
    });
  }
});

describe("bounds", () => {
  test("1000 identifications over 4 KiB stay under a generous budget", () => {
    const inputs = [
      randomBytes(4096),
      enc("lorem ipsum dolor sit amet, ".repeat(150)),
      enc('{"k": [1, 2, 3, "four"]}'.repeat(200)),
      enc("<r>" + "<i a='1'>x</i>".repeat(300)),
    ];
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) identifyData(inputs[i % inputs.length] as Uint8Array);
    const ms = performance.now() - t0;
    // Stated budget: 1000 identifications in 2000 ms.
    expect(ms).toBeLessThan(2000);
  });

  test("never throws on odd input", () => {
    for (const n of [1, 2, 3, 5, 17, 300, 5000])
      expect(() => identifyData(randomBytes(n))).not.toThrow();
    expect(() => identifyData(enc("[".repeat(5000)))).not.toThrow();
    expect(() => identifyData(enc("<a".repeat(3000)))).not.toThrow();
  });
});
