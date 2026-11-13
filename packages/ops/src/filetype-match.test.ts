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
 * Tests for the signature ids and names of the Detect File Type table (src/filetype-sigs.ts) and for the
 * pure matcher (src/filetype-match.ts): the ids, the lookup, the magic of every row matched from its own
 * bytes, and the `format "<id>"` clause in the vocabularies.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CATEGORIES, FILE_SIGNATURES, SIGNATURE_IDS, signatureById } from "./filetype-sigs.js";
import type { Category, FileSig } from "./filetype-sigs.js";
import { magicAt, matchesAt, scanAll } from "./filetype-match.js";

const ALL: ReadonlySet<Category> = new Set(CATEGORIES);
const LOWER_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The ids of the `magic-bytes format "<id>"` checks in a text, in order of appearance. The clause is
 * matched after `magic-bytes` only: a bare `format "..."` is also a parameter or a choice in the
 * vocabularies (`param format "..."`, `format "hex" = ...`).
 */
function formatIdsIn(text: string): string[] {
  return [...text.matchAll(/\bmagic-bytes\s+format\s+"([^"]*)"/g)].map((m) => m[1] as string);
}

/** The ids named by a text that are not in the signature table. */
function unknownFormatIds(text: string): string[] {
  return formatIdsIn(text).filter((id) => signatureById(id) === undefined);
}

/** The `.fth` files of a directory (the vocabularies have no subdirectories). */
function fthFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".fth"))
    .map((name) => `${dir}/${name}`);
}

/** A buffer that holds the compiled magic of a row at offset 0; the bytes the magic does not fix are 0. */
function bufferFor(sig: FileSig): Uint8Array {
  const size = Math.max(...sig.parts.map((p) => p.offset + p.value.length)) + 4;
  const buf = new Uint8Array(size);
  for (const part of sig.parts) buf.set(part.value, part.offset);
  return buf;
}

describe("the ids and display names", () => {
  test("every id is lower-kebab-case, ASCII and unique", () => {
    const seen = new Set<string>();
    for (const s of FILE_SIGNATURES) {
      expect(s.id, s.name).toMatch(LOWER_KEBAB);
      expect(seen.has(s.id), `duplicate id ${s.id}`).toBe(false);
      seen.add(s.id);
    }
    expect(seen.size).toBe(FILE_SIGNATURES.length);
  });

  test("every row has a display name", () => {
    for (const s of FILE_SIGNATURES) {
      expect(s.displayName.trim().length, s.id).toBeGreaterThan(0);
      expect(s.displayName.length, s.id).toBeLessThanOrEqual(64);
    }
  });

  test("the existing name is unchanged: it is still the name Detect File Type reports", () => {
    expect(FILE_SIGNATURES.find((s) => s.id === "png")?.name).toBe(
      "Portable Network Graphics image",
    );
    expect(FILE_SIGNATURES.find((s) => s.id === "gzip")?.displayName).toBe("gzip data");
  });

  test("SIGNATURE_IDS lists the ids of the table in table order", () => {
    expect(SIGNATURE_IDS).toEqual(FILE_SIGNATURES.map((s) => s.id));
  });

  test("signatureById round-trips every row and misses an unknown id", () => {
    for (const s of FILE_SIGNATURES) expect(signatureById(s.id)).toBe(s);
    expect(signatureById("no-such-format")).toBeUndefined();
    expect(signatureById("")).toBeUndefined();
    expect(signatureById("PNG")).toBeUndefined();
  });
});

describe("the magic of every row, from its own bytes", () => {
  test("a buffer built from a row's compiled magic is matched by that row at offset 0", () => {
    for (const sig of FILE_SIGNATURES) {
      const buf = bufferFor(sig);
      expect(magicAt(buf, 0, sig), sig.id).toBe(true);
      // rows with a `verify` refinement are checked on the magic alone; the refinement needs a real file
      if (sig.verify === undefined) expect(matchesAt(buf, 0, sig), sig.id).toBe(true);
    }
  });

  test("the scan finds each row at offset 0 of its own bytes", () => {
    for (const sig of FILE_SIGNATURES) {
      if (sig.verify !== undefined) continue;
      const found = scanAll(bufferFor(sig), ALL, false, 1_000_000);
      expect(
        found.some((m) => m.offset === 0 && m.sig === sig),
        sig.id,
      ).toBe(true);
    }
  });
});

describe("the format clause in the vocabularies", () => {
  test('the scanner reads magic-bytes format "<id>" and not the other uses of format', () => {
    const sample = `
      \\ a test word
      checks input magic-bytes format "png" ;
      checks output magic-bytes format "gzip" ;
      param input-format "How the input is written." ;
      param format "How the input is written: hex text." ;
      format "hex" = [ data hex:decode ] [ data ] if ;
      dup ";" join output-format "Client to Server" _out ;
      checks input magic-bytes format "not-a-real-id" ;
    `;
    expect(formatIdsIn(sample)).toEqual(["png", "gzip", "not-a-real-id"]);
    expect(unknownFormatIds(sample)).toEqual(["not-a-real-id"]);
  });

  test("the scanner catches an id that is not in the table, and passes the ones that are", () => {
    expect(unknownFormatIds(`checks input magic-bytes format "png" ;`)).toEqual([]);
    expect(unknownFormatIds(`checks input magic-bytes format "pnhg" ;`)).toEqual(["pnhg"]);
  });

  test("every format id named in packages/ops/vocab is in the table", () => {
    const here = fileURLToPath(import.meta.url);
    const vocab = `${here.replace(/\/[^/]*$/, "")}/../vocab`;
    const missing: string[] = [];
    for (const path of fthFiles(vocab)) {
      for (const id of unknownFormatIds(readFileSync(path, "utf8"))) missing.push(`${path}: ${id}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("the pure matcher has no runtime dependency", () => {
  test("filetype-match.ts imports neither @forge/lang nor a primitive module", () => {
    const src = readFileSync(
      `${fileURLToPath(import.meta.url).replace(/\/[^/]*$/, "")}/filetype-match.ts`,
      "utf8",
    );
    const imported = [...src.matchAll(/^(?:import|export) [^;]*? from "([^"]+)";/gm)].map(
      (m) => m[1] as string,
    );
    expect(imported.length).toBeGreaterThan(0);
    for (const spec of imported) {
      expect(spec, spec).not.toMatch(/^@forge\//);
      expect(spec, spec).not.toMatch(/prim-util|prims\//);
    }
  });
});
