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
 * Tests for the `prime` vocabulary (vocab/prime.fth): the structure of the random primes (size, primality checked
 * independently, spread), and the exact choice of the primality test on fixed inputs. The deterministic vectors
 * (errors) are in vocab/prime.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const bundle = await loadBundleNode(["prime"]);
const runtime = assembleRuntime(bundle);

// The private test is reachable only from a unit in the vocabulary, so the test adds a probe to it.
runtime.load(`IN: prime
: t-prime? ( n:int -- bool ) n _prime? ;`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const none = bytes(new Uint8Array(0));

const gen = async (
  size: number,
  unit = "bits",
  count = 1,
  format = "decimal",
  delimiter = "newline",
) =>
  runtime.call("prime:generate", [
    none,
    int(size),
    str(unit),
    int(count),
    str(format),
    str(delimiter),
  ]);

/** Trial division, independent of the vocabulary (small numbers only). */
function slowPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (let d = 2n; d * d <= n; d++) if (n % d === 0n) return false;
  return true;
}

/** Deterministic Miller-Rabin with the first 12 primes as bases: exact below 3.3e24, and a strong check above. */
function mr(n: bigint): boolean {
  if (n < 2n) return false;
  const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of bases) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    s++;
  }
  const pow = (b: bigint, e: bigint, m: bigint) => {
    let r = 1n;
    b %= m;
    while (e > 0n) {
      if (e & 1n) r = (r * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return r;
  };
  outer: for (const a of bases) {
    let x = pow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < s; i++) {
      x = (x * x) % n;
      if (x === n - 1n) continue outer;
    }
    return false;
  }
  return true;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("prime:generate is a Generators op with the +random effect", () => {
    const cat = buildCatalogue(assembleRuntime(bundle));
    const mine = cat.ops.filter((o) => o.vocab === "prime");
    expect(mine.map((o) => o.qname)).toEqual(["prime:generate"]);
    expect(mine[0]?.category).toBe("Generators");
    expect(mine[0]?.effects).toContain("+random");
  });
});

describe("the primality test", () => {
  test("agrees with trial division for every number below 3000", async () => {
    const wrong: number[] = [];
    for (let n = 0; n < 3000; n++) {
      const r = await runtime.call("prime:t-prime?", [int(n)]);
      if (top(r) !== slowPrime(BigInt(n))) wrong.push(n);
    }
    expect(wrong).toEqual([]);
  });

  test.each([
    [39601n, false], // 199 squared
    [44521n, false], // 211 squared
    [40009n, true],
    [561n, false], // Carmichael numbers
    [1105n, false],
    [8911n, false],
    [3215031751n, false], // strong pseudoprime to bases 2, 3, 5 and 7
    [2147483647n, true], // 2^31 - 1
    [(1n << 61n) - 1n, true],
    [(1n << 89n) - 1n, true],
    [(1n << 127n) - 1n, true],
    [(1n << 67n) - 1n, false], // Cole's factorisation
    [(1n << 127n) + 1n, false],
  ])("%s -> %s", async (n, expected) => {
    expect(top(await runtime.call("prime:t-prime?", [int(n)]))).toBe(expected);
  });
});

describe("prime:generate", () => {
  test.each([2, 3, 4, 8, 16, 31, 64, 128, 256])(
    "%i bits: prime, exactly that size",
    async (bits) => {
      for (let i = 0; i < 5; i++) {
        const p = BigInt(top(await gen(bits)) as string);
        expect(p.toString(2).length).toBe(bits);
        expect(mr(p)).toBe(true);
      }
    },
  );

  test("2048 bits, the largest size, is within the step and time limits", async () => {
    const r = await gen(2048);
    // about two seconds alone; on a machine so loaded that the 30 s wall-clock limit is hit, only that limit may fire
    if (!r.ok) {
      expect(code(r)).toBe("E_LIMIT_TIME");
      return;
    }
    expect(r.steps).toBeLessThan(5_000_000);
    const p = BigInt(top(r) as string);
    expect(p.toString(2).length).toBe(2048);
    expect(mr(p)).toBe(true);
  }, 120000);

  test.each([1, 2, 3, 6, 20, 77])("%i digits: prime, exactly that many digits", async (digits) => {
    for (let i = 0; i < 5; i++) {
      const s = top(await gen(digits, "digits")) as string;
      expect(s.length).toBe(digits);
      expect(mr(BigInt(s))).toBe(true);
    }
  });

  test("the default size is 512 bits, as CyberChef's bit length", () => {
    expect(runtime.meta("prime:generate").params.find((x) => x.name === "size")?.default).toBe(512);
  });

  test("hex output is lower-case hex with a 0x in front, of the same kind of number", async () => {
    const s = top(await gen(64, "bits", 1, "hex")) as string;
    expect(s).toMatch(/^0x[0-9a-f]{16}$/);
    expect(mr(BigInt(s))).toBe(true);
  });

  test("count and delimiter", async () => {
    const s = top(await gen(32, "bits", 4, "decimal", "comma")) as string;
    const parts = s.split(",");
    expect(parts).toHaveLength(4);
    expect(parts.every((p) => mr(BigInt(p)))).toBe(true);
    expect(top(await gen(32, "bits", 3, "decimal", "none"))).toMatch(/^\d+$/);
  });

  test("the 2-bit primes are 2 and 3, each about half the time", async () => {
    const seen = { 2: 0, 3: 0 } as Record<string, number>;
    for (let i = 0; i < 200; i++) seen[top(await gen(2)) as string]!++;
    expect(seen["2"]! + seen["3"]!).toBe(200);
    expect(seen["2"]).toBeGreaterThan(60);
    expect(seen["3"]).toBeGreaterThan(60);
  });

  test("the 1-digit primes are 2, 3, 5 and 7, with a loose chi-squared bound", async () => {
    const seen: Record<string, number> = { "2": 0, "3": 0, "5": 0, "7": 0 };
    for (let i = 0; i < 400; i++) seen[top(await gen(1, "digits")) as string]!++;
    const chi = Object.values(seen).reduce((a, o) => a + (o - 100) ** 2 / 100, 0);
    expect(Object.keys(seen)).toHaveLength(4);
    expect(chi).toBeLessThan(25);
  });

  test("two calls differ, and the input is ignored", async () => {
    const a = top(await gen(128));
    const b = top(await gen(128));
    expect(a).not.toBe(b);
    const r = await runtime.call("prime:generate", [
      bytes(Uint8Array.of(1, 2, 3)),
      int(16),
      str("bits"),
      int(1),
      str("decimal"),
      str("newline"),
    ]);
    expect(code(r)).toBe("ok");
  });

  test("uses the host CSPRNG: a host without it is an error, never Math.random", async () => {
    vi.stubGlobal("crypto", {});
    expect(code(await gen(16))).toBe("E_PRIMITIVE");
  });

  test.each([
    [1, "bits"],
    [2049, "bits"],
    [0, "digits"],
    [617, "digits"],
  ])("size %i %s is out of range", async (size, unit) => {
    const r = await gen(size, unit);
    expect(["E_RANGE", "E_PARAM_INVALID"]).toContain(code(r));
  });
});
