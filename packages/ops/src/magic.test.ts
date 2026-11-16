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
 * Tests for the `magic` vocabulary (vocab/magic.fth, src/prims/magic.ts). The op vectors are in
 * vocab/magic.test.json; these keep `CHOICE: magic-format` equal to the ids the identification can give
 * (the Detect File Type table and the generic kinds) and check the family rule and the hard-kill flag.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { GENERIC_IDS } from "./checks/identify.js";
import { SIGNATURE_IDS } from "./filetype-sigs.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["magic"]));
const catalogue = buildCatalogue(runtime);
const isFormat = catalogue.ops.find((o) => o.qname === "magic:is-format");

describe("CHOICE: magic-format", () => {
  const options = [...(isFormat?.params.find((p) => p.name === "format")?.options ?? [])];
  const expected = [...new Set([...SIGNATURE_IDS, ...GENERIC_IDS])];

  test("lists exactly the signature ids and the generic ids, once each, in a stable order", () => {
    const stale = options.filter((o) => !expected.includes(o));
    const missing = expected.filter((o) => !options.includes(o));
    expect({ stale, missing }).toEqual({ stale: [], missing: [] });
    expect(new Set(options).size).toBe(options.length);
    expect(options).toEqual(expected);
  });

  test("every option has help", () => {
    const docs = runtime.meta("magic:is-format").discovery?.optionDocs?.["format"] ?? {};
    expect(options.filter((o) => (docs[o] ?? "") === "")).toEqual([]);
  });
});

describe("magic words", () => {
  const run = (op: string, data: Uint8Array, ...rest: ReturnType<typeof str>[]) =>
    runtime.call(op, [bytes(data), ...rest]);
  const top = (r: Awaited<ReturnType<typeof run>>) => {
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.stack[r.stack.length - 1];
  };
  const gzip = Uint8Array.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]);

  test("identify gives the id, and unknown when nothing matches", async () => {
    expect(top(await run("magic:identify", gzip))).toEqual(str("gzip"));
    expect(top(await run("magic:identify", Uint8Array.from([0, 1, 2, 3])))).toEqual(str("unknown"));
    expect(top(await run("magic:identify", new Uint8Array(0)))).toEqual(str("unknown"));
  });

  test("is-format is true for the id and for the family, false otherwise", async () => {
    const text = new TextEncoder().encode("plain text\n");
    expect(top(await run("magic:is-format", gzip, str("gzip")))).toEqual({ tag: "bool", v: true });
    expect(top(await run("magic:is-format", text, str("utf8-text")))).toEqual({
      tag: "bool",
      v: true,
    });
    expect(top(await run("magic:is-format", text, str("gzip")))).toEqual({ tag: "bool", v: false });
    expect(top(await run("magic:is-format", Uint8Array.of(0, 1), str("gzip")))).toEqual({
      tag: "bool",
      v: false,
    });
  });

  test("the words run no regex engine, so need no hard kill", () => {
    expect(catalogue.ops.filter((o) => o.vocab === "magic").map((o) => o.needsHardKill)).toEqual([
      false,
      false,
    ]);
  });
});
