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
 * Tests for the `bcrypt` vocabulary through the runtime. The published hashes are in
 * vocab/bcrypt.test.json and the primitives' own tests; these cover the random salt (which the
 * vectors cannot pin): the +random effect, the round trip through compare and parse, and the limits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bcrypt"]));

const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => String.fromCharCode(...u);

async function call(word: string, args: Parameters<typeof runtime.call>[1]) {
  const r = await runtime.call(word, args);
  if (!r.ok) return { code: r.error.code, effects: r.effects };
  const top = r.stack[r.stack.length - 1] as { v: unknown };
  return { out: top.v, effects: r.effects };
}

describe("bcrypt:hash", () => {
  test("draws a random salt (effect +random), and the result verifies and parses", async () => {
    const a = await call("bcrypt:hash", [bytes(text("hunter2")), int(4), str("2b")]);
    const b = await call("bcrypt:hash", [bytes(text("hunter2")), int(4), str("2b")]);
    expect(a.effects).toContain("+random");
    const ha = ascii(a.out as Uint8Array);
    expect(ha).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
    expect(ha).not.toBe(ascii(b.out as Uint8Array));
    expect((await call("bcrypt:compare", [bytes(text("hunter2")), str(ha)])).out).toBe(true);
    expect((await call("bcrypt:compare", [bytes(text("hunter3")), str(ha)])).out).toBe(false);
    const report = (await call("bcrypt:parse", [str(ha)])).out as string;
    expect(report).toBe(
      `Rounds: 4\nSalt: ${ha.slice(0, 29)}\nPassword hash: ${ha.slice(29)}\nFull hash: ${ha}`,
    );
  });

  test("the cost is 4 to 16, otherwise E_RANGE", async () => {
    for (const cost of [3, 17, -1, 0])
      expect((await call("bcrypt:hash", [bytes(text("x")), int(cost), str("2b")])).code).toBe(
        "E_RANGE",
      );
  });

  test("a version outside the choice is E_PARAM_INVALID", async () => {
    expect((await call("bcrypt:hash", [bytes(text("x")), int(4), str("2x")])).code).toBe(
      "E_PARAM_INVALID",
    );
  });
});

describe("bcrypt:hash-salted", () => {
  test("is deterministic and has no +random effect", async () => {
    const salt = new Uint8Array(16).fill(0x41);
    const a = await call("bcrypt:hash-salted", [bytes(text("pw")), bytes(salt), int(5), str("2a")]);
    const b = await call("bcrypt:hash-salted", [bytes(text("pw")), bytes(salt), int(5), str("2a")]);
    expect(a.effects).not.toContain("+random");
    expect(ascii(a.out as Uint8Array)).toBe(ascii(b.out as Uint8Array));
    expect(ascii(a.out as Uint8Array).slice(0, 7)).toBe("$2a$05$");
  });

  test("a salt that is not 16 bytes is E_RANGE", async () => {
    for (const n of [0, 15, 17])
      expect(
        (
          await call("bcrypt:hash-salted", [
            bytes(text("pw")),
            bytes(new Uint8Array(n)),
            int(4),
            str("2b"),
          ])
        ).code,
      ).toBe("E_RANGE");
  });
});

describe("bcrypt:compare and bcrypt:parse", () => {
  test("a malformed string is E_COERCE", async () => {
    for (const bad of ["", "nope", "$2a$05$short", "$2b$10$" + "x".repeat(53) + "!"]) {
      expect((await call("bcrypt:compare", [bytes(text("a")), str(bad)])).code).toBe("E_COERCE");
      expect((await call("bcrypt:parse", [str(bad)])).code).toBe("E_COERCE");
    }
  });

  test("a cost above the cap in the string is E_RANGE for compare, but parse reports it", async () => {
    const h = "$2a$31$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy";
    expect((await call("bcrypt:compare", [bytes(text("a")), str(h)])).code).toBe("E_RANGE");
    expect(((await call("bcrypt:parse", [str(h)])).out as string).startsWith("Rounds: 31\n")).toBe(
      true,
    );
  });

  test("a very long password counts only its first 72 bytes", async () => {
    const salt = bytes(new Uint8Array(16));
    const a = await call("bcrypt:hash-salted", [
      bytes(text("a".repeat(65536))),
      salt,
      int(4),
      str("2b"),
    ]);
    const b = await call("bcrypt:hash-salted", [
      bytes(text("a".repeat(72))),
      salt,
      int(4),
      str("2b"),
    ]);
    expect(ascii(a.out as Uint8Array)).toBe(ascii(b.out as Uint8Array));
  });
});
