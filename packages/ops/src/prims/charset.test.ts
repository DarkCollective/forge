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
import { describe, expect, test } from "vitest";
import { primitives } from "./charset.js";

const def = primitives.find((p) => p.name === "_decode")!;
const decode = def.fn as (
  data: Uint8Array,
  label: string,
  fatal: boolean,
  ctx: { limits: { maxValueBytes: number } },
) => string;
const ctx = { limits: { maxValueBytes: 1 << 20 } };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return "none";
}

describe("charset._decode (the only charset primitive)", () => {
  test("is the only primitive of the module", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_decode"]);
  });

  test("decodes with the WHATWG decoder of the label", () => {
    expect(decode(Uint8Array.of(0x82, 0xa0), "shift_jis", true, ctx)).toBe("あ");
    expect(decode(Uint8Array.of(0xc4, 0xe3), "gbk", true, ctx)).toBe("你");
    expect(decode(new Uint8Array(0), "big5", true, ctx)).toBe("");
  });

  test("keeps a byte order mark", () => {
    expect(decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41), "utf-8", true, ctx)).toBe("﻿A");
  });

  test("fatal: invalid input is E_COERCE; otherwise U+FFFD", () => {
    expect(codeOf(() => decode(Uint8Array.of(0xff), "utf-8", true, ctx))).toBe("E_COERCE");
    expect(decode(Uint8Array.of(0x41, 0xff), "utf-8", false, ctx)).toBe("A�");
  });

  test("an unknown label is E_RANGE", () => {
    expect(codeOf(() => decode(Uint8Array.of(0x41), "no-such-encoding", true, ctx))).toBe(
      "E_RANGE",
    );
  });

  test("a result over maxValueBytes is E_LIMIT_VALUE", () => {
    const small = { limits: { maxValueBytes: 10 } };
    expect(codeOf(() => decode(new Uint8Array(100), "utf-8", true, small))).toBe("E_LIMIT_VALUE");
  });
});
