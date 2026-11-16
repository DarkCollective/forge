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

// The scoring rule of the Magic engine: each weight, the evidence gate, the pruning rules.
import { dataView } from "@forge/ops/checks";
import { gzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { MAGIC_WEIGHTS, MIN_GAIN, scoreOutput, worthReturning } from "./score.js";
import type { ScoreInput } from "./score.js";

const enc = (s: string) => new TextEncoder().encode(s);
const base = (text: Uint8Array | string, extra: Partial<ScoreInput> = {}): ScoreInput => {
  const view = dataView(typeof text === "string" ? enc(text) : text);
  return {
    view,
    rootEntropy: 5,
    evidence: true,
    outputChecks: [],
    cribMatched: false,
    parent: { score: 0, id: null },
    ...extra,
  };
};
const TEXT = "Hello, World! This is plain text.";

describe("scoreOutput", () => {
  test("readable text earns utf8, printable and plain-text weights", () => {
    const s = scoreOutput(base(TEXT, { rootEntropy: 0 }));
    expect(s.score).toBeCloseTo(
      MAGIC_WEIGHTS.utf8 + MAGIC_WEIGHTS.printable + MAGIC_WEIGHTS.plainText,
      6,
    );
    expect(s.reasons[0]).toContain("valid UTF-8");
  });

  test("an entropy drop below the search input adds up to its weight", () => {
    const flat = scoreOutput(base(TEXT, { rootEntropy: 0 })).score;
    const dropped = scoreOutput(base(TEXT, { rootEntropy: 100 })).score;
    expect(dropped - flat).toBeCloseTo(MAGIC_WEIGHTS.entropyDrop, 6);
  });

  test("a signature match earns the identified weight, and is newly recognised", () => {
    const gz = gzipSync(enc(TEXT));
    const s = scoreOutput(base(gz, { rootEntropy: 0 }));
    expect(s.id).toBe("gzip");
    expect(s.score).toBeCloseTo(MAGIC_WEIGHTS.identified, 6);
    expect(s.newlyRecognised).toBe(true);
    expect(s.improves).toBe(true);
    // The same data is not new when the parent was already it.
    const again = scoreOutput(base(gz, { rootEntropy: 0, parent: { score: 1, id: "gzip" } }));
    expect(again.newlyRecognised).toBe(false);
  });

  test("an operation without evidence earns nothing but the crib", () => {
    const none = scoreOutput(base(TEXT, { evidence: false, parent: { score: 0.3, id: null } }));
    expect(none.score).toBe(0.3);
    expect(none.improves).toBe(false);
    const cribbed = scoreOutput(
      base(TEXT, { evidence: false, cribMatched: true, parent: { score: 0.3, id: null } }),
    );
    expect(cribbed.score).toBeCloseTo(0.3 + MAGIC_WEIGHTS.crib, 6);
    expect(cribbed.improves).toBe(true);
    expect(cribbed.reasons).toEqual(["matches the crib"]);
  });

  test("a failing output check is a penalty, a passing one is not credit", () => {
    const check = { scope: "output", test: { kind: "charset", alphabet: "0-9", min: 1 } } as const;
    const failing = scoreOutput(base(TEXT, { rootEntropy: 0, outputChecks: [check] }));
    const free = scoreOutput(base(TEXT, { rootEntropy: 0 }));
    expect(failing.score).toBeCloseTo(free.score - MAGIC_WEIGHTS.outputChecks, 6);
    const passing = scoreOutput(base("12345", { rootEntropy: 0, outputChecks: [check] }));
    expect(passing.reasons.join(";")).not.toContain("output checks");
  });

  test("taking apart an encoding needs readable output", () => {
    const readable = scoreOutput(
      base(TEXT, { rootEntropy: 0, parent: { score: 0.35, id: "hex" } }),
    );
    expect(readable.decoded).toBe(true);
    const noise = scoreOutput(
      base(
        Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 200) & 255),
        {
          rootEntropy: 0,
          parent: { score: 0.35, id: "hex" },
        },
      ),
    );
    expect(noise.decoded).toBe(false);
  });

  test("an output must beat its parent by MIN_GAIN to be kept, unless it is recognised, decoded or cribbed", () => {
    const s = scoreOutput(
      base(TEXT, { rootEntropy: 0, parent: { score: 0.45, id: "ascii-text" } }),
    );
    expect(s.score).toBeCloseTo(0.45, 6);
    expect(s.improves).toBe(false);
    const better = scoreOutput(
      base(TEXT, { rootEntropy: 0, parent: { score: 0.45 - MIN_GAIN, id: "ascii-text" } }),
    );
    expect(better.improves).toBe(true);
  });

  test("the maximum is the sum of the weights that can hold together", () => {
    const w = MAGIC_WEIGHTS;
    expect(w.utf8 + w.printable + w.entropyDrop + w.decoded + w.identified + w.crib).toBeCloseTo(
      1.35,
      6,
    );
  });

  test("worthReturning compares with the search input", () => {
    const s = scoreOutput(base(TEXT, { rootEntropy: 0 }));
    expect(worthReturning(s, false, s.score)).toBe(false);
    expect(worthReturning(s, false, s.score - 0.1)).toBe(true);
    expect(worthReturning(s, true, s.score)).toBe(true);
  });
});
