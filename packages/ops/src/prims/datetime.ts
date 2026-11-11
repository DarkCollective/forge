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
 * datetime primitives: the host's time zone rules, and nothing else. FL cannot read the IANA time zone database,
 * and Forge ships no date library, so the host's `Intl` API answers the two questions the vocabulary has about a
 * zone name: the offset from UTC at an instant, and a short name (abbreviation) at an instant. The list of zone
 * names comes from `Intl.supportedValuesOf`. All the calendar maths, the format tokens and the parsing are FL
 * (vocab/datetime.fth). The primitives are pure: they read no clock, only the rules of the host's ICU data.
 *
 *  - `_zone-offset ( zone:str ms:int -- int )`: the offset of the zone from UTC, in seconds (positive east of
 *    Greenwich), at the instant `ms` (milliseconds since the Unix epoch). Whole seconds, so the local mean time of
 *    old dates (UTC-4:56:02) is exact. An unknown zone name, or an instant outside the years 1 to 9999, is E_RANGE.
 *  - `_zone-abbr ( zone:str ms:int -- str )`: the short name the host gives the zone at that instant ("EST", or
 *    "GMT+9" where the host knows no abbreviation). It depends on the host's ICU data.
 *  - `_zones ( -- list )`: the zone names the host supports, with "UTC" always present, sorted by code point.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const { str } = valueHelpers;

// The package builds against ES2022 only, whose Intl typings lack part of what is used here.
interface Part {
  readonly type: string;
  readonly value: string;
}
interface Formatter {
  formatToParts(date: Date): Part[];
}
interface IntlHost {
  DateTimeFormat: new (locale: string, options: Record<string, string | boolean>) => Formatter;
  supportedValuesOf?: (key: string) => string[];
}
const host = (): IntlHost => (globalThis as unknown as { Intl: IntlHost }).Intl;

/** 0001-01-01T00:00:00Z and 9999-12-31T23:59:59.999Z in milliseconds: the range the zone rules are asked about. */
const MIN_MS = -62_135_596_800_000;
const MAX_MS = 253_402_300_799_999;

const offsetFormatters = new Map<string, Formatter>();
const abbrFormatters = new Map<string, Formatter>();

function formatter(
  cache: Map<string, Formatter>,
  zone: string,
  options: Record<string, string | boolean>,
): Formatter {
  const cached = cache.get(zone);
  if (cached !== undefined) return cached;
  let made: Formatter;
  try {
    made = new (host().DateTimeFormat)("en-US", { ...options, timeZone: zone });
  } catch {
    throw rangeFailure(`'${zone}' is not a time zone name this host knows`, { zone });
  }
  cache.set(zone, made);
  return made;
}

function checkInstant(ms: number | bigint): number {
  const n = Number(ms);
  if (!(n >= MIN_MS && n <= MAX_MS)) {
    throw rangeFailure("time zone rules are available for the years 1 to 9999 only", {
      ms: String(ms),
    });
  }
  return n;
}

/** The offset of `zone` from UTC at `ms`, in seconds: the zone's wall clock read as if it were UTC, minus the instant. */
export function zoneOffset(zone: string, ms: number | bigint): number {
  const t = checkInstant(ms);
  const f = formatter(offsetFormatters, zone, {
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const get: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) {
    if (p.type !== "literal") get[p.type] = Number(p.value);
  }
  const wall = new Date(0);
  wall.setUTCFullYear(get["year"] as number, (get["month"] as number) - 1, get["day"] as number);
  wall.setUTCHours(
    (get["hour"] as number) % 24,
    get["minute"] as number,
    get["second"] as number,
    0,
  );
  return (wall.getTime() - Math.floor(t / 1000) * 1000) / 1000;
}

export function zoneAbbr(zone: string, ms: number | bigint): string {
  const t = checkInstant(ms);
  const f = formatter(abbrFormatters, zone, { timeZoneName: "short" });
  const name = f.formatToParts(new Date(t)).find((p) => p.type === "timeZoneName");
  return name?.value ?? zone;
}

export function zoneNames(): ReturnType<typeof str>[] {
  const names = new Set<string>(host().supportedValuesOf?.("timeZone") ?? []);
  names.add("UTC");
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((n) => str(n));
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("datetime", "_zone-offset", "( zone:str ms:int -- int )", zoneOffset, {
    doc: "The offset of an IANA time zone from UTC in seconds at an instant in Unix milliseconds, from the host's Intl rules (private helper of the datetime vocabulary). An unknown zone, or an instant outside the years 1 to 9999, is E_RANGE.",
    category: "Date/Time",
  }),
  definePrimitive("datetime", "_zone-abbr", "( zone:str ms:int -- str )", zoneAbbr, {
    doc: "The short name the host gives a time zone at an instant (private helper of the datetime vocabulary); it depends on the host's ICU data.",
    category: "Date/Time",
  }),
  definePrimitive("datetime", "_zones", "( -- list )", zoneNames, {
    doc: "The time zone names the host supports, with UTC, sorted by code point (private helper of datetime:zones).",
    category: "Date/Time",
  }),
];
