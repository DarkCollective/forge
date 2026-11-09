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
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha256 } from "./sha256.js";

const ref = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

describe("sha256 known answers", () => {
  test.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ])("%j", (input, expected) => {
    expect(sha256(input)).toBe(expected);
  });

  test("one million 'a'", () => {
    expect(sha256("a".repeat(1_000_000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("sha256 input handling", () => {
  test("strings are UTF-8 encoded", () => {
    const s = "héllo 世界 \u{1f600}";
    expect(sha256(s)).toBe(ref(s));
    const utf8 = Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
    expect(sha256(s)).toBe(sha256(utf8));
  });

  test("bytes and strings agree for the same content", () => {
    expect(sha256(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256("abc"));
  });

  test("output is 64 lowercase hex digits", () => {
    expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("every length around the block boundaries matches node:crypto", () => {
    for (let n = 0; n <= 200; n++) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(sha256(data), `length ${n}`).toBe(ref(data));
    }
  });

  test("random inputs match node:crypto", () => {
    let seed = 0x12345678;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 200; i++) {
      const data = new Uint8Array(next() % 1500);
      for (let j = 0; j < data.length; j++) data[j] = next() >>> 24;
      expect(sha256(data)).toBe(ref(data));
    }
  });

  test("random strings match node:crypto", () => {
    let seed = 99;
    const next = (): number => {
      seed = (Math.imul(seed, 22695477) + 1) >>> 0;
      return seed;
    };
    for (let i = 0; i < 100; i++) {
      let s = "";
      const n = next() % 80;
      for (let j = 0; j < n; j++) s += String.fromCodePoint((next() >>> 8) % 0x10000 || 65);
      const clean = s.replace(/[\ud800-\udfff]/g, "?");
      expect(sha256(clean)).toBe(ref(clean));
    }
  });

  test("does not modify its input", () => {
    const data = new Uint8Array([1, 2, 3]);
    sha256(data);
    expect([...data]).toEqual([1, 2, 3]);
  });
});
