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
 * Tests for the `flask-session` vocabulary (vocab/flask-session.fth). The cookies in vocab/flask-session.test.json
 * were computed with Python's hmac/hashlib following itsdangerous; these cover the clock (the +time effect, the
 * pinned timestamp and the fake clock), the shortest-big-endian timestamp, and a 64 KiB payload.
 */
import { deflateSync } from "node:zlib";
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["flask-session"]));

const text = (s: string) => new TextEncoder().encode(s);
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** URL-safe base64 without padding. */
function b64url(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    if (i + 1 < b.length) out += B64.charAt((n >> 6) & 63);
    if (i + 2 < b.length) out += B64.charAt(n & 63);
  }
  return out;
}
const ascii = (u: Uint8Array) => Array.from(u, (b) => String.fromCharCode(b)).join("");
const out = (r: Awaited<ReturnType<typeof runtime.call>>) =>
  r.ok ? ascii((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) : undefined;
const code = (r: Awaited<ReturnType<typeof runtime.call>>) => (r.ok ? "ok" : r.error.code);

const KEY = text("secret-key");
const SALT = text("cookie-session");
const PAYLOAD = '{"user":"admin","role":"editor"}';
// itsdangerous reimplemented with Python hmac/hashlib: key secret-key, ts 1700000000, sha1
const COOKIE = "eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoiZWRpdG9yIn0.ZVPxAA.EMj9sWlqrOaM5slFnW5cWDEoCx8";

const sign = (payload: string, ts: number, alg = "sha1") =>
  runtime.call("flask-session:sign", [
    bytes(text(payload)),
    bytes(KEY),
    bytes(SALT),
    str(alg),
    int(ts),
  ]);

afterEach(() => {
  vi.useRealTimers();
});

describe("flask-session", () => {
  test("sign carries the +time effect, decode and verify do not", () => {
    expect(runtime.meta("flask-session:sign").effects).toEqual(["+time"]);
    expect(runtime.meta("flask-session:decode").effects).toEqual([]);
    expect(runtime.meta("flask-session:verify").effects).toEqual([]);
  });

  test("a pinned timestamp ignores the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000_000_000_000);
    expect(out(await sign(PAYLOAD, 1700000000))).toBe(COOKIE);
  });

  test("timestamp 0 uses the clock, in whole seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_999);
    expect(out(await sign(PAYLOAD, 0))).toBe(COOKIE);
  });

  test("a cookie signed now verifies with its own timestamp", async () => {
    const token = out(await sign(PAYLOAD, 0)) as string;
    const r = await runtime.call("flask-session:verify", [
      bytes(text(token)),
      bytes(KEY),
      bytes(SALT),
      str("sha1"),
      bool(true),
    ]);
    const m = /^\{"valid":true,"payload":(.*),"timestamp":(\d+)\}$/.exec(out(r) ?? "");
    expect(m?.[1]).toBe(PAYLOAD);
    expect(Math.abs(Number(m?.[2]) - Date.now() / 1000)).toBeLessThan(5);
  });

  test("64 KiB payload round trip, both digests", async () => {
    const body = "y".repeat(65000);
    const payload = `{"d":"${body}"}`;
    for (const alg of ["sha1", "sha256"]) {
      const s = await sign(payload, 1700000000, alg);
      expect(s.ok).toBe(true);
      const v = await runtime.call("flask-session:verify", [
        bytes(text(out(s) as string)),
        bytes(KEY),
        bytes(SALT),
        str(alg),
        bool(false),
      ]);
      expect(out(v)).toBe(`{"valid":true,"payload":${payload}}`);
      if (s.ok && v.ok) expect(s.steps + v.steps).toBeLessThan(5_000_000);
    }
  });

  test("a compressed cookie is inflated (the signature covers the dot)", async () => {
    // Made by hand in Python (zlib.compress, base64url, HMAC-SHA1 over ".payload.ts"); see the vectors file.
    const cookie =
      ".eJyrVkpOLCpRsopWSiwoyElV0sFJJyXmASE-RqyOUmlxapGSlVJiSm5mHlCiKB-o1UopNSWzJL9IqRYAczwi1g.ZVPxAA.QCoe3AWEJ0L8fnMPo6y0fdPi3AI";
    const json =
      '{"cart":["apple","apple","apple","apple","banana","banana","banana","banana"],"user":"admin","role":"editor"}';
    const d = await runtime.call("flask-session:decode", [bytes(text(cookie)), bool(false)]);
    expect(out(d)).toBe(json);
    const v = await runtime.call("flask-session:verify", [
      bytes(text(cookie)),
      bytes(KEY),
      bytes(SALT),
      str("sha1"),
      bool(false),
    ]);
    expect(out(v)).toBe(`{"valid":true,"payload":${json}}`);
  });

  test("a zlib bomb in a cookie payload stops at the value limit", async () => {
    const bomb = deflateSync(new Uint8Array(20 * 1024 * 1024));
    const small = assembleRuntime(await loadBundleNode(["flask-session"]), {
      limits: { maxValueBytes: 16 * 1024 * 1024 },
    });
    const r = await small.call("flask-session:decode", [
      bytes(text(`.${b64url(bomb)}.ZVPxAA.sig`)),
      bool(false),
    ]);
    expect(code(r)).toBe("E_LIMIT_VALUE");
  }, 60_000);
});
