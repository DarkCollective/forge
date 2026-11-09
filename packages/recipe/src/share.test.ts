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
import { afterEach, describe, expect, test, vi } from "vitest";
import { Rng, genRecipe } from "../test/gen.js";
import { combined, extras, golden, recipeOf, seed } from "../test/helpers.js";
import { deflateRaw } from "./deflate.js";
import { base64UrlEncode, utf8Encode } from "./encoding.js";
import { normaliseRecipe } from "./normalise.js";
import { decodeShare, encodeShare } from "./share.js";
import { SHARE_ERROR_CODES, SHARE_LIMITS } from "./types.js";
import { validateRecipe } from "./validate.js";
import type { DecodeShareResult, EncodeShareResult, Recipe, ShareErrorCode } from "./types.js";

const GATE = {
  forge: 1,
  steps: [
    { kind: "op", op: "base64:decode", params: { alphabet: "standard" } },
    { kind: "op", op: "classical:rot", params: { amount: 13 } },
    { kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } },
  ],
} as unknown as Recipe;

const text = (s: string) => new TextEncoder().encode(s);

/** A fragment of exactly `length` characters whose recipe is `{}`. */
function padded(length: number): string {
  const head = `v=1&r=0e30&zz=`;
  return head + "A".repeat(length - head.length);
}

function stored(bytes: Uint8Array): string {
  return `0${base64UrlEncode(bytes)}`;
}

async function packed(bytes: Uint8Array): Promise<string> {
  return `1${base64UrlEncode(await deflateRaw(bytes))}`;
}

function errorOf(result: DecodeShareResult | EncodeShareResult): ShareErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeShare: the golden of RECIPES.md section 12.5", () => {
  const fragment = golden("gate.share.txt").trim();

  test("decodes to the Gate recipe, the input bytes and the input encoding", async () => {
    const result = await decodeShare(fragment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe).toEqual(GATE);
    expect(JSON.stringify(result.recipe)).toHaveLength(224);
    expect(new TextDecoder().decode(result.input)).toBe("VXJ5eWIsIEpiZXlxIQ==");
    expect(result.inputEncoding).toBe("utf8");
    expect(result.warnings).toEqual([]);
  });

  test("with or without the leading #, with a catalogue", async () => {
    const bare = fragment.slice(1);
    for (const f of [fragment, bare]) {
      const result = await decodeShare(f, { catalogue: seed });
      expect(result.ok).toBe(true);
    }
  });

  test("the recipe payload is deflated and the input payload is stored", () => {
    const pairs = Object.fromEntries(
      fragment
        .slice(1)
        .split("&")
        .map((p) => p.split("=")),
    );
    expect(pairs.r?.[0]).toBe("1");
    expect(pairs.i?.[0]).toBe("0");
    expect(pairs.i).toBe("0VlhKNWVXSXNJRXBpWlhseElRPT0");
  });

  test("the hostile fragments of 12.5", async () => {
    const codes = await Promise.all(
      [
        "#v=2&r=0e30",
        "#r=0e30",
        "#v=1&r=0e30&r=0e30",
        "#v=1&r=0e30",
        "#v=1&r=0A",
        "#v=1&r=1!!!!",
      ].map(async (f) => errorOf(await decodeShare(f))),
    );
    expect(codes).toEqual([
      "unsupported-version",
      "malformed",
      "malformed",
      "invalid-recipe",
      "bad-base64",
      "malformed",
    ]);
    const empty = await decodeShare("#v=1&r=0e30");
    expect(!empty.ok && empty.error.issues?.map((i) => [i.code, i.path])).toEqual([
      ["required", "/forge"],
      ["required", "/steps"],
    ]);
  });
});

describe("decodeShare: hostile fragments (RECIPES.md section 7.5)", () => {
  const ok = `v=1&r=${stored(text('{"forge":1,"steps":[]}'))}`;

  test.each<[string, string, ShareErrorCode | "ok"]>([
    ["70 000 characters", `#v=1&r=0${"A".repeat(70_000)}`, "fragment-too-long"],
    ["exactly the limit is not too long", padded(65_536), "invalid-recipe"],
    ["one over the limit", padded(65_537), "fragment-too-long"],
    ["empty fragment", "", "malformed"],
    ["just a hash", "#", "malformed"],
    ["empty value", "#r=", "malformed"],
    ["v and an empty r", "#v=1&r=", "malformed"],
    ["ie without i", "#v=1&r=0e30&ie=hex", "malformed"],
    ["no r", "#v=1&i=0e30", "malformed"],
    ["trailing bit", "#v=1&r=0e31", "bad-base64"],
    ["version 2", "#v=2&r=0e30", "unsupported-version"],
    ["version 01", "#v=01&r=0e30", "unsupported-version"],
    ["no v", "#r=0e30", "malformed"],
    ["v not first", "#r=0e30&v=1", "malformed"],
    ["r twice", "#v=1&r=0e30&r=0e30", "malformed"],
    ["v twice", "#v=1&v=1&r=0e30", "malformed"],
    ["i twice", "#v=1&r=0e30&i=0&i=0", "malformed"],
    ["nine pairs", "#v=1&r=0e30&a=1&b=1&c=1&d=1&e=1&f=1&g=1", "malformed"],
    ["eight pairs are fine", "#v=1&r=0e30&a=1&b=1&c=1&d=1&e=1&f=1", "invalid-recipe"],
    ["ie=ebcdic", "#v=1&r=0e30&i=0&ie=ebcdic", "malformed"],
    ["ie twice", "#v=1&r=0e30&i=0&ie=hex&ie=hex", "malformed"],
    ["a percent sign", "#v=1&r=0e%30", "malformed"],
    ["a plus", "#v=1&r=0e+0", "malformed"],
    ["an equals sign in a value", "#v=1&r=0e=0", "malformed"],
    ["a space", "#v=1&r=0e 0", "malformed"],
    ["a pair without =", "#v=1&r", "malformed"],
    ["an empty key", "#v=1&=1&r=0e30", "malformed"],
    ["an upper case unknown key", "#v=1&r=0e30&Zz=1", "malformed"],
    ["a long unknown key", "#v=1&r=0e30&abcdefghi=1", "malformed"],
    ["an unknown key with a bad value", "#v=1&r=0e30&zz=!", "malformed"],
    ["r=1!!!", "#v=1&r=1!!!", "malformed"],
    ["r=0A", "#v=1&r=0A", "bad-base64"],
    ["padding is not canonical", "#v=1&r=0e30=", "malformed"],
    ["r=2AAAA (unknown method)", "#v=1&r=2AAAA", "malformed"],
    ["r=1 and garbage", "#v=1&r=1AAAAAAAAAAAA", "bad-compression"],
    ["r=1 alone", "#v=1&r=1", "bad-compression"],
    ["i with an unknown method", "#v=1&r=0e30&i=9AA", "malformed"],
    ["i with bad base64", "#v=1&r=0e30&i=0A", "bad-base64"],
    ["unknown keys are ignored", `#${ok}&zz=abc&q9=1`, "ok"],
  ])("%s", async (_name, fragment, code) => {
    expect(errorOf(await decodeShare(fragment))).toBe(code);
  });

  test("a deflate stream followed by one extra byte is bad-compression", async () => {
    const good = await deflateRaw(text('{"forge":1,"steps":[]}'));
    const withExtra = Uint8Array.from([...good, 0]);
    expect(errorOf(await decodeShare(`v=1&r=1${base64UrlEncode(good)}`))).toBe("ok");
    expect(errorOf(await decodeShare(`v=1&r=1${base64UrlEncode(withExtra)}`))).toBe(
      "bad-compression",
    );
  });

  test("inflated bytes that are not UTF-8, not JSON, or 200 000 nested [ are bad-json", async () => {
    const cases = [
      Uint8Array.of(0x7b, 0xff, 0x7d),
      text("not json"),
      text(""),
      text("[".repeat(200_000)),
      Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), // a BOM is data, and JSON.parse rejects it
    ];
    for (const bytes of cases) {
      expect(errorOf(await decodeShare(`v=1&r=${await packed(bytes)}`))).toBe("bad-json");
    }
    expect(errorOf(await decodeShare(`v=1&r=${stored(Uint8Array.of(0xff))}`))).toBe("bad-json");
  });

  test("valid JSON that is not a valid recipe is invalid-recipe with the issues of section 3.7", async () => {
    const cases: [string, string][] = [
      ["[]", "type"],
      ['{"forge":2,"steps":[]}', "bad-version"],
      ['{"forge":1,"steps":[{"kind":"op","op":"nope:x"}]}', "unknown-op"],
    ];
    for (const [json, code] of cases) {
      const result = await decodeShare(`v=1&r=${stored(text(json))}`, { catalogue: seed });
      expect(errorOf(result)).toBe("invalid-recipe");
      expect(!result.ok && result.error.issues?.[0]?.code).toBe(code);
    }
  });

  test("a __proto__ key in params is rejected and Object.prototype is untouched", async () => {
    const json =
      '{"forge":1,"steps":[{"kind":"op","op":"text:upper","params":{"__proto__":{"polluted":true}}}]}';
    for (const catalogue of [undefined, seed]) {
      const result = await decodeShare(`v=1&r=${stored(text(json))}`, { catalogue });
      expect(errorOf(result)).toBe("invalid-recipe");
      expect(!result.ok && result.error.issues?.map((i) => i.path)).toEqual([
        "/steps/0/params/__proto__",
      ]);
    }
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a balanced hostile nesting is bad-json or an invalid-recipe with a limit issue, never a throw", async () => {
    // RECIPES.md 7.5 says 100 000 levels of {"a":{"a":...}}; that is 600 000 bytes, over maxRecipeBytes, so it is too-large
    const objects = (n: number) => text('{"a":'.repeat(n) + "1" + "}".repeat(n));
    expect(errorOf(await decodeShare(`v=1&r=${await packed(objects(100_000))}`))).toBe("too-large");
    // within the byte limit, as deflate (a stored payload this deep would not fit the fragment limit)
    for (const bytes of [objects(40_000), text("[".repeat(100_000) + "]".repeat(100_000))]) {
      const result = await decodeShare(`v=1&r=${await packed(bytes)}`);
      expect(result.ok).toBe(false);
      const code = errorOf(result);
      expect(["bad-json", "invalid-recipe"]).toContain(code);
      if (code === "invalid-recipe") {
        expect(!result.ok && result.error.issues?.[0]).toMatchObject({
          code: "limit",
          detail: { limit: "maxJsonDepth" },
        });
      }
    }
    // a stored payload at the size the fragment allows
    const small = await decodeShare(`v=1&r=${stored(objects(7_000))}`);
    expect(["bad-json", "invalid-recipe"]).toContain(errorOf(small));
  });

  test("a small deflate stream that inflates to far more than the budget is too-large and memory stays bounded", async () => {
    const chunk = new Uint8Array(1 << 20);
    const stream = new CompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const written = (async () => {
      for (let i = 0; i < 48; i++) await writer.write(chunk); // 48 MiB of zeros
      await writer.close();
    })();
    const parts: Uint8Array[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value as Uint8Array);
    }
    await written;
    const bomb = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bomb.set(p, at);
      at += p.length;
    }
    expect(bomb.length).toBeLessThan(65_536 * 0.75); // it fits in a fragment
    const before = process.memoryUsage().arrayBuffers;
    const started = Date.now();
    expect(errorOf(await decodeShare(`v=1&r=1${base64UrlEncode(bomb)}`))).toBe("too-large");
    expect(
      errorOf(await decodeShare(`v=1&r=${stored(text("{}"))}&i=1${base64UrlEncode(bomb)}`)),
    ).toBe("too-large");
    const grown = process.memoryUsage().arrayBuffers - before;
    expect(grown).toBeLessThan(16 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("a stored payload over the budget is too-large", async () => {
    const big = new Uint8Array(SHARE_LIMITS.maxRecipeBytes + 1).fill(0x20);
    // too big for a fragment when stored, so deflate it: method 1 covers the inflated size; method 0 is bounded by the fragment length
    expect(errorOf(await decodeShare(`v=1&r=${await packed(big)}`))).toBe("too-large");
    const limit = new Uint8Array(SHARE_LIMITS.maxInputBytes + 1);
    expect(errorOf(await decodeShare(`v=1&r=${stored(text("{}"))}&i=${await packed(limit)}`))).toBe(
      "too-large",
    );
    const stored50k = new Uint8Array(49_000).fill(0x20);
    const result = await decodeShare(`v=1&r=${stored(stored50k)}`);
    expect(errorOf(result)).toBe("bad-json");
  });

  test("it never throws", async () => {
    const hostile = {
      toString: () => {
        throw new Error("boom");
      },
    };
    expect(errorOf(await decodeShare(hostile as unknown as string))).toBe("malformed");
    expect(errorOf(await decodeShare(undefined as unknown as string))).toBe("malformed");
    expect(errorOf(await decodeShare(null as unknown as string))).toBe("malformed");
  });
});

describe("decodeShare: the result", () => {
  const link = async (recipe: unknown, extra = "") =>
    `v=1&r=${stored(text(JSON.stringify(recipe)))}${extra}`;

  test("the recipe is normalised and rebuilt from a whitelist of keys", async () => {
    const raw = recipeOf(
      [
        { kind: "op", op: "text:upper", params: {}, disabled: false, note: "" },
        { kind: "subsection", pattern: "a", flags: "mi", encoding: "utf8", steps: [] },
        {
          kind: "fork",
          split: { value: "DE AD", enc: "hex" },
          join: { value: "3q2+7w", enc: "base64" },
          steps: [],
        },
      ],
      { name: "" },
    );
    const result = await decodeShare(await link(raw));
    expect(result.ok && JSON.stringify(result.recipe)).toBe(
      '{"forge":1,"steps":[{"kind":"op","op":"text:upper"},{"kind":"subsection","pattern":"a","flags":"im","steps":[]},' +
        '{"kind":"fork","split":{"value":"dead","enc":"hex"},"join":{"value":"3q2+7w==","enc":"base64"},"steps":[]}]}',
    );
  });

  test("warnings: pins, aliases, catalogue", async () => {
    const recipe = {
      forge: 1,
      catalogue: "0000000000000000",
      steps: [
        { kind: "op", op: "classical:rot13" },
        { kind: "op", op: "text:upper", hash: "9".repeat(64) },
      ],
    };
    const f = await link(recipe);
    const warn = await decodeShare(f, { catalogue: seed });
    expect(warn.ok && warn.warnings.map((w) => w.code)).toEqual([
      "catalogue-mismatch",
      "alias-used",
      "hash-mismatch",
    ]);
    const strict = await decodeShare(f, { catalogue: seed, pins: "strict" });
    expect(errorOf(strict)).toBe("invalid-recipe");
    const ignore = await decodeShare(f, { catalogue: seed, pins: "ignore" });
    expect(ignore.ok && ignore.warnings.map((w) => w.code)).toEqual([
      "catalogue-mismatch",
      "alias-used",
    ]);
    const none = await decodeShare(f);
    expect(none.ok && none.warnings).toEqual([]);
  });

  test("inputs and their encoding", async () => {
    for (const ie of ["utf8", "hex", "latin1", "base64"]) {
      const result = await decodeShare(
        await link({ forge: 1, steps: [] }, `&i=${stored(Uint8Array.of(0, 255, 1))}&ie=${ie}`),
      );
      expect(result.ok && [result.inputEncoding, Array.from(result.input ?? [])]).toEqual([
        ie,
        [0, 255, 1],
      ]);
    }
    const noEncoding = await decodeShare(
      await link({ forge: 1, steps: [] }, `&i=${stored(Uint8Array.of(1))}`),
    );
    expect(noEncoding.ok && noEncoding.inputEncoding).toBe("utf8");
    const noInput = await decodeShare(await link({ forge: 1, steps: [] }));
    expect(noInput.ok && "input" in noInput).toBe(false);
    const emptyInput = await decodeShare(await link({ forge: 1, steps: [] }, `&i=0`));
    expect(emptyInput.ok && emptyInput.input?.length).toBe(0);
  });
});

describe("encodeShare", () => {
  test("round trip with and without a catalogue and an input", async () => {
    const encoded = await encodeShare({
      recipe: GATE,
      input: text("VXJ5eWIsIEpiZXlxIQ=="),
      inputEncoding: "utf8",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.fragment.startsWith("v=1&r=")).toBe(true);
    expect(encoded.fragment.endsWith("&ie=utf8")).toBe(true);
    const back = await decodeShare(encoded.fragment);
    expect(back.ok && back.recipe).toEqual(GATE);
    expect(back.ok && new TextDecoder().decode(back.input)).toBe("VXJ5eWIsIEpiZXlxIQ==");
    // with a leading #
    expect((await decodeShare(`#${encoded.fragment}`)).ok).toBe(true);
  });

  test("a catalogue pins steps that have no pin and keeps the pins that are there", async () => {
    const mine = "7".repeat(64);
    const recipe = recipeOf([
      { kind: "op", op: "classical:rot13" },
      { kind: "op", op: "text:upper", hash: mine },
      { kind: "op", op: "unknown:thing" },
      {
        kind: "if",
        test: { kind: "op", op: "regex:test", params: { pattern: "a" } },
        then: [
          { kind: "comment", text: "c" },
          { kind: "op", op: "text:lower" },
        ],
      },
    ]);
    const bad = await encodeShare({ recipe }, { catalogue: seed });
    expect(errorOf(bad)).toBe("invalid-recipe"); // unknown:thing
    const fixed = recipeOf((recipe.steps as unknown[]).filter((_, i) => i !== 2));
    const encoded = await encodeShare({ recipe: fixed }, { catalogue: seed });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const back = await decodeShare(encoded.fragment, { catalogue: seed });
    const hashOf = (q: string) => seed.ops.find((o) => o.qname === q)?.hash;
    expect(back.ok && JSON.parse(JSON.stringify(back.recipe))).toMatchObject({
      steps: [
        { op: "classical:rot13", hash: hashOf("classical:rot") },
        { op: "text:upper", hash: mine },
        {
          test: { op: "regex:test", hash: hashOf("regex:test") },
          then: [{ kind: "comment" }, { op: "text:lower", hash: hashOf("text:lower") }],
        },
      ],
    });
    // without a catalogue nothing is pinned
    const plain = await encodeShare({ recipe: fixed });
    const plainBack = plain.ok ? await decodeShare(plain.fragment) : undefined;
    expect(JSON.stringify(plainBack?.ok && plainBack.recipe)).not.toContain(
      'hash":"' + hashOf("classical:rot"),
    );
  });

  test("secret-in-url warns for key parameters that differ from their default, and only those", async () => {
    const recipe = recipeOf([
      { kind: "op", op: "x:key", params: { key: { value: "ab", enc: "utf8" } } },
      { kind: "op", op: "x:secret", params: { secret: { value: "", enc: "utf8" } } }, // the default
      { kind: "op", op: "x:secret", params: { secret: { value: "s3cret", enc: "utf8" } } },
      { kind: "op", op: "x:secret", params: { secret: { value: "", enc: "hex" } } }, // same text, other encoding
      { kind: "op", op: "x:secret" },
      { kind: "op", op: "x:toggle", params: { mode: { value: "zz", enc: "utf8" } } }, // not secret
      {
        kind: "fork",
        split: { value: "x", enc: "utf8" },
        join: { value: "", enc: "utf8" },
        steps: [
          {
            kind: "if",
            test: { kind: "op", op: "x:pred", params: { needle: "a" } },
            then: [{ kind: "op", op: "x:key", params: { key: { value: "cdef", enc: "hex" } } }],
          },
        ],
      },
    ]);
    const encoded = await encodeShare(
      { recipe, input: text("secret input") },
      { catalogue: extras },
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.warnings.map((w) => [w.code, w.severity, w.path])).toEqual([
      ["secret-in-url", "warning", "/steps/0/params/key"],
      ["secret-in-url", "warning", "/steps/2/params/secret"],
      ["secret-in-url", "warning", "/steps/3/params/secret"],
      ["secret-in-url", "warning", "/steps/6/steps/0/then/0/params/key"],
    ]);
    expect(encoded.warnings[0]?.detail).toEqual({ param: "key" });
    // without a catalogue there is nothing to compare
    const bare = await encodeShare({ recipe });
    expect(bare.ok && bare.warnings).toEqual([]);
  });

  test("warnings of the validator are carried", async () => {
    const encoded = await encodeShare(
      { recipe: recipeOf([{ kind: "op", op: "classical:rot13" }]) },
      { catalogue: seed },
    );
    expect(encoded.ok && encoded.warnings.map((w) => w.code)).toEqual(["alias-used"]);
  });

  test("an invalid recipe is invalid-recipe with its issues", async () => {
    const result = await encodeShare({ recipe: { forge: 2, steps: [] } as unknown as Recipe });
    expect(errorOf(result)).toBe("invalid-recipe");
    expect(!result.ok && result.error.issues?.[0]?.code).toBe("bad-version");
    expect(errorOf(await encodeShare(null as never))).toBe("invalid-recipe");
  });

  test("the payload is deflated only when that is strictly shorter", async () => {
    const tiny = await encodeShare({ recipe: recipeOf([]) });
    expect(tiny.ok && tiny.fragment.split("&")[1]?.startsWith("r=0")).toBe(true);
    const repetitive = recipeOf(
      Array.from({ length: 50 }, () => ({ kind: "op", op: "text:upper", note: "same note" })),
    );
    const big = await encodeShare({ recipe: repetitive });
    expect(big.ok && big.fragment.split("&")[1]?.startsWith("r=1")).toBe(true);
    const input = await encodeShare({ recipe: recipeOf([]), input: new Uint8Array(1000) });
    expect(input.ok && input.fragment).toMatch(/&i=1/);
    const emptyInput = await encodeShare({ recipe: recipeOf([]), input: new Uint8Array(0) });
    expect(emptyInput.ok && emptyInput.fragment).toMatch(/&i=0&ie=utf8$/);
  });

  test("every byte value survives as input", async () => {
    const input = Uint8Array.from({ length: 256 }, (_, i) => i);
    const encoded = await encodeShare({ recipe: recipeOf([]), input, inputEncoding: "hex" });
    const back = encoded.ok ? await decodeShare(encoded.fragment) : undefined;
    expect(back?.ok && Array.from(back.input ?? [])).toEqual(Array.from(input));
    expect(back?.ok && back.inputEncoding).toBe("hex");
  });

  test("limits: too-large, input-too-large, fragment-too-long and a bad inputEncoding", async () => {
    // a recipe that is valid but whose normal form is over the limit: base64 values grow by padding
    const fork = {
      kind: "fork",
      split: { value: "x", enc: "utf8" },
      join: { value: "QQ", enc: "base64" },
      steps: [],
    };
    const forks = Array.from({ length: 150 }, () => fork);
    const full = Array.from({ length: 121 }, () => ({ kind: "comment", text: "c".repeat(2000) }));
    const build = (pad: number) =>
      recipeOf([...forks, ...full, { kind: "comment", text: "c".repeat(pad) }]);
    const sizeOf = (r: unknown) => utf8Encode(JSON.stringify(r)).length;
    const pad = SHARE_LIMITS.maxRecipeBytes - sizeOf(build(0));
    expect(pad).toBeGreaterThan(0);
    expect(pad).toBeLessThanOrEqual(2000);
    expect(sizeOf(build(pad))).toBe(SHARE_LIMITS.maxRecipeBytes);
    expect(validateRecipe(build(pad)).ok).toBe(true);
    expect(sizeOf(normaliseRecipe(build(pad)))).toBeGreaterThan(SHARE_LIMITS.maxRecipeBytes);
    expect(errorOf(await encodeShare({ recipe: build(pad) }))).toBe("too-large");

    expect(
      errorOf(
        await encodeShare({
          recipe: recipeOf([]),
          input: new Uint8Array(SHARE_LIMITS.maxInputBytes + 1),
        }),
      ),
    ).toBe("input-too-large");
    const incompressible = Uint8Array.from({ length: 60_000 }, () => 0).map(
      (_, i) => (i * 2654435761) >>> 24,
    );
    const rng = new Rng(5);
    const noise = Uint8Array.from(incompressible, () => rng.int(256));
    expect(errorOf(await encodeShare({ recipe: recipeOf([]), input: noise }))).toBe(
      "fragment-too-long",
    );
    expect(
      errorOf(
        await encodeShare({
          recipe: recipeOf([]),
          input: text("x"),
          inputEncoding: "ebcdic" as never,
        }),
      ),
    ).toBe("malformed");
  });

  test("when compression is unavailable the payload is stored", async () => {
    vi.stubGlobal(
      "CompressionStream",
      class {
        constructor() {
          throw new Error("no compression");
        }
      },
    );
    const encoded = await encodeShare({ recipe: GATE });
    expect(encoded.ok && encoded.fragment.split("&")[1]?.startsWith("r=0")).toBe(true);
    vi.unstubAllGlobals();
    const back = encoded.ok ? await decodeShare(encoded.fragment) : undefined;
    expect(back?.ok && back.recipe).toEqual(GATE);
  });

  test("a property over generated recipes: decode(encode(r)) is normalise(r)", async () => {
    for (let i = 1; i <= 60; i++) {
      const recipe = genRecipe(new Rng(i * 104729), combined);
      const input = Uint8Array.from({ length: i * 3 }, (_, k) => (k * i) & 255);
      const encoded = await encodeShare(
        { recipe, input, inputEncoding: "base64" },
        { catalogue: combined },
      );
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      const back = await decodeShare(encoded.fragment, { catalogue: combined });
      expect(back.ok).toBe(true);
      if (!back.ok) continue;
      const unpinned = await encodeShare({ recipe });
      const again = unpinned.ok ? await decodeShare(unpinned.fragment) : undefined;
      expect(JSON.stringify(again?.ok && again.recipe)).toBe(
        JSON.stringify(normaliseRecipe(recipe)),
      );
      expect(Array.from(back.input ?? [])).toEqual(Array.from(input));
      expect(back.inputEncoding).toBe("base64");
    }
  });

  test("the error codes are the documented ones", () => {
    expect([...SHARE_ERROR_CODES].sort()).toEqual(
      [
        "bad-base64",
        "bad-compression",
        "bad-json",
        "fragment-too-long",
        "input-too-large",
        "invalid-recipe",
        "malformed",
        "too-large",
        "unsupported-version",
      ].sort(),
    );
  });
});
