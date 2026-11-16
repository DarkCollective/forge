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
 * Tests for the `lines` vocabulary (vocab/lines.fth): the catalogue entries, the ops against plain JavaScript
 * references on seeded random input, the random ops with the source pinned, and the cost at 64 KiB with the default
 * limits. The fixed examples are in vocab/lines.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lines"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const text = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return top(r) as string;
};

// runtime.call does not fill in defaults, so every argument is given.
const sort = (data: string, order: string, reverse = false, delimiter = "newline") =>
  runtime.call("lines:sort", [str(data), str(delimiter), bool(reverse), str(order)]).then(text);
const unique = (data: string, count: boolean, delimiter = "newline") =>
  runtime.call("lines:unique", [str(data), str(delimiter), bool(count)]).then(text);
const head = (data: string, n: number) =>
  runtime.call("lines:head", [str(data), str("newline"), int(n)]).then(text);
const tail = (data: string, n: number) =>
  runtime.call("lines:tail", [str(data), str("newline"), int(n)]).then(text);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Order by code point, as FL compares strings. */
const byCodePoint = (a: string, b: string): number => {
  const x = [...a].map((c) => c.codePointAt(0) as number);
  const y = [...b].map((c) => c.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  }
  return x.length - y.length;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("the ops of lines, in the Utils category, and no helper is an op", () => {
    const cat = buildCatalogue(runtime);
    const mine = cat.ops.filter((o) => o.vocab === "lines");
    expect(mine.map((o) => o.name).sort()).toEqual([
      "add-numbers",
      "file-tree",
      "filter",
      "head",
      "pad",
      "remove-numbers",
      "shuffle",
      "sort",
      "tail",
      "to-table",
      "unique",
      "wrap",
    ]);
    expect(mine.every((o) => o.category === "Utils")).toBe(true);
    expect(mine.filter((o) => o.effects.includes("+random")).map((o) => o.name)).toEqual([
      "shuffle",
    ]);
  });

  test("the delimiter parameter is the shared list, without none where the word splits", () => {
    const cat = buildCatalogue(runtime);
    for (const o of cat.ops.filter((x) => x.vocab === "lines" && x.name !== "to-table")) {
      const p = o.params.find((x) => x.name === "delimiter");
      expect(p?.type, o.qname).toBe("choice");
      expect(p?.options, o.qname).toEqual([
        "space",
        "comma",
        "semicolon",
        "colon",
        "newline",
        "crlf",
        "cr",
        "tab",
      ]);
      expect(p?.default, o.qname).toBe("newline");
    }
  });
});

describe("sort", () => {
  const words = (next: () => number, n: number, chars = "abAB09 _é😀") =>
    Array.from({ length: n }, () =>
      Array.from({ length: Math.floor(next() * 5) }, () => {
        const cs = [...chars];
        return cs[Math.floor(next() * cs.length)];
      }).join(""),
    );

  test("alphabetical is the code point order", async () => {
    const next = rng(1);
    for (let i = 0; i < 30; i++) {
      const w = words(next, 25);
      expect(await sort(w.join("\n"), "alphabetical")).toBe(w.slice().sort(byCodePoint).join("\n"));
    }
  });

  test("case-insensitive and length are stable sorts by a key", async () => {
    const next = rng(2);
    for (let i = 0; i < 30; i++) {
      const w = words(next, 25);
      const lower = w.slice().sort((a, b) => byCodePoint(a.toLowerCase(), b.toLowerCase()));
      expect(await sort(w.join("\n"), "case-insensitive")).toBe(lower.join("\n"));
      const len = w.slice().sort((a, b) => [...a].length - [...b].length);
      expect(await sort(w.join("\n"), "length")).toBe(len.join("\n"));
      expect(await sort(w.join("\n"), "length", true)).toBe(len.reverse().join("\n"));
    }
  });

  test("numeric agrees with parseFloat on plain decimals and puts the others first, ties in code point order", async () => {
    const next = rng(3);
    const num = () => {
      const k = next();
      if (k < 0.2) return "word" + Math.floor(next() * 10);
      const sign = next() < 0.3 ? "-" : "";
      const whole = next() < 0.1 ? "" : String(Math.floor(next() * 1000));
      const frac = next() < 0.5 ? "" : "." + String(Math.floor(next() * 1000)).padStart(3, "0");
      return whole === "" && frac === "" ? "0" : sign + whole + frac;
    };
    for (let i = 0; i < 30; i++) {
      const w = Array.from({ length: 30 }, num);
      const val = (s: string) => parseFloat(s);
      const expected = w.slice().sort((a, b) => {
        const x = val(a);
        const y = val(b);
        // ties, and the text with no number, are in code point order
        if (Number.isNaN(x) && Number.isNaN(y)) return byCodePoint(a, b);
        if (Number.isNaN(x)) return -1;
        if (Number.isNaN(y)) return 1;
        return x - y || byCodePoint(a, b);
      });
      expect(await sort(w.join("\n"), "numeric")).toBe(expected.join("\n"));
    }
  });

  test("hexadecimal agrees with parseInt(s, 16) on hex digits and signs", async () => {
    const next = rng(4);
    const hex = () => {
      const k = next();
      if (k < 0.15) return "zz" + Math.floor(next() * 10);
      const sign = next() < 0.2 ? "-" : "";
      const prefix = next() < 0.2 ? "0x" : "";
      return sign + prefix + Math.floor(next() * 65536).toString(16);
    };
    for (let i = 0; i < 30; i++) {
      const w = Array.from({ length: 30 }, hex);
      const expected = w.slice().sort((a, b) => {
        const x = parseInt(a, 16);
        const y = parseInt(b, 16);
        if (Number.isNaN(x) && Number.isNaN(y)) return byCodePoint(a, b);
        if (Number.isNaN(x)) return -1;
        if (Number.isNaN(y)) return 1;
        return x - y || byCodePoint(a, b);
      });
      expect(await sort(w.join("\n"), "hexadecimal")).toBe(expected.join("\n"));
    }
  });

  test("ip-address agrees with the address value, other text after in code point order", async () => {
    const next = rng(5);
    const ip = () =>
      next() < 0.15
        ? ["foo", "1.2.3", "256.1.1.1", "1.2.3.4.5", "a.b.c.d", ""][Math.floor(next() * 6)]!
        : Array.from({ length: 4 }, () => Math.floor(next() * (next() < 0.5 ? 4 : 256))).join(".");
    const key = (s: string) => {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
      if (!m || m.slice(1).some((x) => Number(x) > 255)) return -1;
      return m.slice(1).reduce((acc, x) => acc * 256 + Number(x), 0);
    };
    for (let i = 0; i < 30; i++) {
      const w = Array.from({ length: 30 }, ip);
      const expected = w.slice().sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x < 0 && y < 0) return byCodePoint(a, b);
        if (x < 0) return 1;
        if (y < 0) return -1;
        return x - y;
      });
      expect(await sort(w.join("\n"), "ip-address")).toBe(expected.join("\n"));
    }
  });

  test("the delimiter is the cut and the join", async () => {
    expect(await sort("c;b;a", "alphabetical", false, "semicolon")).toBe("a;b;c");
    expect(await sort("c\r\nb\r\na", "alphabetical", false, "crlf")).toBe("a\r\nb\r\nc");
    expect(await sort("c\tb\ta", "alphabetical", true, "tab")).toBe("c\tb\ta");
  });
});

describe("unique, head and tail", () => {
  test("unique keeps the first of each, and counts them", async () => {
    const next = rng(6);
    for (let i = 0; i < 30; i++) {
      const w = Array.from({ length: 40 }, () => String(Math.floor(next() * 8)));
      const counts = new Map<string, number>();
      for (const x of w) counts.set(x, (counts.get(x) ?? 0) + 1);
      expect(await unique(w.join("\n"), false)).toBe([...counts.keys()].join("\n"));
      expect(await unique(w.join("\n"), true)).toBe(
        [...counts].map(([k, c]) => `${c} ${k}`).join("\n"),
      );
    }
  });

  test("head and tail follow the slice rules, except that tail 0 keeps none", async () => {
    const lines = ["1", "2", "3", "4", "5"];
    for (let n = -7; n <= 7; n++) {
      expect(await head(lines.join("\n"), n)).toBe(lines.slice(0, n).join("\n"));
      expect(await tail(lines.join("\n"), n)).toBe((n === 0 ? [] : lines.slice(-n)).join("\n"));
    }
  });
});

describe("numbers, pad and wrap", () => {
  const add = (data: string, offset: number, delimiter = "newline") =>
    runtime.call("lines:add-numbers", [str(data), str(delimiter), int(offset)]).then(text);
  const remove = (data: string) =>
    runtime.call("lines:remove-numbers", [str(data), str("newline")]).then(text);

  test("remove-numbers undoes add-numbers for any offset", async () => {
    const next = rng(8);
    for (let i = 0; i < 40; i++) {
      const w = Array.from(
        { length: 1 + Math.floor(next() * 120) },
        () => "x" + Math.floor(next() * 100),
      );
      const offset = Math.floor(next() * 2000) - 1000;
      const numbered = await add(w.join("\n"), offset);
      // right-aligned to the width of the count of lines (not of the offset), then a space
      const width = String(w.length).length;
      expect(numbered).toBe(
        w.map((line, k) => `${String(k + 1 + offset).padStart(width, " ")} ${line}`).join("\n"),
      );
      if (offset >= 0) expect(await remove(numbered)).toBe(w.join("\n"));
    }
  });

  test("pad adds exactly length characters to every line", async () => {
    const next = rng(9);
    for (let i = 0; i < 20; i++) {
      const w = Array.from({ length: 20 }, () =>
        "ab😀c".repeat(Math.floor(next() * 4)).slice(0, Math.floor(next() * 9)),
      );
      const length = Math.floor(next() * 12);
      const pad = (position: string, ch: string) =>
        runtime
          .call("lines:pad", [
            str(w.join("\n")),
            str("newline"),
            str(position),
            int(length),
            str(ch),
          ])
          .then(text);
      const start = (await pad("start", "xy")).split("\n");
      const end = (await pad("end", "xy")).split("\n");
      w.forEach((line, k) => {
        const n = [...line].length;
        const fill = "xy".repeat(length).slice(0, length);
        expect([...(start[k] as string)].length).toBe(n + length);
        expect([...(end[k] as string)].length).toBe(n + length);
        expect(start[k]).toBe(fill + line);
        expect(end[k]).toBe(line + fill);
      });
    }
  });

  test("wrap pieces are at most the width and join back to the line", async () => {
    const next = rng(10);
    for (let i = 0; i < 30; i++) {
      const w = Array.from({ length: 6 }, () => "ab😀c".repeat(Math.floor(next() * 8)));
      const width = 1 + Math.floor(next() * 9);
      const out = await runtime
        .call("lines:wrap", [str(w.join("\n")), str("newline"), int(width)])
        .then(text);
      // the lines of the output, regrouped per input line, need the input's own line feeds: use a unique join
      const per = await Promise.all(
        w.map((line) =>
          runtime.call("lines:wrap", [str(line), str("newline"), int(width)]).then(text),
        ),
      );
      expect(out).toBe(per.join("\n"));
      w.forEach((line, k) => {
        const pieces = (per[k] as string).split("\n");
        expect(pieces.join("")).toBe(line);
        for (const p of pieces.slice(0, -1)) expect([...p].length).toBe(width);
        expect([...(pieces[pieces.length - 1] as string)].length).toBeLessThanOrEqual(width);
      });
    }
  });
});

describe("file-tree", () => {
  /** An independent model: the paths unique and sorted, a line for every part not written yet. */
  function draw(paths: string[], sep: string): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const path of [...new Set(paths)].sort(byCodePoint)) {
      let parts = path.split(sep);
      if (parts[0] === "") parts = parts.slice(1);
      parts.forEach((part, j) => {
        const key = parts.slice(0, j + 1).join("/");
        if (seen.has(key)) return;
        seen.add(key);
        out.push(j === 0 ? part : "|   ".repeat(j - 1) + "|---" + part);
      });
    }
    return out.join("\n");
  }

  test("random paths draw the same tree as the reference", async () => {
    const next = rng(11);
    const names = ["a", "b", "B", "a-b", "a.b", "c d", "é", "😀", "z"];
    for (let i = 0; i < 40; i++) {
      const paths = Array.from(
        { length: 1 + Math.floor(next() * 20) },
        () =>
          (next() < 0.3 ? "/" : "") +
          Array.from(
            { length: 1 + Math.floor(next() * 4) },
            () => names[Math.floor(next() * names.length)],
          ).join("/") +
          (next() < 0.1 ? "/" : ""),
      );
      const out = await runtime
        .call("lines:file-tree", [str(paths.join("\n")), str("newline"), str("/")])
        .then(text);
      expect(out).toBe(draw(paths, "/"));
    }
  });
});

describe("to-table", () => {
  const table = (data: string, header: boolean, format: string) =>
    runtime
      .call("lines:to-table", [str(data), str("comma"), str("newline"), bool(header), str(format)])
      .then(text);

  test("an ASCII table is a rectangle with a rule above, below and under the header, and ends with a line feed", async () => {
    const next = rng(12);
    for (let i = 0; i < 30; i++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
        Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
          "x".repeat(Math.floor(next() * 8)),
        ),
      );
      const header = next() < 0.5;
      const raw = await table(rows.map((r) => r.join(",")).join("\n"), header, "ascii");
      expect(raw.endsWith("\n")).toBe(true);
      const out = raw.slice(0, -1).split("\n");
      expect(new Set(out.map((l) => [...l].length)).size).toBe(1);
      expect(out.length).toBe(rows.length + (header ? 3 : 2));
      expect(out.filter((l) => l.startsWith("+")).length).toBe(header ? 3 : 2);
    }
  });

  test("a Markdown table has a header, a separator and the rows", async () => {
    const out = await table("a,b\nc,d\ne,f", true, "markdown");
    expect(out).toBe("| a | b |\n| - | - |\n| c | d |\n| e | f |\n");
    // the first row is the header whatever the switch says
    expect(await table("a,b\nc,d\ne,f", false, "markdown")).toBe(out);
  });
});

describe("shuffle", () => {
  const shuffle = (data: string) =>
    runtime.call("lines:shuffle", [str(data), str("newline")]).then(text);

  test("it is a permutation of the lines", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const out = (await shuffle(lines.join("\n"))).split("\n");
    expect(out.slice().sort()).toEqual(lines.slice().sort());
    expect(out).not.toEqual(lines);
  });

  test("with the random source pinned, the lines follow the order of the random keys", async () => {
    // One 7-byte key per line (big-endian): 5, 2 and 9 put the second line first and the third last.
    const keys = [5, 2, 9];
    let i = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.set([0, 0, 0, 0, 0, 0, keys[i++] as number]);
        return a;
      },
    });
    expect(await shuffle("a\nb\nc")).toBe("b\na\nc");
  });

  test("every order of 3 lines comes out about equally often", async () => {
    const counts = new Map<string, number>();
    const draws = 3000;
    for (let i = 0; i < draws; i++) {
      const k = await shuffle("a\nb\nc");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    const expected = draws / 6;
    const chi = [...counts.values()].reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(25); // 5 degrees of freedom: a loose bound, so the test does not flake
  });

  test("a host with no random source is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(code(await runtime.call("lines:shuffle", [str("a\nb"), str("newline")]))).toBe(
      "E_PRIMITIVE",
    );
  });
});

describe("filter", () => {
  test("a pattern the regex engine cannot compile is a parameter error", async () => {
    const r = await runtime.call("lines:filter", [
      str("a"),
      str("newline"),
      str("("),
      str(""),
      bool(false),
    ]);
    expect(code(r)).toBe("E_PARAM_INVALID");
  });

  test("the ops that run a pattern need the hard kill, the others do not", () => {
    const cat = buildCatalogue(runtime);
    const need = cat.ops.filter((o) => o.vocab === "lines" && o.needsHardKill).map((o) => o.name);
    expect(need.sort()).toEqual(["filter", "remove-numbers"]);
  });
});

describe("the cost at 64 KiB with the default limits", () => {
  const next = rng(13);
  const mk = (n: number, f: () => string) => Array.from({ length: n }, f);
  const cap = (s: string) => s.slice(0, 65536);

  test.each([
    ["alphabetical", cap(mk(20000, () => Math.floor(next() * 1e5).toString(16)).join("\n"))],
    ["case-insensitive", cap(mk(20000, () => Math.floor(next() * 1e5).toString(16)).join("\n"))],
    ["numeric", cap(mk(16000, () => (next() * 10).toFixed(1)).join("\n"))],
    ["numeric", "\n".repeat(65535)],
    ["numeric", "a\n".repeat(32000)],
    ["hexadecimal", "\n".repeat(65535)],
    [
      "ip-address",
      cap(mk(4500, () => [0, 0, 0, 0].map(() => Math.floor(next() * 256)).join(".")).join("\n")),
    ],
  ])("sort %s", async (order, data) => {
    const r = await runtime.call("lines:sort", [
      str(data),
      str("newline"),
      bool(false),
      str(order),
    ]);
    expect(code(r)).toBe("ok");
    if (r.ok) expect(r.steps).toBeLessThan(8_000_000);
  });

  test.each([
    ["lines:unique", (d: string) => [str(d), str("newline"), bool(true)]],
    ["lines:add-numbers", (d: string) => [str(d), str("newline"), int(0)]],
    ["lines:remove-numbers", (d: string) => [str(d), str("newline")]],
    ["lines:wrap", (d: string) => [str(d), str("newline"), int(1)]],
    ["lines:file-tree", (d: string) => [str(d), str("newline"), str("/")]],
    [
      "lines:to-table",
      (d: string) => [str(d), str("comma"), str("newline"), bool(true), str("ascii")],
    ],
  ])("%s on 65,535 empty lines and on one line of 65,536 characters", async (op, args) => {
    for (const data of ["\n".repeat(65535), "x".repeat(65536)]) {
      expect(code(await runtime.call(op, args(data)))).toBe("ok");
    }
  });
});

describe("add-numbers and remove-numbers are a round trip (the declared inverse)", () => {
  test.each([
    "a\nb\nc",
    "1 apple\n2 pear",
    "  indented\n\ttabbed",
    "x\n\ny",
    "a\n",
    "",
    "12:30 start\n- item\n1) one",
    "a\r\nb",
    Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
  ])("%j", async (data) => {
    const numbered = text(
      await runtime.call("lines:add-numbers", [str(data), str("newline"), int(0)]),
    );
    const back = text(await runtime.call("lines:remove-numbers", [str(numbered), str("newline")]));
    expect(back).toBe(data);
  });
});
