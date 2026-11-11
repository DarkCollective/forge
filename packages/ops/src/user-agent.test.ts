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
 * Tests for the `user-agent` vocabulary (vocab/user-agent.fth, no primitives): Parse User Agent. The op vectors
 * (vocab/user-agent.test.json) hold User-Agent strings read by hand; these tests add the version rules, many
 * browsers at once, the label, the length limit and strings built to make a pattern backtrack.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["user-agent"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const parse = (data: string) => runtime.call("user-agent:parse", [str(data)]);
const field = (report: string, section: string, name: string): string => {
  const lines = report.split("\n");
  const at = lines.indexOf(section);
  const line = lines.slice(at + 1).find((l) => l.trimStart().startsWith(`${name}:`));
  return (line ?? "").split(": ")[1] ?? "";
};

describe("Parse User Agent", () => {
  test("Windows NT versions name the release", async () => {
    const names: Array<[string, string]> = [
      ["10.0", "10"],
      ["6.3", "8.1"],
      ["6.2", "8"],
      ["6.1", "7"],
      ["6.0", "Vista"],
      ["5.1", "XP"],
      ["5.0", "2000"],
      ["4.0", "NT 4.0"],
      ["11.0", "11.0"],
    ];
    for (const [nt, name] of names) {
      const r = out(
        await parse(
          `Mozilla/5.0 (Windows NT ${nt}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36`,
        ),
      );
      expect(field(r, "OS", "Version"), nt).toBe(name);
    }
  });

  test("underscores in iOS and macOS versions become dots", async () => {
    expect(
      field(
        out(
          await parse(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
          ),
        ),
        "OS",
        "Version",
      ),
    ).toBe("12.5.7");
    expect(
      field(
        out(
          await parse(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
          ),
        ),
        "OS",
        "Version",
      ),
    ).toBe("13.6.1");
  });

  test("the first matching rule wins: Edge, Opera and Samsung over Chrome", async () => {
    const chrome = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(
      field(
        out(await parse(`Mozilla/5.0 (X11; Linux x86_64) ${chrome} Edg/120.0.2210.61`)),
        "Browser",
        "Name",
      ),
    ).toBe("Edge");
    expect(
      field(
        out(await parse(`Mozilla/5.0 (Linux; Android 10) ${chrome} EdgA/120.0.2210.84`)),
        "Browser",
        "Name",
      ),
    ).toBe("Edge");
    expect(
      field(
        out(await parse(`Mozilla/5.0 (X11; Linux x86_64) ${chrome} OPR/106.0.0.0`)),
        "Browser",
        "Name",
      ),
    ).toBe("Opera");
    expect(
      field(
        out(
          await parse(
            `Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/9.2 Chrome/67.0.3396.87 Mobile ${chrome.split(" ").at(-1)}`,
          ),
        ),
        "Browser",
        "Name",
      ),
    ).toBe("Samsung Internet");
    expect(
      field(
        out(await parse(`Mozilla/5.0 (X11; Linux x86_64) ${chrome} Vivaldi/6.5.3206.48`)),
        "Browser",
        "Name",
      ),
    ).toBe("Vivaldi");
    expect(
      field(
        out(await parse(`Opera/9.80 (Windows NT 6.1; U; en) Presto/2.12.388 Version/12.16`)),
        "Browser",
        "Name",
      ),
    ).toBe("Opera");
    expect(
      field(
        out(await parse(`Opera/9.80 (Windows NT 6.1; U; en) Presto/2.12.388 Version/12.16`)),
        "Engine",
        "Name",
      ),
    ).toBe("Presto");
  });

  test("CPU architectures", async () => {
    const cpu = async (s: string) => field(out(await parse(s)), "CPU", "Architecture");
    expect(
      await cpu("Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0"),
    ).toBe("amd64");
    expect(
      await cpu("Mozilla/5.0 (Windows NT 10.0; WOW64; rv:50.0) Gecko/20100101 Firefox/50.0"),
    ).toBe("amd64");
    expect(await cpu("Mozilla/5.0 (X11; Linux i686; rv:109.0) Gecko/20100101 Firefox/115.0")).toBe(
      "ia32",
    );
    expect(
      await cpu("Mozilla/5.0 (X11; Linux aarch64; rv:109.0) Gecko/20100101 Firefox/115.0"),
    ).toBe("arm64");
    expect(
      await cpu(
        "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.0.0 Safari/537.36",
      ),
    ).toBe("arm");
    expect(
      await cpu("Mozilla/5.0 (X11; SunOS sun4u; rv:1.8.0.1) Gecko/20060206 Firefox/1.5.0.1"),
    ).toBe("sparc");
    expect(await cpu("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(
      "unknown",
    );
    expect(
      await cpu(
        "Mozilla/5.0 (Macintosh; U; PPC Mac OS X Mach-O; en-US; rv:1.7.12) Gecko/20050915 Firefox/1.0.7",
      ),
    ).toBe("ppc");
  });

  test("the label, white space and the limit on the length", async () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    const plain = out(await parse(ua));
    expect(out(await parse(`User-Agent: ${ua}\r\n`))).toBe(plain);
    expect(out(await parse(`  user-agent:${ua}  `))).toBe(plain);
    expect(code(await parse("a".repeat(4096)))).toBe("ok");
    expect(code(await parse("a".repeat(4097)))).toBe("E_RANGE");
    expect(code(await parse("x".repeat(100_000)))).toBe("E_RANGE");
  });

  test("agents built to make the patterns backtrack stay fast", { timeout: 60_000 }, async () => {
    const t0 = Date.now();
    const evil = [
      `Mozilla/5.0 (${"Android;".repeat(500)}`,
      `Mozilla/5.0 (Linux; Android ${"1".repeat(2000)}`,
      `Android;${" x".repeat(1500)} Mobile`,
      `${"Opera/".repeat(600)}`,
      `Mozilla/5.0 (Windows NT ${"1.".repeat(1000)}`,
      `Version/${"1".repeat(1900)} ${"Safari ".repeat(30)}`,
      `rv:${"9".repeat(1900)}${" Gecko".repeat(30)}`,
      `(${"a; ".repeat(1300)}Build)`,
      "Mozilla/5.0 (Linux; Android 10; " + "K".repeat(3900),
    ];
    for (const ua of evil) expect(code(await parse(ua)), ua.slice(0, 30)).toBe("ok");
    expect(Date.now() - t0).toBeLessThan(30_000);
    process.stderr.write(
      `\nuser-agent parse: ${evil.length} hostile 2-4 KiB agents in ${Date.now() - t0} ms\n`,
    );
  });

  test("many agents: the steps for one parse", async () => {
    const r = await parse(
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36",
    );
    expect(r.ok && r.steps).toBeLessThan(5000);
    process.stderr.write(`\nuser-agent parse: ${r.ok && r.steps} steps for a typical agent\n`);
  });
});

describe("truncated input", () => {
  test("every prefix of two agents is a result", async () => {
    for (const seedText of [
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    ]) {
      for (let cut = 0; cut <= seedText.length; cut++)
        expect(code(await parse(seedText.slice(0, cut)))).toBe("ok");
    }
  });
});
