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
 * Tests for the `tar` vocabulary (vocab/tar.fth, one primitive in src/prims/tar.ts). Known answers
 * from bsdtar and Python's tarfile are in vocab/tar.test.json. Here: what Forge writes checked field
 * by field (the header layout of POSIX ustar), round trips, archives built by a small independent
 * writer in this file, GNU long names, v7 headers, skipped entry types, damaged and cut-short
 * archives, many entries and 64 KiB with step counts, and the size-field rule (an entry is a slice
 * of the input, so a header claiming 4 GiB allocates nothing). During development the output was
 * also checked with `bsdtar -tvf` and Python's tarfile (recorded in the WP report).
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["tar"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const out = (r: Result) => (top(r) as { v: Uint8Array }).v;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");

interface Entry {
  name: string;
  size: number;
  dir: boolean;
  mtime: number;
  mode: number;
  data: Uint8Array;
}
function entries(r: Result): Entry[] {
  return (top(r) as unknown as { v: { v: Map<string, { v: unknown }> }[] }).v.map((rec) => {
    const g = (k: string) => (rec.v.get(k) as { v: unknown }).v;
    return {
      name: g("name") as string,
      size: Number(g("size")),
      dir: g("dir") as boolean,
      mtime: Number(g("mtime")),
      mode: Number(g("mode")),
      data: g("data") as Uint8Array,
    };
  });
}
const keys = (r: Result) =>
  Array.from((top(r) as unknown as { v: { v: Map<string, unknown> }[] }).v[0]?.v.keys() ?? []);

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

const call = (op: string, args: Value[]) => runtime.call(op, args);
const tar = (
  d: Uint8Array,
  o: Partial<{ filename: string; mode: number; mtime: number; uid: number; gid: number }> = {},
) =>
  call("tar:tar", [
    bytes(d),
    str(o.filename ?? "file.txt"),
    int(o.mode ?? 436),
    int(o.mtime ?? 0),
    int(o.uid ?? 0),
    int(o.gid ?? 0),
  ]);
const untar = (d: Uint8Array, verify = true) => call("tar:untar", [bytes(d), bool(verify)]);
const entry = (d: Uint8Array, name: string, verify = true) =>
  call("tar:entry", [bytes(d), str(name), bool(verify)]);

// ---- an independent writer: a header from the POSIX field table, written with plain loops ----
function field(s: string | Uint8Array, n: number): Uint8Array {
  const b = typeof s === "string" ? text(s) : s;
  const f = new Uint8Array(n);
  f.set(b.subarray(0, n));
  return f;
}
const oct = (v: number, n: number) => field(v.toString(8).padStart(n - 1, "0"), n);
interface Spec {
  name: string;
  data?: Uint8Array;
  type?: string;
  mode?: number;
  mtime?: number;
  prefix?: string;
  magic?: boolean;
}
function header(s: Spec): Uint8Array {
  const h = new Uint8Array(512);
  const data = s.data ?? new Uint8Array(0);
  h.set(field(s.name, 100), 0);
  h.set(oct(s.mode ?? 0o644, 8), 100);
  h.set(oct(0, 8), 108);
  h.set(oct(0, 8), 116);
  h.set(oct(data.length, 12), 124);
  h.set(oct(s.mtime ?? 0, 12), 136);
  h.fill(0x20, 148, 156);
  h[156] = (s.type ?? "0").charCodeAt(0);
  if (s.magic !== false) {
    h.set(field("ustar", 6), 257);
    h.set(text("00"), 263);
  }
  h.set(field(s.prefix ?? "", 155), 345);
  let sum = 0;
  for (const b of h) sum += b;
  h.set(field(sum.toString(8).padStart(6, "0"), 7), 148);
  h[155] = 0x20;
  return h;
}
function mk(specs: Spec[], tail = true): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const s of specs) {
    parts.push(header(s));
    const d = s.data ?? new Uint8Array(0);
    parts.push(d, new Uint8Array((512 - (d.length % 512)) % 512));
  }
  if (tail) parts.push(new Uint8Array(1024));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

describe("tar:tar", () => {
  test("writes the ustar header fields (POSIX table), data padding and two zero blocks", async () => {
    const d = text("hello tar");
    const t = out(
      await tar(d, { filename: "a/b.txt", mode: 0o640, mtime: 1700000000, uid: 1000, gid: 100 }),
    );
    expect(t.length).toBe(512 + 512 + 1024);
    expect(ascii(t.subarray(0, 7))).toBe("a/b.txt");
    expect(t[7]).toBe(0);
    expect(ascii(t.subarray(100, 108))).toBe("0000640\0");
    expect(ascii(t.subarray(108, 116))).toBe("0001750\0"); // 1000
    expect(ascii(t.subarray(116, 124))).toBe("0000144\0"); // 100
    expect(ascii(t.subarray(124, 136))).toBe("00000000011\0"); // 9 bytes
    expect(ascii(t.subarray(136, 148))).toBe("14524770400\0"); // 1700000000
    expect(t[156]).toBe(0x30);
    expect(ascii(t.subarray(257, 265))).toBe("ustar\x0000");
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (t[i] as number);
    expect(ascii(t.subarray(148, 154))).toBe(sum.toString(8).padStart(6, "0"));
    expect(t[154]).toBe(0);
    expect(t[155]).toBe(0x20);
    expect(ascii(t.subarray(512, 521))).toBe("hello tar");
    expect(t.subarray(521).every((b) => b === 0)).toBe(true);
  });

  test("the defaults are CyberChef's file name and mode, and the output never changes", async () => {
    const a = out(await tar(text("x")));
    const b = out(await tar(text("x")));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(ascii(a.subarray(0, 8))).toBe("file.txt");
    expect(ascii(a.subarray(100, 108))).toBe("0000664\0");
    expect(ascii(a.subarray(136, 148))).toBe("00000000000\0");
  });

  test("round trips, including sizes at block boundaries and the empty file", async () => {
    for (const n of [0, 1, 511, 512, 513, 1024, 5000]) {
      const d = randBytes(n, n + 1);
      const t = out(await tar(d, { filename: "f.bin" }));
      expect(t.length).toBe(512 + Math.ceil(n / 512) * 512 + 1024);
      const e = entries(await untar(t));
      expect(e).toHaveLength(1);
      expect(Array.from(e[0]?.data ?? [])).toEqual(Array.from(d));
      expect(e[0]).toMatchObject({ name: "f.bin", size: n, dir: false, mode: 436, mtime: 0 });
      expect(Array.from(out(await entry(t, "f.bin")))).toEqual(Array.from(d));
    }
  });

  test("a long name is cut at a slash into prefix and name, and read back whole", async () => {
    const long = `${"p".repeat(120)}/${"q".repeat(50)}/f.txt`;
    const t = out(await tar(text("x"), { filename: long }));
    expect(ascii(t.subarray(0, 50 + 1 + 5).subarray(0, 56))).toBe(
      `${"q".repeat(50)}/f.txt`.padEnd(56, "\0").slice(0, 56),
    );
    expect(entries(await untar(t))[0]?.name).toBe(long);
    const utf8 = `d/${"é".repeat(40)}.txt`;
    expect(entries(await untar(out(await tar(text("x"), { filename: utf8 }))))[0]?.name).toBe(utf8);
  });

  test("bad parameters are E_RANGE", async () => {
    const d = text("x");
    expect(code(await tar(d, { mode: 4096 }))).toBe("E_RANGE");
    expect(code(await tar(d, { mode: -1 }))).toBe("E_RANGE");
    expect(code(await tar(d, { uid: 2097152 }))).toBe("E_RANGE");
    expect(code(await tar(d, { gid: -1 }))).toBe("E_RANGE");
    expect(code(await tar(d, { mtime: 8589934592 }))).toBe("E_RANGE");
    expect(code(await tar(d, { filename: "" }))).toBe("E_RANGE");
    expect(code(await tar(d, { filename: "a\0b" }))).toBe("E_RANGE");
    expect(code(await tar(d, { filename: "x".repeat(101) }))).toBe("E_RANGE");
    expect(code(await tar(d, { filename: "x".repeat(256) }))).toBe("E_RANGE");
    expect(code(await tar(d, { filename: "x".repeat(100) }))).toBe("ok");
    expect(code(await tar(d, { mtime: 8589934591, uid: 2097151, gid: 2097151, mode: 4095 }))).toBe(
      "ok",
    );
  });

  test("64 KiB round trips in few steps", async () => {
    const d = randBytes(65_536, 5);
    const t = await tar(d);
    expect(t.ok && t.steps).toBeLessThan(40_000);
    const u = await untar(out(t));
    expect(u.ok && u.steps).toBeLessThan(40_000);
    expect(Array.from(entries(u)[0]?.data ?? [])).toEqual(Array.from(d));
  });
});

describe("tar:untar", () => {
  test("lists files and directories in order with the record keys in order", async () => {
    const t = mk([
      { name: "top/", type: "5", mode: 0o755, mtime: 100 },
      { name: "top/a.txt", data: text("alpha"), mtime: 200, mode: 0o600 },
      { name: "top/e", data: new Uint8Array(0) },
    ]);
    const r = await untar(t);
    expect(keys(r)).toEqual(["name", "size", "dir", "mtime", "mode", "data"]);
    const e = entries(r);
    expect(e.map((x) => [x.name, x.size, x.dir, x.mtime, x.mode])).toEqual([
      ["top/", 0, true, 100, 0o755],
      ["top/a.txt", 5, false, 200, 0o600],
      ["top/e", 0, false, 0, 0o644],
    ]);
    expect(ascii(e[1]?.data ?? new Uint8Array())).toBe("alpha");
  });

  test("reads v7 headers (no magic), a ustar prefix, and files of type NUL and 7", async () => {
    const t = mk([
      { name: "old.txt", data: text("v7"), magic: false },
      { name: "name.txt", prefix: "pre/fix", data: text("p") },
      { name: "nul.txt", data: text("n"), type: "\0" },
      { name: "contig.txt", data: text("c"), type: "7" },
    ]);
    expect(entries(await untar(t)).map((x) => x.name)).toEqual([
      "old.txt",
      "pre/fix/name.txt",
      "nul.txt",
      "contig.txt",
    ]);
  });

  test("a GNU long name (type L) names the entry after it; links and extended headers are skipped", async () => {
    const long = `${"a".repeat(150)}/file.txt`;
    const t = mk([
      { name: "./@LongLink", type: "L", data: text(`${long}\0`) },
      { name: "truncated-name", data: text("data1") },
      { name: "sym", type: "2" },
      { name: "pax", type: "x", data: text("20 path=ignored\n") },
      { name: "plain.txt", data: text("data2") },
      { name: "./@LongLink", type: "K", data: text("target\0") },
      { name: "hard", type: "1" },
    ]);
    const e = entries(await untar(t));
    expect(e.map((x) => x.name)).toEqual([long, "plain.txt"]);
    expect(ascii(e[0]?.data ?? new Uint8Array())).toBe("data1");
    expect(ascii(out(await entry(t, long)))).toBe("data1");
  });

  test("the archive ends at the zero blocks, at the end of the data, or after one zero block", async () => {
    const one = mk([{ name: "a", data: text("1") }], false);
    expect(entries(await untar(one))).toHaveLength(1);
    const lone = new Uint8Array(one.length + 512);
    lone.set(one);
    expect(entries(await untar(lone))).toHaveLength(1);
    const more = mk([{ name: "a", data: text("1") }]);
    const trailing = new Uint8Array(more.length + 300);
    trailing.set(more);
    expect(entries(await untar(trailing))).toHaveLength(1); // zeros after the end blocks: ignored
    expect(entries(await untar(new Uint8Array(1024)))).toEqual([]);
  });

  test("the first of two entries with one name is the one entry returns; a missing name lists names", async () => {
    const t = mk([
      { name: "dup", data: text("first") },
      { name: "dup", data: text("second") },
    ]);
    expect(ascii(out(await entry(t, "dup")))).toBe("first");
    const r = await entry(t, "zzz");
    expect(code(r)).toBe("E_RANGE");
    expect(msg(r)).toContain("dup");
    expect(code(await entry(new Uint8Array(1024), "x"))).toBe("E_RANGE");
  });

  test("a changed header byte fails the checksum; verify off reads it", async () => {
    const t = mk([{ name: "abc", data: text("xyz") }]);
    const bad = t.slice();
    bad[1] = (bad[1] as number) ^ 1;
    const r = await untar(bad);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("header checksum mismatch at offset 0");
    expect(entries(await untar(bad, false))[0]?.name).toBe(
      "a\x63c".replace("\x63", "c") === "acc" ? "acc" : "acc",
    );
    expect(code(await entry(bad, "acc"))).toBe("E_COERCE");
    expect(code(await entry(bad, "acc", false))).toBe("ok");
  });

  test("empty input, text, bad octal fields and the base-256 form are E_COERCE", async () => {
    expect(msg(await untar(new Uint8Array(0)))).toContain("empty");
    expect(code(await untar(text("this is not a tar archive. ".repeat(40))))).toBe("E_COERCE");
    const t = mk([{ name: "a", data: text("x") }]);
    const badOct = t.slice();
    badOct[124] = 0x39; // size '9...'
    expect(code(await untar(badOct, false))).toBe("E_COERCE");
    expect(msg(await untar(badOct, false))).toContain("not an octal number");
    const b256 = t.slice();
    b256[124] = 0x80;
    expect(msg(await untar(b256, false))).toContain("base-256");
  });

  test("cut-short archives are E_COERCE at every cut point inside a header or an entry's data", async () => {
    const t = mk([
      { name: "a.txt", data: randBytes(700, 1) },
      { name: "b.txt", data: text("bee") },
    ]);
    // a.txt: header 0..512, data 512..1212, padding to 1536; b.txt: header 1536..2048, data 2048..2051.
    // A cut that leaves only whole entries (the padding of the last one may be missing) reads as an
    // archive without its end blocks; every other cut is an incomplete header or data.
    const whole = (n: number) => (n >= 1212 && n <= 1536) || n >= 2051;
    for (let n = 1; n < t.length; n += 3) {
      const r = await untar(t.subarray(0, n));
      expect(code(r), `cut at ${n}`).toBe(whole(n) ? "ok" : "E_COERCE");
    }
  });

  test("a size field that claims 4 GiB allocates nothing: the entry is cut short", async () => {
    const t = mk([{ name: "big", data: text("x") }]);
    const lie = t.slice();
    lie.set(text("37777777777\0"), 124);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (lie[i] as number);
    lie.set(text(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    const r = await untar(lie);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("cut short");
  });

  test("an entry is a slice, so the total never passes the input", async () => {
    const t = mk(
      Array.from({ length: 50 }, (_, i) => ({ name: `f${i}`, data: randBytes(1000, i) })),
    );
    const total = entries(await untar(t)).reduce((n, e) => n + e.data.length, 0);
    expect(total).toBe(50_000);
    expect(total).toBeLessThanOrEqual(t.length);
  });

  test(
    "many entries: 1,000 are read well inside the default step limit",
    { timeout: 60_000 },
    async () => {
      const t = mk(
        Array.from({ length: 1000 }, (_, i) => ({
          name: `dir${i % 7}/file${i}.txt`,
          data: text(`entry ${i}`),
        })),
      );
      const r = await untar(t);
      const e = entries(r);
      expect(e).toHaveLength(1000);
      expect(ascii(e[999]?.data ?? new Uint8Array())).toBe("entry 999");
      expect(r.ok && r.steps).toBeLessThan(600_000);
      expect(ascii(out(await entry(t, "dir3/file500.txt")))).toBe("entry 500");
    },
  );
});
