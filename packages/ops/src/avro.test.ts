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
 * Tests for the `avro` vocabulary (vocab/avro.fth, src/prims/avro.ts). The op vectors (vocab/avro.test.json) hold
 * files written by Python's fastavro and containers built by hand from the specification; these tests add
 * truncation at every cut point, mutated bytes, hostile counts, sizes and compressed blocks, the codec message
 * and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  asBytes,
  code,
  cutPoints,
  fromHex,
  loadRuntime,
  message,
  mutations,
  steps,
  text,
} from "./data-format-test.js";
import type { Limits } from "./data-format-test.js";

const { bool, int } = valueHelpers;
const runtime = await loadRuntime(["avro"]);

const toJson = (d: Uint8Array, force = false, indent = 0, limits?: Limits) =>
  runtime.call(
    "avro:to-json",
    [asBytes(d), bool(force), int(indent)],
    limits === undefined ? undefined : { limits },
  );

// ---- a container writer, from the specification
const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const vi = (n: bigint): Uint8Array => {
  let z = (n << 1n) ^ (n >> 63n);
  z = BigInt.asUintN(64, z);
  const out: number[] = [];
  while (z > 0x7fn) {
    out.push(Number(z & 0x7fn) | 0x80);
    z >>= 7n;
  }
  out.push(Number(z));
  return Uint8Array.from(out);
};
const long = (n: number | bigint) => vi(BigInt(n));
const bytesOf = (b: Uint8Array) => cat(long(b.length), b);
const strOf = (s: string) => bytesOf(enc.encode(s));
const SYNC = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
function container(
  schema: string,
  codec: string | undefined,
  blocks: [number | bigint, Uint8Array][],
): Uint8Array {
  const meta: [string, Uint8Array][] = [["avro.schema", enc.encode(schema)]];
  if (codec !== undefined) meta.push(["avro.codec", enc.encode(codec)]);
  return cat(
    enc.encode("Obj\x01"),
    long(meta.length),
    ...meta.map(([k, v]) => cat(strOf(k), bytesOf(v))),
    long(0),
    SYNC,
    ...blocks.map(([count, data]) => cat(long(count), long(data.length), data, SYNC)),
  );
}
const REC =
  '{"type":"record","name":"R","fields":[{"name":"id","type":"long"},{"name":"s","type":"string"},{"name":"u","type":["null","double"]}]}';
const recBlock = (n: number, from = 0): Uint8Array =>
  cat(
    ...Array.from({ length: n }, (_, i) =>
      cat(
        long(from + i),
        strOf(`row ${from + i}`),
        i % 2 === 0 ? long(0) : cat(long(1), new Uint8Array(new Float64Array([i + 0.5]).buffer)),
      ),
    ),
  );

describe("to-json", () => {
  test("lines, a forced array and indentation", async () => {
    const c = container(REC, "null", [[2, recBlock(2)]]);
    expect(text(await toJson(c))).toBe(
      '{"id":0,"s":"row 0","u":null}\n{"id":1,"s":"row 1","u":1.5}\n',
    );
    // indent is not used for lines
    expect(text(await toJson(c, false, 4))).toBe(text(await toJson(c)));
    expect(text(await toJson(c, true))).toBe(
      '[{"id":0,"s":"row 0","u":null},{"id":1,"s":"row 1","u":1.5}]',
    );
    expect(text(await toJson(c, true, 1))).toBe(
      '[\n {\n  "id": 0,\n  "s": "row 0",\n  "u": null\n },\n {\n  "id": 1,\n  "s": "row 1",\n  "u": 1.5\n }\n]',
    );
    expect(code(await toJson(c, true, 33))).toBe("E_RANGE");
    // (the defaults, a valid JSON array and 4 spaces, are in the vectors that name no parameters)
    expect(text(await toJson(c, true, 4)).startsWith('[\n    {\n        "id": 0,')).toBe(true);
  });
  test("the deflate codec (raw DEFLATE, checked with the host's zlib) and several blocks", async () => {
    const c = container(REC, "deflate", [
      [3, deflateRawSync(recBlock(3))],
      [2, deflateRawSync(recBlock(2, 3))],
    ]);
    const rows = text(await toJson(c)).split("\n");
    expect(rows).toHaveLength(6);
    expect(rows[5]).toBe("");
    expect(JSON.parse(rows[4] as string).s).toBe("row 4");
  });
  test("a codec that is not read is named in the error", async () => {
    for (const codec of ["snappy", "zstandard", "bzip2", "xz", "lz4", ""]) {
      const r = await toJson(container(REC, codec, [[1, recBlock(1)]]));
      expect(code(r)).toBe("E_COERCE");
      expect(message(r)).toContain(codec === "" ? "codec" : codec);
    }
  });
  test("every cut point of a container with two blocks is E_COERCE, except the ends of whole blocks", async () => {
    const head = container(REC, "null", []);
    const first = container(REC, "null", [[2, recBlock(2)]]);
    const c = container(REC, "null", [
      [2, recBlock(2)],
      [1, recBlock(1, 2)],
    ]);
    expect(code(await toJson(c))).toBe("ok");
    const bad = await cutPoints(c, (d) => toJson(d));
    // a file cut where a block ends is a shorter, valid file; every other cut is damage
    expect(bad).toEqual([
      { cut: head.length, code: "ok" },
      { cut: first.length, code: "ok" },
    ]);
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    const c = container(REC, "null", [[2, recBlock(2)]]);
    expect(await mutations(c, (d) => toJson(d), [0x00, 0x01, 0x02, 0x7f, 0x80, 0xff])).toEqual([]);
  });
  test("a huge count of data with no bytes stops at the value limit", async () => {
    const c = container('"null"', "null", [[1n << 40n, new Uint8Array(0)]]);
    const t0 = Date.now();
    const r = await toJson(c, false, 0, { maxValueBytes: 1_000_000 });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  test("hostile sizes allocate nothing", async () => {
    const head = container('"string"', "null", []);
    const huge = (n: bigint) => cat(head, long(1), long(n));
    for (const n of [1n << 40n, (1n << 63n) - 1n, 1000000n])
      expect(code(await toJson(huge(n)))).toBe("E_COERCE");
    expect(code(await toJson(cat(head, long(-1), long(5))))).toBe("E_COERCE");
    expect(code(await toJson(cat(head, long(1), long(5), fromHex("ff"))))).toBe("E_COERCE");
    const strBlock = cat(long(1n << 50n), enc.encode("x"));
    expect(code(await toJson(container('"string"', "null", [[1, strBlock]])))).toBe("E_COERCE");
    const arrBlock = cat(long(1n << 50n), long(0));
    expect(
      code(
        await toJson(
          container('{"type":"array","items":"int"}', "null", [[1, arrBlock]]),
          false,
          0,
          { maxValueBytes: 1_000_000 },
        ),
      ),
    ).toBe("E_COERCE");
  });
  test("a compressed block cannot inflate past the value limit", async () => {
    const zeros = deflateRawSync(new Uint8Array(30_000_000));
    expect(zeros.length).toBeLessThan(100_000);
    const r = await toJson(container('"null"', "deflate", [[1, zeros]]), false, 0, {
      maxValueBytes: 1_000_000,
    });
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
  test("a recursive schema is read to the depth limit and no further", async () => {
    const schema = '{"type":"record","name":"N","fields":[{"name":"next","type":["null","N"]}]}';
    const chain = (n: number) => cat(...Array.from({ length: n }, () => long(1)), long(0));
    expect(code(await toJson(container(schema, "null", [[1, chain(30)]])))).toBe("ok");
    const deep = await toJson(container(schema, "null", [[1, chain(100)]]));
    expect(code(deep)).toBe("E_COERCE");
    expect(message(deep)).toContain("deeper than 64");
  });
  test("the schema is checked", async () => {
    for (const s of [
      '{"type":"record","name":"R","fields":[{"name":"a","type":"nope"}]}',
      '{"type":"enum","name":"E","symbols":[]}',
      '{"type":"fixed","name":"F","size":-1}',
      "[]",
      "42",
    ]) {
      const r = await toJson(container(s, "null", [[1, new Uint8Array(1)]]));
      expect(["E_COERCE", "ok"]).toContain(code(r));
    }
    expect(
      code(
        await toJson(
          container('{"type":"fixed","name":"F","size":-1}', "null", [[1, new Uint8Array(1)]]),
        ),
      ),
    ).toBe("E_COERCE");
    expect(code(await toJson(container('"nope"', "null", [[1, new Uint8Array(1)]])))).toBe(
      "E_COERCE",
    );
  });
});

describe("cost at 64 KiB", () => {
  test(
    "about 64 KiB of records, with the null and the deflate codec",
    { timeout: 60_000 },
    async () => {
      const rows = recBlock(4500);
      expect(rows.length).toBeGreaterThan(64 * 1024);
      for (const codec of ["null", "deflate"]) {
        const c = container(REC, codec, [[4500, codec === "null" ? rows : deflateRawSync(rows)]]);
        const t0 = Date.now();
        const r = await toJson(c);
        const ms = Date.now() - t0;
        expect(text(r).split("\n")).toHaveLength(4501);
        expect(steps(r)).toBeLessThan(120_000);
        process.stderr.write(
          `\navro ${codec}: ${c.length} bytes, 4500 records: ${steps(r)} steps ${ms} ms\n`,
        );
      }
    },
  );
});
