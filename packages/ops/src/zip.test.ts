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
 * Tests for the `zip` vocabulary (vocab/zip.fth, primitives in src/prims/zip.ts). Known answers
 * from Python's zipfile and Info-ZIP are in vocab/zip.test.json. Here: round trips, archives made
 * by fflate's zipSync (an independent writer) and read back by Forge, what Forge writes read by
 * fflate and Node's zlib, the DOS time, damaged and cut-short archives, unsupported features, an
 * archive with bytes in front, many entries, 64 KiB with step counts, and the bomb rules (one
 * entry, the sum of all entries, and sizes that lie). During development the output was also
 * checked with `unzip -t`, `zip -T` and Python's zipfile (recorded in the WP report).
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { inflateRawSync } from "node:zlib";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["zip"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const out = (r: Result) => (top(r) as { v: Uint8Array }).v;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array | undefined) =>
  Array.from(u ?? [], (c) => String.fromCharCode(c)).join("");
/** Changes one byte of an array: xor with a mask. */
const flip = (a: Uint8Array, i: number, mask: number) => {
  a[i] = (a[i] as number) ^ mask;
};

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
    const m = rec.v;
    const g = (k: string) => (m.get(k) as { v: unknown }).v;
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
function prose(n: number): Uint8Array {
  return text(
    "the quick brown fox jumps over the lazy dog. ".repeat(Math.ceil(n / 45)).slice(0, n),
  );
}

const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
const zip = (
  d: Uint8Array,
  o: Partial<{
    filename: string;
    comment: string;
    method: string;
    os: string;
    level: number;
    mtime: number;
    mode: number;
  }> = {},
) =>
  call("zip:zip", [
    bytes(d),
    str(o.filename ?? "file.txt"),
    str(o.comment ?? ""),
    str(o.method ?? "deflate"),
    str(o.os ?? "msdos"),
    int(o.level ?? 6),
    int(o.mtime ?? 0),
    int(o.mode ?? 420),
  ]);
const unzip = (d: Uint8Array, verify = true, limits?: { maxValueBytes: number }) =>
  call("zip:unzip", [bytes(d), bool(verify)], limits);
const entry = (d: Uint8Array, name: string, verify = true, limits?: { maxValueBytes: number }) =>
  call("zip:entry", [bytes(d), str(name), bool(verify)], limits);

const u16 = (d: Uint8Array, p: number) => (d[p] as number) | ((d[p + 1] as number) << 8);
const u32 = (d: Uint8Array, p: number) => (u16(d, p) | (u16(d, p + 2) << 16)) >>> 0;
const put32 = (d: Uint8Array, p: number, v: number) => {
  d[p] = v & 255;
  d[p + 1] = (v >>> 8) & 255;
  d[p + 2] = (v >>> 16) & 255;
  d[p + 3] = (v >>> 24) & 255;
};
/** The offset of the (first) central directory entry and of the end record. */
function where(z: Uint8Array) {
  const eocd = z.length - 22;
  return { eocd, cd: u32(z, eocd + 16) };
}

describe("zip:zip", () => {
  test("round trips at every method and level, and fflate and zlib read the output", async () => {
    for (const data of [new Uint8Array(0), text("a"), prose(5000), randBytes(3000, 4)]) {
      for (const [method, level] of [
        ["store", 6],
        ["deflate", 0],
        ["deflate", 1],
        ["deflate", 9],
      ] as const) {
        const z = out(await zip(data, { method, level, filename: "x/y.bin" }));
        const files = unzipSync(z);
        expect(Object.keys(files)).toEqual(["x/y.bin"]);
        expect(Array.from(files["x/y.bin"] as Uint8Array)).toEqual(Array.from(data));
        const e = entries(await unzip(z));
        expect(e).toHaveLength(1);
        expect(Array.from(e[0]?.data ?? [])).toEqual(Array.from(data));
        expect(e[0]?.size).toBe(data.length);
        expect(Array.from(out(await entry(z, "x/y.bin")))).toEqual(Array.from(data));
        if (method === "deflate") {
          const start = 30 + 7;
          const csize = u32(z, where(z).cd + 20);
          expect(Array.from(inflateRawSync(z.subarray(start, start + csize)))).toEqual(
            Array.from(data),
          );
        }
      }
    }
  });

  test("the header fields: host, method, flags, time, attributes and comment", async () => {
    const z = out(
      await zip(text("hi"), {
        filename: "café.txt",
        comment: "nöte",
        os: "unix",
        mode: 0o755,
        mtime: 1700000000,
        method: "store",
      }),
    );
    const { cd } = where(z);
    expect(u16(z, cd + 4)).toBe((3 << 8) | 20); // made by Unix
    expect(u16(z, cd + 8) & 0x800).toBe(0x800); // UTF-8 names
    expect(u16(z, cd + 10)).toBe(0); // stored
    expect(u32(z, cd + 38) >>> 16).toBe(0o100755);
    const nlen = u16(z, cd + 28);
    const clen = u16(z, cd + 32);
    expect(Array.from(z.subarray(cd + 46 + nlen, cd + 46 + nlen + clen))).toEqual(
      Array.from(text("nöte")),
    );
    const e = entries(await unzip(z));
    expect(e[0]).toMatchObject({ name: "café.txt", mtime: 1700000000, mode: 0o755 });
    const dos = out(await zip(text("hi"), { os: "msdos", mode: 0o755 }));
    expect(u32(dos, where(dos).cd + 38)).toBe(0);
    expect(entries(await unzip(dos))[0]?.mode).toBe(0);
    const mac = out(await zip(text("hi"), { os: "macintosh" }));
    expect(u16(mac, where(mac).cd + 4) >> 8).toBe(7);
  });

  test("DOS time: even seconds exactly, odd seconds round down, the limits of the range", async () => {
    for (const t of [315532800, 315532802, 951782400, 1700000000, 2000000000, 4354819198]) {
      expect(entries(await unzip(out(await zip(text("t"), { mtime: t }))))[0]?.mtime).toBe(t);
    }
    expect(entries(await unzip(out(await zip(text("t"), { mtime: 1700000001 }))))[0]?.mtime).toBe(
      1700000000,
    );
    expect(entries(await unzip(out(await zip(text("t"), { mtime: 0 }))))[0]?.mtime).toBe(315532800);
    expect(code(await zip(text("t"), { mtime: 315532799 }))).toBe("E_RANGE");
    expect(code(await zip(text("t"), { mtime: 4354819200 }))).toBe("E_RANGE");
    expect(code(await zip(text("t"), { mtime: -1 }))).toBe("E_RANGE");
  });

  test("the same input gives the same bytes every time", async () => {
    const a = out(await zip(prose(2000)));
    const b = out(await zip(prose(2000)));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("bad parameters are E_RANGE", async () => {
    const d = text("x");
    expect(code(await zip(d, { level: 10 }))).toBe("E_RANGE");
    expect(code(await zip(d, { level: -1 }))).toBe("E_RANGE");
    expect(code(await zip(d, { mode: 4096 }))).toBe("E_RANGE");
    expect(code(await zip(d, { filename: "" }))).toBe("E_RANGE");
    expect(code(await zip(d, { filename: "a\0b" }))).toBe("E_RANGE");
    expect(code(await zip(d, { filename: "n".repeat(65536) }))).toBe("E_RANGE");
    expect(code(await zip(d, { comment: "c".repeat(65536) }))).toBe("E_RANGE");
    expect(code(await zip(d, { filename: "n".repeat(65535) }))).toBe("ok");
  });

  test(
    "64 KiB round trips with a small step count (the CRC-32 and DEFLATE loops are primitives)",
    {
      timeout: 60_000,
    },
    async () => {
      const data = prose(65_536);
      const z = await zip(data);
      expect(z.ok && z.steps).toBeLessThan(2500);
      const u = await unzip(out(z));
      expect(u.ok && u.steps).toBeLessThan(5000);
      expect(Array.from(entries(u)[0]?.data ?? [])).toEqual(Array.from(data));
      const big = randBytes(8 * 1024 * 1024, 11);
      const zb = await zip(big, { method: "store" });
      expect(Array.from(entries(await unzip(out(zb)))[0]?.data.subarray(0, 100) ?? [])).toEqual(
        Array.from(big.subarray(0, 100)),
      );
    },
  );
});

describe("zip:unzip", () => {
  const files = {
    "a.txt": text("alpha"),
    "dir/b.txt": prose(3000),
    "dir/c.bin": randBytes(400, 2),
    "empty.txt": new Uint8Array(0),
  };
  const archive = zipSync(files, { mtime: Date.UTC(2022, 5, 7, 8, 9, 10) });

  test("lists the entries in directory order with the record keys in order", async () => {
    const r = await unzip(archive);
    expect(keys(r)).toEqual(["name", "size", "dir", "mtime", "mode", "data"]);
    const e = entries(r);
    expect(e.map((x) => x.name)).toEqual(Object.keys(files));
    for (const x of e) {
      expect(Array.from(x.data)).toEqual(Array.from(files[x.name as keyof typeof files]));
      expect(x.size).toBe(x.data.length);
      expect(x.dir).toBe(false);
    }
    // fflate writes the local time; Forge reads it as UTC, so the two differ by the zone offset
    expect(
      Math.abs((e[0]?.mtime ?? 0) - Date.UTC(2022, 5, 7, 8, 9, 10) / 1000),
    ).toBeLessThanOrEqual(14 * 3600);
  });

  test("entry finds a file by name; a missing name is E_RANGE listing the names", async () => {
    expect(Array.from(out(await entry(archive, "dir/b.txt")))).toEqual(Array.from(prose(3000)));
    const r = await entry(archive, "zzz");
    expect(code(r)).toBe("E_RANGE");
    expect(msg(r)).toContain("a.txt");
    expect(msg(r)).toContain("dir/b.txt");
    const none = await entry(unzipless(), "x");
    expect(code(none)).toBe("E_RANGE");
  });

  function unzipless(): Uint8Array {
    const end = new Uint8Array(22);
    put32(end, 0, 0x06054b50);
    return end;
  }

  test("an archive with no entries is an empty list; with a long comment it is still found", async () => {
    expect(entries(await unzip(unzipless()))).toEqual([]);
    const withComment = new Uint8Array(22 + 300);
    withComment.set(unzipless());
    withComment[20] = 300 & 255;
    withComment[21] = 300 >> 8;
    withComment.fill(0x50, 22);
    expect(entries(await unzip(withComment))).toEqual([]);
    // a comment that holds the signature itself: the last one wins
    const odd = new Uint8Array(22 + 30);
    odd.set(unzipless());
    odd[20] = 30;
    odd.set([0x50, 0x4b, 5, 6], 22);
    const r = await unzip(odd);
    expect(code(r)).toBe("ok");
  });

  test("bytes in front of the zip (a self-extracting archive) are skipped", async () => {
    const pre = new Uint8Array(137 + archive.length);
    pre.set(randBytes(137, 3));
    pre.set(archive, 137);
    expect(entries(await unzip(pre)).map((x) => x.name)).toEqual(Object.keys(files));
  });

  test("a damaged entry fails the CRC-32 and size checks; verify off returns it", async () => {
    const stored = zipSync({ "s.txt": [text("hello hello"), { level: 0 }] });
    const bad = stored.slice();
    flip(bad, 30 + 5 + 2, 1);
    const r = await unzip(bad);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("zip entry s.txt checksum mismatch");
    const lax = entries(await unzip(bad, false));
    expect(ascii(lax[0]?.data)).not.toBe("hello hello");
    expect(code(await entry(bad, "s.txt"))).toBe("E_COERCE");
    expect(code(await entry(bad, "s.txt", false))).toBe("ok");
    const size = stored.slice();
    put32(size, where(size).cd + 24, 99);
    expect(msg(await unzip(size))).toContain("has 11 bytes but the directory says 99");
  });

  test("cut-short archives are E_COERCE at every cut point", async () => {
    const small = zipSync({ "a.txt": prose(300), "b.txt": text("bee") });
    for (let n = 0; n < small.length; n++) {
      const r = await unzip(small.subarray(0, n));
      expect(code(r), `cut at ${n}`).toBe("E_COERCE");
    }
  });

  test("a cut inside the data with an intact directory is E_COERCE", async () => {
    const small = zipSync({ "a.txt": prose(3000) }, { level: 0 });
    const cut = small.slice();
    // the directory still says the data is there, but the entry's local header is damaged
    cut[0] = 0;
    expect(code(await unzip(cut))).toBe("E_COERCE");
    const dd = zipSync({ "a.txt": prose(3000) });
    const zeros = dd.slice();
    zeros.fill(0, 40, 60); // corrupt the deflate stream
    expect(code(await unzip(zeros))).toBe("E_COERCE");
  });

  test("not zip data, damaged directories and unsupported features are E_COERCE naming the fault", async () => {
    expect(code(await unzip(new Uint8Array(0)))).toBe("E_COERCE");
    expect(msg(await unzip(text("plain text, nothing to see here at all")))).toContain("not zip");
    const small = zipSync({ "a.txt": prose(300) });
    const enc = small.slice();
    enc[where(enc).cd + 8] = (enc[where(enc).cd + 8] as number) | 1;
    expect(msg(await unzip(enc))).toContain("zip entry a.txt is encrypted");
    const bz = small.slice();
    bz[where(bz).cd + 10] = 12;
    expect(msg(await unzip(bz))).toContain("compression method 12");
    const z64 = small.slice();
    put32(z64, where(z64).cd + 20, 0xffffffff);
    expect(msg(await unzip(z64))).toContain("zip64");
    const z64e = small.slice();
    put32(z64e, where(z64e).eocd + 16, 0xffffffff);
    expect(msg(await unzip(z64e))).toContain("zip64");
    const disk = small.slice();
    disk[where(disk).eocd + 4] = 1;
    expect(msg(await unzip(disk))).toContain("multi-disk");
    const sig = small.slice();
    sig[where(sig).cd] = 0;
    expect(msg(await unzip(sig))).toContain("central directory is damaged");
    const loc = small.slice();
    put32(loc, where(loc).cd + 42, 5);
    expect(msg(await unzip(loc))).toContain("local file header is damaged");
  });

  test(
    "many entries: 1,000 stay well inside the default step limit",
    {
      timeout: 60_000,
    },
    async () => {
      const many: Record<string, Uint8Array> = {};
      for (let i = 0; i < 1000; i++) many[`d${i % 10}/f${i}.txt`] = text(`entry number ${i}`);
      const z = zipSync(many);
      const r = await unzip(z);
      const e = entries(r);
      expect(e).toHaveLength(1000);
      expect(ascii(e[999]?.data)).toBe("entry number 999");
      expect(r.ok && r.steps).toBeLessThan(2_500_000);
      const u = await call("zip:entry", [bytes(z), str("d5/f555.txt"), bool(true)]);
      expect(ascii(out(u))).toBe("entry number 555");
    },
  );
});

describe("zip: the bomb rules", () => {
  const zeros = (n: number) => new Uint8Array(n);

  test("one entry that inflates past the limit stops with E_LIMIT_VALUE while inflating", async () => {
    const bomb = zipSync({ "z.bin": zeros(32 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(100_000);
    for (const r of [
      await unzip(bomb, true, { maxValueBytes: 1_000_000 }),
      await unzip(bomb, false, { maxValueBytes: 1_000_000 }),
      await entry(bomb, "z.bin", true, { maxValueBytes: 1_000_000 }),
    ]) {
      expect(code(r)).toBe("E_LIMIT_VALUE");
    }
  });

  test("the sum of all entries is capped, though each entry alone fits", async () => {
    const three = zipSync(
      { "1": zeros(600_000), "2": zeros(600_000), "3": zeros(600_000) },
      { level: 9 },
    );
    expect(code(await unzip(three, true, { maxValueBytes: 1_000_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await entry(three, "3", true, { maxValueBytes: 1_000_000 }))).toBe("ok");
    const stored = zipSync({
      "1": [zeros(600_000), { level: 0 }],
      "2": [zeros(600_000), { level: 0 }],
    });
    expect(code(await unzip(stored, true, { maxValueBytes: 1_200_000 }))).toBe("E_LIMIT_VALUE");
  });

  test("sizes that lie allocate nothing and decide nothing", async () => {
    const z = zipSync({ e: prose(2000) });
    const lie = z.slice();
    const { cd } = where(lie);
    put32(lie, cd + 24, 0xfffffffe); // usize 4 GiB - 2
    put32(lie, 18, 0xfffffffe); // local header too
    const r = await unzip(lie);
    expect(code(r)).toBe("E_COERCE"); // size mismatch, found after a normal inflate
    expect(msg(r)).toContain("has 2000 bytes");
    expect(entries(await unzip(lie, false))[0]?.size).toBe(2000);
    const tiny = z.slice();
    put32(tiny, cd + 20, 0xfffffffe); // csize 4 GiB - 2 is ignored for a deflate entry
    expect(entries(await unzip(tiny, false))[0]?.size).toBe(2000);
    const stored = zipSync({ e: [prose(2000), { level: 0 }] });
    const huge = stored.slice();
    put32(huge, where(huge).cd + 20, 0xfffffffe);
    expect(code(await unzip(huge))).toBe("E_COERCE"); // a stored entry past the end of the data
  });

  test("a directory with thousands of lying entries is bounded by the steps and the data", async () => {
    const z = zipSync({ e: prose(100) });
    const { cd } = where(z);
    const one = z.subarray(cd, cd + 46 + 1);
    const n = 20_000;
    const body = z.subarray(0, cd);
    const dir = new Uint8Array(one.length * n);
    for (let i = 0; i < n; i++) dir.set(one, i * one.length);
    const big = new Uint8Array(body.length + dir.length + 22);
    big.set(body);
    big.set(dir, body.length);
    const eocd = big.subarray(body.length + dir.length);
    put32(eocd, 0, 0x06054b50);
    eocd[10] = n & 255;
    eocd[11] = n >> 8;
    put32(eocd, 12, dir.length);
    put32(eocd, 16, body.length);
    const r = await unzip(big);
    expect(["E_LIMIT_STEPS", "E_LIMIT_TOTAL", "E_LIMIT_VALUE", "E_LIMIT_TIME"]).toContain(code(r));
  }, 60_000);
});
