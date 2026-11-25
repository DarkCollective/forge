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
 * The rules for the named inputs of a bake (RECIPES-1.2.md section 7.2), in one place: the client applies them
 * before a message is sent and the core applies them on receipt, so the in-process baker, the client and the
 * worker give the same answer. A violation is a bad request (`E_PROTOCOL`), not a recipe error.
 */
import { BAKE_INPUT_LIMITS } from "./types.js";
import type { BakeError, BakeInput } from "./types.js";

/** True for a name with a C0 or C1 control character or a surrogate that is not half of a pair. */
function malformed(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x80 && c <= 0x9f)) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = name.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Longest name echoed in `detail.name`, in code points. */
const ECHO_CHARS = BAKE_INPUT_LIMITS.maxInputNameChars;

function echo(name: string): string {
  return [...name].slice(0, ECHO_CHARS).join("");
}

/** True when `name` is a legal tab name: 1 to 120 code points, well-formed UTF-16, no control character. */
export function isInputName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false;
  // A string longer than the limit in UTF-16 units may still be short in code points, but never beyond 2x.
  if (name.length > BAKE_INPUT_LIMITS.maxInputNameChars * 2) return false;
  if (malformed(name)) return false;
  return [...name].length <= BAKE_INPUT_LIMITS.maxInputNameChars;
}

function protocolError(message: string, reason: string, name?: string): BakeError {
  return {
    code: "E_PROTOCOL",
    message,
    path: null,
    word: null,
    detail: name === undefined ? { reason } : { reason, name: echo(name) },
  };
}

/**
 * The first rule that `inputs` breaks, as a `BakeError`, or null. `mainBytes` is the size of the bake's main
 * input and `maxTotalBytes` the effective `limits.maxTotalBytes`: together with all the named inputs they may not
 * exceed it.
 */
export function checkBakeInputs(
  inputs: readonly BakeInput[] | undefined,
  mainBytes: number,
  maxTotalBytes: number,
): BakeError | null {
  if (inputs === undefined) return null;
  if (inputs.length > BAKE_INPUT_LIMITS.maxInputs) {
    return protocolError(
      `a bake may have at most ${BAKE_INPUT_LIMITS.maxInputs} named inputs, it has ${inputs.length}`,
      "input-count",
    );
  }
  const seen = new Set<string>();
  let total = mainBytes;
  for (const input of inputs) {
    if (!isInputName(input.name)) {
      return protocolError(
        `the name of an input must be 1 to ${BAKE_INPUT_LIMITS.maxInputNameChars} characters with no control character`,
        "input-name",
        typeof input.name === "string" ? input.name : "",
      );
    }
    if (seen.has(input.name)) {
      return protocolError(
        `two inputs are named '${echo(input.name)}'`,
        "input-duplicate",
        input.name,
      );
    }
    seen.add(input.name);
    total += input.bytes.length;
  }
  if (total > maxTotalBytes) {
    return protocolError(
      `the inputs hold ${total} bytes, more than the limit of ${maxTotalBytes}`,
      "input-size",
    );
  }
  return null;
}
