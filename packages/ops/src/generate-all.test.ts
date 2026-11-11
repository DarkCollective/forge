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
 * Tests for the `generate-all` vocabulary (vocab/generate-all.fth). The fixed answers are in
 * vocab/generate-all.test.json. Here: every report line equals what the word of that family gives
 * (so the report cannot drift from the words it reports), the CRC primitive equals `crc:checksum`
 * for all 171 presets, the length filter, the names switch, binary input, and 64 KiB inside the
 * default step limit.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, bool, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["generate-all"]));

const enc = (s: string) => new TextEncoder().encode(s);
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

let seed = 12345;
function randBytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) & 255;
  });
}

async function report(word: string, data: Uint8Array, length = "all", names = true) {
  const r = await runtime.call(word, [bytes(data), str(length), bool(names)]);
  if (!r.ok) return { code: r.error.code, steps: r.steps };
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v, steps: r.steps };
}

/** The digest of a word as hex text (the stack top is bytes). */
async function digestHex(word: string, args: unknown[]) {
  const r = await runtime.call(word, args as never);
  if (!r.ok) throw new Error(`${word}: ${r.error.message}`);
  return hexOf((r.stack[r.stack.length - 1] as { v: Uint8Array }).v);
}

/** The width a CRC name states (CRC-16/ARC is 16), else undefined. */
function widthOf(name: string): number | undefined {
  const m = /^CRC-(\d+)(\/|$)/.exec(name);
  return m ? Number(m[1]) : undefined;
}

function lines(out: string): [string, string][] {
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    });
}

describe("generate-all:hashes", () => {
  test("each line is the digest word of that algorithm", async () => {
    const data = enc("The quick brown fox jumps over the lazy dog");
    const got = Object.fromEntries(lines((await report("generate-all:hashes", data)).out!));
    const d = bytes(data);
    const expected: [string, string, unknown[]][] = [
      ["MD2", "md2:digest", [d]],
      ["MD5", "md5:digest", [d]],
      ["SHA1", "sha1:digest", [d]],
      ["SHA2 256", "sha2:digest", [d, str("256")]],
      ["SHA3 384", "sha3:digest", [d, str("384")]],
      ["Keccak 512", "keccak:digest", [d, str("512")]],
      ["Shake 128", "shake:digest", [d, str("128"), int(32)]],
      ["Shake 256", "shake:digest", [d, str("256"), int(64)]],
      ["RIPEMD-320", "ripemd:digest", [d, str("320")]],
      ["Whirlpool", "whirlpool:digest", [d]],
      ["BLAKE2b-160", "blake2b:digest", [d, int(20), bytes(new Uint8Array())]],
      ["BLAKE2s-256", "blake2s:digest", [d, int(32), bytes(new Uint8Array())]],
      ["BLAKE3", "blake3:digest", [d, int(32), bytes(new Uint8Array())]],
      ["Streebog-512", "streebog:digest", [d, str("512")]],
      ["GOST", "gost:digest", [d, str("cryptopro")]],
      ["Snefru-256", "snefru:digest", [d, str("256"), str("8")]],
      ["SM3", "sm3:digest", [d]],
      ["MD6", "md6:digest", [d, int(256), int(64), str("")]],
    ];
    const rt = assembleRuntime(
      await loadBundleNode([
        "md2",
        "md5",
        "sha1",
        "sha2",
        "sha3",
        "keccak",
        "shake",
        "ripemd",
        "whirlpool",
        "blake2b",
        "blake2s",
        "blake3",
        "streebog",
        "gost",
        "snefru",
        "sm3",
        "md6",
      ]),
    );
    for (const [name, word, args] of expected) {
      const r = await rt.call(word, args as never);
      expect(r.ok, word).toBe(true);
      const want = hexOf((r.stack[r.stack.length - 1] as { v: Uint8Array }).v);
      expect(got[name], name).toBe(want);
    }
    expect(Object.keys(got)).toHaveLength(46);
    expect(got["SSDEEP"]).toMatch(/^3:/);
    expect(got["NT Hash"]).toBe(
      await digestHex("nthash:digest", [str("The quick brown fox jumps over the lazy dog")]),
    );
    expect(got["LM Hash"]).toBe(
      await digestHex("lmhash:digest", [str("The quick brown fox jumps over the lazy dog")]),
    );
  }, 60_000);

  test("the LM hash line sits just before the NT hash line, where CyberChef has it (after the GOST hash)", async () => {
    const out = (await report("generate-all:hashes", enc("password"))).out!;
    const names = lines(out).map(([n]) => n);
    expect(names.indexOf("LM Hash")).toBeGreaterThan(names.indexOf("GOST"));
    expect(names.slice(names.indexOf("LM Hash"))).toEqual(["LM Hash", "NT Hash", "SSDEEP"]);
    // the well-known LM hash of password (the lmhash vectors cite it)
    expect(out).toContain("LM Hash:      e52cac67419a9a224a3b108f3fa6cb6d\n");
  });

  test("input the LM hash cannot take (a character beyond Latin-1) gets a note on its line only", async () => {
    const out = (await report("generate-all:hashes", enc("a\u20ac"))).out!;
    expect(out).toContain("LM Hash:      (the input is not UTF-8 text of Latin-1 characters)\n");
    expect(out).toMatch(/NT Hash: {6}[0-9a-f]{32}\n/);
    expect(lines(out)).toHaveLength(46);
  });

  test("the length filter keeps the digests of that many bits (ssdeep only for all)", async () => {
    const data = enc("abc");
    const all = lines((await report("generate-all:hashes", data)).out!);
    for (const bits of [128, 160, 224, 256, 320, 384, 512]) {
      const part = lines((await report("generate-all:hashes", data, String(bits))).out!);
      expect(part.length, `${bits}`).toBeGreaterThan(0);
      for (const [name, hex] of part) {
        expect(hex.length, `${name} ${bits}`).toBe(bits / 4);
      }
      const want = all.filter(([, hex]) => hex.length === bits / 4 && !hex.includes(":"));
      expect(part).toEqual(want);
    }
  });

  test("names off gives the digests alone, one per line", async () => {
    const out = (await report("generate-all:hashes", enc("abc"), "128", false)).out!;
    expect(out.split("\n")).toEqual([
      "da853b0d3f88d99b30283a69e6ded6bb",
      "a448017aaf21d8525fc10ae87aa6729d",
      "900150983cd24fb0d6963f7d28e17f72",
      out.split("\n")[3],
      out.split("\n")[4],
      out.split("\n")[5],
      out.split("\n")[6],
      out.split("\n")[7],
      out.split("\n")[8],
      "",
    ]);
  });

  test("binary input that is not UTF-8 still gives a report, with a note for the LM and NT hashes", async () => {
    const out = (await report("generate-all:hashes", Uint8Array.from([0xff, 0xfe, 0, 1]))).out!;
    expect(lines(out)).toHaveLength(46);
    expect(out).toContain("LM Hash:      (the input is not UTF-8 text of Latin-1 characters)");
    expect(out).toContain("NT Hash:      (the input is not valid UTF-8 text)");
  });

  test("64 KiB takes a few thousand steps", async () => {
    const r = await report("generate-all:hashes", randBytes(65536));
    expect(lines(r.out!)).toHaveLength(46);
    expect(r.steps).toBeLessThan(100_000);
  }, 60_000);
});

describe("generate-all:checksums", () => {
  test("every CRC line equals crc:checksum, for all 171 presets", async () => {
    const rt = assembleRuntime(await loadBundleNode(["crc"]));
    for (const n of [0, 1, 9, 37, 300]) {
      const data = randBytes(n);
      const got = new Map(lines((await report("generate-all:checksums", data)).out!));
      let crcLines = 0;
      for (const [name, hex] of got) {
        if (!name.startsWith("CRC-")) continue;
        crcLines++;
        const r = await rt.call("crc:checksum", [bytes(data), str(name)]);
        expect(r.ok, name).toBe(true);
        const want = hexOf((r.stack[r.stack.length - 1] as { v: Uint8Array }).v);
        // the report prints ceil(width/4) digits; the word gives whole bytes
        expect(BigInt(`0x${hex}`), `${name} length ${n}`).toBe(BigInt(`0x${want}`));
      }
      expect(crcLines).toBe(171);
    }
  }, 120_000);

  test("Adler-32 and the Fletcher sums are the words' values", async () => {
    const rt = assembleRuntime(await loadBundleNode(["adler32", "fletcher"]));
    const data = randBytes(1001);
    const got = new Map(lines((await report("generate-all:checksums", data)).out!));
    const a = await rt.call("adler32:checksum", [bytes(data)]);
    expect(got.get("Adler-32")).toBe(hexOf((a.stack[a.stack.length - 1] as { v: Uint8Array }).v));
    for (const size of ["8", "16", "32", "64"]) {
      const f = await rt.call("fletcher:checksum", [bytes(data), str(size)]);
      expect(got.get(`Fletcher-${size}`), size).toBe(
        hexOf((f.stack[f.stack.length - 1] as { v: Uint8Array }).v),
      );
    }
    expect(got.size).toBe(176);
  });

  test("the length filter keeps the checksums of that width", async () => {
    const data = enc("123456789");
    const all = lines((await report("generate-all:checksums", data)).out!);
    for (const w of [
      3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 21, 24, 30, 31, 32, 40, 64, 82,
    ]) {
      const part = lines((await report("generate-all:checksums", data, String(w))).out!);
      expect(part.length, `${w}`).toBeGreaterThan(0);
      for (const [name, hex] of part) {
        expect(hex.length, `${name}`).toBe(Math.ceil(w / 4));
        if (name.startsWith("CRC-")) expect(widthOf(name), name).toBe(w);
      }
      expect(all.filter(([n]) => widthOf(n) === w)).toEqual(part.filter(([n]) => widthOf(n) === w));
    }
    expect(
      lines((await report("generate-all:checksums", data, "64")).out!).map(([n]) => n),
    ).toContain("Fletcher-64");
  });

  test("names off gives the values alone, one per line", async () => {
    const out = (await report("generate-all:checksums", enc("123456789"), "3", false)).out!;
    expect(out).toBe("4\n6\n");
  });

  test("an empty input gives the empty-input values", async () => {
    const got = new Map(lines((await report("generate-all:checksums", new Uint8Array())).out!));
    expect(got.get("Adler-32")).toBe("00000001");
    expect(got.get("CRC-32")).toBe("00000000");
    expect(got.get("Fletcher-16")).toBe("0000");
  });

  // Measured: 7.16 million steps for 64 KiB, about 1.1 s; the default limit is 10 million. Most of it
  // is the Fletcher sums and Adler-32 in FL; the 171 CRCs are one primitive call.
  test("all checksums of 64 KiB stay inside the default step limit", async () => {
    const r = await report("generate-all:checksums", randBytes(65536));
    expect(lines(r.out!)).toHaveLength(176);
    expect(r.steps).toBeLessThan(9_000_000);
  }, 60_000);
});
