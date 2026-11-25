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
 * Rendering values for display (RECIPES.md section 8.3), the JSON form used by the vector runner
 * (section 9.1) and the comparison helper `stripTimings` (section 10.3).
 */
import { REDACTED, extText, getExtKind, isSecret, reprShort } from "@forge/lang";
import type { Value } from "@forge/lang";
import { RENDER_LIMITS } from "./types.js";
import type {
  BakeResult,
  OutputToJsonFn,
  OutputValue,
  RenderValueFn,
  StepOutputInfo,
  StripTimingsFn,
} from "./types.js";

/** Values rendered by one call, however the limits above multiply (a list of lists of lists...). */
const MAX_NODES = 100_000;

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function utf8Text(bytes: Uint8Array): string | null {
  if (bytes.length > RENDER_LIMITS.maxTextBytes) return null;
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

/** An `ext` output: the text form cut at the limit with the flag, and the kind's `view` when it has one. */
function extOutput(kind: string, payload: unknown): OutputValue {
  const max = RENDER_LIMITS.maxExtTextChars;
  // Ask for one code unit more than is kept: a longer answer means the text was cut (a kind cuts a
  // longer text to exactly what it was asked for, so "more than max" is the only signal needed).
  let text: string;
  try {
    text = extText(kind, payload, max + 1);
  } catch {
    text = `<ext ${kind}>`;
  }
  const truncated = text.length > max;
  if (truncated) text = text.slice(0, max - 3) + "...";
  const k = getExtKind(kind);
  if (k?.view === undefined) return { kind: "ext", extKind: kind, text, truncated };
  try {
    const view = k.view(payload, { maxRows: RENDER_LIMITS.maxExtRows });
    return view === undefined
      ? { kind: "ext", extKind: kind, text, truncated }
      : { kind: "ext", extKind: kind, text, truncated, view };
  } catch {
    // A kind whose view fails still has its text form; the page shows that.
    return { kind: "ext", extKind: kind, text, truncated };
  }
}

function other(value: Value): OutputValue {
  return { kind: "other", tag: value.tag, repr: reprShort(value, RENDER_LIMITS.maxReprChars) };
}

export const renderValue: RenderValueFn = (value) => {
  let budget = MAX_NODES;
  const render = (v: Value, depth: number): OutputValue => {
    if (--budget < 0) return other(v);
    switch (v.tag) {
      case "bytes":
        if (isSecret(v)) return { kind: "other", tag: "bytes", repr: REDACTED };
        // A copy the result owns exclusively, so that the worker can transfer its buffer.
        return { kind: "bytes", bytes: new Uint8Array(v.v), text: utf8Text(v.v) };
      case "str":
        return { kind: "str", text: v.v };
      case "int":
        return { kind: "int", text: v.v.toString() };
      case "num":
        return { kind: "num", value: v.v };
      case "bool":
        return { kind: "bool", value: v.v };
      case "list": {
        if (depth >= RENDER_LIMITS.maxDepth) return other(v);
        const items = v.v.slice(0, RENDER_LIMITS.maxItems).map((item) => render(item, depth + 1));
        return { kind: "list", items, total: v.v.length };
      }
      case "record": {
        if (depth >= RENDER_LIMITS.maxDepth) return other(v);
        const entries: { key: string; value: OutputValue }[] = [];
        for (const [key, item] of v.v) {
          if (entries.length >= RENDER_LIMITS.maxItems) break;
          entries.push({ key, value: render(item, depth + 1) });
        }
        return { kind: "record", entries, total: v.v.size };
      }
      case "ext":
        return extOutput(v.kind, v.v);
      default:
        return other(v);
    }
  };
  return render(value, 0);
};

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += (b < 16 ? "0" : "") + b.toString(16);
  return out;
}

/** The vector JSON form of an output (RECIPES.md section 9.1). */
export const outputToJson: OutputToJsonFn = (output) => {
  switch (output.kind) {
    case "str":
      return output.text;
    case "bool":
      return output.value;
    case "num":
      return Object.is(output.value, -0) ? { $num: "-0" } : output.value;
    case "int": {
      const n = Number(output.text);
      return Number.isSafeInteger(n) ? n : { $int: output.text };
    }
    case "bytes":
      return { $bytes: hex(output.bytes) };
    case "list": {
      const items = output.items.map(outputToJson);
      if (items.length < output.total) items.push({ $truncated: output.total - items.length });
      return items;
    }
    case "record": {
      const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const { key, value } of output.entries) {
        Object.defineProperty(record, key, {
          value: outputToJson(value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      if (output.entries.length < output.total) {
        record["$truncated"] = output.total - output.entries.length;
      }
      return record;
    }
    case "ext":
      // The text form is what a vector compares (`{ "$ext": kind, "text": ... }`); a cut text says so.
      return output.truncated
        ? { $ext: output.extKind, text: output.text, $truncated: true }
        : { $ext: output.extKind, text: output.text };
    case "other":
      return { $other: output.repr };
  }
};

/** Zero the timings and the id, so results of different hosts can be compared (RECIPES.md section 10.3). */
export const stripTimings: StripTimingsFn = (result) => {
  const stripped = {
    ...result,
    id: 1,
    steps: result.steps.map((s) => ({ ...s, ms: 0 })),
    stats: { ...result.stats, elapsedMs: 0 },
  };
  return stripped as BakeResult;
};

// ---------------------------------------------------------------------------------------------
// The per-step schema (RECIPES-1.2.md section 7.5)
// ---------------------------------------------------------------------------------------------

const INFO_TAGS: ReadonlySet<string> = new Set([
  "bytes",
  "str",
  "int",
  "num",
  "bool",
  "list",
  "record",
  "ext",
]);

const cutChars = (text: string, max: number): string =>
  text.length <= max ? text : [...text].slice(0, max).join("");

/** `[{ name, type }]` from whatever a kind returned, or null when it is not that shape. */
function columnsOf(found: unknown): readonly { name: string; type: string }[] | null {
  if (!Array.isArray(found)) return null;
  const out: { name: string; type: string }[] = [];
  for (const c of found as unknown[]) {
    if (typeof c !== "object" || c === null) return null;
    const { name, type } = c as { name?: unknown; type?: unknown };
    if (typeof name !== "string" || typeof type !== "string") return null;
    out.push({ name, type });
  }
  return out;
}

/**
 * The columns of an ext value: the kind's optional `schema(payload)` (LANGUAGE-0.3.md section 4), which must be
 * O(1) or cached. A kind with no `schema` but a `view` that names its columns (the `table` kind) is asked for a
 * view of no rows. Anything that throws, or has another shape, gives no schema.
 */
function extColumns(
  kind: string,
  payload: unknown,
): readonly { name: string; type: string }[] | null {
  const k = getExtKind(kind);
  if (k === undefined) return null;
  try {
    const schema = (k as unknown as { schema?: unknown }).schema;
    if (typeof schema === "function") {
      return columnsOf((schema as (p: unknown) => unknown).call(k, payload));
    }
    if (k.view === undefined) return null;
    const view = k.view(payload, { maxRows: 0 }) as { columns?: unknown } | undefined;
    return columnsOf(view?.columns);
  } catch {
    return null;
  }
}

/**
 * What a value is, without the value: its tag, and for an ext value its kind and, when the kind has one, its
 * schema (at most `RENDER_LIMITS.maxSchemaColumns` columns, names cut to `RENDER_LIMITS.maxSchemaNameChars`).
 */
export function outputInfo(value: Value): StepOutputInfo {
  if (value.tag !== "ext") return { tag: INFO_TAGS.has(value.tag) ? value.tag : "other" };
  const columns = extColumns(value.kind, value.v);
  if (columns === null) return { tag: "ext", kind: value.kind };
  const max = RENDER_LIMITS.maxSchemaColumns;
  const schema = columns.slice(0, max).map((c) => ({
    name: cutChars(c.name, RENDER_LIMITS.maxSchemaNameChars),
    type: cutChars(c.type, RENDER_LIMITS.maxSchemaNameChars),
  }));
  return columns.length > max
    ? { tag: "ext", kind: value.kind, schema, schemaTruncated: true }
    : { tag: "ext", kind: value.kind, schema };
}
