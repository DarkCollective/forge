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

import { describe, expect, test } from "vitest";
import { zoneAbbr, zoneNames, zoneOffset } from "./datetime.js";

// 2026-01-15T12:00:00Z and 2026-07-15T12:00:00Z
const JAN = Date.UTC(2026, 0, 15, 12);
const JUL = Date.UTC(2026, 6, 15, 12);

describe("datetime._zone-offset", () => {
  test("a zone without daylight saving time", () => {
    expect(zoneOffset("Asia/Tokyo", JAN)).toBe(32400);
    expect(zoneOffset("Asia/Tokyo", JUL)).toBe(32400);
    expect(zoneOffset("Asia/Kolkata", JAN)).toBe(19800);
    expect(zoneOffset("UTC", JAN)).toBe(0);
  });

  test("a zone with daylight saving time changes with the date, in both hemispheres", () => {
    expect(zoneOffset("America/New_York", JAN)).toBe(-18000);
    expect(zoneOffset("America/New_York", JUL)).toBe(-14400);
    expect(zoneOffset("Europe/London", JAN)).toBe(0);
    expect(zoneOffset("Europe/London", JUL)).toBe(3600);
    expect(zoneOffset("Australia/Sydney", JAN)).toBe(39600);
    expect(zoneOffset("Australia/Sydney", JUL)).toBe(36000);
  });

  test("the change happens at the instant the rules say (2026-03-08T07:00:00Z in New York)", () => {
    const at = Date.UTC(2026, 2, 8, 7);
    expect(zoneOffset("America/New_York", at - 1)).toBe(-18000);
    expect(zoneOffset("America/New_York", at)).toBe(-14400);
  });

  test("offsets are exact to the second, so the local mean time of old dates is kept", () => {
    expect(zoneOffset("America/New_York", Date.UTC(1850, 0, 1))).toBe(-(4 * 3600 + 56 * 60 + 2));
  });

  test("an instant is read as the millisecond count, whether number or bigint, and fractions of a second do not matter", () => {
    expect(zoneOffset("Asia/Tokyo", BigInt(JAN))).toBe(32400);
    expect(zoneOffset("Asia/Tokyo", JAN + 999)).toBe(32400);
    expect(zoneOffset("Asia/Tokyo", -1)).toBe(32400);
  });

  test("the years 1 to 9999 are the supported range, and an unknown zone is E_RANGE", () => {
    expect(zoneOffset("Asia/Tokyo", Date.UTC(9999, 11, 31))).toBe(32400);
    expect(() => zoneOffset("Asia/Tokyo", 253_402_300_800_000)).toThrow(/years 1 to 9999/);
    expect(() => zoneOffset("Asia/Tokyo", -62_135_596_800_001)).toThrow(/years 1 to 9999/);
    expect(() => zoneOffset("Mars/Olympus", JAN)).toThrow(/not a time zone name/);
    expect(() => zoneOffset("", JAN)).toThrow();
  });
});

describe("datetime._zone-abbr", () => {
  test("gives a short name for a zone (the exact text depends on the host's ICU data)", () => {
    expect(zoneAbbr("America/New_York", JAN)).toBe("EST");
    expect(zoneAbbr("America/New_York", JUL)).toBe("EDT");
    expect(zoneAbbr("Asia/Tokyo", JAN)).toMatch(/^(JST|GMT\+9)$/);
    expect(() => zoneAbbr("Mars/Olympus", JAN)).toThrow();
  });
});

describe("datetime._zones", () => {
  test("lists the host's zones, sorted, with UTC", () => {
    const names = zoneNames().map((v) => v.v as string);
    expect(names).toContain("UTC");
    expect(names).toContain("Asia/Tokyo");
    expect(names).toContain("America/New_York");
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(names).size).toBe(names.length);
  });
});
