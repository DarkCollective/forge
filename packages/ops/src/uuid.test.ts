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
 * Tests for the `uuid` vocabulary (vocab/uuid.fth): the builders pinned to the examples of RFC 9562 appendix A, the
 * name-based UUIDs against independent values (Python's uuid module, which implements RFC 4122/9562 namespaces),
 * the structure of the random and time-based output, and the analyser. The deterministic vectors are in
 * vocab/uuid.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const bundle = await loadBundleNode(["uuid"]);
const runtime = assembleRuntime(bundle);

// The private builders are reachable only from a unit in the vocabulary, so the test adds probes to it.
runtime.load(`IN: uuid
: t-v1 ( ticks:int rnd:bytes -- str ) ticks rnd _v1 _text ;
: t-v6 ( ticks:int rnd:bytes -- str ) ticks rnd _v6 _text ;
: t-v7 ( ms:int rnd:bytes -- str ) ms rnd _v7 _text ;
: t-greg ( ms:int -- int ) ms _gregorian ;
: t-iso ( ms:int -- str ) ms _iso ;
: t-parse ( s:str -- str ) s _parse _text ;`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const none = bytes(new Uint8Array(0));
const hex = (h: string) => bytes(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));

const gen = async (version: string, namespace = "dns", name = "") =>
  runtime.call("uuid:generate", [none, str(version), str(namespace), str(name)]);
const analyse = async (s: string) => top(await runtime.call("uuid:analyse", [str(s)])) as string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([89ab])[0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("generate and analyse are catalogue ops; the generator has both random and time effects", () => {
    const cat = buildCatalogue(assembleRuntime(bundle));
    const mine = cat.ops.filter((o) => o.vocab === "uuid");
    expect(mine.map((o) => o.qname)).toEqual(["uuid:analyse", "uuid:generate"]);
    const g = mine.find((o) => o.qname === "uuid:generate");
    expect(g?.category).toBe("Generators");
    expect(g?.effects).toEqual(expect.arrayContaining(["+random", "+time"]));
  });
});

describe("the builders against RFC 9562 appendix A", () => {
  test("A.3 version 1: 2022-02-22 19:22:22 UTC", async () => {
    const r = await runtime.call("uuid:t-v1", [int(0x1ec9414c232ab00n), hex("33c89f6bdeced846")]);
    expect(top(r)).toBe("c232ab00-9414-11ec-b3c8-9f6bdeced846");
  });

  test("A.4 version 6: the same instant, time first", async () => {
    const r = await runtime.call("uuid:t-v6", [int(0x1ec9414c232ab00n), hex("33c89f6bdeced846")]);
    expect(top(r)).toBe("1ec9414c-232a-6b00-b3c8-9f6bdeced846");
  });

  test("A.6 version 7: 2022-02-22 19:22:22.000 UTC", async () => {
    const r = await runtime.call("uuid:t-v7", [int(0x017f22e279b0), hex("0cc318c4dc0c0c07398f")]);
    expect(top(r)).toBe("017f22e2-79b0-7cc3-98c4-dc0c0c07398f");
  });

  test("the Gregorian tick count of the Unix epoch and of 2022-02-22 19:22:22 UTC", async () => {
    expect(top(await runtime.call("uuid:t-greg", [int(0)]))).toBe(122192928000000000n);
    expect(top(await runtime.call("uuid:t-greg", [int(1645557742000)]))).toBe(0x1ec9414c232ab00n);
  });

  test("the version 1 node always has the multicast bit set", async () => {
    const r = await runtime.call("uuid:t-v1", [int(0), hex("0000" + "000000000000")]);
    expect(top(r)).toMatch(/-8000-010000000000$/);
  });
});

describe("name-based UUIDs", () => {
  test.each([
    ["v3", "dns", "www.example.com", "5df41881-3aed-3515-88a7-2f4a814cf09e"], // RFC 9562 A.2
    ["v5", "dns", "www.example.com", "2ed6657d-e927-568b-95e1-2665a8aea6a2"], // RFC 9562 A.4
    ["v5", "url", "https://example.com/", "dd2c1780-811a-5296-81c5-178a0ef488bc"],
    ["v3", "oid", "1.3.6.1", "dd1a1cef-13d5-368a-ad82-eca71acd4cd1"],
    ["v5", "x500", "cn=x", "a951fb6d-5aab-5a72-8e2e-9aa8df8d1f8f"],
    [
      "v5",
      "6BA7B810-9DAD-11D1-80B4-00C04FD430C8",
      "www.example.com",
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    ],
    [
      "v5",
      "urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "www.example.com",
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    ],
    [
      "v5",
      "{6ba7b8109dad11d180b400c04fd430c8}",
      "www.example.com",
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    ],
  ])("%s %s %s", async (version, ns, name, expected) => {
    expect(top(await gen(version, ns, name))).toBe(expected);
  });

  test("the name is UTF-8 text", async () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "grüße.example")
    expect(top(await gen("v5", "dns", "grüße.example"))).toBe(
      "b7ef62df-d74e-5856-a4e5-c3ff9a38795d",
    );
  });

  test("a bad namespace is E_RANGE", async () => {
    expect(code(await gen("v5", "nope", "x"))).toBe("E_RANGE");
    expect(code(await gen("v3", "6ba7b810-9dad-11d1-80b4", "x"))).toBe("E_RANGE");
  });

  test("a namespace is not looked at by the other versions", async () => {
    expect(code(await gen("v4", "nope", "x"))).toBe("ok");
  });
});

describe("nil and max", () => {
  test("nil", async () => {
    expect(top(await gen("nil"))).toBe("00000000-0000-0000-0000-000000000000");
  });
  test("max", async () => {
    expect(top(await gen("max"))).toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
  });
});

describe("random and time-based UUIDs", () => {
  test.each([
    ["v1", "1"],
    ["v4", "4"],
    ["v6", "6"],
    ["v7", "7"],
  ])("%s has its version nibble and the RFC variant", async (version, nibble) => {
    for (let i = 0; i < 20; i++) {
      const m = UUID.exec(top(await gen(version)) as string);
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe(nibble);
    }
  });

  test("two v4 UUIDs differ", async () => {
    expect(top(await gen("v4"))).not.toBe(top(await gen("v4")));
  });

  test("v4 with a stubbed random source: the bits other than version and variant are the random bits", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0xff);
        return a;
      },
    });
    expect(top(await gen("v4"))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  test("v7 with a fake clock and a stubbed random source", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0x017f22e279b0);
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0);
        return a;
      },
    });
    expect(top(await gen("v7"))).toBe("017f22e2-79b0-7000-8000-000000000000");
  });

  test("v1 and v6 with a fake clock: the time is the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1645557742000);
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.set([0x33, 0xc8, 0x9f, 0x6b, 0xde, 0xce, 0xd8, 0x46].slice(0, a.length));
        return a;
      },
    });
    expect(top(await gen("v1"))).toBe("c232ab00-9414-11ec-b3c8-9f6bdeced846");
    expect(top(await gen("v6"))).toBe("1ec9414c-232a-6b00-b3c8-9f6bdeced846");
  });

  test("v7 UUIDs made later sort after earlier ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_000);
    const a = top(await gen("v7")) as string;
    vi.setSystemTime(1_700_000_000_001);
    const b = top(await gen("v7")) as string;
    expect(a < b).toBe(true);
  });

  test("a host without a random source is E_PRIMITIVE, never Math.random", async () => {
    vi.stubGlobal("crypto", {});
    expect(code(await gen("v4"))).toBe("E_PRIMITIVE");
    expect(code(await gen("v3"))).toBe("ok");
  });

  test("the bits are spread: each hex digit of v4 is roughly uniform", async () => {
    const counts = new Array<number>(16).fill(0);
    for (let i = 0; i < 100; i++) {
      const s =
        (top(await gen("v4")) as string).replaceAll("-", "").slice(0, 12) +
        (top(await gen("v4")) as string).replaceAll("-", "").slice(16);
      for (const c of s) counts[parseInt(c, 16)]!++;
    }
    const n = counts.reduce((a, b) => a + b, 0);
    const chi = counts.reduce((a, c) => a + (c - n / 16) ** 2 / (n / 16), 0);
    expect(chi).toBeLessThan(45); // 15 degrees of freedom: a loose bound
  });
});

describe("the parser and the ISO text", () => {
  test.each([
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "6BA7B810-9DAD-11D1-80B4-00C04FD430C8",
    "6ba7b8109dad11d180b400c04fd430c8",
    "{6ba7b810-9dad-11d1-80b4-00c04fd430c8}",
    "urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "  6ba7b810-9dad-11d1-80b4-00c04fd430c8\n",
  ])("%j reads as the DNS namespace", async (s) => {
    expect(top(await runtime.call("uuid:t-parse", [str(s)]))).toBe(
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    );
  });

  test.each([
    "",
    "xyz",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8a",
    "6ba7b810-9dad-11d1-80b4-00c04fd430cg",
  ])("%j is E_COERCE", async (s) => {
    expect(code(await runtime.call("uuid:t-parse", [str(s)]))).toBe("E_COERCE");
  });

  test.each([
    [0, "1970-01-01T00:00:00.000"],
    [951782400000, "2000-02-29T00:00:00.000"],
    [-1, "1969-12-31T23:59:59.999"],
    [-12219292800000, "1582-10-15T00:00:00.000"],
    [253402300799999, "9999-12-31T23:59:59.999"],
    [1709210096789, "2024-02-29T12:34:56.789"],
    [4102444800000, "2100-01-01T00:00:00.000"],
  ])("ISO text of %i ms", async (ms, expected) => {
    expect(top(await runtime.call("uuid:t-iso", [int(ms)]))).toBe(expected);
  });

  test("ISO text agrees with Date for a spread of instants (years 1 to 9999, including before 1970)", async () => {
    for (const ms of [-62135596800000, -5e12, -86400001, 86399999, 1e12, 1.5e12, 2.5e12, 1.8e13]) {
      const want = new Date(ms).toISOString().replace("Z", "");
      expect(top(await runtime.call("uuid:t-iso", [int(ms)]))).toBe(want);
    }
  });
});

describe("uuid:analyse", () => {
  test("RFC 9562 version 1 example", async () => {
    expect(await analyse("C232AB00-9414-11EC-B3C8-9F6BDECED846")).toBe(
      "Version: 1 (Gregorian time and node)\nVariant: RFC 9562 (RFC 4122)\nTimestamp: 2022-02-22T19:22:22.0000000Z",
    );
  });

  test("RFC 9562 version 6 example", async () => {
    expect(await analyse("1EC9414C-232A-6B00-B3C8-9F6BDECED846")).toBe(
      "Version: 6 (Gregorian time, sortable)\nVariant: RFC 9562 (RFC 4122)\nTimestamp: 2022-02-22T19:22:22.0000000Z",
    );
  });

  test("RFC 9562 version 7 example", async () => {
    expect(await analyse("017F22E2-79B0-7CC3-98C4-DC0C0C07398F")).toBe(
      "Version: 7 (Unix time and random)\nVariant: RFC 9562 (RFC 4122)\nTimestamp: 2022-02-22T19:22:22.000Z",
    );
  });

  test("a version 1 time with 100 ns digits", async () => {
    const r = await analyse("c232ab01-9414-11ec-b3c8-9f6bdeced846");
    expect(r).toContain("Timestamp: 2022-02-22T19:22:22.0000001Z");
  });

  test("random and name-based versions have no timestamp", async () => {
    expect(await analyse("919108f7-52d1-4320-9bac-f847db4148a8")).toBe(
      "Version: 4 (random)\nVariant: RFC 9562 (RFC 4122)",
    );
    expect(await analyse("2ed6657d-e927-568b-95e1-2665a8aea6a2")).toBe(
      "Version: 5 (SHA-1 of a namespace and a name)\nVariant: RFC 9562 (RFC 4122)",
    );
  });

  test("nil, max and the other variants", async () => {
    expect(await analyse("00000000-0000-0000-0000-000000000000")).toBe("Nil UUID (all bits zero)");
    expect(await analyse("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")).toBe("Max UUID (all bits one)");
    expect(await analyse("00000000-0000-1000-0000-000000000001")).toBe("Variant: NCS (reserved)");
    expect(await analyse("00000000-0000-1000-c000-000000000001")).toBe(
      "Variant: Microsoft (reserved)",
    );
    expect(await analyse("00000000-0000-1000-e000-000000000001")).toBe(
      "Variant: reserved for the future",
    );
  });

  test("generate then analyse gives back the version", async () => {
    for (const [v, n] of [
      ["v4", 4],
      ["v1", 1],
      ["v6", 6],
      ["v7", 7],
      ["v3", 3],
      ["v5", 5],
    ] as const) {
      expect(await analyse(top(await gen(v)) as string)).toMatch(new RegExp(`^Version: ${n} `));
    }
  });

  test("the timestamp of a v7 made now is now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 11, 12, 34, 56, 789));
    expect(await analyse(top(await gen("v7")) as string)).toContain(
      "Timestamp: 2026-11-11T12:34:56.789Z",
    );
    expect(await analyse(top(await gen("v1")) as string)).toContain(
      "Timestamp: 2026-11-11T12:34:56.7890000Z",
    );
  });

  test("text that is not a UUID is E_COERCE", async () => {
    expect(code(await runtime.call("uuid:analyse", [str("not a uuid")]))).toBe("E_COERCE");
  });
});
