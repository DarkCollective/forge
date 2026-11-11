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
 * Tests for the `fernet` vocabulary (vocab/fernet.fth). The IV and the time are pinned two ways: the private
 * `_seal` and `_open` take them as arguments (used with the vectors of github.com/fernet/spec: generate.json,
 * verify.json and invalid.json), and the public words are run with a stubbed `crypto.getRandomValues` and a fake
 * clock. Deterministic Fernet vectors for the public words are in vocab/fernet.test.json (decrypt only; encrypt
 * is random by design).
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["fernet"]));

// The private words are reachable only from a unit in their own vocabulary, so the test adds two probes to it.
runtime.load(`IN: fernet
: t-seal ( data:bytes key:bytes iv:bytes ts:int -- bytes ) data key iv ts _seal ;
: t-open ( token:bytes key:bytes ttl:int now:int -- bytes ) token key ttl now _open ;`);

const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => Array.from(u, (b) => String.fromCharCode(b)).join("");
const out = (r: Awaited<ReturnType<typeof runtime.call>>) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Awaited<ReturnType<typeof runtime.call>>) => (r.ok ? "ok" : r.error.code);

// The key of the spec's three files (url-safe base64 text), and the clock of generate.json.
const SECRET = text("cw_0x689RpI-jtRR7oE8h_eQsKImvJapLeSbXpwF4e4=");
const T0 = Date.parse("1985-10-26T01:20:00-07:00") / 1000;
const IV = Uint8Array.from({ length: 16 }, (_, i) => i);
const GENERATED =
  "gAAAAAAdwJ6wAAECAwQFBgcICQoLDA0ODy021cpGVWKZ_eEwCGM4BLLF_5CV9dOPmrhuVUPgJobwOz7JcbmrR64jVmpU4IwqDA==";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** url-safe base64 text of 32 bytes, with padding (written out so the test needs no host helper). */
function urlsafe(raw: Uint8Array): string {
  let s = "";
  for (let i = 0; i < raw.length; i += 3) {
    const n = ((raw[i] ?? 0) << 16) | ((raw[i + 1] ?? 0) << 8) | (raw[i + 2] ?? 0);
    for (let k = 3; k >= 0; k--) s += B64[(n >> (6 * k)) & 63];
  }
  return s.slice(0, Math.ceil((raw.length * 4) / 3)) + "=".repeat((3 - (raw.length % 3)) % 3);
}

const seal = (data: Uint8Array, key: Uint8Array, iv: Uint8Array, ts: number) =>
  runtime.call("fernet:t-seal", [bytes(data), bytes(key), bytes(iv), int(ts)]);
const open = (token: string, key: Uint8Array, ttl: number, now: number) =>
  runtime.call("fernet:t-open", [bytes(text(token)), bytes(key), int(ttl), int(now)]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fernet spec vectors", () => {
  test("generate.json: the token of 'hello' with the pinned IV and time", async () => {
    expect(T0).toBe(499162800);
    const r = await seal(text("hello"), SECRET, IV, T0);
    expect(ascii(out(r) as Uint8Array)).toBe(GENERATED);
  });

  test("verify.json: the same token opens at +1 s with a 60 s TTL", async () => {
    const r = await open(GENERATED, SECRET, 60, T0 + 1);
    expect(ascii(out(r) as Uint8Array)).toBe("hello");
  });

  // invalid.json, every case with ttl 60 and now = 1985-10-26T01:20:01-07:00 unless noted
  const invalid: [string, string, number][] = [
    [
      "incorrect mac",
      "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAl1-szkFVzXTuGb4hR8AKtwcaX1YdykQUFBQUFBQUFBQQ==",
      T0 + 1,
    ],
    ["too short", "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPA==", T0 + 1],
    [
      "invalid base64",
      "%%%%%%%%%%%%%AECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAl1-szkFVzXTuGb4hR8AKtwcaX1YdykRtfsH-p1YsUD2Q==",
      T0 + 1,
    ],
    [
      "payload size not multiple of block size",
      "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPOm73QeoCk9uGib28Xe5vz6oxq5nmxbx_v7mrfyudzUm",
      T0 + 1,
    ],
    [
      "payload padding error",
      "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0ODz4LEpdELGQAad7aNEHbf-JkLPIpuiYRLQ3RtXatOYREu2FWke6CnJNYIbkuKNqOhw==",
      T0 + 1,
    ],
    [
      "far-future TS (unacceptable clock skew)",
      "gAAAAAAdwStRAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAnja1xKYyhd-Y6mSkTOyTGJmw2Xc2a6kBd-iX9b_qXQcw==",
      T0 + 1,
    ],
    [
      "expired TTL",
      "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAl1-szkFVzXTuGb4hR8AKtwcaX1YdykRtfsH-p1YsUD2Q==",
      T0 + 91,
    ],
    [
      "incorrect IV (causes padding error)",
      "gAAAAAAdwJ6xBQECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAkLhFLHpGtDBRLRTZeUfWgHSv49TF2AUEZ1TIvcZjK1zQ==",
      T0 + 1,
    ],
  ];
  for (const [desc, token, now] of invalid) {
    test(`invalid.json: ${desc}`, async () => {
      expect(code(await open(token, SECRET, 60, now))).toBe("E_COERCE");
    });
  }

  test("the expired token (it holds an empty message) is fine without a TTL, and the clock checks need a TTL", async () => {
    const token =
      "gAAAAAAdwJ6xAAECAwQFBgcICQoLDA0OD3HkMATM5lFqGaerZ-fWPAl1-szkFVzXTuGb4hR8AKtwcaX1YdykRtfsH-p1YsUD2Q==";
    const r = await open(token, SECRET, 0, T0 + 1_000_000);
    expect(r.ok).toBe(true);
    expect((out(r) as Uint8Array).length).toBe(0);
  });

  test("a TTL is checked at its edge: valid at ts + ttl, expired one second later", async () => {
    expect(code(await open(GENERATED, SECRET, 60, T0 + 60))).toBe("ok");
    expect(code(await open(GENERATED, SECRET, 60, T0 + 61))).toBe("E_COERCE");
    expect(code(await open(GENERATED, SECRET, 60, T0 - 60))).toBe("ok");
    expect(code(await open(GENERATED, SECRET, 60, T0 - 61))).toBe("E_COERCE");
  });
});

describe("fernet keys", () => {
  test("a raw 32-byte key gives the same token as its base64 text", async () => {
    const raw = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
    const b64 = urlsafe(raw);
    const a = await seal(text("x"), raw, IV, T0);
    const b = await seal(text("x"), text(b64), IV, T0);
    expect(ascii(out(a) as Uint8Array)).toBe(ascii(out(b) as Uint8Array));
  });

  test("a key of another size is E_RANGE", async () => {
    expect(code(await seal(text("x"), new Uint8Array(31), IV, T0))).toBe("E_RANGE");
    expect(code(await seal(text("x"), text("AAAA"), IV, T0))).toBe("E_RANGE");
    expect(code(await open(GENERATED, new Uint8Array(33), 0, 0))).toBe("E_RANGE");
  });

  test("a negative TTL is E_RANGE, a wrong key is E_COERCE", async () => {
    expect(code(await open(GENERATED, SECRET, -1, T0))).toBe("E_RANGE");
    expect(code(await open(GENERATED, new Uint8Array(32), 0, T0))).toBe("E_COERCE");
  });

  test("an empty input is one padding block", async () => {
    const r = await seal(new Uint8Array(0), SECRET, IV, T0);
    const token = ascii(out(r) as Uint8Array);
    expect(token.length).toBe(Math.ceil((1 + 8 + 16 + 16 + 32) / 3) * 4);
    const back = await open(token, SECRET, 0, 0);
    expect((out(back) as Uint8Array).length).toBe(0);
  });
});

describe("fernet:encrypt and fernet:decrypt", () => {
  test("they carry the +random and +time effects", () => {
    expect(runtime.meta("fernet:encrypt").effects).toEqual(["+random", "+time"]);
    expect(runtime.meta("fernet:decrypt").effects).toEqual(["+time"]);
  });

  test("with the IV and the clock pinned, encrypt gives the spec token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0 * 1000);
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.set(IV);
        return a;
      },
    });
    const r = await runtime.call("fernet:encrypt", [bytes(text("hello")), bytes(SECRET)]);
    expect(ascii(out(r) as Uint8Array)).toBe(GENERATED);
  });

  test("decrypt takes the time from the clock when a TTL is set", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((T0 + 30) * 1000);
    const ok = await runtime.call("fernet:decrypt", [
      bytes(text(GENERATED)),
      bytes(SECRET),
      int(60),
    ]);
    expect(ascii(out(ok) as Uint8Array)).toBe("hello");
    vi.setSystemTime((T0 + 200) * 1000);
    const late = await runtime.call("fernet:decrypt", [
      bytes(text(GENERATED)),
      bytes(SECRET),
      int(60),
    ]);
    expect(code(late)).toBe("E_COERCE");
  });

  test("two encryptions differ (real randomness), and both decrypt", async () => {
    const a = await runtime.call("fernet:encrypt", [bytes(text("same")), bytes(SECRET)]);
    const b = await runtime.call("fernet:encrypt", [bytes(text("same")), bytes(SECRET)]);
    const ta = ascii(out(a) as Uint8Array);
    expect(ta).not.toBe(ascii(out(b) as Uint8Array));
    const back = await runtime.call("fernet:decrypt", [bytes(text(ta)), bytes(SECRET), int(60)]);
    expect(ascii(out(back) as Uint8Array)).toBe("same");
  });

  test("a host without a random source is an error, never a weak IV", async () => {
    vi.stubGlobal("crypto", undefined);
    const r = await runtime.call("fernet:encrypt", [bytes(text("x")), bytes(SECRET)]);
    expect(code(r)).toBe("E_PRIMITIVE");
  });

  test("64 KiB round trip, and a flipped bit anywhere is rejected", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const enc = await runtime.call("fernet:encrypt", [bytes(data), bytes(SECRET)]);
    expect(enc.ok).toBe(true);
    const token = ascii(out(enc) as Uint8Array);
    const dec = await runtime.call("fernet:decrypt", [bytes(text(token)), bytes(SECRET), int(0)]);
    expect(dec.ok).toBe(true);
    expect(out(dec)).toEqual(data);
    if (enc.ok && dec.ok) expect(enc.steps + dec.steps).toBeLessThan(5_000_000);
    const bad = token.slice(0, 100) + (token[100] === "A" ? "B" : "A") + token.slice(101);
    expect(
      code(await runtime.call("fernet:decrypt", [bytes(text(bad)), bytes(SECRET), int(0)])),
    ).toBe("E_COERCE");
  });

  test("64 KiB with a pinned IV and time matches an independent Fernet (Python cryptography 46.0.3, Fernet._encrypt_from_parts)", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const r = await seal(data, SECRET, IV, T0);
    const token = ascii(out(r) as Uint8Array);
    expect(token.length).toBe(87480);
    expect(token.slice(0, 60)).toBe("gAAAAAAdwJ6wAAECAwQFBgcICQoLDA0OD7gY-oZH6FjMt7jup6-_Jap_smtI");
    // the last 44 characters hold the HMAC, which covers every byte before it
    expect(token.slice(-60)).toBe("j8jcoKTPFnxhcOHmtscOBidMS1BupY6IDlwWCBu215pzzUiC74O95r1JmRs=");
  });
});
