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
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// polygraphic is FL (vocab/polygraphic.fth); these tests drive its public words through the runtime.
// The published worked examples are in vocab/polygraphic.test.json.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["polygraphic"]));
const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asciiText = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function letters(next: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String.fromCharCode(65 + Math.floor(next() * 26));
  return out;
}

/** The letters as the cipher sees them: upper case, J merged into I, then digraphs with X filler. */
function digraphs(text: string, merge: "I" | "J" = "I"): string {
  const from = merge === "I" ? "J" : "I";
  const l = text
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("")
    .map((c) => (c === from ? merge : c));
  let out = "";
  for (let i = 0; i < l.length; i++) {
    const a = l[i] as string;
    const b = l[i + 1];
    if (b === undefined) {
      out += a + "X";
    } else if (a === b) {
      out += a + "X";
    } else {
      out += a + b;
      i++;
    }
  }
  return out;
}

async function call(word: string, data: string, params: readonly string[]) {
  return runtime.call(`polygraphic:${word}`, [
    bytes(asciiBytes(data)),
    ...params.map((p) => str(p)),
  ]);
}

function outText(r: Awaited<ReturnType<typeof call>>): string {
  expect(r.ok).toBe(true);
  return asciiText(top(r).v as Uint8Array);
}

describe("polygraphic: published examples", () => {
  test("Playfair, key playfairexample, hide the gold in the tree stump", async () => {
    const ct = outText(
      await call("playfair-encrypt", "Hide the gold in the tree stump", [
        "playfairexample",
        "j",
        "X",
      ]),
    );
    expect(ct).toBe("BMODZBXDNABEKUDMUIXMMOUVIF");
    expect(outText(await call("playfair-decrypt", ct, ["playfairexample", "j"]))).toBe(
      "HIDETHEGOLDINTHETREXESTUMP",
    );
  });

  test("Hill 3x3, GYBNQKURP: ACT -> POH and CAT -> FIN", async () => {
    expect(outText(await call("hill-encrypt", "ACT", ["GYBNQKURP", "letters", "X"]))).toBe("POH");
    expect(outText(await call("hill-encrypt", "CAT", ["GYBNQKURP", "letters", "X"]))).toBe("FIN");
    expect(outText(await call("hill-decrypt", "POH", ["GYBNQKURP", "letters"]))).toBe("ACT");
  });

  test("Hill 2x2, 3 3 2 5: HELP -> HIAT", async () => {
    expect(outText(await call("hill-encrypt", "HELP", ["3 3 2 5", "numbers", "X"]))).toBe("HIAT");
  });

  test("four-square: the first digraph of the Wikipedia example", async () => {
    expect(
      outText(
        await call("four-square-encrypt", "HELPMEOBIWANKENOBI", ["example", "keyword", "X"]),
      ).slice(0, 2),
    ).toBe("FY");
  });
});

describe("polygraphic: round trips", () => {
  test("Playfair decrypt(encrypt(x)) is x as digraphs (fillers included)", async () => {
    const next = rng(41);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, Math.floor(next() * 10));
      const text = letters(next, Math.floor(next() * 40)) + (trial % 3 === 0 ? "XX" : "");
      const ct = outText(await call("playfair-encrypt", text, [key, "j", "X"]));
      expect(ct.length).toBe(digraphs(text).length);
      expect(outText(await call("playfair-decrypt", ct, [key, "j"]))).toBe(digraphs(text));
    }
  });

  test("four-square decrypt(encrypt(x)) is x as digraphs", async () => {
    const next = rng(42);
    for (let trial = 0; trial < 30; trial++) {
      const k1 = letters(next, Math.floor(next() * 8));
      const k2 = letters(next, Math.floor(next() * 8));
      const text = letters(next, 1 + Math.floor(next() * 40));
      const ct = outText(await call("four-square-encrypt", text, [k1, k2, "X"]));
      expect(outText(await call("four-square-decrypt", ct, [k1, k2]))).toBe(digraphs(text));
    }
  });

  test("Hill decrypt(encrypt(x)) is x padded to whole blocks", async () => {
    const next = rng(43);
    for (let trial = 0; trial < 30; trial++) {
      const key = trial % 2 === 0 ? "3325" : "GYBNQKURP";
      const fmt = "letters";
      const k = key === "3325" ? "3 3 2 5" : key;
      const f = key === "3325" ? "numbers" : fmt;
      const n = key === "3325" ? 2 : 3;
      const text = letters(next, 1 + Math.floor(next() * 30));
      const padded = text + "X".repeat((n - (text.length % n)) % n);
      const ct = outText(await call("hill-encrypt", text, [k, f, "X"]));
      expect(outText(await call("hill-decrypt", ct, [k, f]))).toBe(padded);
    }
  });
});

describe("polygraphic: errors", () => {
  test("Hill: a non-invertible key is E_RANGE", async () => {
    const r = await call("hill-encrypt", "HELP", ["2244", "numbers", "X"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("Hill: a key of the wrong size is E_RANGE", async () => {
    const r = await call("hill-encrypt", "HELP", ["1 2 3 4 5", "numbers", "X"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("Hill: a key value above 25 is E_RANGE", async () => {
    const r = await call("hill-encrypt", "HELP", ["26 3 2 5", "numbers", "X"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("Hill decrypt of letters that are not whole blocks is E_COERCE", async () => {
    const r = await call("hill-decrypt", "HEL", ["3 3 2 5", "numbers"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("Playfair decrypt of an odd count is E_COERCE", async () => {
    const r = await call("playfair-decrypt", "ABC", ["", "j"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("an omit choice other than j or i is rejected", async () => {
    const r = await call("playfair-encrypt", "AB", ["", "x", "X"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });
});

describe("polygraphic: size", () => {
  test("64 KiB of letters through Playfair round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const ct = await call("playfair-encrypt", text, ["monarchy", "j", "X"]);
    expect(ct.ok).toBe(true);
    const back = await runtime.call("polygraphic:playfair-decrypt", [
      top(ct) as never,
      str("monarchy"),
      str("j"),
    ]);
    expect(back.ok).toBe(true);
    expect(asciiText(top(back).v as Uint8Array)).toBe(digraphs(text));
  }, 60_000);
});
