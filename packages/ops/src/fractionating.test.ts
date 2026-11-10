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

// fractionating is FL (vocab/fractionating.fth); these tests drive its public words through the runtime.
// The published worked examples are in vocab/fractionating.test.json.
const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["fractionating"]));
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

async function call(word: string, data: string, key: string) {
  return runtime.call(`fractionating:${word}`, [bytes(asciiBytes(data)), str(key)]);
}

function outText(r: Awaited<ReturnType<typeof call>>): string {
  expect(r.ok).toBe(true);
  return asciiText(top(r).v as Uint8Array);
}

describe("fractionating: polybius", () => {
  test("plain square: HELLO is 2315313134", async () => {
    expect(outText(await call("polybius-encrypt", "HELLO", ""))).toBe("2315313134");
    expect(outText(await call("polybius-decrypt", "2315313134", ""))).toBe("HELLO");
  });

  test("round trip over random letters and keys (J is I)", async () => {
    const next = rng(51);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, Math.floor(next() * 12));
      const text = letters(next, Math.floor(next() * 50));
      const digits = outText(await call("polybius-encrypt", text, key));
      expect(digits.length).toBe(text.length * 2);
      expect(outText(await call("polybius-decrypt", digits, key))).toBe(text.replaceAll("J", "I"));
    }
  });

  test("64 KiB of letters round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const digits = outText(await call("polybius-encrypt", text, "POLYBIUSCIPHER"));
    expect(digits.length).toBe(131072);
    expect(outText(await call("polybius-decrypt", digits, "POLYBIUSCIPHER"))).toBe(
      text.replaceAll("J", "I"),
    );
  }, 60_000);
});

// Words with more than the (data, key) pair: params are passed in declaration order.
async function callWith(word: string, data: string, params: readonly (string | number)[]) {
  return runtime.call(`fractionating:${word}`, [
    bytes(asciiBytes(data)),
    ...params.map((p) => (typeof p === "number" ? int(p) : str(p))),
  ]);
}

function errorCode(r: { ok: boolean; error?: { code: string } }): string | undefined {
  return r.ok ? undefined : r.error?.code;
}

describe("fractionating: nihilist", () => {
  const NUMBERS = "37 106 62 36 67 47 86 26 104 53 62 77 27 55 57 66 55 36 54 27";

  test("published example, square ZEBRAS and key RUSSIAN (Wikipedia)", async () => {
    expect(
      outText(await callWith("nihilist-encrypt", "DYNAMITE WINTER PALACE", ["RUSSIAN", "ZEBRAS"])),
    ).toBe(NUMBERS);
    expect(outText(await callWith("nihilist-decrypt", NUMBERS, ["RUSSIAN", "ZEBRAS"]))).toBe(
      "DYNAMITEWINTERPALACE",
    );
  });

  test("plain square: HELLO with key A is 34 26 42 42 45", async () => {
    expect(outText(await callWith("nihilist-encrypt", "HELLO", ["A", ""]))).toBe("34 26 42 42 45");
  });

  test("round trip over random letters, keys and squares (J is I)", async () => {
    const next = rng(61);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 10));
      const square = letters(next, Math.floor(next() * 12));
      const text = letters(next, Math.floor(next() * 50));
      const nums = outText(await callWith("nihilist-encrypt", text, [key, square]));
      expect(outText(await callWith("nihilist-decrypt", nums, [key, square]))).toBe(
        text.replaceAll("J", "I"),
      );
    }
  });

  test("a number that is no sum of two cells is E_COERCE", async () => {
    const r = await callWith("nihilist-decrypt", "99", ["R", "ZEBRAS"]);
    expect(errorCode(r)).toBe("E_COERCE");
  });

  test("a key with a digit is rejected", async () => {
    const r = await callWith("nihilist-encrypt", "ABC", ["R1", ""]);
    expect(errorCode(r)).toBe("E_PARAM_INVALID");
  });

  test("64 KiB of letters round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const nums = outText(await callWith("nihilist-encrypt", text, ["POLYBIUSCIPHER", "ZEBRAS"]));
    expect(outText(await callWith("nihilist-decrypt", nums, ["POLYBIUSCIPHER", "ZEBRAS"]))).toBe(
      text.replaceAll("J", "I"),
    );
  }, 60_000);
});

describe("fractionating: ADFGX and ADFGVX", () => {
  const ADFGX_KEY = "BTALPDHOZKQFVSNGICUXMREWY";
  const ADFGVX_KEY = "NA1C3H8TB2OME5WRPD4F6G7I9J0KLQSUVXYZ";

  test("ADFGX published example ATTACKATONCE (Wikipedia)", async () => {
    const ct = "FAXDFADDDGDGFFFAFAXAFAFX";
    expect(
      outText(await callWith("adfgx-encrypt", "ATTACKATONCE", [ADFGX_KEY, "CARGO", "adfgx"])),
    ).toBe(ct);
    expect(outText(await callWith("adfgx-decrypt", ct, [ADFGX_KEY, "CARGO", "adfgx"]))).toBe(
      "ATTACKATONCE",
    );
  });

  test("ADFGVX published example attack at 1200am (Wikipedia)", async () => {
    const ct = "DGDDDAGDDGAFADDFDADVDVFAADVX";
    expect(
      outText(
        await callWith("adfgx-encrypt", "attack at 1200am", [ADFGVX_KEY, "PRIVACY", "adfgvx"]),
      ),
    ).toBe(ct);
    expect(outText(await callWith("adfgx-decrypt", ct, [ADFGVX_KEY, "PRIVACY", "adfgvx"]))).toBe(
      "ATTACKAT1200AM",
    );
  });

  test("round trip over random letters and keys: ADFGX (J is I) and ADFGVX (digits too)", async () => {
    const next = rng(71);
    for (let trial = 0; trial < 30; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 20));
      const trkey = letters(next, 1 + Math.floor(next() * 8));
      const text = letters(next, Math.floor(next() * 50));
      const ct = outText(await callWith("adfgx-encrypt", text, [key, trkey, "adfgx"]));
      expect(outText(await callWith("adfgx-decrypt", ct, [key, trkey, "adfgx"]))).toBe(
        text.replaceAll("J", "I"),
      );
      const vtext = text + String(trial).padStart(4, "7");
      const vct = outText(await callWith("adfgx-encrypt", vtext, [key, trkey, "adfgvx"]));
      expect(outText(await callWith("adfgx-decrypt", vct, [key, trkey, "adfgvx"]))).toBe(
        vtext.toUpperCase(),
      );
    }
  });

  test("an odd count of labels is E_COERCE", async () => {
    const r = await callWith("adfgx-decrypt", "FAXDFADDDGDGFFFAFAXAFAFXA", [
      ADFGX_KEY,
      "CARGO",
      "adfgx",
    ]);
    expect(errorCode(r)).toBe("E_COERCE");
  });

  test("a letter that is no label of ADFGX is E_COERCE", async () => {
    const r = await callWith("adfgx-decrypt", "ZZAA", [ADFGX_KEY, "CARGO", "adfgx"]);
    expect(errorCode(r)).toBe("E_COERCE");
  });

  test("an unknown variant is rejected", async () => {
    const r = await callWith("adfgx-encrypt", "ABC", [ADFGX_KEY, "CARGO", "xxx"]);
    expect(r.ok).toBe(false);
  });

  test("64 KiB of letters and digits round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const ct = outText(
      await callWith("adfgx-encrypt", text, [ADFGVX_KEY, "ZEBRASQUARTZ", "adfgvx"]),
    );
    expect(
      outText(await callWith("adfgx-decrypt", ct, [ADFGVX_KEY, "ZEBRASQUARTZ", "adfgvx"])),
    ).toBe(text);
  }, 60_000);
});

describe("fractionating: trifid", () => {
  test("published example aide-toi, le ciel t'aidera, period 5 (Wikipedia)", async () => {
    expect(
      outText(
        await callWith("trifid-encrypt", "aide-toi, le ciel t'aidera", ["FELIXMARDELASTELLE", 5]),
      ),
    ).toBe("FMJFVOISSUFTFPUFEQQC");
    expect(
      outText(await callWith("trifid-decrypt", "FMJFVOISSUFTFPUFEQQC", ["FELIXMARDELASTELLE", 5])),
    ).toBe("AIDETOILECIELTAIDERA");
  });

  test("plain cube with the default period 5: ABCDEFGHI is AABKTAF+F, and back", async () => {
    expect(outText(await callWith("trifid-encrypt", "ABCDEFGHI", ["", 5]))).toBe("AABKTAF+F");
    expect(outText(await callWith("trifid-decrypt", "AABKTAF+F", ["", 5]))).toBe("ABCDEFGHI");
  });

  test("round trip over random letters, keys and periods", async () => {
    const next = rng(81);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, Math.floor(next() * 12));
      const period = 1 + Math.floor(next() * 9);
      const text = letters(next, Math.floor(next() * 60));
      const ct = outText(await callWith("trifid-encrypt", text, [key, period]));
      expect(ct.length).toBe(text.length);
      expect(outText(await callWith("trifid-decrypt", ct, [key, period]))).toBe(text);
    }
  });

  test("a period of 0 is rejected", async () => {
    const r = await callWith("trifid-encrypt", "ABC", ["", 0]);
    expect(r.ok).toBe(false);
  });

  test("64 KiB of letters round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const ct = outText(await callWith("trifid-encrypt", text, ["ZEBRASQUARTZ", 5]));
    expect(outText(await callWith("trifid-decrypt", ct, ["ZEBRASQUARTZ", 5]))).toBe(text);
  }, 60_000);
});
