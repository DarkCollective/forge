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
 * Tests for `http:dechunk` (vocab/http.fth, written in FL with a collector). The known-answer vectors are in
 * vocab/http.test.json; the Strip HTTP headers tests are in src/packets.test.ts. Here: the grammar, the errors with
 * their offsets, every cut of a valid body, a size that lies, and the cost at 64 KiB under the untrusted limits of
 * the worker (UNTRUSTED_LIMITS: 5 million steps, 256 MiB in total).
 */
import { valueHelpers } from "@forge/lang";
import type { Limits } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const bundle = await loadBundleNode(["http"]);
const runtime = assembleRuntime(bundle);
const untrusted: Partial<Limits> = {
  maxSteps: 5_000_000,
  maxDataDepth: 10_000,
  maxValueBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxIntBits: 16_384,
  maxMillis: 10_000,
};
const strict = assembleRuntime(bundle, { limits: untrusted });

const enc = (s: string) => new TextEncoder().encode(s);
const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

type Outcome = { out: string } | { code: string; message: string };
async function run(data: Uint8Array, rt: typeof runtime = runtime): Promise<Outcome> {
  const r = await rt.call("http:dechunk", [bytes(data)]);
  if (!r.ok) return { code: r.error.code, message: r.error.message };
  return { out: latin1((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}
const dec = async (s: string) => run(enc(s));

describe("Dechunk HTTP response (http:dechunk)", () => {
  test("chunks, extensions, trailers, bare line feeds", async () => {
    expect(
      await dec("4\r\nWiki\r\n6;a=b\r\npedia \r\nE\r\nin \r\n\r\nchunks.\r\n0\r\n\r\n"),
    ).toEqual({
      out: "Wikipedia in \r\n\r\nchunks.",
    });
    expect(await dec("0\r\n\r\n")).toEqual({ out: "" });
    expect(await dec("1\r\nx\r\n0\r\nT: 1\r\nU: 2\r\n\r\n")).toEqual({ out: "x" });
    expect(await dec("1\nx\n0\n\n")).toEqual({ out: "x" });
    expect(await dec("A\r\n0123456789\r\n0000\r\n\r\n")).toEqual({ out: "0123456789" });
    expect(await dec("1 \t;e\r\nx\r\n0\r\n\r\n")).toEqual({ out: "x" });
  });

  test("errors are E_COERCE with an offset", async () => {
    for (const s of [
      "",
      "1\r\nx",
      "1\r\nx\r\n",
      "1\r\nx\r\n0\r\n",
      "1\r\nxy\r\n0\r\n\r\n",
      "g\r\n",
      "1\r\nx\r\n0\r\n\r\nextra",
      "-1\r\nx\r\n0\r\n\r\n",
      "1\r\nx\r\n0\r\nT: 1\r\n",
      "fffffffffffffffff\r\nx",
      "1;\x00\r\nx\r\n0\r\n\r\n",
      "1;a\rb\r\nx\r\n0\r\n\r\n",
      "1 x\r\nx\r\n0\r\n\r\n",
    ]) {
      const r = await dec(s);
      expect("code" in r && r.code, JSON.stringify(s)).toBe("E_COERCE");
    }
    expect(await dec("1\r\nxy\r\n0\r\n\r\n")).toMatchObject({
      message: expect.stringMatching(/not followed by a line end \(byte 0x79\)/) as string,
    });
    expect(await dec("5\r\nab\r\n")).toMatchObject({
      message: expect.stringMatching(/declares 5 bytes but only 4 are left/) as string,
    });
    expect(await dec("g\r\n")).toMatchObject({
      message: expect.stringMatching(
        /chunk size at offset 0 is not hexadecimal \(byte 0x67\)/,
      ) as string,
    });
    expect(await dec("1;a\x00b\r\nx\r\n0\r\n\r\n")).toMatchObject({
      message: expect.stringMatching(
        /chunk extension at offset 3 holds a control character/,
      ) as string,
    });
    expect(await dec("1\r\nx\r\n0\r\n\r\nxy")).toMatchObject({
      message: expect.stringMatching(
        /2 bytes follow the last chunk and its trailer, at offset 11/,
      ) as string,
    });
  });

  test("every cut of a valid body is E_COERCE", async () => {
    const body = enc("3;x=y\r\nabc\r\n5\r\n12345\r\n0\r\nTrail: v\r\n\r\n");
    expect(await run(body)).toEqual({ out: "abc12345" });
    for (let cut = 0; cut < body.length; cut++) {
      const r = await run(body.subarray(0, cut));
      expect("code" in r && r.code, `cut ${cut}`).toBe("E_COERCE");
    }
  });

  test("maxValueBytes is E_LIMIT_VALUE (the input is as long as the output or longer)", async () => {
    const body = enc("a\r\n0123456789\r\n0\r\n\r\n");
    expect(await run(body, assembleRuntime(bundle, { limits: { maxValueBytes: 1000 } }))).toEqual({
      out: "0123456789",
    });
    const r = await run(body, assembleRuntime(bundle, { limits: { maxValueBytes: 19 } }));
    expect("code" in r && r.code).toBe("E_LIMIT_VALUE");
  });

  test("a size that lies allocates nothing, and a long size line or trailer is read in full", async () => {
    for (const s of [
      "7fffffffffffff\r\nabc\r\n0\r\n\r\n",
      "0000000000000000000000000000000002\r\nabc\r\n0\r\n\r\n",
      `${"0".repeat(5000)}f\r\nabc\r\n0\r\n\r\n`,
    ]) {
      const r = await run(enc(s), strict);
      expect("code" in r && r.code, s.slice(0, 20)).toBe("E_COERCE");
    }
    // 20,000 zeros are a valid, zero, size; the extension runs on past the search window
    expect(await run(enc(`${"0".repeat(20_000)};${"e".repeat(5000)}\r\n\r\n`), strict)).toEqual({
      out: "",
    });
    const trailer = Array.from(
      { length: 3000 },
      (_, i) => `X-${i}: ${"v".repeat(i % 90)}\r\n`,
    ).join("");
    expect(await run(enc(`1\r\nq\r\n0\r\n${trailer}\r\n`), strict)).toEqual({ out: "q" });
  });
});

describe("cost at 64 KiB", () => {
  // The worst case for the walk is many small chunks: 10,900 chunks of six bytes are 64 KiB of data. Before the
  // collectors (v0.2) this was a primitive, because growing the result a chunk at a time overran the allocation limit.
  test(
    "about 10,900 six-byte chunks, under the untrusted limits",
    { timeout: 60_000 },
    async () => {
      const parts: string[] = [];
      for (let i = 0; i < 10_900; i++)
        parts.push(`6\r\n${String.fromCharCode(97 + (i % 26)).repeat(6)}\r\n`);
      parts.push("0\r\n\r\n");
      const msg = enc(parts.join(""));
      expect(msg.length).toBeGreaterThan(64 * 1024);
      const t0 = Date.now();
      const r = await strict.call("http:dechunk", [bytes(msg)]);
      const ms = Date.now() - t0;
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((r.stack[r.stack.length - 1] as { v: Uint8Array }).v.length).toBe(65_400);
      process.stderr.write(`\nhttp:dechunk 10,900 six-byte chunks: ${r.steps} steps ${ms} ms\n`);
      // Measured 2.56 million, about 235 per chunk; the limit is 5 million.
      expect(r.steps).toBeLessThan(3_000_000);
    },
  );

  test(
    "a chunk of one byte, 10,900 times, and 64 KiB in one chunk",
    { timeout: 60_000 },
    async () => {
      const ones = enc(`${"1\r\nz\r\n".repeat(10_900)}0\r\n\r\n`);
      const a = await strict.call("http:dechunk", [bytes(ones)]);
      expect(a.ok && a.steps).toBeLessThan(2_700_000);
      const big = new Uint8Array(65_536).fill(0x61);
      const head = enc("10000\r\n");
      const tail = enc("\r\n0\r\n\r\n");
      const msg = new Uint8Array(head.length + big.length + tail.length);
      msg.set(head);
      msg.set(big, head.length);
      msg.set(tail, head.length + big.length);
      const b = await strict.call("http:dechunk", [bytes(msg)]);
      expect(b.ok && b.steps).toBeLessThan(1_000);
    },
  );
});
