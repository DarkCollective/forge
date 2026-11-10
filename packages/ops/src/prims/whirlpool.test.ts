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
import { hash, primitives } from "./whirlpool.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

describe("whirlpool._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the empty message and abc", () => {
    expect(hex(hash(text("")))).toBe(
      "19fa61d75522a4669b44e39c1d2e1726c530232130d407f89afee0964997f7a73e83be698b288febcf88e3e03c4f0757ea8964e59b63d93708b138cc42a66eb3",
    );
    expect(hex(hash(text("abc")))).toBe(
      "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5",
    );
  });

  test("padding boundaries are 64 bytes each", () => {
    for (const n of [0, 31, 32, 33, 63, 64, 65, 95, 96])
      expect(hash(new Uint8Array(n))).toHaveLength(64);
  });

  // 64 KiB of (i * 31 + 7) mod 256; the digest was computed with OpenSSL's whirlpool (legacy
  // provider) as an independent implementation and is fixed here.
  test("64 KiB", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data))).toBe(
      "3b5ad54a6bbc961e5019f2261a3c873b28203bd32911c0f771f832a9719091de8b0a3c7bb727a4b005f9e2b4cf4fcb4d9cc5ef60be28f64963451e38a36207ac",
    );
  });
});
