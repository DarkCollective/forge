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
 * Tests for the `crc` vocabulary (vocab/crc.fth, no primitives). The check values of every preset
 * are in vocab/crc.test.json. These tests compare the table-driven FL against a plain bit-by-bit
 * reference of the Rocksoft model for every preset (including the ones with no published check
 * value), and measure the work for 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["crc"]));

interface Preset {
  name: string;
  width: number;
  poly: bigint;
  init: bigint;
  refin: boolean;
  refout: boolean;
  xorout: bigint;
}

// The preset lines are read from the vocabulary source, so the reference tests the shipped table.
const here = fileURLToPath(import.meta.url).replace(/[^/\\]*$/, "");
const source = readFileSync(`${here}../vocab/crc.fth`, "utf8");
const literal = /: _presets \( -- str \)\s+"([^"]*)"/.exec(source);
const presets: Preset[] = (literal?.[1] ?? "")
  .split("\\n")
  .filter((l) => l !== "")
  .map((line) => {
    const f = line.split(" ") as [string, string, string, string, string, string, string];
    return {
      name: f[0],
      width: Number(f[1]),
      poly: BigInt(`0x${f[2]}`),
      init: BigInt(`0x${f[3]}`),
      refin: f[4] === "T",
      refout: f[5] === "T",
      xorout: BigInt(`0x${f[6]}`),
    };
  });

/** The Rocksoft model, one bit at a time: the specification the FL table algorithm must match. */
function reference(p: Preset, data: Uint8Array): bigint {
  const w = BigInt(p.width);
  const mask = (1n << w) - 1n;
  const reflect = (v: bigint, n: bigint): bigint => {
    let r = 0n;
    for (let i = 0n; i < n; i++) r |= ((v >> i) & 1n) << (n - 1n - i);
    return r;
  };
  let reg = p.init;
  for (const byte of data) {
    const b = p.refin ? reflect(BigInt(byte), 8n) : BigInt(byte);
    for (let i = 7n; i >= 0n; i--) {
      const top = ((reg >> (w - 1n)) & 1n) ^ ((b >> i) & 1n);
      reg = (reg << 1n) & mask;
      if (top === 1n) reg ^= p.poly;
    }
  }
  if (p.refout) reg = reflect(reg, w);
  return (reg ^ p.xorout) & mask;
}

function toBig(b: Uint8Array): bigint {
  return b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
}

function top(r: { ok: boolean; stack: readonly unknown[] }): Uint8Array {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
}

let seed = 0x1f2e3d4c;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randBytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
}

describe("presets", () => {
  test("the table has every CyberChef preset", () => {
    expect(presets.length).toBe(171);
    expect(new Set(presets.map((p) => p.name)).size).toBe(171);
  });

  test("every preset agrees with the bit-by-bit reference", async () => {
    for (const p of presets) {
      for (const n of [0, 1, 9, 37]) {
        const data = randBytes(n);
        const got = top(await runtime.call("crc:checksum", [bytes(data), str(p.name)]));
        expect(got.length, p.name).toBe(Math.ceil(p.width / 8));
        expect(toBig(got), `${p.name} ${n}`).toBe(reference(p, data));
      }
    }
  }, 120_000);

  test("custom agrees with the reference for odd widths and mixed reflection", async () => {
    const hex = (v: bigint, w: number) =>
      Uint8Array.from({ length: Math.ceil(w / 8) }, (_, i) =>
        Number((v >> BigInt(8 * (Math.ceil(w / 8) - 1 - i))) & 255n),
      );
    for (let i = 0; i < 60; i++) {
      const width = 1 + Math.floor(rand() * 82);
      const mask = (1n << BigInt(width)) - 1n;
      const rb = () => toBig(randBytes(11)) & mask;
      const p: Preset = {
        name: "custom",
        width,
        poly: rb(),
        init: rb(),
        refin: rand() < 0.5,
        refout: rand() < 0.5,
        xorout: rb(),
      };
      const data = randBytes(Math.floor(rand() * 30));
      const r = await runtime.call("crc:custom", [
        bytes(data),
        int(width),
        bytes(hex(p.poly, width)),
        bytes(hex(p.init, width)),
        bool(p.refin),
        bool(p.refout),
        bytes(hex(p.xorout, width)),
      ]);
      expect(toBig(top(r)), `width ${width} refin ${p.refin} refout ${p.refout}`).toBe(
        reference(p, data),
      );
    }
  }, 120_000);
});

describe("64 KiB", () => {
  // Measured: about 0.88 million steps (0.3 s) for CRC-32, CRC-64 and CRC-82, 1.29 million for
  // CRC-16/XMODEM (the MSB-first path); the default limit is 10 million. No primitive is needed.
  for (const name of ["CRC-32", "CRC-64/XZ", "CRC-16/XMODEM", "CRC-82/DARC", "CRC-5/USB"]) {
    test(`${name} over 65536 bytes stays inside the default limits`, async () => {
      const data = randBytes(65536);
      const r = await runtime.call("crc:checksum", [bytes(data), str(name)]);
      const p = presets.find((x) => x.name === name) as Preset;
      expect(toBig(top(r))).toBe(reference(p, data));
      expect(r.steps).toBeLessThan(5_000_000);
    }, 60_000);
  }
});
