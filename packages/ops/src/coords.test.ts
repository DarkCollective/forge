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

/*
 * Tests for the `coords` vocabulary (vocab/coords.fth, primitives in prims/coords.ts). Known
 * answers are in vocab/coords.test.json. These compare with independent references: the textbook
 * floating-point geohash bisection, Snyder's (1987) transverse Mercator series for UTM (forward,
 * and as a check of the inverse), and the haversine formula in plain floating point; they also
 * round-trip every format and time a worst-case input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";
import { primitives } from "./prims/coords.js";

const { str, int, num } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["coords", "raise"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const convert = async (data: string, from: string, to: string, precision: number) =>
  top(
    await runtime.call("coords:convert", [str(data), str(from), str(to), int(precision)]),
  ) as string;
const haversine = async (data: string, radius: number) =>
  top(await runtime.call("coords:haversine", [str(data), num(radius)])) as string;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
/** The textbook geohash: bisect the interval, longitude first. */
function geohash(lat: number, lon: number, n: number): string {
  const la = [-90, 90];
  const lo = [-180, 180];
  let even = true;
  let bit = 0;
  let ch = 0;
  let out = "";
  while (out.length < n) {
    const r = even ? lo : la;
    const v = even ? lon : lat;
    const mid = ((r[0] as number) + (r[1] as number)) / 2;
    if (v >= mid) {
      ch = ch * 2 + 1;
      r[0] = mid;
    } else {
      ch *= 2;
      r[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      out += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}
function geohashMiddle(s: string): [number, number] {
  const la = [-90, 90];
  const lo = [-180, 180];
  let even = true;
  for (const c of s) {
    const v = B32.indexOf(c);
    for (let k = 4; k >= 0; k--) {
      const r = even ? lo : la;
      const mid = ((r[0] as number) + (r[1] as number)) / 2;
      if ((v >> k) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return [((la[0] as number) + (la[1] as number)) / 2, ((lo[0] as number) + (lo[1] as number)) / 2];
}

/** Snyder (1987) eq. 8-9 to 8-15 on WGS 84 with k0 = 0.9996: easting and northing north of the equator. */
function snyder(latDeg: number, lonDeg: number, lon0Deg: number): { e: number; n: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const rad = Math.PI / 180;
  const phi = latDeg * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = (lonDeg - lon0Deg) * rad * Math.cos(phi);
  const M = (p: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const x =
    k0 *
    N *
    (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    k0 *
    (M(phi) +
      N *
        Math.tan(phi) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  return { e: 500000 + x, n: y };
}

const parseDd = (s: string): [number, number] => {
  const [a, b] = s.split(",").map(Number) as [number, number];
  return [a, b];
};

describe("the primitives", () => {
  test("two private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "coords:_math",
      "coords:_atan2",
    ]);
  });
});

describe("geohash", () => {
  test("encoding agrees with the textbook bisection", async () => {
    const next = lcg(11);
    for (let i = 0; i < 40; i++) {
      const lat = next() * 180 - 90;
      const lon = next() * 360 - 180;
      const n = 1 + Math.floor(next() * 12);
      expect(await convert(`${lat.toFixed(9)}, ${lon.toFixed(9)}`, "auto", "geohash", n)).toBe(
        geohash(Number(lat.toFixed(9)), Number(lon.toFixed(9)), n),
      );
    }
  });

  test("decoding gives the middle of the cell", async () => {
    const next = lcg(12);
    for (let i = 0; i < 30; i++) {
      const n = 1 + Math.floor(next() * 12);
      let s = "";
      for (let k = 0; k < n; k++) s += B32[Math.floor(next() * 32)];
      const [lat, lon] = geohashMiddle(s);
      const [gl, go] = parseDd(await convert(s, "geohash", "decimal-degrees", 12));
      expect(Math.abs(gl - lat), s).toBeLessThan(1e-9);
      expect(Math.abs(go - lon), s).toBeLessThan(1e-9);
    }
  });

  test("the poles and the date line fall in the last cell", async () => {
    expect(await convert("90, 180", "auto", "geohash", 6)).toBe("zzzzzz");
    expect(await convert("-90, -180", "auto", "geohash", 6)).toBe("000000");
  });

  test("a geohash is detected only in lower case", async () => {
    expect(await convert("ezs42", "auto", "decimal-degrees", 3)).toBe("42.605, -5.603");
    expect(await convert("EZS42", "geohash", "decimal-degrees", 3)).toBe("42.605, -5.603");
  });
});

describe("degrees, minutes and seconds", () => {
  test("decimal degrees survive a trip through every notation", async () => {
    const next = lcg(13);
    for (let i = 0; i < 25; i++) {
      const lat = (next() * 180 - 90).toFixed(9);
      const lon = (next() * 360 - 180).toFixed(9);
      const dd = `${lat}, ${lon}`;
      const dmm = await convert(dd, "auto", "degrees-decimal-minutes", 11);
      const dms = await convert(dd, "auto", "degrees-minutes-seconds", 9);
      expect(await convert(dmm, "auto", "decimal-degrees", 9), dmm).toBe(dd);
      expect(await convert(dms, "auto", "decimal-degrees", 9), dms).toBe(dd);
    }
  });

  test("the notations of the input", async () => {
    const want = "48.856667, 2.351944";
    for (const t of [
      "48 51 24 N 2 21 7 E",
      "N48 51 24 E2 21 7",
      "48:51:24N,2:21:7E",
      "48°51′24″N 2°21′7″E",
      "+48 51 24 +2 21 7",
    ])
      expect(await convert(t, "auto", "decimal-degrees", 6), t).toBe(want);
    expect(
      await convert("48 51.4 N 2 21.1333333 E", "degrees-decimal-minutes", "decimal-degrees", 4),
    ).toBe("48.8567, 2.3522");
  });

  test("south and west make a value negative, and so does a minus sign", async () => {
    expect(await convert("33 51 S 151 12 E", "auto", "decimal-degrees", 4)).toBe(
      "-33.8500, 151.2000",
    );
    expect(await convert("-33 51 151 12 W", "auto", "decimal-degrees", 4)).toBe(
      "-33.8500, -151.2000",
    );
    expect(await convert("-0 30 0 0 0 0", "auto", "decimal-degrees", 4)).toBe("-0.5000, 0.0000");
  });
});

describe("UTM and MGRS", () => {
  test("UTM agrees with Snyder's series across the zones", async () => {
    const next = lcg(14);
    for (let i = 0; i < 30; i++) {
      const zone = 1 + Math.floor(next() * 60);
      const lon0 = zone * 6 - 183;
      let lat = next() * 125 - 70;
      if (lat >= 56 && lat < 64) lat -= 10; // keep clear of the Norway exception
      const lon = lon0 + (next() * 5.8 - 2.9);
      const r = snyder(lat, lon, lon0);
      const south = lat < 0;
      const out = await convert(`${lat.toFixed(9)}, ${lon.toFixed(9)}`, "auto", "utm", 6);
      const m = /^(\d+)([C-X]) (\d+) (\d+)$/.exec(out);
      expect(m, out).not.toBeNull();
      const [, z, , e, n] = m as RegExpExecArray;
      expect(Number(z), out).toBe(zone);
      expect(Math.abs(Number(e) - r.e), out).toBeLessThanOrEqual(0.51);
      expect(Math.abs(Number(n) - (r.n + (south ? 1e7 : 0))), out).toBeLessThanOrEqual(0.51);
    }
  });

  test("the inverse reproduces the easting and northing (checked with the forward series)", async () => {
    const next = lcg(15);
    for (let i = 0; i < 25; i++) {
      const zone = 1 + Math.floor(next() * 60);
      const lon0 = zone * 6 - 183;
      const south = next() < 0.5;
      const e = 500000 + (next() - 0.5) * 600000;
      const n = 100000 + next() * 6800000;
      const band = south ? "K" : "T";
      const [lat, lon] = parseDd(
        await convert(
          `${zone}${band} ${e.toFixed(3)} ${(south ? n + 1e6 : n).toFixed(3)}`,
          "utm",
          "decimal-degrees",
          12,
        ),
      );
      const r = snyder(lat, lon, lon0);
      expect(Math.abs(r.e - e), `${zone}${band} ${e} ${n}`).toBeLessThan(0.01);
      expect(
        Math.abs(r.n + (south ? 1e7 : 0) - (south ? n + 1e6 : n)),
        `${zone}${band} ${e} ${n}`,
      ).toBeLessThan(0.01);
    }
  });

  test("a point survives UTM and MGRS to within a metre", async () => {
    const next = lcg(16);
    for (let i = 0; i < 20; i++) {
      const lat = next() * 150 - 70;
      const lon = next() * 358 - 179;
      if (lat >= 56 && lat < 64) continue;
      const dd = `${lat.toFixed(8)}, ${lon.toFixed(8)}`;
      for (const f of ["utm", "mgrs"]) {
        const text = await convert(dd, "auto", f, 6);
        const [la, lo] = parseDd(await convert(text, "auto", "decimal-degrees", 9));
        expect(Math.abs(la - lat) * 111320, `${dd} ${f} ${text}`).toBeLessThan(1.5);
        expect(
          Math.abs(lo - lon) * 111320 * Math.cos((lat * Math.PI) / 180),
          `${dd} ${f} ${text}`,
        ).toBeLessThan(1.5);
      }
    }
  });

  test("the zone exceptions", async () => {
    expect(await convert("60, 10", "auto", "utm", 6)).toMatch(/^32V /);
    expect(await convert("60, 2", "auto", "utm", 6)).toMatch(/^31V /);
    expect(await convert("75, 5", "auto", "utm", 6)).toMatch(/^31X /);
    expect(await convert("75, 15", "auto", "utm", 6)).toMatch(/^33X /);
    expect(await convert("75, 25", "auto", "utm", 6)).toMatch(/^35X /);
    expect(await convert("75, 38", "auto", "utm", 6)).toMatch(/^37X /);
    expect(await convert("84, 180", "auto", "utm", 6)).toMatch(/^60X /);
    expect(await convert("-80, -180", "auto", "utm", 6)).toMatch(/^1C /);
  });

  test("the latitude bands", async () => {
    const bands = "CDEFGHJKLMNPQRSTUVWX";
    for (let i = 0; i < 20; i++) {
      const lat = -80 + i * 8 + 4;
      const out = await convert(`${lat}, 0.5`, "auto", "utm", 6);
      expect(out.split(" ")[0]?.endsWith(bands[i] as string), `${lat} ${out}`).toBe(true);
    }
  });

  test("MGRS squares run across the 100 km columns and the 2000 km northing cycle", async () => {
    const next = lcg(17);
    for (let i = 0; i < 20; i++) {
      const lat = next() * 150 - 70;
      const lon = next() * 358 - 179;
      if (lat >= 56 && lat < 64) continue;
      const mgrs = await convert(`${lat.toFixed(8)}, ${lon.toFixed(8)}`, "auto", "mgrs", 6);
      expect(mgrs, mgrs).toMatch(/^\d\d[C-X][A-HJ-NP-Z][A-HJ-NP-V]\d{10}$/);
      const utm = (await convert(`${lat.toFixed(8)}, ${lon.toFixed(8)}`, "auto", "utm", 6)).split(
        " ",
      );
      // The metres inside the square agree with the UTM text to a metre.
      expect(Math.abs(Number(mgrs.slice(5, 10)) - (Number(utm[1]) % 100000))).toBeLessThanOrEqual(
        1,
      );
    }
  });

  test("MGRS of different precision is the middle of a bigger cell", async () => {
    expect(await convert("31TEK", "mgrs", "utm", 6)).toBe("31T 550000 4950000");
    expect(await convert("31TEK0049", "mgrs", "utm", 6)).toBe("31T 500500 4949500");
  });
});

describe("haversine", () => {
  test("agrees with the formula in plain floating point", async () => {
    const next = lcg(18);
    for (let i = 0; i < 25; i++) {
      const p = [next() * 180 - 90, next() * 360 - 180, next() * 180 - 90, next() * 360 - 180].map(
        (x) => Number(x.toFixed(6)),
      );
      const [a, b, c, d] = p as [number, number, number, number];
      const rad = Math.PI / 180;
      const h =
        Math.sin(((c - a) * rad) / 2) ** 2 +
        Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
      const want = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      const got = Number(await haversine(`${a}, ${b}\n${c}, ${d}`, 6371));
      expect(Math.abs(got - want), `${p}`).toBeLessThan(0.0011);
    }
  });

  test("accepts several formats and a decimal radius", async () => {
    expect(await haversine("48 51 24 N 2 21 7 E\n  51.5074 N, 0.1278 W ", 6371.5)).toMatch(
      /^3435\d\d\.\d{3}$/,
    );
  });
});

describe("errors and limits", () => {
  test("bad input is an error", async () => {
    for (const bad of ["", "abc", "1,2,3,4,5", "1 2 3 4 5 6 7", "N S"]) {
      const r = await runtime.call("coords:convert", [str(bad), str("auto"), str("utm"), int(6)]);
      expect(code(r), bad).toBe("E_COERCE");
    }
    expect(
      code(
        await runtime.call("coords:convert", [
          str("31TEK00000829501"),
          str("mgrs"),
          str("utm"),
          int(6),
        ]),
      ),
    ).toBe("E_COERCE");
    expect(
      code(
        await runtime.call("coords:convert", [
          str("61T 500000 5000000"),
          str("utm"),
          str("utm"),
          int(6),
        ]),
      ),
    ).toBe("E_RANGE");
    expect(
      code(
        await runtime.call("coords:convert", [
          str("0T 500000 5000000"),
          str("utm"),
          str("utm"),
          int(6),
        ]),
      ),
    ).toBe("E_RANGE");
  });

  test("a long input costs a bounded number of steps", async () => {
    const r = await runtime.call("coords:convert", [
      str("48 51 24.123456789012 N, 2 21 7.123456789012 E"),
      str("auto"),
      str("mgrs"),
      int(12),
    ]);
    expect(code(r)).toBe("ok");
    if (r.ok) expect(r.steps).toBeLessThan(40000);
  });
});
