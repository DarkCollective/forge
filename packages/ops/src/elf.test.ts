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
 * Tests for the `elf` vocabulary (vocab/elf.fth): ELF Info. The reference is GNU readelf 2.42: the files
 * of src/fixtures/elf.json were built by `cc -nostdlib -static` (the executable `a`) and by a small
 * Python writer (ELF32 and ELF64, both byte orders, the MIPS, ARM, PowerPC and RISC-V machine numbers,
 * the GNU and FreeBSD OS/ABIs, symbols of every type, bind, visibility and section index, program
 * headers of many types), and the expected texts are the blocks of `readelf -W -h -l -S -s` for each
 * file, put together in the order of the report (the header, the program headers, the section headers,
 * the symbol tables), with no change at all. The table of machine names is the answer of readelf for
 * every e_machine it knows (213 numbers). Also here: every cut point, hostile counts, offsets and
 * lengths, mutated files, and a 64 KiB file with the VM step count.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import fixtures from "./fixtures/elf.json";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["elf"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const textOf = (r: Result) => (top(r) as { v: string }).v;
const info = (d: Uint8Array) => runtime.call("elf:info", [bytes(d)]);
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

type Fixture = { hex: string; text: string };
const fx = (name: string) => (fixtures as unknown as Record<string, Fixture>)[name] as Fixture;
const NAMES = [
  "a",
  "v32be",
  "v32le",
  "v64be",
  "v64le",
  "vfbsd",
  "vgnu",
  "vnosec",
  "vplain",
  "vpie",
  "vpie0",
];

function dv(d: Uint8Array): DataView {
  return new DataView(d.buffer, d.byteOffset, d.byteLength);
}

describe("ELF Info against readelf", () => {
  for (const name of NAMES) {
    test(`${name}: the report is readelf's, block for block`, async () => {
      const r = await info(hex(fx(name).hex));
      expect(textOf(r)).toBe(fx(name).text);
    });
  }

  test("the executable has the header lines, a symbol table and the PHDR rows readelf shows", async () => {
    const out = textOf(await info(hex(fx("a").hex)));
    expect(out).toContain("  Machine:                           Advanced Micro Devices X86-64\n");
    expect(out).toContain("Symbol table '.symtab' contains 9 entries:");
    expect(out).toContain("     4: 000000000040014e     6 FUNC    GLOBAL DEFAULT    2 _start\n");
    expect(out).toContain(
      "  [ 1] .note.gnu.property NOTE            0000000000400120 000120 000020 00   A  0   0  8\n",
    );
  });

  test("a PIE is told by DT_FLAGS_1, an interpreter line follows its segment", async () => {
    const pie = textOf(await info(hex(fx("vpie").hex)));
    expect(pie).toContain("DYN (Position-Independent Executable file)");
    expect(pie).toContain("      [Requesting program interpreter: /lib/ld.so]\n");
    expect(textOf(await info(hex(fx("vpie0").hex)))).toContain("DYN (Shared object file)");
  });

  test("every e_machine readelf names has the same name here", async () => {
    const base = hex(fx("vplain").hex);
    const machines = fixtures.machines as Record<string, string>;
    expect(Object.keys(machines).length).toBeGreaterThan(200);
    for (const [num, name] of Object.entries(machines)) {
      const d = base.slice();
      dv(d).setUint16(18, Number(num), true);
      const out = textOf(await info(d));
      expect(out, `machine ${num}`).toContain(`  Machine:                           ${name}\n`);
    }
    const d = base.slice();
    dv(d).setUint16(18, 0xabcd, true);
    expect(textOf(await info(d))).toContain(
      "  Machine:                           <unknown>: 0xabcd\n",
    );
  }, 60_000);

  test("every OS/ABI readelf names has the same name here", async () => {
    const base = hex(fx("vplain").hex);
    for (const [num, name] of Object.entries(fixtures.abis as Record<string, string>)) {
      const d = base.slice();
      d[7] = Number(num);
      expect(textOf(await info(d)), `abi ${num}`).toContain(
        `  OS/ABI:                            ${name}\n`,
      );
    }
    const d = base.slice();
    d[7] = 0x4e;
    expect(textOf(await info(d))).toContain("<unknown: 4e>");
  });

  test("the ELF types", async () => {
    const base = hex(fx("vplain").hex);
    const want: Record<number, string> = {
      0: "NONE (None)",
      1: "REL (Relocatable file)",
      2: "EXEC (Executable file)",
      3: "DYN (Shared object file)",
      4: "CORE (Core file)",
      5: "<unknown>: 5",
      0xfe00: "OS Specific: (fe00)",
      0xff00: "Processor Specific: (ff00)",
    };
    for (const [t, name] of Object.entries(want)) {
      const d = base.slice();
      dv(d).setUint16(16, Number(t), true);
      expect(textOf(await info(d))).toContain(`  Type:                              ${name}\n`);
    }
  });
});

describe("what is not ELF", () => {
  test("empty, short, wrong magic, wrong class and wrong byte order are E_COERCE", async () => {
    expect(code(await info(new Uint8Array(0)))).toBe("E_COERCE");
    expect(code(await info(hex("7f454c46")))).toBe("E_COERCE");
    expect(
      msg(await info(new TextEncoder().encode("MZ\x90\x00 this is not elf at all!"))),
    ).toContain("not an ELF file");
    const d = hex(fx("a").hex);
    const badClass = d.slice();
    badClass[4] = 3;
    expect(msg(await info(badClass))).toContain("unsupported ELF class 3");
    const badData = d.slice();
    badData[5] = 0;
    expect(msg(await info(badData))).toContain("unsupported ELF data encoding 0");
    expect(msg(await info(d.subarray(0, 40)))).toContain("cut short");
  });
});

describe("cut-short and hostile files", () => {
  test(
    "every cut point of the files is E_COERCE or a report, nothing else",
    { timeout: 60_000 },
    async () => {
      for (const name of ["a", "v32be", "vnosec", "vpie", "vgnu"]) {
        const d = hex(fx(name).hex);
        for (let k = 0; k < d.length; k++) {
          const r = await info(d.subarray(0, k));
          expect(["ok", "E_COERCE"], `${name} cut at ${k}`).toContain(code(r));
          // the section header table ends the file: any cut before the end loses it
          if (name === "a" || name === "v32be" || name === "vgnu")
            expect(code(r), `${name} cut at ${k}`).toBe("E_COERCE");
        }
      }
    },
  );

  test("counts and offsets that lie allocate nothing", async () => {
    const d = hex(fx("a").hex);
    const cases: [string, (x: Uint8Array) => void][] = [
      ["phnum 65535", (x) => dv(x).setUint16(56, 65535, true)],
      ["shnum 65535", (x) => dv(x).setUint16(60, 65535, true)],
      ["phoff 2^63", (x) => dv(x).setBigUint64(32, 1n << 63n, true)],
      ["shoff 2^63", (x) => dv(x).setBigUint64(40, 1n << 63n, true)],
      ["phoff 2^64-1", (x) => dv(x).setBigUint64(32, (1n << 64n) - 1n, true)],
      ["phentsize 0", (x) => dv(x).setUint16(54, 0, true)],
      ["shentsize 0", (x) => dv(x).setUint16(58, 0, true)],
      ["phentsize 65535", (x) => dv(x).setUint16(54, 65535, true)],
      ["shentsize 65535", (x) => dv(x).setUint16(58, 65535, true)],
    ];
    for (const [name, patch] of cases) {
      const x = d.slice();
      patch(x);
      const t0 = Date.now();
      const r = await info(x);
      expect(["ok", "E_COERCE"], name).toContain(code(r));
      if (r.ok) expect(textOf(r).length, name).toBeLessThan(200_000);
      expect(Date.now() - t0, name).toBeLessThan(2000);
    }
  });

  test("a symbol table, string table or section name that lies is shown as corrupt, or is E_COERCE", async () => {
    const d = hex(fx("a").hex);
    const sh = 800;
    const symtab = sh + 7 * 64;
    const bad: [string, (x: Uint8Array) => void][] = [
      ["symtab size 2^40", (x) => dv(x).setBigUint64(symtab + 32, 1n << 40n, true)],
      ["symtab entsize 1", (x) => dv(x).setBigUint64(symtab + 56, 1n, true)],
      ["symtab offset 2^50", (x) => dv(x).setBigUint64(symtab + 24, 1n << 50n, true)],
      ["symtab link 999", (x) => dv(x).setUint32(symtab + 40, 999, true)],
      ["shstrndx 999", (x) => dv(x).setUint16(62, 999, true)],
      ["shstrndx 0", (x) => dv(x).setUint16(62, 0, true)],
      ["name offset 2^32-1", (x) => dv(x).setUint32(sh + 2 * 64, 0xffffffff, true)],
      ["strtab size 0", (x) => dv(x).setBigUint64(sh + 8 * 64 + 32, 0n, true)],
    ];
    for (const [name, patch] of bad) {
      const x = d.slice();
      patch(x);
      const r = await info(x);
      expect(["ok", "E_COERCE"], name).toContain(code(r));
    }
    const noStr = d.slice();
    dv(noStr).setUint16(62, 0, true);
    expect(textOf(await info(noStr))).toContain("<no-strings>");
    const corrupt = d.slice();
    dv(corrupt).setUint32(sh + 2 * 64, 0xffffffff, true);
    expect(textOf(await info(corrupt))).toContain("<corrupt>");
    const shortEnt = d.slice();
    dv(shortEnt).setBigUint64(symtab + 56, 1n, true);
    expect(msg(await info(shortEnt))).toContain("too small for an ELF symbol");
  });

  test("an interpreter segment that lies is cut at the data", async () => {
    const d = hex(fx("vpie").hex);
    const x = d.slice();
    dv(x).setBigUint64(64 + 56 + 32, 1n << 60n, true); // p_filesz of the INTERP header
    const r = await info(x);
    expect(code(r)).toBe("ok");
    expect(textOf(r)).toContain("[Requesting program interpreter: /lib/ld.so]");
    const y = d.slice();
    dv(y).setBigUint64(64 + 56 + 8, 1n << 60n, true); // p_offset
    expect(code(await info(y))).toBe("ok");
  });

  test("mutated files give a report or E_COERCE, nothing else", async () => {
    let seed = 99;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const name of ["a", "v32be", "v64le", "vpie", "vgnu"]) {
      const base = hex(fx(name).hex);
      for (let k = 0; k < 60; k++) {
        const d = base.slice();
        for (let j = 0; j < 3; j++) d[next() % d.length] = next() & 0xff;
        const r = await info(d);
        expect(["ok", "E_COERCE"], `${name} ${k}`).toContain(code(r));
        if (r.ok) expect(textOf(r).length).toBeLessThan(300_000);
      }
    }
  }, 60_000);
});

// An ELF64 little endian file with n symbols, built here with plain loops (the layout of ELF64: header,
// .symtab, .strtab, .shstrtab, section headers).
function bigElf(n: number): Uint8Array {
  const names = Array.from({ length: n }, (_, i) => `sym${i}`);
  const strtab = new Uint8Array(1 + names.reduce((s, x) => s + x.length + 1, 0));
  let at = 1;
  const nameOffs = names.map((x) => {
    const o = at;
    for (let i = 0; i < x.length; i++) strtab[at++] = x.charCodeAt(i);
    at++;
    return o;
  });
  const symtab = new Uint8Array(24 * (n + 1));
  const sdv = dv(symtab);
  for (let i = 0; i < n; i++) {
    const b = 24 * (i + 1);
    sdv.setUint32(b, nameOffs[i] as number, true);
    symtab[b + 4] = 0x12;
    sdv.setUint16(b + 6, 1, true);
    sdv.setBigUint64(b + 8, BigInt(0x1000 + i), true);
    sdv.setBigUint64(b + 16, BigInt(i % 50), true);
  }
  const shstr = new TextEncoder().encode("\0.symtab\0.strtab\0.shstrtab\0");
  const symOff = 64;
  const strOff = symOff + symtab.length;
  const shstrOff = strOff + strtab.length;
  const shOff = (shstrOff + shstr.length + 7) & ~7;
  const out = new Uint8Array(shOff + 4 * 64);
  out.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
  const v = dv(out);
  v.setUint16(16, 1, true);
  v.setUint16(18, 62, true);
  v.setUint32(20, 1, true);
  v.setBigUint64(40, BigInt(shOff), true);
  v.setUint16(52, 64, true);
  v.setUint16(58, 64, true);
  v.setUint16(60, 4, true);
  v.setUint16(62, 3, true);
  out.set(symtab, symOff);
  out.set(strtab, strOff);
  out.set(shstr, shstrOff);
  const sec = (
    i: number,
    name: number,
    type: number,
    off: number,
    size: number,
    link: number,
    entsize: number,
  ) => {
    const b = shOff + 64 * i;
    v.setUint32(b, name, true);
    v.setUint32(b + 4, type, true);
    v.setBigUint64(b + 24, BigInt(off), true);
    v.setBigUint64(b + 32, BigInt(size), true);
    v.setUint32(b + 40, link, true);
    v.setBigUint64(b + 48, 8n, true);
    v.setBigUint64(b + 56, BigInt(entsize), true);
  };
  sec(1, 1, 2, symOff, symtab.length, 2, 24);
  sec(2, 9, 3, strOff, strtab.length, 0, 0);
  sec(3, 17, 3, shstrOff, shstr.length, 0, 0);
  return out;
}

describe("many symbols", () => {
  test("1,000 symbols (about 40 KB): every row, with the step count", async () => {
    const d = bigElf(1000);
    const t0 = Date.now();
    const r = await info(d);
    const ms = Date.now() - t0;
    const out = textOf(r);
    expect(out).toContain("Symbol table '.symtab' contains 1001 entries:");
    expect(out).toContain("   999: 00000000000013e6    48 FUNC    GLOBAL DEFAULT    1 sym998\n");
    expect(out).not.toContain("more not shown");
    expect(ms).toBeLessThan(5000);
    // about 1,000 VM steps a symbol (the rows are built from 20 small words)
    expect(r.ok && r.steps).toBeLessThan(1_300_000);
  }, 60_000);

  test("2,500 symbols (about 64 KiB): 2,000 rows and the count of the others", async () => {
    const d = bigElf(2500);
    expect(d.length).toBeLessThan(80_000);
    const t0 = Date.now();
    const r = await info(d);
    const out = textOf(r);
    expect(out).toContain("Symbol table '.symtab' contains 2501 entries:");
    expect(out).toContain("  (501 more not shown)\n");
    expect(out).toContain("  1999: ");
    expect(out).not.toContain("  2000: ");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.ok && r.steps).toBeLessThan(2_000_000);
  }, 60_000);

  test("a count of symbols that is far beyond the data is E_COERCE", async () => {
    const d = bigElf(10).slice();
    // sh_size of .symtab claims 10 million entries: the first 2,000 rows must exist
    const sh = dv(d).getBigUint64(40, true);
    dv(d).setBigUint64(Number(sh) + 64 + 32, 24n * 10_000_000n, true);
    const r = await info(d);
    expect(code(r)).toBe("E_COERCE");
    expect(msg(r)).toContain("the symbol table");
  });
});
