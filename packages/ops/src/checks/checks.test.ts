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

/* Tests for the check evaluator (WP 6.23) and the import guard of its entry point. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "fflate";
import type { MagicCheck, MagicTest } from "@forge/lang";
import { describe, expect, test } from "vitest";
import type { ChecksOp } from "../types.js";
import {
  BINARY_MIN_BYTES,
  CHECK_PREFIX_BYTES,
  UTF8_WHOLE_CAP,
  dataView,
  evaluateChecks,
  evaluateTest,
  expectedName,
  scoreChecks,
} from "./index.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const chk = (test: MagicTest, scope: "input" | "output" = "input"): MagicCheck => ({ scope, test });
const ev = (test: MagicTest, data: Uint8Array) => evaluateTest(test, data);

/** Deterministic pseudo-random bytes (xorshift). */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = (x >>> 0) & 0xff;
  }
  return out;
}

describe("limits", () => {
  test("the constants", () => {
    expect(CHECK_PREFIX_BYTES).toBe(4096);
    expect(UTF8_WHOLE_CAP).toBe(1_048_576);
    expect(BINARY_MIN_BYTES).toBe(16);
  });
});

describe("test kinds, both outcomes", () => {
  test("regex", () => {
    expect(ev({ kind: "regex", pattern: "^-----BEGIN" }, enc("-----BEGIN X"))).toBe("pass");
    expect(ev({ kind: "regex", pattern: "^-----BEGIN" }, enc("hello"))).toBe("fail");
  });
  test("charset, with ranges and a share", () => {
    const b64 = { kind: "charset", alphabet: "A-Za-z0-9+/=", min: 1 } as const;
    expect(ev(b64, enc("QUJDREVG/+=="))).toBe("pass");
    expect(ev(b64, enc("QUJD REVG"))).toBe("fail");
    expect(ev({ ...b64, min: 0.8 }, enc("QUJDREVG!!"))).toBe("pass");
    expect(ev({ kind: "charset", alphabet: "a-c-e", min: 1 }, enc("ab-e"))).toBe("pass");
    expect(ev({ kind: "charset", alphabet: "a-c-e", min: 1 }, enc("d"))).toBe("fail");
    expect(ev({ kind: "charset", alphabet: "à-ÿ", min: 1 }, enc("éè"))).toBe("pass");
  });
  test("entropy", () => {
    expect(ev({ kind: "entropy", min: 7, max: 8 }, randomBytes(4096))).toBe("pass");
    expect(ev({ kind: "entropy", min: 7, max: 8 }, enc("aaaaaaaaaaaaaaaa"))).toBe("fail");
    expect(ev({ kind: "entropy", min: 0, max: 0.5 }, enc("aaaaaaaaaaaaaaaa"))).toBe("pass");
  });
  test("printable", () => {
    expect(ev({ kind: "printable", min: 0.9 }, enc("Hello, world\n\t"))).toBe("pass");
    expect(ev({ kind: "printable", min: 0.9 }, randomBytes(256))).toBe("fail");
    expect(ev({ kind: "printable", min: 0.9 }, new Uint8Array([0, 1, 2, 3, 65]))).toBe("fail");
  });
  test("magic-bytes hex at an offset", () => {
    const gz = new Uint8Array([0x1f, 0x8b, 8, 0]);
    expect(ev({ kind: "magic-bytes", hex: "1f8b", offset: 0 }, gz)).toBe("pass");
    expect(ev({ kind: "magic-bytes", hex: "1F8B", offset: 0 }, gz)).toBe("pass");
    expect(ev({ kind: "magic-bytes", hex: "8b08", offset: 1 }, gz)).toBe("pass");
    expect(ev({ kind: "magic-bytes", hex: "8b08", offset: 0 }, gz)).toBe("fail");
    expect(ev({ kind: "magic-bytes", hex: "0000", offset: 3 }, gz)).toBe("fail"); // past the end
    expect(ev({ kind: "magic-bytes", hex: "zz", offset: 0 }, gz)).toBe("unknown"); // bad hex
  });
  test("magic-bytes format", () => {
    const gz = gzipSync(enc("hello hello hello"));
    expect(ev({ kind: "magic-bytes", format: "gzip" }, gz)).toBe("pass");
    expect(ev({ kind: "magic-bytes", format: "gzip" }, enc("plain text here"))).toBe("fail");
    expect(ev({ kind: "magic-bytes", format: "no-such-signature-id" }, gz)).toBe("fail");
  });
  test("utf8", () => {
    expect(ev({ kind: "utf8" }, enc("héllo \u{1F600}"))).toBe("pass");
    expect(ev({ kind: "utf8" }, new Uint8Array([0x68, 0xff, 0xfe]))).toBe("fail");
    expect(ev({ kind: "utf8" }, new Uint8Array([0xc0, 0xaf]))).toBe("fail"); // overlong
  });
});

describe("binary", () => {
  test("text fails, gzip and random bytes pass", () => {
    expect(ev({ kind: "binary" }, enc("This is plain UTF-8 text, long enough."))).toBe("fail");
    expect(ev({ kind: "binary" }, gzipSync(enc("hello hello hello hello hello")))).toBe("pass");
    expect(ev({ kind: "binary" }, randomBytes(512))).toBe("pass");
  });
  test("15 bytes are unknown, 16 are decided", () => {
    const bin = new Uint8Array(16).fill(0xff);
    expect(ev({ kind: "binary" }, bin.subarray(0, 15))).toBe("unknown");
    expect(ev({ kind: "binary" }, bin)).toBe("pass");
    expect(ev({ kind: "binary" }, enc("abcdefghijklmnop"))).toBe("fail");
  });
  test("an over-cap blob is unknown, for binary and utf8", () => {
    const big = new Uint8Array(UTF8_WHOLE_CAP + 1).fill(0x61);
    expect(ev({ kind: "binary" }, big)).toBe("unknown");
    expect(ev({ kind: "utf8" }, big)).toBe("unknown");
    const atCap = new Uint8Array(UTF8_WHOLE_CAP).fill(0x61);
    expect(ev({ kind: "utf8" }, atCap)).toBe("pass");
    expect(ev({ kind: "binary" }, atCap)).toBe("fail");
  });
  test("the validity is computed once and shared", () => {
    const v = dataView(enc("shared text"));
    expect(v.utf8Validity).toBe("valid");
    expect(v.utf8Validity).toBe("valid");
    expect(evaluateTest({ kind: "utf8" }, v)).toBe("pass");
    expect(evaluateTest({ kind: "binary" }, v)).toBe("unknown"); // 11 bytes
  });
});

describe("the prefix bound", () => {
  const base = (): Uint8Array => new Uint8Array(CHECK_PREFIX_BYTES + 100).fill(0x61);
  test("a differing byte past 4 KiB does not matter, one before it does", () => {
    const all = chk({ kind: "charset", alphabet: "a", min: 1 });
    const past = base();
    past[CHECK_PREFIX_BYTES] = 0x21;
    expect(evaluateChecks([all], past, "input").result).toBe("pass");
    const before = base();
    before[CHECK_PREFIX_BYTES - 1] = 0x21;
    expect(evaluateChecks([all], before, "input").result).toBe("fail");
    const entropyAll = chk({ kind: "entropy", min: 0, max: 0 });
    expect(evaluateChecks([entropyAll], past, "input").result).toBe("pass");
    expect(evaluateChecks([entropyAll], before, "input").result).toBe("fail");
    const rx = chk({ kind: "regex", pattern: "^a+!" });
    expect(evaluateChecks([rx], past, "input").result).toBe("fail");
    const inside = base();
    inside[10] = 0x21;
    expect(evaluateChecks([rx], inside, "input").result).toBe("pass");
  });
  test("magic-bytes reads only its offset", () => {
    const d = base();
    d[4000] = 0x7f;
    expect(ev({ kind: "magic-bytes", hex: "7f", offset: 4000 }, d)).toBe("pass");
    d[4000] = 0x7e;
    expect(ev({ kind: "magic-bytes", hex: "7f", offset: 4000 }, d)).toBe("fail");
  });
  test("utf8 sees the whole data, past the prefix", () => {
    const d = base();
    d[CHECK_PREFIX_BYTES + 50] = 0xff;
    expect(ev({ kind: "utf8" }, d)).toBe("fail");
    expect(ev({ kind: "binary" }, d)).toBe("pass");
  });
  test("a multi-byte character cut at the prefix end does not count against printable", () => {
    const d = new Uint8Array(CHECK_PREFIX_BYTES + 10).fill(0x61);
    d.set([0xe2, 0x82, 0xac], CHECK_PREFIX_BYTES - 1); // euro sign across the boundary
    expect(ev({ kind: "printable", min: 1 }, d)).toBe("pass");
  });
});

describe("unknown cases", () => {
  const kinds: MagicTest[] = [
    { kind: "regex", pattern: "a" },
    { kind: "charset", alphabet: "a", min: 1 },
    { kind: "entropy", min: 0, max: 8 },
    { kind: "magic-bytes", hex: "00", offset: 0 },
    { kind: "magic-bytes", format: "gzip" },
    { kind: "printable", min: 0.5 },
    { kind: "utf8" },
    { kind: "binary" },
  ];
  test("empty data is unknown for every test", () => {
    for (const k of kinds) expect(ev(k, new Uint8Array(0)), k.kind).toBe("unknown");
    expect(
      evaluateChecks(
        kinds.map((k) => chk(k)),
        new Uint8Array(0),
        "input",
      ).result,
    ).toBe("unknown");
  });
  test("a bad regex is unknown, and nothing throws", () => {
    expect(ev({ kind: "regex", pattern: "(" }, enc("abc"))).toBe("unknown");
    expect(ev({ kind: "regex", pattern: "[" }, enc("abc"))).toBe("unknown");
    expect(() =>
      evaluateChecks([chk({ kind: "regex", pattern: "(" })], enc("x"), "input"),
    ).not.toThrow();
  });
  test("an end-anchored regex over a truncated prefix is unknown", () => {
    const big = new Uint8Array(CHECK_PREFIX_BYTES + 1).fill(0x61);
    expect(ev({ kind: "regex", pattern: "a$" }, big)).toBe("unknown");
    expect(ev({ kind: "regex", pattern: "(a|b)$" }, big)).toBe("unknown");
    // not an anchor: escaped, or inside a class
    expect(ev({ kind: "regex", pattern: "a\\$" }, big)).toBe("fail");
    expect(ev({ kind: "regex", pattern: "[$]" }, big)).toBe("fail");
    expect(ev({ kind: "regex", pattern: "^a" }, big)).toBe("pass");
    // whole data: the anchor is decided
    expect(ev({ kind: "regex", pattern: "a$" }, enc("aaa"))).toBe("pass");
    expect(ev({ kind: "regex", pattern: "b$" }, enc("aaa"))).toBe("fail");
  });
});

describe("combination", () => {
  const text = enc("hello world, plain text");
  test("all checks of the scope must pass", () => {
    const pass = chk({ kind: "utf8" });
    const failing = chk({ kind: "regex", pattern: "^zzz" });
    expect(evaluateChecks([pass, pass], text, "input")).toEqual({ result: "pass" });
    const r = evaluateChecks(
      [pass, failing, chk({ kind: "regex", pattern: "^yyy" })],
      text,
      "input",
    );
    expect(r.result).toBe("fail");
    expect(r.failed).toBe(failing);
  });
  test("only the asked scope counts", () => {
    const outFail = chk({ kind: "regex", pattern: "^zzz" }, "output");
    expect(evaluateChecks([outFail], text, "input").result).toBe("pass");
    expect(evaluateChecks([outFail], text, "output").result).toBe("fail");
  });
  test("no check in scope passes vacuously", () => {
    expect(evaluateChecks([], text, "input")).toEqual({ result: "pass" });
  });
  test("any fail beats unknown, unknown beats pass", () => {
    const short = enc("abc");
    const u = chk({ kind: "binary" });
    const f = chk({ kind: "regex", pattern: "^zzz" });
    const p = chk({ kind: "regex", pattern: "^abc" });
    expect(evaluateChecks([p, u], short, "input").result).toBe("unknown");
    expect(evaluateChecks([u, f], short, "input")).toEqual({ result: "fail", failed: f });
    expect(evaluateChecks([p], short, "input").result).toBe("pass");
  });
  test("magic-bytes checks are alternatives", () => {
    const gz = gzipSync(enc("hello hello hello"));
    const png = chk({ kind: "magic-bytes", hex: "89504e47", offset: 0 });
    const gzf = chk({ kind: "magic-bytes", format: "gzip" });
    const gzh = chk({ kind: "magic-bytes", hex: "1f8b", offset: 0 });
    expect(evaluateChecks([png, gzf], gz, "input").result).toBe("pass");
    expect(evaluateChecks([png, gzh], gz, "input").result).toBe("pass");
    expect(evaluateChecks([gzf, png], text, "input")).toEqual({ result: "fail", failed: gzf });
    // other checks still all have to hold
    const noMatch = chk({ kind: "regex", pattern: "^nope" });
    expect(evaluateChecks([png, gzf, noMatch], gz, "input").failed).toBe(noMatch);
    // a magic group with an unknown member and no pass is unknown
    const bad = chk({ kind: "magic-bytes", hex: "zz", offset: 0 });
    expect(evaluateChecks([png, bad], gz, "input").result).toBe("unknown");
    expect(evaluateChecks([bad, gzf], gz, "input").result).toBe("pass");
  });
  test("scoreChecks is the share of passing units", () => {
    const gz = gzipSync(enc("hello hello hello"));
    const png = chk({ kind: "magic-bytes", hex: "89504e47", offset: 0 });
    const gzf = chk({ kind: "magic-bytes", format: "gzip" });
    const yes = chk({ kind: "binary" });
    const no = chk({ kind: "printable", min: 0.99 });
    expect(scoreChecks([], gz, "input")).toBe(1);
    expect(scoreChecks([png, gzf], gz, "input")).toBe(1);
    expect(scoreChecks([png, gzf, yes, no], gz, "input")).toBeCloseTo(2 / 3);
    expect(scoreChecks([png], gz, "input")).toBe(0);
    const v = dataView(gz);
    expect(scoreChecks([yes], v, "input")).toBe(1);
    expect(scoreChecks([yes], v, "output")).toBe(1);
  });
});

describe("expectedName", () => {
  const gzipOp: ChecksOp = {
    expects: null,
    checks: [chk({ kind: "regex", pattern: "x" }), chk({ kind: "magic-bytes", format: "gzip" })],
  };
  test("expects text first", () => {
    expect(expectedName({ ...gzipOp, expects: "a gzip stream" })).toBe("a gzip stream");
  });
  test("else the display name of the first format signature", () => {
    expect(expectedName(gzipOp)).toBe("gzip data");
    expect(
      expectedName({
        expects: null,
        checks: [
          chk({ kind: "magic-bytes", format: "no-such-id" }),
          chk({ kind: "magic-bytes", format: "gzip" }),
        ],
      }),
    ).toBe("gzip data");
  });
  test("else undefined", () => {
    expect(expectedName(undefined)).toBeUndefined();
    expect(expectedName({ expects: null, checks: [] })).toBeUndefined();
    expect(
      expectedName({
        expects: null,
        checks: [chk({ kind: "magic-bytes", hex: "1f8b", offset: 0 })],
      }),
    ).toBeUndefined();
    expect(
      expectedName({
        expects: null,
        checks: [chk({ kind: "magic-bytes", format: "gzip" }, "output")],
      }),
    ).toBeUndefined();
  });
});

describe("timing", () => {
  test("1000 evaluations over 4 KiB stay under the budget (2000 ms)", () => {
    const data = new Uint8Array(CHECK_PREFIX_BYTES);
    const phrase = enc("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ");
    for (let i = 0; i < data.length; i++) data[i] = phrase[i % phrase.length] as number;
    const checks: MagicCheck[] = [
      chk({ kind: "regex", pattern: "ipsum\\s+dolor" }),
      chk({ kind: "charset", alphabet: "A-Za-z ,.", min: 0.95 }),
      chk({ kind: "entropy", min: 3, max: 6 }),
      chk({ kind: "printable" as const, min: 0.9 }),
      chk({ kind: "magic-bytes", format: "gzip" }),
      chk({ kind: "magic-bytes", hex: "4c6f", offset: 0 }),
      chk({ kind: "utf8" }),
      chk({ kind: "binary" }),
    ];
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) evaluateChecks(checks, data, "input"); // a fresh view each time
    const ms = performance.now() - t0;
    console.log(`1000 evaluations of ${checks.length} checks over 4 KiB: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

/** POSIX path helpers (the ops package has no Node typings): `dirname`, and `resolve` of a relative path. */
const dirname = (f: string): string => f.slice(0, f.lastIndexOf("/"));
function resolve(base: string, ...rest: string[]): string {
  const parts = base.split("/");
  for (const r of rest) {
    for (const seg of r.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== "." && seg !== "") parts.push(seg);
    }
  }
  return parts.join("/");
}

describe("import guard", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = resolve(dir, "..");
  const IMPORT =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

  function graph(entry: string): Set<string> {
    const seen = new Set<string>();
    const todo = [entry];
    while (todo.length > 0) {
      const file = todo.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(IMPORT)) {
        const spec = (m[1] ?? m[2]) as string;
        if (!spec.startsWith(".")) continue;
        todo.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
      }
    }
    return seen;
  }

  test("src/checks/index.ts does not reach prims/ or bundle*", () => {
    const files = [...graph(resolve(src, "checks/index.ts"))].map((f) => f.slice(src.length + 1));
    expect(files).toContain("checks/evaluate.ts");
    expect(files).toContain("filetype-sigs.ts");
    expect(files).toContain("regex-engine.ts");
    for (const f of files) {
      expect(f.startsWith("prims/"), f).toBe(false);
      expect(/^bundle/.test(f), f).toBe(false);
      expect(f.includes("vocab"), f).toBe(false);
    }
  });
});
