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
 * Tests for the `argon2` vocabulary (vocab/argon2.fth, with the private primitives `_derive` and
 * `_verify`). The reference-implementation hashes and the compare errors are in
 * vocab/argon2.test.json and the RFC 9106 section 5 vectors in src/prims/argon2.test.ts; these run
 * CyberChef's default parameters, the three types round trip, and the largest memory.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["argon2"]));

const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => String.fromCharCode(...u);

async function derive(
  pw: string,
  p: {
    salt?: string;
    iterations?: number;
    memory?: number;
    parallelism?: number;
    length?: number;
    type?: string;
    output?: string;
  } = {},
) {
  const r = await runtime.call("argon2:derive", [
    bytes(text(pw)),
    bytes(text(p.salt ?? "somesalt")),
    int(p.iterations ?? 3),
    int(p.memory ?? 4096),
    int(p.parallelism ?? 1),
    int(p.length ?? 32),
    str(p.type ?? "argon2i"),
    str(p.output ?? "encoded"),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

async function compare(pw: string, encoded: string) {
  const r = await runtime.call("argon2:compare", [bytes(text(pw)), str(encoded)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: boolean }).v };
}

describe("argon2", () => {
  test("CyberChef's defaults (somesalt, 3 iterations, 4096 KiB, 1 lane, 32 bytes, argon2i, encoded)", async () => {
    const enc = ascii((await derive("password")).out!);
    expect(enc).toMatch(/^\$argon2i\$v=19\$m=4096,t=3,p=1\$c29tZXNhbHQ\$[A-Za-z0-9+/]{43}$/);
    expect((await compare("password", enc)).out).toBe(true);
    expect((await compare("passwore", enc)).out).toBe(false);
  });

  test("each type and a few lanes round trip through compare, and differ from each other", async () => {
    const seen = new Set<string>();
    for (const type of ["argon2i", "argon2d", "argon2id"]) {
      const enc = ascii(
        (await derive("pw", { type, memory: 64, parallelism: 4, iterations: 2, length: 20 })).out!,
      );
      expect(enc.startsWith(`$${type}$v=19$m=64,t=2,p=4$`)).toBe(true);
      expect((await compare("pw", enc)).out).toBe(true);
      expect((await compare("px", enc)).out).toBe(false);
      seen.add(enc.split("$")[5] as string);
    }
    expect(seen.size).toBe(3);
  });

  test("the raw output is as long as asked", async () => {
    const raw = await derive("pw", { output: "raw", length: 77, memory: 32 });
    expect(raw.out).toHaveLength(77);
  });

  test("the largest memory (256 MiB, one pass) runs and verifies", async () => {
    const enc = ascii(
      (await derive("pw", { memory: 262144, iterations: 1, type: "argon2id", length: 16 })).out!,
    );
    expect(enc.startsWith("$argon2id$v=19$m=262144,t=1,p=1$")).toBe(true);
    expect((await compare("pw", enc)).out).toBe(true);
  }, 30_000);

  test("errors", async () => {
    expect((await derive("pw", { salt: "short" })).code).toBe("E_RANGE");
    expect((await derive("pw", { type: "argon2x" })).code).toBe("E_PARAM_INVALID");
    expect((await compare("pw", "nope")).code).toBe("E_COERCE");
  });
});
