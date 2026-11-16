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
import { createRuntime } from "../runtime.js";

const rt = createRuntime();

/** Runs console source; returns the output, or `ERR <code>` for a failed run. */
async function go(src: string, limits?: Record<string, number>): Promise<string> {
  const r = await rt.run(src, limits ? { limits } : undefined);
  return r.ok ? r.output : `ERR ${r.error.code}`;
}

describe("be-bytes>int and le-bytes>int", () => {
  test("read at an offset in either order", async () => {
    expect(await go("#[ 01 02 03 04 ] 0 4 be-bytes>int .")).toBe("16909060\n");
    expect(await go("#[ 01 02 03 04 ] 0 4 le-bytes>int .")).toBe("67305985\n");
    expect(await go("#[ ff 01 02 03 ff ] 1 3 be-bytes>int .")).toBe("66051\n");
    expect(await go("#[ ff 01 02 03 ff ] 1 3 le-bytes>int .")).toBe("197121\n");
    expect(await go("#[ 01 02 ] 1 0 be-bytes>int .")).toBe("0\n");
    expect(await go("#[ 01 02 ] 2 0 le-bytes>int .")).toBe("0\n");
  });

  test("wide reads give a bigint, the same as a hex round trip", async () => {
    expect(await go("#[ ff ff ff ff ff ff ff ff ] 0 8 be-bytes>int .")).toBe(
      "18446744073709551615\n",
    );
    expect(await go("#[ 00 00 00 00 00 00 00 01 ] 0 8 le-bytes>int .")).toBe("72057594037927936\n");
    expect(
      await go(
        "#[ 0a 0b 0c 0d 0e 0f 10 11 12 13 ] 0 10 be-bytes>int dup 16 int>str-radix swap drop .",
      ),
    ).toBe("a0b0c0d0e0f10111213\n");
  });

  test("errors: the slice error, and the integer limit", async () => {
    expect(await go("#[ 01 02 ] 1 2 be-bytes>int .")).toBe("ERR E_RANGE");
    expect(await go("#[ 01 02 ] 3 0 le-bytes>int .")).toBe("ERR E_RANGE");
    expect(await go("#[ 01 02 ] -1 1 be-bytes>int .")).toBe("ERR E_RANGE");
    expect(await go("#[ 01 02 ] 0 -1 le-bytes>int .")).toBe("ERR E_RANGE");
    expect(await go("#[ 01 02 03 04 ] 0 4 be-bytes>int .", { maxIntBits: 16 })).toBe(
      "ERR E_LIMIT_VALUE",
    );
    expect(await go("1 2 3 be-bytes>int .")).toBe("ERR E_TYPE");
  });
});

describe("int>be-bytes and int>le-bytes", () => {
  test("the low n bytes in either order", async () => {
    expect(await go("258 3 int>be-bytes bytes>hex .")).toBe("000102\n");
    expect(await go("258 3 int>le-bytes bytes>hex .")).toBe("020100\n");
    expect(await go("0x1234 1 int>be-bytes bytes>hex .")).toBe("34\n");
    expect(await go("5 0 int>le-bytes len .")).toBe("0\n");
    expect(await go("-1 2 int>be-bytes bytes>hex .")).toBe("ffff\n");
    expect(await go("-2 3 int>le-bytes bytes>hex .")).toBe("feffff\n");
    expect(await go("1 80 shl 1 + 11 int>be-bytes bytes>hex .")).toBe("0100000000000000000001\n");
  });

  test("round trips", async () => {
    for (const n of ["0", "1", "255", "65535", "4294967295", "1 100 shl 12345 +"]) {
      expect(await go(`${n} 13 int>be-bytes 0 13 be-bytes>int ${n} = .`)).toBe("true\n");
      expect(await go(`${n} 13 int>le-bytes 0 13 le-bytes>int ${n} = .`)).toBe("true\n");
    }
  });

  test("errors", async () => {
    expect(await go("1 -1 int>be-bytes .")).toBe("ERR E_RANGE");
    expect(await go("1 -1 int>le-bytes .")).toBe("ERR E_RANGE");
    expect(await go("1 100 int>be-bytes .", { maxValueBytes: 50 })).toBe("ERR E_LIMIT_VALUE");
    expect(await go('"a" 1 int>le-bytes .')).toBe("ERR E_TYPE");
  });
});

describe("rotl and rotr", () => {
  test("32-bit rotates", async () => {
    expect(await go("0x80000001 1 32 rotl .")).toBe("3\n");
    expect(await go("0x80000001 1 32 rotr .")).toBe("3221225472\n");
    expect(await go("0x12345678 8 32 rotl 16 int>str-radix .")).toBe("34567812\n");
    expect(await go("0x12345678 0 32 rotl .")).toBe("305419896\n");
    expect(await go("0x12345678 32 32 rotl .")).toBe("305419896\n");
    expect(await go("0x12345678 40 32 rotl 16 int>str-radix .")).toBe("34567812\n");
  });

  test("the value is cut to the width; a negative value is two's complement", async () => {
    expect(await go("0x1ffffffff 4 32 rotl .")).toBe("4294967295\n");
    expect(await go("-2 1 8 rotl .")).toBe("253\n");
    expect(await go("1 1 1 rotl .")).toBe("1\n");
  });

  test("any width, wide widths included, equals the shl and shr form", async () => {
    const x = 0x123456789abcdef0123456789n;
    const m = (1n << 100n) - 1n;
    const want = (((x << 7n) | (x >> 93n)) & m).toString();
    expect(await go("0x123456789abcdef0123456789 7 100 rotl .")).toBe(`${want}\n`);
    const back = (((x >> 7n) | (x << 93n)) & m).toString();
    expect(await go("0x123456789abcdef0123456789 7 100 rotr .")).toBe(`${back}\n`);
    expect(await go("1 99 100 rotl 1 99 shl = .")).toBe("true\n");
    expect(await go("1 1 100 rotr 1 99 shl = .")).toBe("true\n");
  });

  test("errors", async () => {
    expect(await go("1 1 0 rotl .")).toBe("ERR E_RANGE");
    expect(await go("1 1 -8 rotr .")).toBe("ERR E_RANGE");
    expect(await go("1 -1 8 rotl .")).toBe("ERR E_RANGE");
    expect(await go("1 1 100000 rotl .")).toBe("ERR E_LIMIT_VALUE");
    expect(await go("1.5 1 8 rotl .")).toBe("ERR E_COERCE");
  });
});

describe("metering", () => {
  test("each word costs the same number of steps whatever the width or order", async () => {
    const steps = async (src: string): Promise<number> => {
      const r = await rt.run(src);
      if (!r.ok) throw new Error(r.error.message);
      return r.steps;
    };
    const be4 = await steps("#[ 01 02 03 04 ] 0 4 be-bytes>int drop");
    const le4 = await steps("#[ 01 02 03 04 ] 0 4 le-bytes>int drop");
    const be1 = await steps("#[ 01 ] 0 1 be-bytes>int drop");
    expect(le4).toBe(be4);
    expect(be1).toBe(be4);
    const w = await steps("1 100 shl 3 int>be-bytes drop");
    expect(await steps("1 100 shl 80 int>le-bytes drop")).toBe(w);
    const r = await steps("1 100 shl 3 32 rotl drop");
    expect(await steps("1 100 shl 3 32 rotr drop")).toBe(r);
    expect(await steps("1 100 shl 3 200 rotl drop")).toBe(r);
  });
});
