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
import { REDACTED, isSecret, reprShort } from "@forge/lang";
import type { Value } from "@forge/lang";
import { RENDER_LIMITS } from "./types.js";
import type {
  BakeResult,
  OutputToJsonFn,
  OutputValue,
  RenderValueFn,
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
