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
 * Tests for the `otp` vocabulary (vocab/otp.fth): the RFC 4226 and RFC 6238 values are in vocab/otp.test.json; here the
 * clock and the random source are pinned (the default time, the random secret), and the corner cases of the
 * truncation and of the secret are checked.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str } = valueHelpers;
const bundle = await loadBundleNode(["otp"]);
const runtime = assembleRuntime(bundle);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const hotp = (
  secret: string,
  counter: number | bigint = 0,
  digits = 6,
  algorithm = "sha1",
  name = "",
  keySize = 32,
) =>
  runtime.call("otp:hotp", [
    str(secret),
    str(name),
    str(algorithm),
    int(digits),
    int(counter),
    int(keySize),
  ]);
const totp = (secret: string, time = -1, period = 30, epoch = 0, digits = 6, keySize = 32) =>
  runtime.call("otp:totp", [
    str(secret),
    str(""),
    str("sha1"),
    int(digits),
    int(period),
    int(epoch),
    int(keySize),
    int(time),
  ]);
const password = (r: Result) => /Password: (\d+)$/.exec(top(r) as string)?.[1];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("hotp and totp are Generators ops; both can use the random source, totp also the clock", () => {
    const cat = buildCatalogue(assembleRuntime(bundle));
    const mine = cat.ops.filter((o) => o.vocab === "otp");
    expect(mine.map((o) => o.qname)).toEqual(["otp:hotp", "otp:totp"]);
    expect(mine.every((o) => o.category === "Generators")).toBe(true);
    expect(mine[0]?.effects).toContain("+random");
    expect(mine[1]?.effects).toEqual(expect.arrayContaining(["+random", "+time"]));
  });
});

describe("totp reads the clock", () => {
  test("time -1 is now: the RFC 6238 time 59 as the fake clock gives the RFC value", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    expect(password(await totp(SECRET, -1, 30, 0, 8))).toBe("94287082");
  });

  test("the password changes at the period boundary and not before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(29_999);
    const a = password(await totp(SECRET));
    vi.setSystemTime(30_000);
    const b = password(await totp(SECRET));
    vi.setSystemTime(59_999);
    const c = password(await totp(SECRET));
    expect(a).toBe("755224"); // counter 0, RFC 4226 appendix D
    expect(b).toBe("287082"); // counter 1
    expect(c).toBe(b);
  });

  test("an explicit time ignores the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000_000_000);
    expect(password(await totp(SECRET, 59, 30, 0, 8))).toBe("94287082");
  });
});

describe("the defaults follow CyberChef", () => {
  test("the account name is Account and a random secret has 20 bytes", () => {
    for (const w of ["otp:hotp", "otp:totp"]) {
      const ps = runtime.meta(w).params;
      expect(ps.find((x) => x.name === "name")?.default).toBe("Account");
      expect(ps.find((x) => x.name === "key-size")?.default).toBe(20);
    }
  });
});

describe("the secret", () => {
  test("an empty input makes a random secret of key-size bytes from the host random source", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0);
        return a;
      },
    });
    const r = await hotp("", 0, 6, "sha1", "", 10);
    // 10 zero bytes are 16 Base32 'A's; the HMAC key is ten zero bytes
    expect(top(r)).toMatch(
      /^URI: otpauth:\/\/hotp\/\?secret=AAAAAAAAAAAAAAAA&algorithm=SHA1&digits=6&counter=0\n\nPassword: \d{6}$/,
    );
  });

  test("random secrets differ, are Base32 and have the requested size", async () => {
    const a = top(await hotp("", 0, 6, "sha1", "", 20)) as string;
    const b = top(await hotp("", 0, 6, "sha1", "", 20)) as string;
    const secretOf = (s: string) => /secret=([A-Z2-7]+)&/.exec(s)?.[1] ?? "";
    expect(secretOf(a)).toHaveLength(32); // 20 bytes
    expect(secretOf(a)).not.toBe(secretOf(b));
  });

  test("a secret of random bytes is accepted again as the input", async () => {
    const made = top(await hotp("", 5, 6, "sha256", "", 32)) as string;
    const secret = /secret=([A-Z2-7]+)&/.exec(made)?.[1] ?? "";
    expect(top(await hotp(secret, 5, 6, "sha256"))).toBe(made);
  });

  test("Base32 with padding is accepted", async () => {
    const a = top(await hotp("MFRGG===")) as string;
    expect(a).toContain("secret=MFRGG&");
  });

  test("a host without a random source cannot make a secret, but a given secret needs none", async () => {
    vi.stubGlobal("crypto", {});
    expect(code(await hotp(""))).toBe("E_PRIMITIVE");
    expect(code(await hotp(SECRET))).toBe("ok");
  });
});

describe("the password", () => {
  test("is padded to the number of digits", async () => {
    // counter 0..199 over the RFC secret: some truncated values are below 10^5
    let sawPad = false;
    for (let c = 0; c < 200; c++) {
      const p = password(await hotp(SECRET, c)) ?? "";
      expect(p).toHaveLength(6);
      if (p.startsWith("0")) sawPad = true;
    }
    expect(sawPad).toBe(true);
  });

  test("1 digit and 10 digits", async () => {
    expect(password(await hotp(SECRET, 1, 1))).toBe("2");
    expect(password(await hotp(SECRET, 1, 10))).toBe("1094287082");
  });

  test("the largest counter is 2^64 - 1", async () => {
    expect(code(await hotp(SECRET, 2n ** 64n - 1n))).toBe("ok");
    expect(code(await hotp(SECRET, 2n ** 64n))).toBe("E_RANGE");
  });

  test("the digits are uniform: a loose chi-squared check of the last digit over 400 counters", async () => {
    const counts = new Array<number>(10).fill(0);
    for (let c = 0; c < 400; c++) counts[Number(password(await hotp(SECRET, c, 1)) ?? 0)]!++;
    const chi = counts.reduce((a, o) => a + (o - 40) ** 2 / 40, 0);
    expect(chi).toBeLessThan(40); // 9 degrees of freedom
  });
});
