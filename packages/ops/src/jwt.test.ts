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
 * Tests for the `jwt` vocabulary (vocab/jwt.fth). The RFC 7515 A.1 and RFC 7519 3.1 tokens and the computed
 * HS256/HS384/HS512 tokens are in vocab/jwt.test.json; these reproduce RFC 7515 A.1 byte for byte through the
 * private `_sign` (the public `sign` always writes alg first, and A.1's header is typ first), check the
 * `none` and algorithm-confusion refusals, and run a 64 KiB payload.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["jwt"]));
// The private words are reachable only from a unit in their own vocabulary, so the test adds a probe.
runtime.load(`IN: jwt
: t-sign ( payload:bytes key:bytes alg:str header:str -- bytes ) payload key alg header _sign ;`);

const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => Array.from(u, (b) => String.fromCharCode(b)).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const out = (r: Awaited<ReturnType<typeof runtime.call>>) =>
  r.ok ? ascii((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) : undefined;
const code = (r: Awaited<ReturnType<typeof runtime.call>>) => (r.ok ? "ok" : r.error.code);

// RFC 7515 appendix A.1: the JWS, the key (the JWK k, base64url-decoded) and its parts.
const A1_HEADER = '{"typ":"JWT",\r\n "alg":"HS256"}';
const A1_PAYLOAD = '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}';
const A1_KEY = unhex(
  "0323354b2b0fa5bc837e0665777ba68f5ab328e6f054c928a90f84b2d2502ebfd3fb5a92d20647ef968ab4c377623d223d2e2172052e4f08c0cd9af567d080a3",
);
const A1_TOKEN =
  "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const verify = (token: string, key: Uint8Array, alg = "auto") =>
  runtime.call("jwt:verify", [bytes(text(token)), bytes(key), str(alg)]);
const sign = (payload: Uint8Array, key: Uint8Array, alg = "HS256", header = "{}") =>
  runtime.call("jwt:sign", [bytes(payload), bytes(key), str(alg), str(header)]);

describe("jwt", () => {
  test("RFC 7515 A.1 is reproduced byte for byte with the pinned header", async () => {
    const r = await runtime.call("jwt:t-sign", [
      bytes(text(A1_PAYLOAD)),
      bytes(A1_KEY),
      str("HS256"),
      str(A1_HEADER),
    ]);
    expect(out(r)).toBe(A1_TOKEN);
  });

  test("verify returns the payload exactly as signed (CRLF and spaces kept)", async () => {
    expect(out(await verify(A1_TOKEN, A1_KEY))).toBe(A1_PAYLOAD);
  });

  test("the unsecured token of RFC 7519 3.1 is refused whatever the key and alg", async () => {
    const none =
      "eyJhbGciOiJub25lIn0.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.";
    for (const alg of ["auto", "HS256", "HS384", "HS512"]) {
      expect(code(await verify(none, A1_KEY, alg))).toBe("E_RANGE");
      expect(code(await verify(none, new Uint8Array(0), alg))).toBe("E_RANGE");
    }
    // and the case variants of none are not algorithms either
    const header = btoaUrl('{"alg":"None"}');
    expect(code(await verify(`${header}.e30.`, A1_KEY))).toBe("E_RANGE");
    expect(code(await verify(`${btoaUrl('{"alg":""}')}.e30.`, A1_KEY))).toBe("E_RANGE");
  });

  test("an alg header that is not a string, or is missing, is E_COERCE", async () => {
    expect(code(await verify(`${btoaUrl('{"alg":5}')}.e30.x`, A1_KEY))).toBe("E_COERCE");
    expect(code(await verify(`${btoaUrl('{"typ":"JWT"}')}.e30.x`, A1_KEY))).toBe("E_COERCE");
  });

  test("sign then verify with each algorithm, and a key given as bytes", async () => {
    const key = text("k".repeat(100));
    for (const alg of ["HS256", "HS384", "HS512"]) {
      const token = out(await sign(text('{"a":1}'), key, alg));
      expect(token).toBeDefined();
      expect(out(await verify(token as string, key, alg))).toBe('{"a":1}');
      expect(code(await verify(token as string, text("other"), alg))).toBe("E_COERCE");
    }
  });

  test("64 KiB payload round trip", async () => {
    const body = "x".repeat(65000);
    const payload = text(`{"d":"${body}"}`);
    const s = await sign(payload, text("secret"), "HS512");
    expect(s.ok).toBe(true);
    const token = out(s) as string;
    const v = await verify(token, text("secret"));
    expect(out(v)).toBe(`{"d":"${body}"}`);
    if (s.ok && v.ok) expect(s.steps + v.steps).toBeLessThan(5_000_000);
  });

  test("decode does not need the key and reads either part", async () => {
    const p = await runtime.call("jwt:decode", [bytes(text(A1_TOKEN)), str("payload")]);
    expect(out(p)).toBe(A1_PAYLOAD);
    const h = await runtime.call("jwt:decode", [bytes(text(A1_TOKEN)), str("header")]);
    expect(out(h)).toBe(A1_HEADER);
  });
});

function btoaUrl(s: string): string {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const b = text(s);
  let o = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    for (let k = 3; k >= 0; k--) o += B64[(n >> (6 * k)) & 63];
  }
  return o.slice(0, Math.ceil((b.length * 4) / 3));
}
