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
 * Tests for the `hassh` vocabulary (vocab/hassh.fth): HASSH Client Fingerprint and HASSH Server Fingerprint. The
 * known-answer vectors (vocab/hassh.test.json) were computed by Python (struct, hashlib) from RFC 4253 section 7.1
 * and the Salesforce HASSH definition; here: truncation at every cut point, mutated packets, hostile lengths, the
 * depth at which errors are raised, and the VM step counts on 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import type { Limits, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const bundle = await loadBundleNode(["hassh"]);
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

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as Value).v as string;
};
const run = (op: "client" | "server", data: Uint8Array, output = "hash", rt = runtime) =>
  rt.call(`hassh:${op}`, [bytes(data), str("raw"), str(output)]);

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    o.set(p, at);
    at += p.length;
  }
  return o;
};
const u32 = (n: number): Uint8Array =>
  Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const nameList = (s: string): Uint8Array => cat(u32(s.length), ascii(s));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** An SSH_MSG_KEXINIT binary packet (RFC 4253 sections 6 and 7.1) with the given ten name-lists. */
const kexinit = (lists: string[], padding = 4): Uint8Array => {
  const payload = cat(
    Uint8Array.from([20]),
    Uint8Array.from({ length: 16 }, (_, i) => i),
    ...lists.map(nameList),
    Uint8Array.from([0]),
    u32(0),
  );
  return cat(
    u32(1 + payload.length + padding),
    Uint8Array.from([padding]),
    payload,
    new Uint8Array(padding),
  );
};
const LISTS = [
  "curve25519-sha256,diffie-hellman-group14-sha256",
  "ssh-ed25519,rsa-sha2-512",
  "chacha20-poly1305@openssh.com,aes128-ctr",
  "aes256-ctr,aes128-gcm@openssh.com",
  "hmac-sha2-256-etm@openssh.com,hmac-sha2-256",
  "hmac-sha1",
  "none,zlib@openssh.com",
  "none",
  "",
  "",
];
const GOOD = kexinit(LISTS);

describe("the HASSH string", () => {
  test("the client takes the client-to-server lists, the server the server-to-client ones", async () => {
    expect(out(await run("client", GOOD, "string"))).toBe(
      "curve25519-sha256,diffie-hellman-group14-sha256;chacha20-poly1305@openssh.com,aes128-ctr;hmac-sha2-256-etm@openssh.com,hmac-sha2-256;none,zlib@openssh.com",
    );
    expect(out(await run("server", GOOD, "string"))).toBe(
      "curve25519-sha256,diffie-hellman-group14-sha256;aes256-ctr,aes128-gcm@openssh.com;hmac-sha1;none",
    );
  });

  test("the full layout names the direction", async () => {
    const c = out(await run("client", GOOD, "full"));
    expect(c).toContain(
      "Encryption Algorithms Client to Server:\nchacha20-poly1305@openssh.com,aes128-ctr\n",
    );
    const s = out(await run("server", GOOD, "full"));
    expect(s).toContain("Compression Algorithms Server to Client:\nnone");
  });

  test("padding of 4 to 255 bytes", async () => {
    const want = out(await run("client", GOOD));
    for (const pad of [4, 5, 7, 8, 100, 255])
      expect(out(await run("client", kexinit(LISTS, pad)))).toBe(want);
  });
});

describe("truncation at every cut point", () => {
  for (const op of ["client", "server"] as const) {
    test(`${op}: a packet cut anywhere is E_COERCE`, async () => {
      expect(code(await run(op, GOOD))).toBe("ok");
      for (let n = 0; n < GOOD.length; n++)
        expect(code(await run(op, GOOD.slice(0, n))), `${op} cut at ${n}`).toBe("E_COERCE");
    }, 120_000);

    test(`${op}: a packet with its length field fixed up after the cut is E_COERCE`, async () => {
      // the length and the padding are made consistent, so the fault is inside the fields
      for (let n = 6 + 62 - 1; n < GOOD.length - 4; n++) {
        const body = GOOD.slice(5, n);
        const pk = cat(u32(1 + body.length + 4), Uint8Array.from([4]), body, new Uint8Array(4));
        const r = await run(op, pk);
        // cutting the 5 final bytes' neighbourhood leaves a valid packet only when n is exactly at the end
        expect(code(r), `${op} fixed-up cut at ${n}`).toBe("E_COERCE");
      }
    }, 120_000);
  }
});

describe("errors", () => {
  test("messages say what is wrong and where", async () => {
    const msg = async (d: Uint8Array) => {
      const r = await run("client", d);
      expect(code(r)).toBe("E_COERCE");
      return !r.ok ? r.error.message : "";
    };
    expect(await msg(new Uint8Array(0))).toContain("cut short");
    expect(await msg(cat(GOOD, Uint8Array.from([0])))).toContain("packet length");
    const wrongCode = Uint8Array.from(GOOD);
    wrongCode[5] = 21;
    expect(await msg(wrongCode)).toContain("message code is 21");
    const shortPad = Uint8Array.from(GOOD);
    shortPad[4] = 3;
    expect(await msg(shortPad)).toContain("below the minimum of 4");
    const huge = Uint8Array.from(GOOD);
    huge.set(u32(0xffffffff), 22);
    expect(await msg(huge)).toContain("declares 4294967295 bytes");
    const bad = Uint8Array.from(GOOD);
    bad[26] = 0xe9;
    expect(await msg(bad)).toContain("not printable US-ASCII");
  });

  test("every error is raised fewer than 16 calls deep", async () => {
    let deepest = 0;
    const cases: Uint8Array[] = [new Uint8Array(0), GOOD.slice(0, 30)];
    for (const n of [50, 62, 120, 150, GOOD.length - 6]) cases.push(GOOD.slice(0, n));
    const bad = Uint8Array.from(GOOD);
    bad.set(u32(0xffffffff), 22);
    cases.push(bad);
    const bad2 = Uint8Array.from(GOOD);
    bad2[26] = 0xe9;
    cases.push(bad2);
    for (const c of cases) {
      const r = await run("client", c);
      if (!r.ok) deepest = Math.max(deepest, r.error.frames.length);
    }
    expect(deepest).toBeGreaterThan(0);
    expect(deepest).toBeLessThan(16);
  });
});

describe("mutated input gives a result or E_COERCE, nothing else", () => {
  let seed = 20260712;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  for (const op of ["client", "server"] as const) {
    test(`${op} on ${GOOD.length} bytes, 300 mutations`, async () => {
      for (let i = 0; i < 300; i++) {
        const m = Uint8Array.from(GOOD);
        for (let k = 0, n = 1 + (next() % 3); k < n; k++) m[next() % m.length] = next() & 255;
        const r = await run(op, m);
        expect(["ok", "E_COERCE"], `${op} ${toHex(m)}`).toContain(code(r));
      }
    }, 60_000);
  }
});

describe("hostile lengths allocate nothing", () => {
  test("a name-list of 4 GB, and a packet length of 4 GB, on a small packet", async () => {
    for (const at of [22, 26 + LISTS[0]!.length, 0]) {
      const d = Uint8Array.from(GOOD);
      d.set(u32(0xffffffff), at);
      expect(code(await run("client", d))).toBe("E_COERCE");
    }
  });
});

describe("cost on 64 KiB (steps are VM steps, measured)", () => {
  test("a KEXINIT of about 64 KiB: one list of 65,000 characters", async () => {
    const big = "a,".repeat(32_400) + "a";
    const pk = kexinit([big, "", "e", "e", "m", "m", "c", "c", "", ""]);
    expect(pk.length).toBeGreaterThan(64_000);
    const r = await run("client", pk, "full", strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(2_500_000);
  }, 60_000);

  test("ten lists of 6,000 characters", async () => {
    const lists = Array.from({ length: 10 }, (_, i) => `n${i},`.repeat(1200) + "z");
    const r = await run("server", kexinit(lists), "hash", strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(2_500_000);
  }, 60_000);
});
