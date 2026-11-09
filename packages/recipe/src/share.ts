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
/**
 * The share URL codec (RECIPES.md section 7): `#v=1&r=<m><payload>&i=<m><payload>&ie=<enc>`.
 *
 * The fragment is untrusted. Checks run cheapest first, the first failure wins, inflation has an output budget,
 * and a decoded recipe is validated and rebuilt from a whitelist of keys. Nothing here throws.
 */
import type { EncodingName } from "@forge/lang";
import { deflateRaw, inflateRaw } from "./deflate.js";
import { base64UrlDecode, base64UrlEncode, utf8DecodeStrict, utf8Encode } from "./encoding.js";
import { isEncodedShape, normaliseRecipe, pinOps } from "./normalise.js";
import { opIndex } from "./opindex.js";
import { validateRecipe } from "./validate.js";
import { SHARE_FORMAT_VERSION, SHARE_LIMITS } from "./types.js";
import type {
  CatalogueView,
  DecodeShareOptions,
  DecodeShareResult,
  EncodeShareOptions,
  EncodeShareResult,
  OpStep,
  OpTest,
  Recipe,
  RecipeIssue,
  ShareError,
  ShareErrorCode,
  ShareState,
  Step,
} from "./types.js";

const ENCODINGS: readonly string[] = ["utf8", "hex", "latin1", "base64"];
const VALUE_RE = /^[A-Za-z0-9_-]*$/;
const OTHER_KEY_RE = /^[a-z][a-z0-9]{0,7}$/;
const KNOWN_KEYS: ReadonlySet<string> = new Set(["v", "r", "i", "ie"]);

function fail(
  code: ShareErrorCode,
  message: string,
  issues?: readonly RecipeIssue[],
): { ok: false; error: ShareError } {
  return { ok: false, error: issues === undefined ? { code, message } : { code, message, issues } };
}

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

/** `<m><base64url>`: deflate-raw (method 1) only when strictly shorter than stored (method 0). */
async function payload(bytes: Uint8Array): Promise<string> {
  const stored = `0${base64UrlEncode(bytes)}`;
  try {
    const deflated = `1${base64UrlEncode(await deflateRaw(bytes))}`;
    return deflated.length < stored.length ? deflated : stored;
  } catch {
    return stored;
  }
}

type OpLike = OpStep | OpTest;

/** Calls `visit` for every op step and op test, with its JSON pointer. Iterative. */
function forEachOp(steps: readonly Step[], visit: (op: OpLike, path: string) => void): void {
  const stack: { step: Step; path: string }[] = [];
  for (let i = steps.length - 1; i >= 0; i--)
    stack.push({ step: steps[i] as Step, path: `/steps/${i}` });
  while (stack.length > 0) {
    const { step, path } = stack.pop() as { step: Step; path: string };
    const push = (list: readonly Step[], key: string): void => {
      for (let i = list.length - 1; i >= 0; i--) {
        stack.push({ step: list[i] as Step, path: `${path}/${key}/${i}` });
      }
    };
    switch (step.kind) {
      case "op":
        visit(step, path);
        break;
      case "if":
        if (step.test.kind === "op") visit(step.test, `${path}/test`);
        push(step.then, "then");
        push(step.else ?? [], "else");
        break;
      case "fork":
      case "subsection":
      case "repeat":
        push(step.steps, "steps");
        break;
      case "comment":
        break;
    }
  }
}

/** A `secret-in-url` warning for every `key` parameter that is present and differs from its default. */
function secretWarnings(recipe: Recipe, catalogue: CatalogueView): RecipeIssue[] {
  const index = opIndex(catalogue);
  const out: RecipeIssue[] = [];
  forEachOp(recipe.steps, (op, path) => {
    const entry = index.find(op.op);
    if (entry === undefined || op.params === undefined) return;
    for (const spec of entry.op.params) {
      if (spec.type !== "key" || !Object.hasOwn(op.params, spec.name)) continue;
      const given = (op.params as Record<string, unknown>)[spec.name];
      const def = spec.default;
      const same =
        isEncodedShape(given) &&
        isEncodedShape(def) &&
        given.value === def.value &&
        given.enc === def.enc;
      if (!same) {
        out.push({
          code: "secret-in-url",
          severity: "warning",
          path: `${path}/params/${spec.name}`,
          message: `the key parameter '${spec.name}' would be written into the link`,
          detail: { param: spec.name },
        });
      }
    }
  });
  return out;
}

async function encodeInner(
  state: ShareState,
  options?: EncodeShareOptions,
): Promise<EncodeShareResult> {
  const catalogue = options?.catalogue;
  const checked = validateRecipe(state.recipe, catalogue, { pins: "ignore" });
  if (!checked.ok) return fail("invalid-recipe", "the recipe is not valid", checked.issues);
  const warnings: RecipeIssue[] = [...checked.issues];
  let recipe = checked.recipe;
  if (catalogue !== undefined) {
    recipe = pinOps(recipe, catalogue, true);
    warnings.push(...secretWarnings(recipe, catalogue));
  }
  const recipeBytes = utf8Encode(JSON.stringify(normaliseRecipe(recipe)));
  if (recipeBytes.length > SHARE_LIMITS.maxRecipeBytes) {
    return fail("too-large", `the recipe is larger than ${SHARE_LIMITS.maxRecipeBytes} bytes`);
  }
  let fragment = `v=${SHARE_FORMAT_VERSION}&r=${await payload(recipeBytes)}`;
  if (state.input !== undefined) {
    if (state.input.length > SHARE_LIMITS.maxInputBytes) {
      return fail(
        "input-too-large",
        `the input is larger than ${SHARE_LIMITS.maxInputBytes} bytes`,
      );
    }
    const ie = state.inputEncoding ?? "utf8";
    if (!ENCODINGS.includes(ie)) return fail("malformed", "inputEncoding is not a known encoding");
    fragment += `&i=${await payload(state.input)}&ie=${ie}`;
  }
  if (fragment.length > SHARE_LIMITS.maxFragmentChars) {
    return fail(
      "fragment-too-long",
      `the link is longer than ${SHARE_LIMITS.maxFragmentChars} characters`,
    );
  }
  return { ok: true, fragment, warnings };
}

/** The fragment (without `#`) for a recipe and optionally its input. Validates, pins and normalises first. Never throws. */
export async function encodeShare(
  state: ShareState,
  options?: EncodeShareOptions,
): Promise<EncodeShareResult> {
  try {
    return await encodeInner(state, options);
  } catch {
    return fail("invalid-recipe", "the state could not be encoded");
  }
}

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/** The `key=value` pairs of a fragment, or the error. */
function splitPairs(body: string): Map<string, string> | ShareError {
  const malformed = (message: string): ShareError => ({ code: "malformed", message });
  const parts = body.split("&");
  if (parts.length > SHARE_LIMITS.maxPairs) return malformed("too many pairs");
  const pairs = new Map<string, string>();
  for (const part of parts) {
    const pieces = part.split("=");
    if (pieces.length !== 2) return malformed("each pair is key=value");
    const [key, value] = pieces as [string, string];
    if (!KNOWN_KEYS.has(key) && !OTHER_KEY_RE.test(key)) return malformed("bad key");
    if (value === "" || !VALUE_RE.test(value)) return malformed("bad value");
    if (KNOWN_KEYS.has(key) && pairs.has(key)) return malformed("repeated key");
    if (pairs.size === 0 && key !== "v") return malformed("v must come first");
    pairs.set(key, value);
  }
  return pairs;
}

/** Splits `<m><base64url>` into the method and the bytes. */
function unpack(value: string): { method: "0" | "1"; bytes: Uint8Array } | ShareError {
  const method = value.charAt(0);
  if (method !== "0" && method !== "1")
    return { code: "malformed", message: "unknown payload method" };
  const bytes = base64UrlDecode(value.slice(1));
  if (bytes === null)
    return { code: "bad-base64", message: "the payload is not canonical base64url" };
  return { method, bytes };
}

function isShareError(x: object): x is ShareError {
  return "code" in x;
}

async function expand(
  packed: { method: "0" | "1"; bytes: Uint8Array },
  budget: number,
): Promise<Uint8Array | ShareError> {
  if (packed.method === "0") {
    return packed.bytes.length > budget
      ? { code: "too-large", message: `the payload is larger than ${budget} bytes` }
      : packed.bytes;
  }
  const inflated = await inflateRaw(packed.bytes, budget);
  if (inflated.ok) return inflated.bytes;
  return inflated.reason === "too-large"
    ? { code: "too-large", message: `the payload inflates to more than ${budget} bytes` }
    : { code: "bad-compression", message: "the payload is not a valid deflate stream" };
}

async function decodeInner(
  fragment: string,
  options?: DecodeShareOptions,
): Promise<DecodeShareResult> {
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (body.length > SHARE_LIMITS.maxFragmentChars) {
    return fail(
      "fragment-too-long",
      `the link is longer than ${SHARE_LIMITS.maxFragmentChars} characters`,
    );
  }
  const pairs = splitPairs(body);
  if (!(pairs instanceof Map)) return { ok: false, error: pairs };
  if (pairs.get("v") !== String(SHARE_FORMAT_VERSION)) {
    return fail("unsupported-version", "this link has an unsupported format version");
  }
  const r = pairs.get("r");
  if (r === undefined) return fail("malformed", "r is missing");
  const i = pairs.get("i");
  const ie = pairs.get("ie");
  if (ie !== undefined && (i === undefined || !ENCODINGS.includes(ie))) {
    return fail("malformed", "ie is unknown or has no i");
  }

  const packedRecipe = unpack(r);
  if (isShareError(packedRecipe)) return { ok: false, error: packedRecipe };
  const packedInput = i === undefined ? undefined : unpack(i);
  if (packedInput !== undefined && isShareError(packedInput))
    return { ok: false, error: packedInput };

  const recipeBytes = await expand(packedRecipe, SHARE_LIMITS.maxRecipeBytes);
  if (!(recipeBytes instanceof Uint8Array)) return { ok: false, error: recipeBytes };
  let input: Uint8Array | undefined;
  if (packedInput !== undefined) {
    const expanded = await expand(packedInput, SHARE_LIMITS.maxInputBytes);
    if (!(expanded instanceof Uint8Array)) return { ok: false, error: expanded };
    input = expanded;
  }

  const text = utf8DecodeStrict(recipeBytes);
  if (text === null) return fail("bad-json", "the recipe is not well-formed UTF-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("bad-json", "the recipe is not JSON");
  }
  const checked = validateRecipe(parsed, options?.catalogue, { pins: options?.pins ?? "warn" });
  if (!checked.ok) return fail("invalid-recipe", "the recipe is not valid", checked.issues);
  const inputEncoding = (ie ?? "utf8") as EncodingName;
  return {
    ok: true,
    recipe: normaliseRecipe(checked.recipe),
    ...(input === undefined ? {} : { input }),
    inputEncoding,
    warnings: checked.issues,
  };
}

/** Decodes a fragment (with or without the leading `#`). Never throws; the result is data and nothing is run. */
export async function decodeShare(
  fragment: string,
  options?: DecodeShareOptions,
): Promise<DecodeShareResult> {
  try {
    return await decodeInner(String(fragment), options);
  } catch {
    return fail("malformed", "the fragment could not be decoded");
  }
}
