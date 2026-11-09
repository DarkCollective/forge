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
 * The FL console (WP 1.9) run as a child process with piped stdin. These tests need the built
 * library and the built console: `npm run build -w @forge/lang` (the root `build` and `typecheck`
 * scripts do this). When either is missing the suite is skipped with a message.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const replPath = fileURLToPath(new URL("../dist-scripts/repl.js", import.meta.url).href);
const libPath = fileURLToPath(new URL("../dist/index.js", import.meta.url).href);
const built = existsSync(replPath) && existsSync(libPath);

if (!built) {
  console.warn(
    "[repl] packages/lang/dist-scripts/repl.js or dist/index.js is missing: run `npm run build -w @forge/lang`. The REPL tests are skipped.",
  );
}

function runRepl(lines: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [replPath], {
    input: `${lines.join("\n")}\n`,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(!built)("FL console (piped stdin)", () => {
  it("runs a multi-line definition, reports an error and keeps the session going", () => {
    const { status, stdout, stderr } = runRepl([
      "IN: demo",
      ": sq ( n:int -- int )",
      "n n * ;",
      "7 sq .",
      "1 0 div",
      "99 .",
      "3",
      "0 0 div",
      ".s",
    ]);

    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toContain("49");
    expect(stdout).toContain("E_DIV_ZERO");
    // The session continues after the error.
    expect(stdout.indexOf("99")).toBeGreaterThan(stdout.indexOf("E_DIV_ZERO"));
    // The failed line `0 0 div` leaves the stack as it was: only the 3 remains.
    expect(stdout.trimEnd().split("\n").at(-1)).toBe("<1> 3");
  });
});
