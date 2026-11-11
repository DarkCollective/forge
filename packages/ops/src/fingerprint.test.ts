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
 * Tests for the `fingerprint` vocabulary (vocab/fingerprint.fth): JA3, JA3S, JA4 and JA4S. The known-answer vectors
 * (vocab/fingerprint.test.json) were computed by an independent Python implementation of the Salesforce and FoxIO
 * definitions on hellos captured between openssl s_client and s_server and on hand-built ones; here: the pieces
 * that cannot be a vector (truncation at every cut point, mutated input, error attribution depth, hostile sizes)
 * and the VM step counts on 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import type { Limits, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const bundle = await loadBundleNode(["fingerprint"]);
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

const hex = (s: string): Uint8Array =>
  Uint8Array.from(s.replace(/\s+/g, "").match(/../g) ?? [], (h) => parseInt(h, 16));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    o.set(p, at);
    at += p.length;
  }
  return o;
};
const u16 = (n: number): Uint8Array => Uint8Array.from([n >> 8, n & 255]);
const u24 = (n: number): Uint8Array => Uint8Array.from([n >> 16, (n >> 8) & 255, n & 255]);
const rec = (type: number, frag: Uint8Array): Uint8Array =>
  cat(Uint8Array.from([type, 3, 1]), u16(frag.length), frag);
const hs = (type: number, body: Uint8Array): Uint8Array =>
  cat(Uint8Array.from([type]), u24(body.length), body);
const ext = (type: number, data: Uint8Array): Uint8Array => cat(u16(type), u16(data.length), data);
const clientHello = (ciphers: number[], exts: Uint8Array[]): Uint8Array => {
  const cs = cat(...ciphers.map(u16));
  const es = cat(...exts);
  return hs(
    1,
    cat(
      u16(0x0303),
      new Uint8Array(32),
      Uint8Array.from([0]),
      u16(cs.length),
      cs,
      hex("0100"),
      u16(es.length),
      es,
    ),
  );
};
const serverHello = (cipher: number, exts: Uint8Array[]): Uint8Array => {
  const es = cat(...exts);
  return hs(
    2,
    cat(
      u16(0x0303),
      new Uint8Array(32),
      Uint8Array.from([0]),
      u16(cipher),
      hex("00"),
      u16(es.length),
      es,
    ),
  );
};

interface Vector {
  name: string;
  input: { value: string };
}
const packetVectors: Vector[] = JSON.parse(
  readFileSync(
    fileURLToPath(import.meta.url).replace(/[/\\]src[/\\][^/\\]*$/, "/vocab/packets.test.json"),
    "utf8",
  ),
);
const packet = (name: string): Uint8Array => {
  const v = packetVectors.find((x) => x.name.startsWith(name));
  if (!v) throw new Error(`no vector ${name}`);
  return hex(v.input.value);
};
/** The first TLS record of a capture (a whole flight is several records). */
const firstRecord = (b: Uint8Array): Uint8Array => b.slice(0, 5 + b[3]! * 256 + b[4]!);

const CLIENT = firstRecord(packet("TLS 1.3 handshake: ClientHello"));
const SERVER = firstRecord(packet("TLS 1.3: ServerHello and encrypted"));
const OPS = [
  ["ja3", CLIENT, "hash"],
  ["ja3s", SERVER, "hash"],
  ["ja4", CLIENT, "ja4"],
  ["ja4s", SERVER, "ja4s"],
] as const;
const run = (op: string, data: Uint8Array, format: string, output: string, rt = runtime) =>
  rt.call(
    `fingerprint:${op}`,
    op.startsWith("ja4")
      ? [bytes(data), str(format), str(output), str("tcp")]
      : [bytes(data), str(format), str(output)],
  );

describe("the pinned values (the same hellos as the vectors)", () => {
  test("openssl 3.0.13 TLS 1.3 ClientHello and ServerHello", async () => {
    expect(out(await run("ja3", CLIENT, "raw", "hash"))).toBe("5a1edc7f170af1014fc65c994878e63c");
    expect(out(await run("ja4", CLIENT, "raw", "ja4"))).toBe(
      "t13d3111h2_e8f1e7e78f70_1f22a2ca17c4",
    );
    expect(out(await run("ja3s", SERVER, "raw", "string"))).toBe("771,4866,43-51");
    expect(out(await run("ja4s", SERVER, "raw", "ja4s"))).toBe("t130200_1302_a56c5b993250");
  });

  test("the inputs are the same bytes in hex, Base64 and raw", async () => {
    const a = out(await run("ja3", CLIENT, "raw", "hash"));
    expect(out(await run("ja3", new TextEncoder().encode(toHex(CLIENT)), "hex", "hash"))).toBe(a);
    let bin = "";
    for (const c of CLIENT) bin += String.fromCharCode(c);
    const b64 = (globalThis as unknown as { btoa(s: string): string }).btoa(bin);
    expect(out(await run("ja3", new TextEncoder().encode(b64), "base64", "hash"))).toBe(a);
  });

  test("a bare handshake message and the record around it give the same answer", async () => {
    const msg = CLIENT.slice(5);
    for (const op of ["ja3", "ja4"] as const) {
      const f = op === "ja3" ? "hash" : "ja4";
      expect(out(await run(op, msg, "raw", f))).toBe(out(await run(op, CLIENT, "raw", f)));
    }
    const smsg = SERVER.slice(5);
    expect(out(await run("ja3s", smsg, "raw", "hash"))).toBe(
      out(await run("ja3s", SERVER, "raw", "hash")),
    );
  });

  test("a hello of 18433 bytes cannot be wrapped in a record", async () => {
    const big = clientHello([0x1301], [ext(0x7777, new Uint8Array(18_500))]);
    const r = await run("ja3", big, "raw", "hash");
    expect(code(r)).toBe("E_COERCE");
    expect(!r.ok && r.error.message).toContain("18432");
  });

  test("GREASE values are not counted and not listed; an empty list is twelve zeros", async () => {
    const hello = rec(22, clientHello([0x0a0a, 0xfafa], [ext(0x2a2a, new Uint8Array(0))]));
    expect(out(await run("ja3", hello, "raw", "string"))).toBe("771,,,,");
    expect(out(await run("ja4", hello, "raw", "ja4"))).toBe("t12i000000_000000000000_000000000000");
    expect(out(await run("ja4", hello, "raw", "ja4-r"))).toBe("t12i000000__");
  });

  test("a ServerHello is not a ClientHello and the reverse", async () => {
    const a = await run("ja3", SERVER, "raw", "hash");
    expect(code(a)).toBe("E_COERCE");
    expect(!a.ok && a.error.message).toContain("no ClientHello");
    const b = await run("ja3s", CLIENT, "raw", "hash");
    expect(code(b)).toBe("E_COERCE");
    expect(!b.ok && b.error.message).toContain("no ServerHello");
  });

  test("a bad choice is an error, not a silent default", async () => {
    expect(code(await run("ja3", CLIENT, "raw", "everything"))).not.toBe("ok");
    expect(code(await run("ja4", CLIENT, "bits", "ja4"))).not.toBe("ok");
  });
});

describe("truncation at every cut point", () => {
  for (const [op, full, output] of OPS) {
    test(`${op}: a record cut anywhere is E_COERCE, the whole record is not`, async () => {
      expect(code(await run(op, full, "raw", output))).toBe("ok");
      for (let n = 0; n < full.length; n++) {
        const r = await run(op, full.slice(0, n), "raw", output);
        expect(code(r), `${op} cut at ${n}`).toBe("E_COERCE");
      }
    }, 120_000);

    test(`${op}: a bare handshake message cut anywhere is E_COERCE`, async () => {
      const msg = full.slice(5);
      expect(code(await run(op, msg, "raw", output))).toBe("ok");
      for (let n = 0; n < msg.length; n++) {
        const r = await run(op, msg.slice(0, n), "raw", output);
        expect(code(r), `${op} bare message cut at ${n}`).toBe("E_COERCE");
      }
    }, 120_000);
  }
});

describe("errors keep their place in a recipe", () => {
  // The recipe step is found from the outermost frame of an error, and an error keeps only 16 frames: the
  // deepest call chain to a raise must stay below that, whichever check fails.
  test("every error is raised fewer than 16 calls deep", async () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      CLIENT.slice(0, 7),
      CLIENT.slice(0, 40),
      cat(CLIENT, hex("160301")),
    ];
    for (const v of packetVectors) {
      if (v.name.startsWith("hello:")) cases.push(hex(v.input.value));
    }
    let deepest = 0;
    for (const data of cases) {
      for (const [op, , output] of OPS) {
        const r = await run(op, data, "raw", output);
        if (!r.ok) deepest = Math.max(deepest, r.error.frames.length);
      }
    }
    expect(deepest).toBeGreaterThan(0);
    expect(deepest).toBeLessThan(16);
  }, 120_000);
});

describe("mutated input gives a result or E_COERCE, nothing else", () => {
  let seed = 20260711;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  for (const [op, data, output] of OPS) {
    test(`${op} on ${data.length} bytes, 300 mutations`, async () => {
      for (let i = 0; i < 300; i++) {
        const m = Uint8Array.from(data);
        for (let k = 0, n = 1 + (next() % 3); k < n; k++) m[next() % m.length] = next() & 255;
        const r = await run(op, m, "raw", output);
        expect(["ok", "E_COERCE"], `${op} ${toHex(m)}`).toContain(code(r));
      }
    }, 60_000);
  }
});

describe("cost on 64 KiB (steps are VM steps, measured)", () => {
  test("a hello with 2,000 extensions (a record holds at most 18,432 bytes)", async () => {
    const exts = Array.from({ length: 2000 }, (_, i) =>
      ext(0x7000 + (i % 0x0fff), new Uint8Array(4)),
    );
    const hello = rec(22, clientHello([0x1301], exts));
    for (const [op, output] of [
      ["ja3", "hash"],
      ["ja4", "all"],
    ] as const) {
      const r = await run(op, hello, "raw", output, strict);
      expect(code(r), op).toBe("ok");
      expect(r.ok && r.steps, op).toBeLessThan(2_500_000);
    }
  }, 60_000);

  test("a hello with 8,000 cipher suites; a ServerHello with 2,000 extensions", async () => {
    const hello = rec(
      22,
      clientHello(
        Array.from({ length: 8000 }, (_, i) => 0x1300 + (i % 400)),
        [],
      ),
    );
    const a = await run("ja3", hello, "raw", "full", strict);
    expect(a.ok && a.steps).toBeLessThan(2_500_000);
    const b = await run("ja4", hello, "raw", "all", strict);
    expect(b.ok && b.steps).toBeLessThan(2_500_000);
    const sh = rec(
      22,
      serverHello(
        0x1301,
        Array.from({ length: 2000 }, (_, i) => ext(0x7000 + (i % 0x0fff), new Uint8Array(4))),
      ),
    );
    const c = await run("ja3s", sh, "raw", "full", strict);
    const d = await run("ja4s", sh, "raw", "both", strict);
    expect(c.ok && c.steps).toBeLessThan(2_500_000);
    expect(d.ok && d.steps).toBeLessThan(2_500_000);
  }, 60_000);

  test("a hello followed by 13,000 empty records (64 KiB)", async () => {
    const tail = cat(...Array.from({ length: 13_000 }, () => rec(23, new Uint8Array(0))));
    const r = await run("ja4", cat(CLIENT, tail), "raw", "ja4", strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(2_600_000);
  }, 60_000);

  test("64 KiB of hex text is decoded in a few steps", async () => {
    const text = new TextEncoder().encode(toHex(CLIENT).padEnd(65_536, " "));
    const r = await run("ja3", text, "hex", "hash", strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(60_000);
  });
});
