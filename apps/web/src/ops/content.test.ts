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
// WP 6.28: the combination rules and the wording of the content tier, on the real evaluator and the built
// checks.json (the cases that name Gunzip, the 6.28 "done when"), and on small synthetic indexes for the rest.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { ChecksDoc, ChecksOp } from "@forge/ops";
import * as checks from "@forge/ops/checks";
import { describe, expect, test } from "vitest";
import { makeEvaluator } from "./checks-data.js";
import type { ChecksIndex } from "./checks-data.js";
import {
  analyseContent,
  contentBytesAtEnd,
  contentHint,
  contentLevel,
  headerLine,
  noteText,
  sameSource,
} from "./content.js";
import type { ContentView, RowNote } from "./content.js";

const evaluator = makeEvaluator(checks);
const doc = JSON.parse(
  readFileSync(new URL("../../../../packages/ops/dist/checks.json", import.meta.url), "utf8"),
) as ChecksDoc;

const indexOf = (ops: Readonly<Record<string, ChecksOp>>): ChecksIndex => {
  const map = new Map(Object.entries(ops));
  return { get: (q) => map.get(q), entries: () => map.entries(), size: map.size };
};
const real = indexOf(doc.ops);

const png = (): Uint8Array =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(7)]);
const gzip = (): Uint8Array => new Uint8Array(gzipSync(Buffer.from("hello hello hello hello")));
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const GUNZIP = "deflate:gunzip";

describe("Gunzip on real data (the checks.json of the build)", () => {
  test("PNG data: amber, and both sides are named", () => {
    const view = analyseContent({ bytes: png(), utf8: "invalid" }, real, evaluator);
    const note = view.rows.get(GUNZIP);
    expect(note).toEqual({ result: "fail", text: "Expects gzip data; this looks like PNG image" });
    expect(contentLevel("fits", note)).toBe("converts");
    expect(headerLine({ type: "bytes", utf8: "invalid" }, view)).toBe("bytes (PNG image)");
  });

  test("a gzip stream: it passes, stays green, and the header says gzip data", () => {
    const view = analyseContent({ bytes: gzip(), utf8: "invalid" }, real, evaluator);
    const note = view.rows.get(GUNZIP);
    expect(note).toEqual({ result: "pass", text: "Expects gzip data" });
    expect(contentLevel("fits", note)).toBe("fits");
    expect(headerLine({ type: "bytes", utf8: "invalid" }, view)).toBe("bytes (gzip data)");
  });

  test("data that is not identified names only the expected side", () => {
    const view = analyseContent({ bytes: Uint8Array.of(1, 2, 3), utf8: "valid" }, real, evaluator);
    expect(view.identification).toBeNull();
    expect(view.rows.get(GUNZIP)?.text).toBe("Expects gzip data");
    expect(view.rows.get(GUNZIP)?.result).toBe("fail");
    expect(headerLine({ type: "bytes", utf8: "valid" }, view)).toBe("bytes (valid text)");
  });

  test("text data says what it is", () => {
    const view = analyseContent(
      { bytes: text("hello world, plain text"), utf8: "valid" },
      real,
      evaluator,
    );
    expect(view.rows.get(GUNZIP)?.text).toBe("Expects gzip data; this is ASCII text");
  });

  test("empty data: the checks are unknown, so nothing changes, and the op still says what it expects", () => {
    const view = analyseContent({ bytes: new Uint8Array(0), utf8: "valid" }, real, evaluator);
    expect(view.rows.get(GUNZIP)).toEqual({ result: "unknown", text: "Expects gzip data" });
    expect(contentLevel("fits", view.rows.get(GUNZIP))).toBe("fits");
    expect(view.identification).toBeNull();
  });
});

describe("a failed binary check names the data it saw", () => {
  const onlyBinary = indexOf({
    "x:needs-binary": { expects: null, checks: [{ scope: "input", test: { kind: "binary" } }] },
  });
  const named = indexOf({
    "x:decrypt": {
      expects: "encrypted data",
      checks: [{ scope: "input", test: { kind: "binary" } }],
    },
  });
  const data = text("this is a perfectly ordinary sentence of text");

  test("without an expects name the check itself gives one", () => {
    const view = analyseContent({ bytes: data, utf8: "valid" }, onlyBinary, evaluator);
    expect(view.rows.get("x:needs-binary")?.text).toBe("Expects binary data; this is ASCII text");
  });

  test("with UTF-8 text that is not ASCII", () => {
    const view = analyseContent(
      { bytes: text("café au lait, bien chaud ce matin"), utf8: "valid" },
      onlyBinary,
      evaluator,
    );
    expect(view.rows.get("x:needs-binary")?.text).toBe("Expects binary data; this is UTF-8 text");
  });

  test("with an expects name it keeps that name", () => {
    const view = analyseContent({ bytes: data, utf8: "valid" }, named, evaluator);
    expect(view.rows.get("x:decrypt")?.text).toBe("Expects encrypted data; this is ASCII text");
  });

  test("a more specific identification of the text is used", () => {
    const view = analyseContent(
      { bytes: text('{"a": 1, "b": [1, 2, 3]}'), utf8: "valid" },
      onlyBinary,
      evaluator,
    );
    expect(view.rows.get("x:needs-binary")?.text).toBe(
      "Expects binary data; this looks like JSON text",
    );
  });

  test("binary data passes the check", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => 0x80 + (i % 100));
    const view = analyseContent({ bytes, utf8: "invalid" }, onlyBinary, evaluator);
    expect(view.rows.get("x:needs-binary")).toEqual({
      result: "pass",
      text: "Expects binary data",
    });
  });
});

describe("the UTF-8 result of WP 6.21 is reused, not decoded again", () => {
  const binaryOp = indexOf({
    "x:b": { expects: "binary thing", checks: [{ scope: "input", test: { kind: "binary" } }] },
  });
  const data = text("0123456789abcdefghij");

  test("the seeded result decides the binary check (the bytes themselves would say otherwise)", () => {
    expect(
      analyseContent({ bytes: data, utf8: "valid" }, binaryOp, evaluator).rows.get("x:b")?.result,
    ).toBe("fail");
    expect(
      analyseContent({ bytes: data, utf8: "invalid" }, binaryOp, evaluator).rows.get("x:b")?.result,
    ).toBe("pass");
  });

  test("an unknown result is left to the evaluator's own rule", () => {
    expect(
      analyseContent({ bytes: data, utf8: "unknown" }, binaryOp, evaluator).rows.get("x:b")?.result,
    ).toBe("fail");
  });

  test("over the evaluator's cap the seeded result still gives an answer", () => {
    const big = new Uint8Array(checks.UTF8_WHOLE_CAP + 10).fill(0x61);
    expect(
      analyseContent({ bytes: big, utf8: "unknown" }, binaryOp, evaluator).rows.get("x:b")?.result,
    ).toBe("unknown");
    expect(
      analyseContent({ bytes: big, utf8: "valid" }, binaryOp, evaluator).rows.get("x:b")?.result,
    ).toBe("fail");
  });
});

describe("the combination rules", () => {
  const note = (result: RowNote["result"]): RowNote => ({ result, text: "Expects x" });

  test("a red from the type fit is never changed", () => {
    for (const r of ["pass", "fail", "unknown", "none"] as const) {
      expect(contentLevel("no", note(r))).toBe("no");
    }
  });
  test("a failed check gives amber, never red", () => {
    expect(contentLevel("fits", note("fail"))).toBe("converts");
    expect(contentLevel("converts", note("fail"))).toBe("converts");
  });
  test("a pass, an unknown, no checks or no note keep the type fit", () => {
    for (const level of ["fits", "converts"] as const) {
      expect(contentLevel(level, note("pass"))).toBe(level);
      expect(contentLevel(level, note("unknown"))).toBe(level);
      expect(contentLevel(level, note("none"))).toBe(level);
      expect(contentLevel(level, undefined)).toBe(level);
    }
  });
  test("an op with only an expects name has a note and keeps the level", () => {
    const view = analyseContent(
      { bytes: png(), utf8: "invalid" },
      indexOf({ "x:named": { expects: "thing", checks: [] } }),
      evaluator,
    );
    expect(view.rows.get("x:named")).toEqual({ result: "none", text: "Expects thing" });
  });
  test("an op with no clause has no note", () => {
    const view = analyseContent({ bytes: png(), utf8: "invalid" }, indexOf({}), evaluator);
    expect(view.rows.size).toBe(0);
  });
  test("output-scope checks are not input checks", () => {
    const view = analyseContent(
      { bytes: png(), utf8: "invalid" },
      indexOf({
        "x:out": { expects: null, checks: [{ scope: "output", test: { kind: "binary" } }] },
      }),
      evaluator,
    );
    expect(view.rows.get("x:out")).toBeUndefined();
  });
});

describe("the wording", () => {
  const ident = { id: "png", name: "PNG image", family: "png", certainty: "high" as const };
  const failedMagic = { scope: "input", test: { kind: "magic-bytes", format: "gzip" } } as const;
  const failedRegex = { scope: "input", test: { kind: "regex", pattern: "^a" } } as const;

  test("both sides, the expected side only, and a pass", () => {
    expect(noteText("gzip data", "fail", failedMagic, ident)).toBe(
      "Expects gzip data; this looks like PNG image",
    );
    expect(noteText("gzip data", "fail", failedMagic, null)).toBe("Expects gzip data");
    expect(noteText("gzip data", "pass", undefined, ident)).toBe("Expects gzip data");
    expect(noteText(undefined, "pass", undefined, ident)).toBe("");
  });
  test("a failure with no name for the expectation", () => {
    expect(noteText(undefined, "fail", failedRegex, ident)).toBe(
      "Expects other data; this looks like PNG image",
    );
    expect(noteText(undefined, "fail", failedRegex, null)).toBe("Expects other data");
  });
  test("the content sentence comes first, then the type fit's own hint", () => {
    const n: RowNote = { result: "fail", text: "Expects gzip data" };
    expect(contentHint(n, "")).toBe("Expects gzip data");
    expect(contentHint(n, "text only if valid UTF-8")).toBe(
      "Expects gzip data. Text only if valid UTF-8",
    );
    expect(contentHint(undefined, "converts to bytes")).toBe("converts to bytes");
    expect(contentHint({ result: "none", text: "" }, "converts to bytes")).toBe(
      "converts to bytes",
    );
    expect(contentHint(undefined, "")).toBe("");
  });
});

describe("what the header may claim", () => {
  test("a low-certainty identification is not claimed", () => {
    const random = Uint8Array.from({ length: 256 }, (_, i) => (i * 167 + 13) % 256);
    expect(checks.identifyData(random)?.certainty).toBe("low");
    const view = analyseContent({ bytes: random, utf8: "invalid" }, real, evaluator);
    expect(view.identification).toBeNull();
    expect(headerLine({ type: "bytes", utf8: "invalid" }, view)).toBe("bytes");
  });
  test("other types keep the 6.1 text", () => {
    const view = {
      identification: { id: "png", name: "PNG image", family: "png", certainty: "high" },
      rows: new Map(),
    } as ContentView;
    expect(headerLine({ type: "str", utf8: "unknown" }, view)).toBe("text");
    expect(headerLine({ type: "bytes", utf8: "unknown" }, null)).toBe("bytes");
    expect(headerLine({ type: "bytes", utf8: "valid" }, null)).toBe("bytes (valid text)");
  });
});

describe("the data source", () => {
  const recipe = (steps: unknown[]) => ({ steps }) as never;
  const bake = (output: unknown, stale = false) =>
    ({ result: { ok: true, output }, stale }) as never;
  const bytes = Uint8Array.of(1, 2, 3);
  const other = Uint8Array.of(9);

  test("the last successful, non-stale bake output wins", () => {
    expect(
      contentBytesAtEnd({
        recipe: recipe([{ kind: "op", op: "a:b" }]),
        bake: bake({ kind: "bytes", bytes, text: null }),
        ops: null,
        inputBytes: other,
      }),
    ).toBe(bytes);
  });
  test("a stale bake with steps gives no bytes; an empty recipe gives the input", () => {
    const stale = bake({ kind: "bytes", bytes, text: null }, true);
    expect(
      contentBytesAtEnd({
        recipe: recipe([{ kind: "op", op: "a:b" }]),
        bake: stale,
        ops: null,
        inputBytes: other,
      }),
    ).toBeNull();
    expect(
      contentBytesAtEnd({ recipe: recipe([]), bake: stale, ops: null, inputBytes: other }),
    ).toBe(other);
    expect(
      contentBytesAtEnd({
        recipe: recipe([{ kind: "comment" }]),
        bake: stale,
        ops: null,
        inputBytes: other,
      }),
    ).toBe(other);
  });
  test("a bake whose output is not bytes gives none", () => {
    expect(
      contentBytesAtEnd({
        recipe: recipe([]),
        bake: bake({ kind: "str", text: "x" }),
        ops: null,
        inputBytes: other,
      }),
    ).toBeNull();
  });
  test("sources are the same only for the same array and state", () => {
    expect(sameSource({ bytes, utf8: "valid" }, { bytes, utf8: "valid" })).toBe(true);
    expect(sameSource({ bytes, utf8: "valid" }, { bytes, utf8: "invalid" })).toBe(false);
    expect(sameSource({ bytes, utf8: "valid" }, { bytes: other, utf8: "valid" })).toBe(false);
    expect(sameSource(null, null)).toBe(true);
    expect(sameSource(null, { bytes, utf8: "valid" })).toBe(false);
  });
});

describe("cost", () => {
  // The measured figures are in the WP report; this only guards against a regression of an order of
  // magnitude: a frame is about 16 ms, and the whole catalogue's pass is far below it.
  test.each([0, 4096, 1 << 20])(
    "the whole catalogue over %i bytes stays within a frame",
    (size) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
      analyseContent({ bytes, utf8: "invalid" }, real, evaluator); // warm up
      const t0 = performance.now();
      const runs = 10;
      for (let i = 0; i < runs; i++) analyseContent({ bytes, utf8: "invalid" }, real, evaluator);
      const per = (performance.now() - t0) / runs;
      expect(per).toBeLessThan(16);
    },
  );
});
