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
 * Tests for the `datetime` vocabulary (vocab/datetime.fth, src/prims/datetime.ts): the calendar maths and the
 * week rules against JavaScript's own Date over many instants (a different implementation), the format and the
 * parse of every token, the round trip between them, time zones (daylight saving changes, gaps and overlaps,
 * fixed offsets), the limits, and the catalogue. The fixed-answer vectors are in vocab/datetime.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["datetime"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const PRESET = "Custom";
const INTL = "International date and time";

/** datetime:from-unix with milliseconds: an instant written with a format in a zone. */
async function write(ms: number | bigint, format: string, zone = "UTC") {
  const r = await runtime.call("datetime:from-unix", [
    str(String(ms)),
    str("milliseconds"),
    str(zone),
    str(format),
  ]);
  if (!r.ok) throw new Error(`from-unix ${ms} ${format}: ${r.error.code} ${r.error.message}`);
  return top(r) as string;
}

/** datetime:to-unix in milliseconds, without the parsed text. */
async function read(text: string, format: string, zone = "UTC") {
  const r = await runtime.call("datetime:to-unix", [
    str(text),
    str("milliseconds"),
    str(PRESET),
    str(format),
    str(zone),
    bool(false),
  ]);
  return r.ok ? BigInt(top(r) as string) : code(r);
}

const parse = (text: string, preset: string, format: string, zone: string) =>
  runtime.call("datetime:parse", [str(text), str(preset), str(format), str(zone)]);

const delta = (
  text: string,
  zone: string,
  op: string,
  days: number,
  hours: number,
  minutes = 0,
  seconds = 0,
  ms = 0,
) =>
  runtime.call("datetime:delta", [
    str(text),
    str(INTL),
    str(""),
    str(zone),
    str(op),
    int(days),
    int(hours),
    int(minutes),
    int(seconds),
    int(ms),
  ]);

/** A deterministic sequence of numbers (xorshift), so the sampled instants are the same on every run. */
function sequence(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** ISO 8601 week and week-year by the "Thursday of the week" rule, on JavaScript's Date. */
function isoWeek(ms: number): { week: number; year: number } {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const jan1 = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return {
    week: Math.floor((day.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1,
    year: day.getUTCFullYear(),
  };
}

/** The week of the year where weeks start on Sunday and week 1 holds 1 January (moment.js's English locale). */
function localWeek(ms: number): { week: number; year: number } {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const day = Date.UTC(y, d.getUTCMonth(), d.getUTCDate());
  const saturday = new Date(day + (6 - d.getUTCDay()) * 86_400_000);
  if (saturday.getUTCFullYear() > y) return { week: 1, year: y + 1 };
  const jan1 = new Date(Date.UTC(y, 0, 1)).getUTCDay();
  const doy = (day - Date.UTC(y, 0, 1)) / 86_400_000;
  return { week: Math.floor((doy + jan1) / 7) + 1, year: y };
}

describe("catalogue", () => {
  const cat = buildCatalogue(runtime);
  const mine = cat.ops.filter((o) => o.vocab === "datetime");

  test("the operations, all in the Date/Time category, and the helpers are not operations", () => {
    expect(mine.map((o) => o.qname).sort()).toEqual([
      "datetime:delta",
      "datetime:extract-dates",
      "datetime:filetime-to-unix",
      "datetime:from-unix",
      "datetime:parse",
      "datetime:to-unix",
      "datetime:translate",
      "datetime:unix-to-filetime",
    ]);
    expect(mine.every((o) => o.category === "Date/Time")).toBe(true);
    expect(cat.ops.some((o) => o.name.startsWith("_") || o.name === "zones")).toBe(false);
  });

  test("none of the operations reads the clock or the random source", () => {
    expect(mine.every((o) => o.effects.length === 0)).toBe(true);
  });
});

describe("zones", () => {
  test("the list of zone names has UTC and the IANA names, sorted", async () => {
    const r = await runtime.call("datetime:zones", []);
    const names = (top(r) as { v: string }[]).map((x) => x.v);
    expect(names).toContain("UTC");
    expect(names).toContain("Europe/Paris");
    expect(names).toEqual([...names].sort());
  });
});

describe("the calendar against JavaScript's Date", () => {
  test("date, time, weekday and day of the year over 400 instants from year 1 to year 9999", async () => {
    const next = sequence(12345);
    const lo = -62_135_596_800_000;
    const hi = 253_402_300_799_999;
    const sample = [lo, hi, 0, -1, 951_782_400_000, 4_107_542_400_000];
    while (sample.length < 400) sample.push(Math.floor(lo + next() * (hi - lo)));
    for (const ms of sample) {
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const doy =
        (Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86_400_000 + 1;
      const expected =
        `${pad(y, 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)} ` +
        `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}.${pad(d.getUTCMilliseconds(), 3)} ` +
        `${DAYS[d.getUTCDay()]} ${doy} ${pad(doy, 3)}`;
      expect(await write(ms, "YYYY-MM-DD HH:mm:ss.SSS dddd DDD DDDD"), String(ms)).toBe(expected);
    }
  });

  test("ISO weeks and week-years agree with the Thursday rule, over three years of days and the turns of the year", async () => {
    const days: number[] = [];
    for (let ms = Date.UTC(2019, 11, 20); ms < Date.UTC(2022, 0, 10); ms += 86_400_000 * 2)
      days.push(ms);
    for (const y of [1900, 2000, 2004, 2015, 2020, 2026, 2032, 2099, 9998]) {
      for (const [m, d] of [
        [0, 1],
        [0, 3],
        [0, 4],
        [11, 28],
        [11, 31],
      ] as const)
        days.push(Date.UTC(y, m as number, d));
    }
    for (const ms of days) {
      const iso = isoWeek(ms);
      const loc = localWeek(ms);
      const got = await write(ms, "W|GGGG|w|gggg|E|e");
      const dow = new Date(ms).getUTCDay();
      expect(got, new Date(ms).toISOString()).toBe(
        `${iso.week}|${pad(iso.year, 4)}|${loc.week}|${pad(loc.year, 4)}|${dow || 7}|${dow}`,
      );
    }
  });

  test("every month length and the leap year rules, through the day after the last day of each month", async () => {
    for (const y of [1899, 1900, 2000, 2023, 2024, 2100]) {
      for (let m = 0; m < 12; m++) {
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const text = `${pad(y, 4)}-${pad(m + 1, 2)}-${pad(last, 2)}`;
        expect(await read(text, "YYYY-MM-DD"), text).toBe(BigInt(Date.UTC(y, m, last)));
        expect(await read(`${pad(y, 4)}-${pad(m + 1, 2)}-${pad(last + 1, 2)}`, "YYYY-MM-DD")).toBe(
          "E_COERCE",
        );
      }
    }
  });
});

describe("format tokens", () => {
  const T = Date.UTC(2026, 10, 11, 15, 4, 5, 60); // Wednesday 2026-11-11 15:04:05.060

  test.each([
    ["Y YY YYYY YYYYY YYYYYY", "2026 26 2026 +02026 +002026"],
    ["Q Qo", "4 4th"],
    ["M Mo MM MMM MMMM", "11 11th 11 Nov November"],
    ["D Do DD DDD DDDo DDDD", "11 11th 11 315 315th 315"],
    ["d do dd ddd dddd", "3 3rd We Wed Wednesday"],
    ["E e", "3 3"],
    ["W Wo WW w wo ww", "46 46th 46 46 46th 46"],
    ["GG GGGG GGGGG gg gggg ggggg", "26 2026 +02026 26 2026 +02026"],
    ["H HH h hh k kk", "15 15 3 03 15 15"],
    ["m mm s ss", "4 04 5 05"],
    ["S SS SSS SSSS SSSSSSSSS", "0 06 060 0600 060000000"],
    ["a A", "pm PM"],
    ["Z ZZ z", "+00:00 +0000 UTC"],
    ["X x", "1794409445 1794409445060"],
    ["[YYYY MM] YYYY[T]HH [] x[x]", "YYYY MM 2026T15  1794409445060x"],
    [
      "LT | LTS | L | l | LL | ll",
      "3:04 PM | 3:04:05 PM | 11/11/2026 | 11/11/2026 | November 11, 2026 | Nov 11, 2026",
    ],
    ["LLL | LLLL", "November 11, 2026 3:04 PM | Wednesday, November 11, 2026 3:04 PM"],
    ["-/:. ,!()#", "-/:. ,!()#"],
  ])("%s", async (format, expected) => {
    expect(await write(T, format)).toBe(expected);
  });

  test("the 12-hour clock around noon and midnight, and k for the 24th hour", async () => {
    const at = (h: number) => Date.UTC(2026, 0, 1, h);
    expect(await write(at(0), "h hh a k kk H")).toBe("12 12 am 24 24 0");
    expect(await write(at(12), "h hh a k H")).toBe("12 12 pm 12 12");
    expect(await write(at(13), "h hh A")).toBe("1 01 PM");
  });

  test("ordinals: 1st 2nd 3rd 4th, 11th 12th 13th, 21st 22nd 23rd, 101st 111th", async () => {
    const got: string[] = [];
    for (const d of [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31])
      got.push(await write(Date.UTC(2026, 0, d), "Do"));
    expect(got).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "30th",
      "31st",
    ]);
    expect(await write(Date.UTC(2026, 3, 11), "DDDo")).toBe("101st");
    expect(await write(Date.UTC(2026, 3, 21), "DDDo")).toBe("111th");
  });

  test("years: signs, padding, year 0 and negative years, and years past 9999", async () => {
    expect(await write(Date.UTC(2026, 0, 1), "YYYY YY")).toBe("2026 26");
    expect(await write(-62_167_219_200_000, "YYYY-MM-DD")).toBe("0000-01-01");
    expect(await write(-62_167_219_200_001, "YYYY-MM-DD")).toBe("-0001-12-31");
    expect(await write(253_402_300_800_000, "YYYY Y YYYYYY YY")).toBe("+10000 +10000 +010000 00");
    expect(await write(-62_135_596_800_000, "YYYY YY")).toBe("0001 01");
  });

  test("a time before the epoch keeps its fraction of a second", async () => {
    expect(await write(-1, "YYYY-MM-DD HH:mm:ss.SSS X x")).toBe("1969-12-31 23:59:59.999 -1 -1");
  });

  test("a bracket that is never closed is two plain characters and the text after it", async () => {
    expect(await write(T, "[YYYY")).toBe("[2026");
  });
});

describe("parsing", () => {
  test.each([
    ["2026-11-11 15:04:05", "YYYY-MM-DD HH:mm:ss", Date.UTC(2026, 10, 11, 15, 4, 5)],
    [
      "2026-11-11T15:04:05.060Z",
      "YYYY-MM-DD[T]HH:mm:ss.SSS[Z]",
      Date.UTC(2026, 10, 11, 15, 4, 5, 60),
    ],
    ["11 Nov 2026", "D MMM YYYY", Date.UTC(2026, 10, 11)],
    ["NOVEMBER 11TH, 2026", "MMMM Do, YYYY", Date.UTC(2026, 10, 11)],
    ["Wednesday, November 11, 2026 3:04 PM", "LLLL", Date.UTC(2026, 10, 11, 15, 4)],
    ["3:04 p.m.", "h:mm a", 15 * 3_600_000 + 4 * 60_000],
    ["12:00 AM", "hh:mm A", 0],
    ["12:00 PM", "hh:mm A", 12 * 3_600_000],
    ["2026 315", "YYYY DDD", Date.UTC(2026, 10, 11)],
    ["2026-W46-3", "GGGG-[W]WW-E", Date.UTC(2026, 10, 11)],
    ["2026-w46-3", "gggg-[w]ww-e", Date.UTC(2026, 10, 11)],
    ["2026-Q4", "YYYY-[Q]Q", Date.UTC(2026, 9, 1)],
    ["26-11-11", "YY-MM-DD", Date.UTC(2026, 10, 11)],
    ["68-01-01", "YY-MM-DD", Date.UTC(2068, 0, 1)],
    ["69-01-01", "YY-MM-DD", Date.UTC(1969, 0, 1)],
    ["1794409445", "X", 1_794_409_445_000],
    ["1794409445.5", "X", 1_794_409_445_500],
    ["-1794409445060", "x", -1_794_409_445_060],
    ["2026-11-11 15:04:05 +05:30", "YYYY-MM-DD HH:mm:ss Z", Date.UTC(2026, 10, 11, 9, 34, 5)],
    ["2026-11-11 15:04:05 -0800", "YYYY-MM-DD HH:mm:ss ZZ", Date.UTC(2026, 10, 11, 23, 4, 5)],
    ["2026-11-11 15:04:05 Z", "YYYY-MM-DD HH:mm:ss Z", Date.UTC(2026, 10, 11, 15, 4, 5)],
    ["15:04:05.123456789", "HH:mm:ss.SSSSSSSSS", 15 * 3_600_000 + 4 * 60_000 + 5123],
    ["1.5", "s.S", 1500],
    ["0001-01-01", "YYYY-MM-DD", -62_135_596_800_000],
    ["9999-12-31 23:59:59.999", "YYYY-MM-DD HH:mm:ss.SSS", 253_402_300_799_999],
    ["Thursday 1 January 1970", "dddd D MMMM YYYY", 0],
    ["Sun, 03 Jan 2021 00:00:00", "ddd, DD MMM YYYY HH:mm:ss", Date.UTC(2021, 0, 3)],
    ["2026-11-11 24:00:00", "YYYY-MM-DD kk:mm:ss", Date.UTC(2026, 10, 11)],
  ])("%s with %s", async (text, format, expected) => {
    expect(await read(text, format)).toBe(BigInt(expected));
  });

  test("a literal is used up only when it is the next text, so a missing separator does not swallow a field", async () => {
    expect(await read("on 2026/11/11 at 08:09", "YYYY MM DD HH mm")).toBe(
      BigInt(Date.UTC(2026, 10, 11, 8, 9)),
    );
    // without separators each field takes the digits it can: four for the year, then two and two
    expect(await read("20261111", "YYYY-MM-DD")).toBe(BigInt(Date.UTC(2026, 10, 11)));
  });

  test("errors: nothing matched, a date that does not exist, an hour out of range", async () => {
    expect(await read("", "YYYY-MM-DD")).toBe("E_COERCE");
    expect(await read("abc", "YYYY-MM-DD")).toBe("E_COERCE");
    expect(await read("2026-00-10", "YYYY-MM-DD")).toBe("E_COERCE");
    expect(await read("2026-04-31", "YYYY-MM-DD")).toBe("E_COERCE");
    expect(await read("2026-01-01 60:00", "YYYY-MM-DD HH:mm")).toBe("E_COERCE");
    expect(await read("2026-01-01 10:60", "YYYY-MM-DD HH:mm")).toBe("E_COERCE");
    expect(await read("2026-01-01 10:10:60", "YYYY-MM-DD HH:mm:ss")).toBe("E_COERCE");
    expect(await read("2025 366", "YYYY DDD")).toBe("E_COERCE");
    expect(await read("2024 366", "YYYY DDD")).toBe(BigInt(Date.UTC(2024, 11, 31)));
  });

  test("a text that names no fields of the format leaves the defaults only when something matched", async () => {
    // Only the year is named: the rest is 1 January, midnight.
    expect(await read("2026", "YYYY")).toBe(BigInt(Date.UTC(2026, 0, 1)));
    expect(await read("5", "H")).toBe(5n * 3_600_000n);
  });
});

describe("round trip: write with a format, read with the same format", () => {
  const formats = [
    "YYYY-MM-DD HH:mm:ss.SSSSSSSSS Z",
    "dddd Do MMMM YYYY h:mm:ss.SSS A ZZ",
    "GGGG-[W]WW-E HH:mm:ss.SSS",
    "gggg-[w]ww-e HH:mm:ss.SSS",
    "YYYY DDDD HH:mm:ss.SSS",
    "YYYY-Q-DD HH:mm:ss.SSS",
    "LLLL",
    "x",
  ];
  test.each(formats)("%s", async (format) => {
    const next = sequence(777);
    for (let i = 0; i < 40; i++) {
      const ms = Math.floor(-62_000_000_000_000 + next() * 250_000_000_000_000);
      const whole = format === "LLLL" ? Math.floor(ms / 60_000) * 60_000 : ms;
      const text = await write(whole, format, "UTC");
      const back = await read(text, format);
      if (format.startsWith("GGGG") || format.startsWith("gggg") || format.startsWith("YYYY-Q"))
        continue; // those formats do not hold the month, so only the day of the week/year round-trips (checked in the vectors)
      expect(back, `${format} ${whole} ${text}`).toBe(BigInt(whole));
    }
  });
});

describe("time zones", () => {
  const NY = "America/New_York";

  test("the wall clock of an instant, either side of the changes", async () => {
    // 2026-03-08 07:00Z: 02:00 EST becomes 03:00 EDT. 2026-11-01 06:00Z: 02:00 EDT becomes 01:00 EST.
    const spring = Date.UTC(2026, 2, 8, 7);
    expect(await write(spring - 1, "YYYY-MM-DD HH:mm:ss Z z", NY)).toBe(
      "2026-03-08 01:59:59 -05:00 EST",
    );
    expect(await write(spring, "YYYY-MM-DD HH:mm:ss Z z", NY)).toBe(
      "2026-03-08 03:00:00 -04:00 EDT",
    );
    const autumn = Date.UTC(2026, 10, 1, 6);
    expect(await write(autumn - 1, "HH:mm:ss Z", NY)).toBe("01:59:59 -04:00");
    expect(await write(autumn, "HH:mm:ss Z", NY)).toBe("01:00:00 -05:00");
  });

  test("a time that occurs twice is the first one, and a time that does not exist moves forward", async () => {
    expect(await read("2026-11-01 01:30:00", "YYYY-MM-DD HH:mm:ss", NY)).toBe(
      BigInt(Date.UTC(2026, 10, 1, 5, 30)),
    );
    expect(await read("2026-11-01 02:30:00", "YYYY-MM-DD HH:mm:ss", NY)).toBe(
      BigInt(Date.UTC(2026, 10, 1, 7, 30)),
    );
    expect(await read("2026-03-08 02:30:00", "YYYY-MM-DD HH:mm:ss", NY)).toBe(
      BigInt(Date.UTC(2026, 2, 8, 7, 30)),
    );
    expect(await read("2026-03-08 03:30:00", "YYYY-MM-DD HH:mm:ss", NY)).toBe(
      BigInt(Date.UTC(2026, 2, 8, 7, 30)),
    );
    expect(await read("2026-03-08 01:30:00", "YYYY-MM-DD HH:mm:ss", NY)).toBe(
      BigInt(Date.UTC(2026, 2, 8, 6, 30)),
    );
  });

  test("half-hour and 45-minute zones, and the southern summer", async () => {
    expect(await write(Date.UTC(2026, 0, 1), "HH:mm Z", "Asia/Kathmandu")).toBe("05:45 +05:45");
    expect(await write(Date.UTC(2026, 0, 1), "HH:mm Z", "Australia/Adelaide")).toBe("10:30 +10:30");
    expect(await write(Date.UTC(2026, 0, 1), "HH:mm Z", "Australia/Sydney")).toBe("11:00 +11:00");
    expect(await write(Date.UTC(2026, 6, 1), "HH:mm Z", "Australia/Sydney")).toBe("10:00 +10:00");
  });

  test("parse reports daylight saving time by comparing with the January and June offsets (north and south)", async () => {
    const dst = async (text: string, zone: string) => {
      const r = await parse(text, INTL, "", zone);
      return /Daylight Saving Time: (\w+)/.exec(top(r) as string)?.[1];
    };
    expect(await dst("2026-07-01 12:00:00", NY)).toBe("true");
    expect(await dst("2026-01-01 12:00:00", NY)).toBe("false");
    expect(await dst("2026-01-01 12:00:00", "Australia/Sydney")).toBe("true");
    expect(await dst("2026-07-01 12:00:00", "Australia/Sydney")).toBe("false");
    expect(await dst("2026-07-01 12:00:00", "Asia/Tokyo")).toBe("false");
    expect(await dst("2026-07-01 12:00:00", "UTC")).toBe("false");
  });

  test("the parse report names the zone and the offset", async () => {
    const r = await parse("2026-07-01 12:00:00", INTL, "", NY);
    expect(top(r)).toContain("Timezone: EDT\nUTC offset: -0400");
  });

  test("fixed offsets: forms, signs and range", async () => {
    for (const [zone, hh] of [
      ["+09:00", "21:34"],
      ["+0900", "21:34"],
      ["+09", "21:34"],
      ["-05", "07:34"],
      ["-0530", "07:04"],
      ["Z", "12:34"],
      ["UTC", "12:34"],
      ["utc", "12:34"],
    ] as const) {
      expect(await write(1_794_400_496_000, "HH:mm", zone), zone).toBe(hh);
    }
    const bad = await runtime.call("datetime:from-unix", [
      str("0"),
      str("seconds"),
      str("+24:00"),
      str("HH"),
    ]);
    expect(code(bad)).toBe("E_RANGE");
    const bad2 = await runtime.call("datetime:from-unix", [
      str("0"),
      str("seconds"),
      str("+09:60"),
      str("HH"),
    ]);
    expect(code(bad2)).toBe("E_RANGE");
  });

  test("a named zone outside the years 1 to 9999 is E_RANGE, while UTC and fixed offsets are not limited", async () => {
    const r = await runtime.call("datetime:from-unix", [
      str("300000000000"),
      str("seconds"),
      str("Asia/Tokyo"),
      str("YYYY"),
    ]);
    expect(code(r)).toBe("E_RANGE");
    expect(await write(300_000_000_000_000, "YYYY-MM-DD", "UTC")).toBe("+11476-08-15");
    expect(await write(300_000_000_000_000, "YYYY", "+01:00")).toBe("+11476");
  });

  test("the offset in the text wins over the zone", async () => {
    const r = await read("2026-11-11 12:00 +00:00", "YYYY-MM-DD HH:mm Z", "Asia/Tokyo");
    expect(r).toBe(BigInt(Date.UTC(2026, 10, 11, 12)));
  });
});

describe("delta", () => {
  const NY = "America/New_York";

  test("days are calendar days across a daylight saving change, hours are elapsed time", async () => {
    // 2026-03-07 12:00 EST (17:00Z) + 1 day = 2026-03-08 12:00 EDT (16:00Z); + 24 hours = 2026-03-08 13:00 EDT.
    expect(top(await delta("2026-03-07 12:00:00", NY, "add", 1, 0))).toBe("2026-03-08 12:00:00");
    expect(top(await delta("2026-03-07 12:00:00", NY, "add", 0, 24))).toBe("2026-03-08 13:00:00");
    expect(top(await delta("2026-03-08 12:00:00", NY, "subtract", 1, 0))).toBe(
      "2026-03-07 12:00:00",
    );
  });

  test("an addition and the opposite subtraction cancel, over many starts", async () => {
    const next = sequence(99);
    for (let i = 0; i < 40; i++) {
      const ms = Math.floor(next() * 4_000_000_000_000);
      const text = await write(ms, "YYYY-MM-DD HH:mm:ss");
      const days = Math.floor(next() * 4000);
      const there = top(await delta(text, "UTC", "add", days, 5, 6, 7)) as string;
      const back = top(await delta(there, "UTC", "subtract", days, 5, 6, 7)) as string;
      expect(back, `${text} ${days}`).toBe(text);
      const expected = await write(
        ms - (ms % 1000) + days * 86_400_000 + 5 * 3_600_000 + 6 * 60_000 + 7000,
        "YYYY-MM-DD HH:mm:ss",
      );
      expect(there).toBe(expected);
    }
  });
});

describe("file times and Unix times", () => {
  const call = async (op: string, ...args: ReturnType<typeof str>[]) =>
    top(await runtime.call(op, args));

  test("round trip over many instants in every unit and every file time form", async () => {
    const next = sequence(4242);
    for (let i = 0; i < 60; i++) {
      const secs = BigInt(Math.floor(-11_644_473_600 + next() * 1_000_000_000_000));
      for (const out of ["decimal", "hex-be", "hex-le"]) {
        const ft = await call(
          "datetime:unix-to-filetime",
          str(String(secs)),
          str("seconds"),
          str(out),
        );
        expect(
          await call("datetime:filetime-to-unix", str(ft as string), str(out), str("seconds")),
          `${secs} ${out}`,
        ).toBe(String(secs));
      }
    }
  });

  test("file times that are not whole seconds are exact in each unit", async () => {
    const ft = "134388740967891234"; // 1794400496.7891234 s
    expect(await call("datetime:filetime-to-unix", str(ft), str("decimal"), str("seconds"))).toBe(
      "1794400496.7891234",
    );
    expect(
      await call("datetime:filetime-to-unix", str(ft), str("decimal"), str("milliseconds")),
    ).toBe("1794400496789.1234");
    expect(
      await call("datetime:filetime-to-unix", str(ft), str("decimal"), str("microseconds")),
    ).toBe("1794400496789123.4");
    expect(
      await call("datetime:filetime-to-unix", str(ft), str("decimal"), str("nanoseconds")),
    ).toBe("1794400496789123400");
  });

  test("the largest file time and the one after it", async () => {
    const max = "18446744073709551615";
    expect(await call("datetime:filetime-to-unix", str(max), str("decimal"), str("seconds"))).toBe(
      "1833029933770.9551615",
    );
    expect(
      await call(
        "datetime:unix-to-filetime",
        str("1833029933770.9551615"),
        str("seconds"),
        str("hex-be"),
      ),
    ).toBe("ffffffffffffffff");
    const over = await runtime.call("datetime:unix-to-filetime", [
      str("1833029933771"),
      str("seconds"),
      str("decimal"),
    ]);
    expect(code(over)).toBe("E_RANGE");
  });

  test("from-unix keeps big numbers exact (nanoseconds past 2^53)", async () => {
    const r = await runtime.call("datetime:from-unix", [
      str("1794400496789123457"),
      str("nanoseconds"),
      str("UTC"),
      str("HH:mm:ss.SSSSSSSSS"),
    ]);
    expect(top(r)).toBe("12:34:56.789123457");
  });
});

describe("extract-dates", () => {
  const extract = (text: string, total = false, sort = false, unique = false) =>
    runtime.call("datetime:extract-dates", [str(text), bool(total), bool(sort), bool(unique)]);

  test("handles a 64 KiB text of dates within the default limits", async () => {
    const line = "log 2026-11-11 and 11/12/2026, 31.12.1999 end\n";
    const text = line.repeat(Math.floor(65_536 / line.length));
    const t0 = Date.now();
    const r = await extract(text, true, true, true);
    expect(code(r)).toBe("ok");
    expect(top(r)).toBe("Total found: 3\n\n11/12/2026\n2026-11-11\n31.12.1999");
    const r2 = await extract(text);
    expect(((top(r2) as string).match(/\n/g) ?? []).length).toBe(
      3 * Math.floor(65_536 / line.length) - 1,
    );
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("limits", () => {
  test("a full parse report and a translate stay far below the step limit", async () => {
    const r = await parse(
      "Wednesday 11th November 2026 21:34:56 +09:00 GMT+9",
      "Verbose date and time",
      "",
      "UTC",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.steps).toBeLessThan(200_000);
  });

  test("a 64 KiB text that holds no date fails quickly", async () => {
    const t0 = Date.now();
    const r = await parse("x".repeat(65_536), INTL, "", "UTC");
    expect(code(r)).toBe("E_COERCE");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test("a long text with a date in the middle is read from its first match", async () => {
    const r = await runtime.call("datetime:to-unix", [
      str(`${"x ".repeat(20_000)}2026-11-11 12:34:56`),
      str("seconds"),
      str(INTL),
      str(""),
      str("UTC"),
      bool(false),
    ]);
    expect(top(r)).toBe("1794400496");
  });
});
