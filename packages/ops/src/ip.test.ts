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
 * Tests for the `ip` vocabulary (vocab/ip.fth, no primitives): Parse IP range, Parse IPv6 address, IPv6 Transition
 * Addresses, Change IP format, Group IP addresses and Defang IP Addresses. The op vectors (vocab/ip.test.json) hold
 * the cases computed with Python's ipaddress module and the RFC examples; these tests add random addresses against a
 * BigInt model written here, the limits of the listing, hostile input and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["ip"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const steps = (r: Result): number => (r.ok ? r.steps : -1);

// every argument is given: a direct call does not fill in the defaults
const range = (data: string, info = true, enumerate = true, large = false) =>
  runtime.call("ip:parse-range", [str(data), bool(info), bool(enumerate), bool(large)]);
const ipv6 = (data: string) => runtime.call("ip:parse-ipv6", [str(data)]);
const transition = (data: string, ignore = true, headers = false) =>
  runtime.call("ip:transition", [str(data), bool(ignore), bool(headers)]);
const change = (data: string, from: string, to: string) =>
  runtime.call("ip:change-format", [str(data), str(from), str(to)]);
const group = (data: string, delimiter = "newline", cidr = 24, only = false) =>
  runtime.call("ip:group", [str(data), str(delimiter), int(cidr), bool(only)]);
const defang = (data: string) => runtime.call("ip:defang", [str(data)]);

let seed = 0x1b5d;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);

// ---- the model: addresses as BigInt, written without the FL words under test ----
const hextetsOf = (n: bigint): number[] =>
  Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn));
const long6 = (n: bigint) =>
  hextetsOf(n)
    .map((h) => h.toString(16).padStart(4, "0"))
    .join(":");
function short6(n: bigint): string {
  const hs = hextetsOf(n);
  let bestAt = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (hs[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && hs[j] === 0) j++;
    if (j - i > bestLen) {
      bestAt = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (xs: number[]) => xs.map((h) => h.toString(16)).join(":");
  if (bestLen < 2) return hex(hs);
  return `${hex(hs.slice(0, bestAt))}::${hex(hs.slice(bestAt + bestLen))}`;
}
const v4s = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
const randomV6 = (): bigint => {
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    const h = rand() < 0.45 ? 0 : below(rand() < 0.5 ? 65536 : 16);
    n = (n << 16n) | BigInt(h);
  }
  return n;
};
const randomV4 = () => (below(65536) * 65536 + below(65536)) >>> 0;

describe("IPv6 text forms against the model", () => {
  test("longhand and shorthand of 300 random addresses (many with runs of zero groups)", async () => {
    for (let i = 0; i < 300; i++) {
      const n = randomV6();
      const text = short6(n);
      const report = out(await ipv6(text));
      expect(report.startsWith(`Longhand:  ${long6(n)}\nShorthand: ${short6(n)}\n`), text).toBe(
        true,
      );
      // the long form and an upper-case form read back to the same address
      const upper = out(await ipv6(long6(n).toUpperCase()));
      expect(upper.split("\n").slice(0, 2)).toEqual(report.split("\n").slice(0, 2));
    }
  });

  test("the forms that are refused", async () => {
    for (const bad of [
      "",
      ":",
      ":::",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
      "::1::",
      "12345::1",
      "g::1",
      ":1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:",
      "::ffff:1.2.3.256",
      "::ffff:1.2.3",
      "1.2.3.4",
      "1:2:3:4:5:6:7::8",
      "2001:db8::1%",
      "2001:db8::1%a%b",
    ]) {
      expect(code(await ipv6(bad)), JSON.stringify(bad)).toBe("E_COERCE");
    }
  });

  test("an IPv4 tail is two groups", async () => {
    const a = out(await ipv6("64:ff9b::192.0.2.33"));
    const b = out(await ipv6("64:ff9b::c000:221"));
    expect(a).toBe(b);
    expect(code(await ipv6("1:2:3:4:5:6:1.2.3.4"))).toBe("ok");
    expect(code(await ipv6("1:2:3:4:5:6:7:1.2.3.4"))).toBe("E_COERCE");
  });

  test("Teredo flags and reserved ranges that the vectors do not reach", async () => {
    const t = out(await ipv6("2001:0:4136:e378:c000:63bf:3fff:fdd2"));
    expect(t).toContain("R:       1 Error: This flag should be set to 0.");
    expect(t).toContain("This is an invalid Teredo address.");
    const ok = out(await ipv6("2001:0:4136:e378:8d3a:63bf:3fff:fdd2".replace("8d3a", "bffa")));
    expect(ok).toContain("Random1: 1111");
    expect(ok).toContain("UG:      11 Error");
    const valid = out(await ipv6("2001:0:4136:e378:843a:63bf:3fff:fdd2"));
    expect(valid).toContain("Random1: 0001");
    expect(valid).toContain("which complies with RFC 4380 and RFC 5991.");
    expect(out(await ipv6("2001:2::1"))).toContain("BMWG range: 2001:2::/48");
    expect(out(await ipv6("2001:10::1"))).toContain("ORCHIDv1 range: 2001:10::/28");
    expect(out(await ipv6("2001:2f::1"))).toContain("ORCHIDv2 range: 2001:20::/28");
    expect(out(await ipv6("64:ff9b:1::1"))).toContain("Local-use prefix range: 64:ff9b:1::/48");
    expect(out(await ipv6("::c000:201"))).not.toContain("detected");
    expect(out(await ipv6("ff0e::101"))).toContain("Reserved Multicast Block for Global Scope");
    expect(out(await ipv6("ff02::1:2"))).toContain(
      "'All DHCP Servers and Relay Agents (defined in RFC3315)'",
    );
    expect(out(await ipv6("ff02::1:3"))).toContain("'All LLMNR Hosts (defined in RFC4795)'");
  });
});

describe("Parse IP range against the model", () => {
  test("random IPv4 and IPv6 CIDR ranges: network, mask, range and total", async () => {
    for (let i = 0; i < 100; i++) {
      const cidr = below(33);
      const a = randomV4();
      const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
      const lo = (a & mask) >>> 0;
      const hi = (lo | ~mask) >>> 0;
      const r = out(await range(`${v4s(a)}/${cidr}`, true, false));
      expect(r).toBe(
        `Network: ${v4s(lo)}\nCIDR: ${cidr}\nMask: ${v4s(mask)}\nRange: ${v4s(lo)} - ${v4s(hi)}\nTotal addresses in range: ${2 ** (32 - cidr)}\n\n`,
      );
    }
    for (let i = 0; i < 100; i++) {
      const cidr = below(129);
      const a = randomV6();
      const ones = (1n << 128n) - 1n;
      const mask = (ones << BigInt(128 - cidr)) & ones;
      const lo = a & mask;
      const hi = lo | (ones ^ mask);
      const r = out(await range(`${short6(a)}/${cidr}`, true, true));
      expect(r).toBe(
        `Network: ${long6(lo)}\nShorthand: ${short6(lo)}\nCIDR: ${cidr}\nMask: ${long6(mask)}\nRange: ${long6(lo)} - ${long6(hi)}\nTotal addresses in range: ${1n << BigInt(128 - cidr)}\n\n`,
      );
      // IPv6 is never listed
      expect(r.endsWith("\n\n")).toBe(true);
    }
  });

  test("a hyphenated IPv4 range holds its smallest subnet", async () => {
    for (let i = 0; i < 100; i++) {
      const a = randomV4();
      const b = Math.min(0xffffffff, a + below(1 << below(20)));
      const r = out(await range(`${v4s(a)} - ${v4s(b)}`, true, false));
      let bits = 0;
      for (let x = (a ^ b) >>> 0; x !== 0; x >>>= 1) bits++;
      const cidr = 32 - bits;
      const mask = cidr === 0 ? 0 : (0xffffffff << bits) >>> 0;
      expect(r).toContain(`\tNetwork: ${v4s((a & mask) >>> 0)}\n\tCIDR: ${cidr}\n`);
      expect(r).toContain(`Total addresses in range: ${b - a + 1}\n\n`);
    }
  });

  test("the listing: 65,536 addresses, the larger ones, and the refusal before any work", async () => {
    const r = await range("10.20.0.0/16", false, true);
    const text = out(r);
    const lines = text.split("\n");
    expect(lines.length).toBe(65536);
    expect(lines[0]).toBe("10.20.0.0");
    expect(lines[65535]).toBe("10.20.255.255");
    expect(lines[256]).toBe("10.20.1.0");
    // 65,537 addresses are over the limit
    expect(code(await range("10.0.0.0 - 10.1.0.0", false, true))).toBe("E_RANGE");
    expect(code(await range("0.0.0.0/0", true, true, false))).toBe("E_RANGE");
    expect(code(await range("0.0.0.0/0", true, true, true))).toBe("E_RANGE");
    expect(code(await range("0.0.0.0/0", true, false, true))).toBe("ok");
    // switched off, a huge range costs nothing
    const none = await range("0.0.0.0/0", true, false);
    expect(steps(none)).toBeLessThan(2000);
    process.stderr.write(`\nip parse-range /16 listing: ${steps(r)} steps\n`);
  });

  test(
    "the largest listing, 1,048,576 addresses, with allow-large",
    { timeout: 60_000 },
    async () => {
      const t0 = Date.now();
      const r = await range("172.16.0.0/12", false, true, true);
      const ms = Date.now() - t0;
      const text = out(r);
      expect(text.length).toBeGreaterThan(10_000_000);
      expect(text.startsWith("172.16.0.0\n172.16.0.1\n")).toBe(true);
      expect(text.endsWith("172.31.255.254\n172.31.255.255")).toBe(true);
      expect((text.match(/\n/g) ?? []).length).toBe(1048575);
      expect(steps(r)).toBeLessThan(1_000_000);
      process.stderr.write(
        `\nip parse-range /12 listing: ${text.length} chars, ${steps(r)} steps, ${ms} ms\n`,
      );
    },
  );

  test("lines with spaces, tabs and CRLF are read; hostile text is refused", async () => {
    expect(out(await range("  10.0.0.0/30 \r\n", false, true))).toBe(
      "10.0.0.0\n10.0.0.1\n10.0.0.2\n10.0.0.3",
    );
    expect(out(await range("\t10.0.0.1\t-\t10.0.0.2", false, true))).toBe("10.0.0.1\n10.0.0.2");
    for (const bad of [
      "10.0.0.0/",
      "10.0.0.0/-1",
      "10.0.0.0/1/2",
      "10.0.0.0 - ",
      "- 10.0.0.1",
      "10.0.0.1 - 10.0.0.2 - 10.0.0.3",
      "::/0x",
      "1.2.3/24",
    ]) {
      expect(code(await range(bad)), JSON.stringify(bad)).toBe("E_COERCE");
    }
    expect(code(await range("a".repeat(100_000)))).toBe("E_COERCE");
  });

  test("a 64 KiB list of networks", { timeout: 60_000 }, async () => {
    const lines: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const l = `${v4s(randomV4())}/${8 + below(25)}`;
      lines.push(l);
      size += l.length + 1;
    }
    const r = await range(lines.join("\n"), true, false);
    expect(out(r)).toContain("Total addresses in range: ");
    expect(steps(r)).toBeLessThan(10_000_000);
    const v6: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const l = `${short6(randomV6())}/${below(129)}`;
      v6.push(l);
      size += l.length + 1;
    }
    const r6 = await range(v6.join("\n"), true, false);
    expect(out(r6)).toContain("Total addresses in range: ");
    process.stderr.write(
      `\nip parse-range 64 KiB list: ${lines.length} IPv4 lines ${steps(r)} steps; ${v6.length} IPv6 lines ${steps(r6)} steps\n`,
    );
  });
});

describe("Change IP format", () => {
  test("random addresses round trip through every pair of formats", async () => {
    const formats = ["dotted-decimal", "decimal", "octal", "hex"];
    for (let i = 0; i < 60; i++) {
      const n = randomV4();
      const text: Record<string, string> = {
        "dotted-decimal": v4s(n),
        decimal: String(n),
        octal: `0${n.toString(8)}`,
        hex: n.toString(16).padStart(8, "0"),
      };
      for (const from of formats) {
        for (const to of formats) {
          expect(out(await change(text[from] as string, from, to)), `${from} to ${to} ${n}`).toBe(
            text[to],
          );
        }
      }
    }
  });

  test("the limits of a 32-bit number and the digits", async () => {
    expect(out(await change("4294967295", "decimal", "dotted-decimal"))).toBe("255.255.255.255");
    expect(code(await change("4294967296", "decimal", "hex"))).toBe("E_COERCE");
    expect(code(await change("99999999999", "decimal", "hex"))).toBe("E_COERCE");
    expect(out(await change("37777777777", "octal", "hex"))).toBe("ffffffff");
    expect(code(await change("40000000000", "octal", "hex"))).toBe("E_COERCE");
    expect(code(await change("123456789", "hex", "decimal"))).toBe("E_COERCE");
    expect(code(await change("1.2.3", "dotted-decimal", "hex"))).toBe("E_COERCE");
    expect(code(await change("1.2.3.4.5", "dotted-decimal", "hex"))).toBe("E_COERCE");
    expect(code(await change("1.2.3.-4", "dotted-decimal", "hex"))).toBe("E_COERCE");
    expect(code(await change("-1", "decimal", "hex"))).toBe("E_COERCE");
    expect(code(await change("1e3", "decimal", "hex"))).toBe("E_COERCE");
  });

  test("64 KiB of addresses", { timeout: 60_000 }, async () => {
    const lines = Array.from({ length: 5000 }, () => v4s(randomV4()));
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(64 * 1024 - 8000);
    const r = await change(text, "dotted-decimal", "hex");
    expect(out(r).split("\n").length).toBe(5000);
    expect(steps(r)).toBeLessThan(2_000_000);
    process.stderr.write(`\nip change-format ${text.length} chars: ${steps(r)} steps\n`);
  });
});

describe("Group IP addresses", () => {
  const model = (ips: string[], cidr: number, only: boolean): string => {
    const v4 = ips.filter((x) => !x.includes(":"));
    const v6 = ips.filter((x) => x.includes(":"));
    const parse4 = (s: string) => s.split(".").reduce((a, o) => a * 256 + Number(o), 0);
    const mask4 = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
    const ones = (1n << 128n) - 1n;
    const mask6 = (ones << BigInt(128 - cidr)) & ones;
    const groups: Array<[bigint, string[]]> = [];
    const add = (key: bigint, item: string) => {
      const g = groups.find((x) => x[0] === key);
      if (g) g[1].push(item);
      else groups.push([key, [item]]);
    };
    for (const s of v4) add(BigInt((parse4(s) & mask4) >>> 0), s);
    for (const s of v6)
      add((BigInt(`0x${long6Of(s).replaceAll(":", "")}`) & mask6) + (1n << 128n), s);
    groups.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return groups
      .map(([k, items]) => {
        const head = k >= 1n << 128n ? short6(k - (1n << 128n)) : v4s(Number(k));
        return `${head}/${cidr}\n${
          only
            ? ""
            : `${items
                .sort(cmp)
                .map((x) => `  ${x}\n`)
                .join("")}\n`
        }`;
      })
      .join("");
  };
  const long6Of = (s: string): string => {
    const [h, t = ""] = s.split("::");
    const a = h ? h.split(":") : [];
    const b = t ? t.split(":") : [];
    const mid = s.includes("::") ? Array(8 - a.length - b.length).fill("0") : [];
    return [...a, ...mid, ...b].map((x) => x.padStart(4, "0")).join(":");
  };
  const cmp = (a: string, b: string): number => {
    const key = (s: string) =>
      s.includes(":")
        ? BigInt(`0x${long6Of(s).replaceAll(":", "")}`)
        : BigInt(s.split(".").reduce((x, o) => x * 256 + Number(o), 0));
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };

  test("random mixed lists against the model", async () => {
    for (let round = 0; round < 40; round++) {
      const cidr = [8, 16, 20, 24, 30, 32][below(6)] as number;
      const ips = Array.from({ length: 1 + below(30) }, () =>
        rand() < 0.5
          ? v4s(((10 << 24) | (below(4) << 16) | below(65536)) >>> 0)
          : short6((0x20010db8n << 96n) | (BigInt(below(4)) << 80n) | BigInt(below(1000))),
      );
      const only = rand() < 0.3;
      expect(out(await group(ips.join("\n"), "newline", cidr, only))).toBe(model(ips, cidr, only));
    }
  });

  test("a 64 KiB list", { timeout: 60_000 }, async () => {
    const ips: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const ip = rand() < 0.8 ? v4s(randomV4()) : short6(randomV6());
      ips.push(ip);
      size += ip.length + 1;
    }
    const r = await group(ips.join("\n"), "newline", 16, false);
    expect(out(r)).toBe(model(ips, 16, false));
    process.stderr.write(`\nip group ${ips.length} addresses: ${steps(r)} steps\n`);
  });

  test("delimiters and refusals", async () => {
    expect(out(await group("1.1.1.1;2.2.2.2", "semicolon", 8, true))).toBe(
      "1.0.0.0/8\n2.0.0.0/8\n",
    );
    expect(out(await group("1.1.1.1\r\n2.2.2.2\r\n", "crlf", 8, true))).toBe(
      "1.0.0.0/8\n2.0.0.0/8\n",
    );
    expect(code(await group("1.1.1.1", "tab", 8))).toBe("E_PARAM_INVALID");
    expect(code(await group("1.1.1.1 junk", "space", 8))).toBe("E_COERCE");
    expect(code(await group("1.1.1.1", "newline", 33))).toBe("E_COERCE");
    expect(out(await group("::1", "newline", 128, true))).toBe("::1/128\n");
  });
});

describe("IPv6 Transition Addresses", () => {
  test("random IPv4 addresses convert and convert back", async () => {
    for (let i = 0; i < 60; i++) {
      const n = randomV4();
      const hi = (n >>> 16).toString(16).padStart(4, "0");
      const lo = (n & 0xffff).toString(16).padStart(4, "0");
      const forward = out(await transition(v4s(n), true, true));
      expect(forward).toBe(
        `2002:${hi}:${lo}::/48\n::ffff:${hi}:${lo}\n::ffff:0:${hi}:${lo}\n64:ff9b::${hi}:${lo}\n`,
      );
      for (const form of [
        `2002:${hi}:${lo}::1`,
        `::ffff:${hi}:${lo}`,
        `::ffff:0:${hi}:${lo}`,
        `64:ff9b::${hi}:${lo}`,
      ]) {
        expect(out(await transition(form, true, true)), form).toBe(`${v4s(n)}\n`);
      }
    }
  });

  test("random MAC addresses to EUI-64 and back", async () => {
    for (let i = 0; i < 40; i++) {
      const b = Array.from({ length: 6 }, () => below(256));
      const mac = b.map((x) => x.toString(16).padStart(2, "0")).join(":");
      const e = [b[0]! ^ 2, b[1]!, b[2]!, 0xff, 0xfe, b[3]!, b[4]!, b[5]!].map((x) =>
        x.toString(16).padStart(2, "0"),
      );
      const id = `${e[0]}${e[1]}:${e[2]}${e[3]}:${e[4]}${e[5]}:${e[6]}${e[7]}`;
      expect(out(await transition(mac, true, true))).toBe(`${id}\n`);
      expect(out(await transition(`fe80::${id}`, true, true))).toBe(`${mac.toUpperCase()}\n`);
    }
  });

  test("ranges, headers and refusals", async () => {
    expect(out(await transition("10.1.2.0/24\n10.1.2.3", true, false))).toContain(
      "6to4: 2002:0a01:0203::/48",
    );
    expect(out(await transition("10.1.2.0/24\n10.1.2.3", true, false))).not.toContain("/40");
    expect(out(await transition("10.1.2.99/24", false, true))).toBe(
      "2002:0a01:0200::/40\n::ffff:0a01:0200/120\n::ffff:0:0a01:0200/120\n64:ff9b::0a01:0200/120\n",
    );
    for (const bad of [
      "10.0.0.0/25",
      "1.2.3",
      "00:11:22:33:44",
      "gg:11:22:33:44:55",
      "2001::g",
      "1.2.3.4/24/24",
      "::1::",
    ]) {
      expect(code(await transition(bad, false, false)), bad).toBe("E_COERCE");
    }
    expect(out(await transition("", true, false))).toBe("");
  });

  test("an ISATAP address gives its IPv4 address", async () => {
    expect(out(await transition("fe80::5efe:c000:221", true, true))).toBe("192.0.2.33\n");
    expect(out(await transition("2001:db8::200:5efe:c000:221", true, true))).toBe("192.0.2.33\n");
  });

  test("64 KiB of lines", { timeout: 60_000 }, async () => {
    const lines = Array.from({ length: 4000 }, () => v4s(randomV4()));
    const r = await transition(lines.join("\n"), true, false);
    expect(out(r).split("\n").length).toBe(4000 * 4 + 1);
    expect(steps(r)).toBeLessThan(5_000_000);
    process.stderr.write(`\nip transition ${lines.length} IPv4 lines: ${steps(r)} steps\n`);
  });
});

describe("Defang IP Addresses", () => {
  test("random IPv4 and IPv6 addresses in text", async () => {
    for (let i = 0; i < 80; i++) {
      const a = v4s(randomV4());
      const b = short6(randomV6());
      const r = out(await defang(`from ${a} to ${b}, ok`));
      expect(r).toBe(`from ${a.replaceAll(".", "[.]")} to ${b.replaceAll(":", "[:]")}, ok`);
    }
  });

  test("a 64 KiB text", { timeout: 60_000 }, async () => {
    const words: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const w = [
        `host ${v4s(randomV4())}`,
        `v6 ${short6(randomV6())}.`,
        "plain words here",
        "12:34:56 time",
        "version 1.2.3",
      ][below(5)] as string;
      words.push(w);
      size += w.length + 1;
    }
    const text = words.join("\n");
    const r = await defang(text);
    expect(out(r).replaceAll("[.]", ".").replaceAll("[:]", ":")).toBe(text);
    expect(steps(r)).toBeLessThan(10_000_000);
    process.stderr.write(`\nip defang ${text.length} chars: ${steps(r)} steps\n`);
  });

  test("white space and colons built to make the patterns slow", { timeout: 60_000 }, async () => {
    const t0 = Date.now();
    const bad = [
      `a${" ".repeat(60000)}b`,
      `${":".repeat(60000)}a`,
      `${"1:".repeat(30000)}a`,
      `${"a.".repeat(30000)}`,
      "::".repeat(30000),
      `${"0".repeat(60000)}.1`,
    ];
    for (const t of bad) {
      expect(code(await defang(t)), t.slice(0, 12)).toBe("ok");
      for (const w of [range, ipv6, (x: string) => transition(x), (x: string) => group(x, "comma")])
        expect(["ok", "E_COERCE"]).toContain(code(await w(t)));
    }
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  test("text that looks like a lot of addresses but is not", async () => {
    const noise = "1:2:3:4:5:6:7:8:9 ::::: 1.2.3.4.5 ".repeat(2000);
    const r = await defang(noise);
    expect(r.ok).toBe(true);
    expect(out(r)).toContain("1.2.3.4.5");
  });
});

describe("truncated and mutated input", () => {
  const seeds = [
    "10.0.0.0/30",
    "192.168.1.5 - 192.168.1.9",
    "2001:db8::/32\n2001:db8:0:1::5",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "fe80::0211:22ff:fe33:4455%eth0",
    "::ffff:192.0.2.1",
    "[2002:c000:0204::1]",
    "34:56:78:9a:bc:de",
    "010.0.0.1",
    "4294967295",
    "0xC0A80001",
    "see 2001:db8::1. and 10.0.0.0/8, 1.2.3.4",
  ];
  const allowed = ["ok", "E_COERCE", "E_RANGE"];
  const everything = async (t: string): Promise<string[]> => [
    code(await range(t, true, false)),
    code(await ipv6(t)),
    code(await transition(t, false, false)),
    code(await change(t, "dotted-decimal", "hex")),
    code(await change(t, "decimal", "octal")),
    code(await change(t, "hex", "dotted-decimal")),
    code(await group(t, "comma", 16, false)),
    code(await defang(t)),
  ];

  test(
    "every prefix of the seeds, and 600 random mutations, give a result or E_COERCE or E_RANGE",
    { timeout: 120_000 },
    async () => {
      for (const seedText of seeds) {
        for (let cut = 0; cut <= seedText.length; cut++) {
          for (const c of await everything(seedText.slice(0, cut)))
            expect(allowed, `${seedText.slice(0, cut)}`).toContain(c);
        }
      }
      const alphabet = "0123456789abcdefABCDEF:.-/ \n%[]gx";
      for (let i = 0; i < 600; i++) {
        const chars = [...(seeds[below(seeds.length)] as string)];
        for (let k = 0, n = 1 + below(3); k < n; k++) {
          const at = below(chars.length + 1);
          const op = below(3);
          if (op === 0) chars.splice(at, 1);
          else if (op === 1) chars.splice(at, 0, alphabet[below(alphabet.length)] as string);
          else chars[at] = alphabet[below(alphabet.length)] as string;
        }
        const t = chars.join("");
        for (const c of await everything(t)) expect(allowed, JSON.stringify(t)).toContain(c);
      }
    },
  );
});
