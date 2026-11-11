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
 * Property tests for the `arith` vocabulary (vocab/arith.fth, no primitives): random decimals against a BigInt model,
 * the extended GCD identity, modular words against BigInt, and the size of input a recipe can hold. Fixed answers
 * are in vocab/arith.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["arith"]));

let seed = 0x5eed31;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);

async function call(word: string, ...args: string[]): Promise<string> {
  const r = await runtime.call(
    word,
    args.map((a) => str(a)),
  );
  if (!r.ok) return r.error.code;
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}

/** A random decimal as text, and as a BigInt scaled by 10^6. */
function decimal(): [string, bigint] {
  const whole = BigInt(below(1_000_000)) * BigInt(below(1_000_000) + 1);
  const frac = below(1_000_000);
  const neg = rand() < 0.5;
  const text = `${neg ? "-" : ""}${whole}.${String(frac).padStart(6, "0")}`;
  const v = whole * 1_000_000n + BigInt(frac);
  return [text, neg ? -v : v];
}

/** Plain decimal text of a value scaled by 10^scale, trailing zeros removed. */
function show(v: bigint, scale: number): string {
  const neg = v < 0n;
  let digits = (neg ? -v : v).toString().padStart(scale + 1, "0");
  const cut = digits.length - scale;
  digits = scale === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  if (digits.includes(".")) digits = digits.replace(/0+$/, "").replace(/\.$/, "");
  return digits === "0" ? "0" : (neg ? "-" : "") + digits;
}

describe("exact decimals against a BigInt model", () => {
  test("sum, subtract and multiply of random decimals", async () => {
    for (let round = 0; round < 40; round++) {
      const n = 2 + below(5);
      const parts = Array.from({ length: n }, decimal);
      const text = parts.map((p) => p[0]).join("\n");
      expect(await call("arith:sum", text, "newline")).toBe(
        show(
          parts.reduce((a, p) => a + p[1], 0n),
          6,
        ),
      );
      expect(await call("arith:subtract", text, "newline")).toBe(
        show(
          parts.slice(1).reduce((a, p) => a - p[1], parts[0]![1]),
          6,
        ),
      );
      expect(await call("arith:multiply", text, "newline")).toBe(
        show(
          parts.reduce((a, p) => a * p[1], 1n),
          6 * n,
        ),
      );
    }
  });

  test("mean and median of random decimals", async () => {
    for (let round = 0; round < 25; round++) {
      const n = 1 + below(8);
      const parts = Array.from({ length: n }, decimal);
      const text = parts.map((p) => p[0]).join(",");
      const sorted = parts.map((p) => p[1]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const mid =
        n % 2 === 1
          ? show(sorted[(n - 1) / 2]!, 6)
          : show((sorted[n / 2 - 1]! + sorted[n / 2]!) / 2n, 6);
      // the two middle values are summed at scale 6 and halved exactly at scale 7
      const even = n % 2 === 0 ? show(sorted[n / 2 - 1]! * 5n + sorted[n / 2]! * 5n, 7) : mid;
      expect(await call("arith:median", text, "comma")).toBe(even);
      // mean = sum / n, rounded half away from zero at 20 places
      const sum = parts.reduce((a, p) => a + p[1], 0n);
      const scaled = sum * 10n ** 14n; // scale 20
      const q = scaled / BigInt(n);
      const r = scaled % BigInt(n);
      const adj = (r < 0n ? -r : r) * 2n >= BigInt(n) ? (scaled < 0n ? -1n : 1n) : 0n;
      expect(await call("arith:mean", text, "comma")).toBe(show(q + adj, 20));
    }
  });

  test("mod keeps the sign of the dividend, like JavaScript's %, for every number of the list", async () => {
    for (let round = 0; round < 40; round++) {
      const a = BigInt(below(2_000_001) - 1_000_000) * BigInt(below(1000) + 1);
      const c = BigInt(below(2_000_001) - 1_000_000);
      let b = BigInt(below(2001) - 1000);
      if (b === 0n) b = 7n;
      expect(await call("arith:mod", `${a}\n${c}`, b.toString(), "newline")).toBe(
        `${a % b} ${c % b}`,
      );
    }
  });

  test("divide rounds each step half away from zero at 20 places", async () => {
    for (let round = 0; round < 40; round++) {
      const a = BigInt(below(2_000_001) - 1_000_000);
      const b = BigInt(below(2_001) - 1_000) || 3n;
      const num = a * 10n ** 20n;
      const abs = (x: bigint) => (x < 0n ? -x : x);
      let q = abs(num) / abs(b);
      if ((abs(num) % abs(b)) * 2n >= abs(b)) q += 1n;
      if (a < 0n !== b < 0n) q = -q;
      expect(await call("arith:divide", `${a}\n${b}`, "newline")).toBe(show(q, 20));
    }
  });
});

describe("standard deviation", () => {
  test("roots of 5 and of 6.66666666666666666667 (the variance 20/3 rounded at 20 places first)", async () => {
    // 1, 3, 5, 7: mean 4, variance 5 (population) and 20/3 (sample); values from Python decimal
    expect(await call("arith:standard-deviation", "1\n3\n5\n7", "population", "newline")).toBe(
      "2.23606797749978969641",
    );
    expect(await call("arith:standard-deviation", "1\n3\n5\n7", "sample", "newline")).toBe(
      "2.58198889747161125679",
    );
  });
});

describe("big integers", () => {
  test("ext-gcd: a * x + b * y = g, g divides both and is the greatest", async () => {
    for (let round = 0; round < 40; round++) {
      const a = BigInt(
        `${below(10 ** 9) - 5 * 10 ** 8}${String(below(10 ** 9)).padStart(9, "0")}${below(10 ** 6)}`,
      );
      const b = BigInt(`${below(10 ** 9) - 5 * 10 ** 8}${String(below(10 ** 9)).padStart(9, "0")}`);
      const report = await call("arith:ext-gcd", a.toString(), b.toString());
      const m = /^gcd: (-?\d+)\n\nBezout coefficients:\nx = (-?\d+)\ny = (-?\d+)\n\n$/.exec(report);
      expect(m, report).not.toBeNull();
      const [g, x, y] = [m?.[1], m?.[2], m?.[3]].map((t) => BigInt(t ?? "0")) as [
        bigint,
        bigint,
        bigint,
      ];
      expect(a * x + b * y).toBe(g);
      expect(g >= 0n).toBe(true);
      if (g !== 0n) {
        expect(a % g).toBe(0n);
        expect(b % g).toBe(0n);
      }
    }
  });

  test("mod-pow and mod-inverse against BigInt square and multiply", async () => {
    const modpow = (b: bigint, e: bigint, m: bigint) => {
      let r = 1n % m;
      b = ((b % m) + m) % m;
      while (e > 0n) {
        if (e & 1n) r = (r * b) % m;
        b = (b * b) % m;
        e >>= 1n;
      }
      return r;
    };
    const m = 2n ** 127n - 1n; // prime
    for (let round = 0; round < 15; round++) {
      const b = BigInt(below(10 ** 9)) * 10n ** 12n + BigInt(below(10 ** 9)) - 5n * 10n ** 20n;
      const e = BigInt(below(10 ** 9)) * 10n ** 9n + BigInt(below(10 ** 9));
      expect(await call("arith:mod-pow", b.toString(), e.toString(), m.toString())).toBe(
        modpow(b, e, m).toString(),
      );
      if (((b % m) + m) % m !== 0n) {
        const inv = BigInt(await call("arith:mod-inverse", b.toString(), m.toString()));
        expect((((b % m) + m) * inv) % m).toBe(1n);
      }
    }
  });
});

describe("size of the input", () => {
  test("64 KiB of whole numbers and of decimals stay inside the default step limit", async () => {
    const ints = Array.from({ length: 32_000 }, () => String(below(10))).join("\n");
    const decs = Array.from({ length: 5_500 }, () => decimal()[0]).join("\n");
    for (const data of [ints, decs]) {
      for (const op of ["sum", "subtract", "mean", "median"]) {
        expect(["E_LIMIT_STEPS", "E_LIMIT_TOTAL"]).not.toContain(
          await call(`arith:${op}`, data, "newline"),
        );
      }
      expect(await call("arith:standard-deviation", data, "population", "newline")).toMatch(
        /^\d+(\.\d+)?$/,
      );
    }
    expect(await call("arith:sum", ints, "newline")).toMatch(/^\d+$/);
  }, 240_000);
});

describe("catalogue", () => {
  test("every word is in the Arithmetic category and none needs an effect", () => {
    for (const w of [
      "sum",
      "subtract",
      "multiply",
      "divide",
      "mod",
      "mean",
      "median",
      "standard-deviation",
      "ext-gcd",
      "mod-pow",
      "mod-inverse",
    ]) {
      const meta = runtime.meta(`arith:${w}`);
      expect(meta.category).toBe("Arithmetic");
      expect(meta.effects).toEqual([]);
    }
  });
});
