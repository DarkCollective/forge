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
 * Tests for the `file-mode` vocabulary (vocab/file-mode.fth, no primitives). Known answers are in
 * vocab/file-mode.test.json; these round-trip every one of the 4096 modes between octal and
 * symbolic text against an independent writer of the ls -l notation.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["file-mode", "raise"]));

const convert = async (data: string, to: string) => {
  const r = await runtime.call("file-mode:convert", [str(data), str(to)]);
  if (!r.ok) throw new Error(`${data}: ${JSON.stringify(r.error)}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};

/** The nine characters ls -l prints for a mode (POSIX; the glibc rules for s S t T). */
function ls(mode: number): string {
  const bit = (m: number, ch: string) => (mode & m ? ch : "-");
  const x = (xm: number, sm: number, on: string, off: string) =>
    mode & sm ? (mode & xm ? on : off) : mode & xm ? "x" : "-";
  return (
    bit(0o400, "r") +
    bit(0o200, "w") +
    x(0o100, 0o4000, "s", "S") +
    bit(0o040, "r") +
    bit(0o020, "w") +
    x(0o010, 0o2000, "s", "S") +
    bit(0o004, "r") +
    bit(0o002, "w") +
    x(0o001, 0o1000, "t", "T")
  );
}

describe("file-mode:convert", () => {
  test("every mode: octal to symbolic and back", async () => {
    for (let mode = 0; mode < 4096; mode += 1) {
      const octal = mode.toString(8).padStart(4, "0");
      const symbolic = ls(mode);
      expect(await convert(octal, "symbolic"), octal).toBe(symbolic);
      expect(await convert(symbolic, "octal"), symbolic).toBe(octal);
    }
  });

  test("three-digit octal is the same as four with a leading zero", async () => {
    expect(await convert("644", "symbolic")).toBe(await convert("0644", "symbolic"));
  });

  test("a file type character is kept and is one of - d l b c p s", async () => {
    for (const t of "-dlbcps")
      expect(await convert(`${t}rwxr-xr-x`, "symbolic")).toBe(`${t}rwxr-xr-x`);
  });
});

describe("file-mode:parse", () => {
  test("names the type", async () => {
    const names: Record<string, string> = {
      "-": "Regular file",
      d: "Directory",
      l: "Symbolic link",
      b: "Block device",
      c: "Character device",
      p: "Named pipe",
      s: "Socket",
      D: "Door",
    };
    for (const [t, name] of Object.entries(names)) {
      const r = await runtime.call("file-mode:parse", [str(`${t}rw-r--r--`)]);
      expect(r.ok).toBe(true);
      if (r.ok)
        expect((r.stack[r.stack.length - 1] as { v: string }).v).toContain(
          `\nFile type: ${name}\n`,
        );
    }
  });
});
