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
 * Tests for the asn1 primitives (src/prims/asn1.ts): the exported list of primitives and the direct
 * calls with their argument checks. The words, the bounds and the vectors are tested in
 * src/asn1.test.ts and vocab/{asn1-dump,oid,pem}.test.json.
 */
import { describe, expect, test } from "vitest";
import { oidFind, oidName, oidShort, parseIn, pemScan, primitives } from "./asn1.js";

describe("asn1 primitives", () => {
  test("are exported with the names the vocabulary uses", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "parse-in",
      "oid-decode",
      "oid-encode",
      "oid-name",
      "oid-short",
      "oid-find",
      "_string",
      "_pem-scan",
    ]);
    expect(new Set(primitives.map((p) => p.vocab))).toEqual(new Set(["asn1"]));
  });

  test("parse-in takes its integers as numbers and checks them", () => {
    const fn = primitives[0]?.fn as (...a: unknown[]) => unknown;
    const ctx = { limits: { maxValueBytes: 1 << 20 } };
    const d = Uint8Array.of(5, 0);
    expect((fn(d, 0, 2, 64, ctx) as unknown[]).length).toBe(1);
    expect(() => fn(d, 0n, 2, 64, ctx)).toThrow(/must be an integer/);
    expect(() => fn(d, 0, 2.5, 64, ctx)).toThrow(/must be an integer/);
    expect(() => parseIn(d, 0, 2, 64, 100)).toThrow(/exceeds the limit/);
  });

  test("the name lookups ignore surrounding white space and return empty for unknown", () => {
    expect(oidName(" 2.5.4.3 ")).toBe("commonName");
    expect(oidShort("2.5.4.10")).toBe("O");
    expect(oidFind(" commonname ")).toBe("2.5.4.3");
    expect(oidName("")).toBe("");
    expect(oidFind("")).toBe("");
  });

  test("pemScan keeps the Base64 body as ASCII bytes", () => {
    const text = new TextEncoder().encode("-----BEGIN X-----\nQUJD\n-----END X-----\n");
    const blocks = pemScan(text);
    expect(blocks.length).toBe(1);
    const rec = blocks[0]?.v as unknown as Map<string, { v: Uint8Array }>;
    const body = rec.get("body")?.v;
    expect(String.fromCharCode(...(body as Uint8Array))).toBe("QUJD");
  });
});
