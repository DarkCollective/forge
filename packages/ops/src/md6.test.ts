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
 * Tests for the `md6` vocabulary. The published d=256 vectors are in vocab/md6.test.json. The
 * other parameter paths (size, levels, key, the multi-block tree and the sequential mode) have no
 * independent vectors available here; their digests are pinned from this implementation, whose
 * default path reproduces the published vectors, and are labelled as regression pins.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["md6"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);
const KiB64 = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, size = 256, levels = 64, key = "") {
  const r = await runtime.call("md6:digest", [bytes(data), int(size), int(levels), str(key)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}

describe("md6:digest", () => {
  test("the sizes 224 and 512 of abc (the 512 value begins 00918245 as in the MD6 report)", async () => {
    expect((await digest(enc("abc"), 224)).out).toBe(
      "510c30e4202a5cdd8a4f2ae9beebb6f5988128897937615d52e6d228",
    );
    expect((await digest(enc("abc"), 512)).out).toBe(
      "00918245271e377a7ffb202b90f3bda5477d8feab12d8a3a8994ebc55fe6e74ca8341520032eeea3fdef892f2882378f636212af4b2683ccf80bf025b7d9b457",
    );
  });

  test("regression pins: key, L = 0 (sequential), L = 1 and a 64 KiB tree", async () => {
    expect((await digest(enc("abc"), 256, 64, "secret")).out).toBe(
      "fc05f601755894ae53c6cd6e2a83b8437169f65db3ca6e38627a385c62ca998b",
    );
    expect((await digest(enc("abc"), 256, 0)).out).toBe(
      "93c70c8d38e1d0b583024a3f17c95fe23b3a19bfad96d567f1e522b89ec7b365",
    );
    expect((await digest(KiB64, 256, 64)).out).toBe(
      "17a0147aa0e644eb49d130d5a83365bd82885bad9d394a64120edd62a0dce5fa",
    );
    expect((await digest(KiB64, 256, 0)).out).toBe(
      "804395f0350f108f819a614fd60f85dcfced7a3d13fb20dfc7e6b89aa3be8cfd",
    );
    expect((await digest(KiB64, 256, 1)).out).toBe(
      "7b2cd26b2fcc1dd574f150bd17c5731b22f6af680c090124db90f38c4a2945e0",
    );
  });

  test("the level count is part of the digest even for a one-block message", async () => {
    // L is in the control word V of every compression, so it changes the digest.
    const a = (await digest(enc("abc"), 256, 64)).out;
    const b = (await digest(enc("abc"), 256, 5)).out;
    expect(a).not.toBe(b);
  });

  test("bad parameters are errors", async () => {
    expect((await digest(enc("abc"), 100)).code).toBeDefined(); // not a multiple of 8
    expect((await digest(enc("abc"), 0)).code).toBeDefined();
    expect((await digest(enc("abc"), 520)).code).toBeDefined();
    expect((await digest(enc("abc"), 256, 65)).code).toBeDefined();
    expect((await digest(enc("abc"), 256, -1)).code).toBeDefined();
    expect((await digest(enc("abc"), 256, 64, "k".repeat(65))).code).toBeDefined();
  });
});
