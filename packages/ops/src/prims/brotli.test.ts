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
 * Tests of the brotli primitive over the vendored decoder: the output cap (the 203-byte stream that
 * expands to 256 MiB stops at a 1 MiB limit at once, the exact size passes, one byte less fails), the
 * claimed-length check before allocation, a window larger than the cap, and the fault messages. The
 * streams come from the brotli CLI (vocab/brotli.test.json).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { brotliDecompress } from "./brotli.js";

const MiB = 1024 * 1024;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function fromBase64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s.replace(/=+$/, "")) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

interface Vector {
  name: string;
  input: { value: string; enc: string };
  expect: { value?: string; enc?: string; error?: string };
}
const VECTORS: Vector[] = JSON.parse(
  readFileSync(
    fileURLToPath(import.meta.url).replace(/\/src\/.*$/, "/vocab/brotli.test.json"),
    "utf8",
  ),
);
const vector = (name: string): Vector => {
  const v = VECTORS.find((x) => x.name === name);
  if (!v) throw new Error(`no vector named ${name}`);
  return v;
};
const input = (v: Vector): Uint8Array =>
  v.input.enc === "hex"
    ? Uint8Array.from(v.input.value.match(/../g) ?? [], (h) => parseInt(h, 16))
    : fromBase64(v.input.value);

/** The error code and message of a call that must fail, or undefined. */
function failure(
  f: () => unknown,
): { code: string; message: string; detail?: unknown } | undefined {
  try {
    f();
    return undefined;
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: unknown };
    return { code: err.code ?? "?", message: err.message, detail: err.detail };
  }
}

describe("brotli primitive", () => {
  test("the 203-byte stream of 256 MiB zeros stops at a 1 MiB limit at once", () => {
    const bomb = input(vector("bomb: 256 MiB of zeros in a few hundred bytes stops at the limit"));
    expect(bomb.length).toBe(203);
    const t0 = Date.now();
    const r = failure(() => brotliDecompress(bomb, MiB));
    const ms = Date.now() - t0;
    expect(r?.code).toBe("E_LIMIT_VALUE");
    expect(r?.message).toMatch(/decompressed data of 16777216 exceeds the limit of 1048576/);
    expect(r?.detail).toEqual({ limit: "maxValueBytes", max: MiB, value: 16 * MiB });
    // The first meta-block claims 16 MiB: refused before any allocation for it.
    expect(ms).toBeLessThan(200);
  });

  test("the cap is exact: the output of exactly the limit passes, one byte less fails", () => {
    const v = vector("1 MiB of zeros (within the limit)");
    const data = input(v);
    expect(brotliDecompress(data, MiB).length).toBe(MiB);
    expect(failure(() => brotliDecompress(data, MiB - 1))?.code).toBe("E_LIMIT_VALUE");
  });

  test("a window of 2^24 under a 64 KiB cap decodes: the ring buffer is capped, not the window", () => {
    const v = vector("brotli CLI window 2^24: 64 KiB prose");
    const want = Uint8Array.from(v.expect.value?.match(/../g) ?? [], (h) => parseInt(h, 16));
    const out = brotliDecompress(input(v), 65536);
    expect(out.length).toBe(65536);
    expect(out.every((b, i) => b === want[i])).toBe(true);
  });

  test("faults are E_COERCE: an empty input, a truncated stream, a changed stream", () => {
    expect(failure(() => brotliDecompress(new Uint8Array(0), MiB))?.code).toBe("E_COERCE");
    const cut = input(vector("truncated: half the stream"));
    const r = failure(() => brotliDecompress(cut, MiB));
    expect(r?.code).toBe("E_COERCE");
    expect(r?.message).toMatch(/Unexpected end of input|cannot convert brotli data to bytes/);
    const bad = input(vector("corrupt: a flipped bit in the middle of the stream"));
    expect(failure(() => brotliDecompress(bad, 16 * MiB))?.code).toBe("E_COERCE");
  });

  test("bytes after the last meta-block are E_COERCE, as the reference decoder reports them", () => {
    const good = input(vector("brotli CLI quality 11: small text"));
    expect(brotliDecompress(good, MiB).length).toBeGreaterThan(0);
    const trailing = Uint8Array.from([...good, 0x58, 0x59, 0x5a]);
    const r = failure(() => brotliDecompress(trailing, MiB));
    expect(r?.code).toBe("E_COERCE");
    expect(r?.message).toMatch(/bytes follow the last meta-block/);
  });

  test("a stream whose header is damaged so the padding after the last meta-block is non-zero is E_COERCE", () => {
    // The window byte of the quality 5 stream changed (0x81 to 0xfe): an empty last meta-block with
    // non-zero padding, which the reference decoder rejects.
    const damaged = input(vector("corrupt: the window header byte"));
    expect(failure(() => brotliDecompress(damaged, 16 * MiB))?.code).toBe("E_COERCE");
  });
});
