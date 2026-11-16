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
 * The scoring rule of the Magic engine, in one place. Pure and deterministic.
 *
 * score = utf8 + printable + plainText + decoded + entropyDrop + identified + outputChecks + crib, where
 *
 *   utf8          WEIGHTS.utf8                         the whole output is strictly valid UTF-8
 *   printable     WEIGHTS.printable x share            printable share of the first 4 KiB, only when valid UTF-8
 *   plainText     WEIGHTS.plainText                    identified as UTF-8 or ASCII text (not as Base64, hex or random)
 *   decoded       WEIGHTS.decoded                      the parent was identified as an encoding, a container or a format (PEM,
 *                                                      Base64, hex, gzip, ...) other than text or noise, and this output is
 *                                                      not the same (an operation with evidence took it apart)
 *   entropyDrop   WEIGHTS.entropyDrop x clamp(d / 3)   d = bits per byte below the entropy of the search input
 *   identified    WEIGHTS.identified x certainty       a Detect File Type match, PEM, JSON or XML (certainty: high 1,
 *                                                      medium 0.6, low 0.2), for an operation with evidence only
 *   outputChecks  - WEIGHTS.outputChecks x (1 - share) a penalty: `scoreChecks` of the operation's output checks falls
 *                                                      short of 1 (an operation's claim about its output that does not
 *                                                      hold is evidence of a wrong fit)
 *   crib          WEIGHTS.crib                         the output text matches the crib
 *
 * "Evidence": the operation has an input check of kind magic-bytes, regex or charset and it passed on the data, and it
 * does not declare its output with a magic-bytes or regex output check (`pem:from-hex` always makes "-----BEGIN ":
 * it produces a format, it does not take one apart, and crediting it would be circular). An
 * operation without evidence (a hash, an encoder, ROT13) is credited with nothing but the crib: its score is its
 * parent's, plus the crib. This is what keeps a compressor or an encoder, whose output is always well formed, from
 * "improving" any input, and keeps random bytes from turning into hex text.
 *
 * A node is KEPT when it is not empty, not a repeat, and it improves: score >= parent score + MIN_GAIN, or the crib
 * matches, or an operation with evidence made data of a kind the parent was not (a signature match or structured text,
 * certainty not low), or it took apart a parent that was an encoding, container or format (so layers of equal quality,
 * hex of Base64 of hex, are followed). A kept node is RETURNED when it gains MIN_RESULT_GAIN over the search input's own score, or it
 * matches the crib, or it is newly recognised.
 */
import type { MagicCheck } from "@forge/lang";
import { identifyData, scoreChecks } from "@forge/ops/checks";
import type { CheckView, Identification } from "@forge/ops/checks";

export const MAGIC_WEIGHTS = Object.freeze({
  utf8: 0.15,
  printable: 0.2,
  plainText: 0.1,
  entropyDrop: 0.15,
  decoded: 0.1,
  identified: 0.25,
  outputChecks: 0.15,
  crib: 0.5,
});

/** Entropy drop, in bits per byte, that earns the whole `entropyDrop` weight. */
export const ENTROPY_FULL_DROP = 3;
/** A kept node must beat its parent by this much (unless recognised or matching the crib). */
export const MIN_GAIN = 0.05;
/** A returned node must beat the search input by this much (unless recognised or matching the crib). */
export const MIN_RESULT_GAIN = 0.08;
const EPSILON = 1e-9;

/** Printable share from which valid UTF-8 counts as readable (what "decoded" needs to see). */
const MEANINGFUL_PRINTABLE = 0.9;
const CERTAINTY_FACTOR = { high: 1, medium: 0.6, low: 0.2 } as const;
/** Identifications that are not "a recognised kind": plain text and encodings that still need decoding. */
const UNRECOGNISED = new Set(["utf8-text", "ascii-text", "base64", "hex", "random-bytes"]);
/** The output check kinds that make an operation a producer of a format, not a decoder. */
export const PRODUCER_KINDS: ReadonlySet<string> = new Set(["magic-bytes", "regex"]);

/** The input (or output) check kinds that say something about the data's format. */
export const SPECIFIC_KINDS: ReadonlySet<string> = new Set(["magic-bytes", "regex", "charset"]);
const PLAIN_TEXT = new Set(["utf8-text", "ascii-text"]);

export interface ScoreInput {
  readonly view: CheckView;
  /** Entropy of the search input, bits per byte. */
  readonly rootEntropy: number;
  /** The operation had a passing specific input check. */
  readonly evidence: boolean;
  /** The operation's output checks (empty when none). */
  readonly outputChecks: readonly MagicCheck[];
  readonly cribMatched: boolean;
  /** The parent node: its score and identification id, or null for the search input itself. */
  readonly parent: { readonly score: number; readonly id: string | null } | null;
}

export interface Scored {
  readonly score: number;
  readonly reasons: readonly string[];
  readonly id: string | null;
  /** An operation with evidence made certain-enough data of a recognised kind the parent was not. */
  readonly newlyRecognised: boolean;
  /** An operation with evidence took apart a parent that was an encoding, container or format. */
  readonly decoded: boolean;
  /** `score` beats the parent by `MIN_GAIN`, or the crib matched, or newly recognised. */
  readonly improves: boolean;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const pct = (x: number): string => `${String(Math.round(x * 100))}%`;

/** The parent is something to take apart: an encoding, a container or a recognised format, not text or noise. */
function isWrapper(id: string): boolean {
  return !PLAIN_TEXT.has(id) && id !== "random-bytes";
}

function isRecognised(ident: Identification | null): ident is Identification {
  return ident !== null && !UNRECOGNISED.has(ident.id);
}

export function scoreOutput(input: ScoreInput): Scored {
  const { view, parent } = input;
  const ident = identifyData(view);
  const id = ident === null ? null : ident.id;
  const reasons: string[] = [];
  let score: number;
  let newlyRecognised = false;
  let decoded = false;

  if (!input.evidence && parent !== null) {
    score = parent.score;
  } else {
    score = 0;
    const valid = view.utf8Validity === "valid";
    if (valid) {
      score += MAGIC_WEIGHTS.utf8;
      score += MAGIC_WEIGHTS.printable * view.printableShare;
      reasons.push(`valid UTF-8 text, ${pct(view.printableShare)} printable`);
    }
    if (ident !== null && PLAIN_TEXT.has(ident.id)) {
      score += MAGIC_WEIGHTS.plainText;
      reasons.push(`looks like ${ident.name}`);
    }
    const meaningful =
      (valid && view.printableShare >= MEANINGFUL_PRINTABLE) ||
      (isRecognised(ident) && ident.certainty !== "low");
    if (
      input.evidence &&
      meaningful &&
      parent !== null &&
      parent.id !== null &&
      isWrapper(parent.id) &&
      id !== parent.id
    ) {
      score += MAGIC_WEIGHTS.decoded;
      decoded = true;
      reasons.push(`takes apart the ${parent.id} data`);
    }
    const drop = input.rootEntropy - view.entropy;
    if (input.evidence && drop > 0) {
      score += MAGIC_WEIGHTS.entropyDrop * clamp01(drop / ENTROPY_FULL_DROP);
      reasons.push(
        `entropy ${input.rootEntropy.toFixed(1)} to ${view.entropy.toFixed(1)} bits per byte`,
      );
    }
    const share =
      input.outputChecks.length > 0 ? scoreChecks(input.outputChecks, view, "output") : 1;
    if (input.evidence && isRecognised(ident)) {
      score += MAGIC_WEIGHTS.identified * CERTAINTY_FACTOR[ident.certainty];
      reasons.push(`detected as ${ident.name}`);
      newlyRecognised = ident.certainty !== "low" && (parent === null || parent.id !== ident.id);
    }
    if (input.evidence && share < 1) {
      score -= MAGIC_WEIGHTS.outputChecks * (1 - share);
      reasons.push(`output checks ${pct(share)}`);
    }
  }
  if (input.cribMatched) {
    score += MAGIC_WEIGHTS.crib;
    reasons.push("matches the crib");
  }
  score = round6(score);
  const improves =
    input.cribMatched ||
    newlyRecognised ||
    decoded ||
    parent === null ||
    score >= parent.score + MIN_GAIN - EPSILON;
  return { score, reasons, id, newlyRecognised, decoded, improves };
}

/** Is a kept node worth returning, given the score of the search input? */
export function worthReturning(scored: Scored, cribMatched: boolean, rootScore: number): boolean {
  return (
    cribMatched ||
    scored.newlyRecognised ||
    scored.decoded ||
    scored.score >= rootScore + MIN_RESULT_GAIN - EPSILON
  );
}
