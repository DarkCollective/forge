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
 * Implicit conversions between ext kinds (RECIPES-1.2.md section 6.9). The compiler, `recipeNeedsHardKill` and the
 * editor all ask the same question, "which words does the compiler insert, and where?", and this is the one answer.
 * The package stays kind-blind: kind names are strings, and the catalogue says which pairs have a conversion.
 */
import { childLists } from "./children.js";
import { opIndex } from "./opindex.js";
import { SLOT_FAMILIES } from "./types.js";
import type {
  CatalogueConversionView,
  CatalogueView,
  Conversion,
  Recipe,
  SlotName,
  Step,
} from "./types.js";

/** `ext{kind}` is the kind; every other type is its own tag. */
function typeName(type: string, kind: string | undefined): string {
  return type === "ext" && kind !== undefined ? kind : type;
}

/** The kind of the data at some point: `null` is unknown, and nothing is inserted for it. */
type Kind = string | null;

/**
 * The conversions the compiler inserts into `recipe` (RECIPES-1.2.md section 6.9), in document order. Only enabled
 * steps are planned, and nothing inside a disabled step. The recipe is expected to be valid: for an op that the
 * catalogue does not know the kind of the data becomes unknown and nothing is inserted after it. A catalogue with no
 * `conversions` gives the empty list.
 */
export function planConversions(recipe: Recipe, catalogue: CatalogueView): Conversion[] {
  const index = opIndex(catalogue);
  const usable = (catalogue.conversions ?? []).filter((c) => index.find(c.op) !== undefined);
  if (usable.length === 0) return [];
  const out: Conversion[] = [];

  const bridge = (
    current: Kind,
    wanted: string | undefined,
    atEnd: boolean,
  ): CatalogueConversionView | undefined => {
    if (current === null || current === wanted) return undefined;
    if (atEnd) return usable.find((c) => c.atEnd === true && c.from === current);
    if (wanted === undefined || wanted === "any") return undefined;
    return usable.find((c) => c.from === current && c.to === wanted);
  };
  const qnameOf = (c: CatalogueConversionView): string =>
    (index.find(c.op) as { op: { qname: string } }).op.qname;

  const walk = (steps: readonly Step[], base: string, entering: Kind): Kind => {
    let current = entering;
    steps.forEach((step, i) => {
      if (step.kind === "comment" || step.disabled === true) return;
      const path = `${base}/${i}`;
      switch (step.kind) {
        case "op": {
          const entry = index.find(step.op);
          if (entry === undefined) {
            current = null;
            return;
          }
          const op = entry.op;
          const family =
            op.slot === undefined ? undefined : SLOT_FAMILIES[op.slot as "right" | "step"];
          const lanes =
            family === undefined ? [] : family.slots.filter((s) => step[s] !== undefined);
          if (family === undefined || lanes.length === 0) {
            const conv = bridge(current, typeName(op.input, op.inputKind), false);
            if (conv !== undefined) {
              out.push({ at: "before", path, op: qnameOf(conv), from: conv.from, to: conv.to });
              current = conv.to;
            }
          } else {
            // The data above is used only when `pipe` names a slot. It feeds the data input or, for `pipe: "right"`,
            // the slot parameter; both are of the kind that the family has.
            const spec = op.params.find((p) => p.name === op.slot);
            const paramKind = typeName(spec?.type ?? "any", spec?.kind);
            const wanted =
              step.pipe === undefined
                ? undefined
                : step.pipe === family.data
                  ? typeName(op.input, op.inputKind)
                  : paramKind;
            const conv = bridge(current, wanted, false);
            if (conv !== undefined) {
              out.push({ at: "before", path, op: qnameOf(conv), from: conv.from, to: conv.to });
              current = conv.to;
            }
            for (const slot of lanes) {
              const lane = step[slot as SlotName] as { steps: readonly Step[] };
              const end = walk(lane.steps, `${path}/${slot}/steps`, current);
              const expected = slot === family.data ? typeName(op.input, op.inputKind) : paramKind;
              const fix = bridge(end, expected, false);
              if (fix !== undefined) {
                out.push({
                  at: "lane-end",
                  path,
                  slot,
                  op: qnameOf(fix),
                  from: fix.from,
                  to: fix.to,
                });
              }
            }
          }
          current = typeName(op.output, op.outputKind);
          return;
        }
        case "register":
          // The body runs on a copy and leaves nothing: the data and its kind are unchanged.
          walk(step.steps, `${path}/steps`, current);
          return;
        default:
          // fork, subsection, repeat and if hand their bodies bytes and leave a value of unknown kind; a return leaves
          // the word, so nothing after it runs.
          for (const child of childLists(step)) walk(child.steps, `${path}/${child.key}`, null);
          current = null;
      }
    });
    return current;
  };

  const last = walk(recipe.steps, "/steps", "bytes");
  const end = bridge(last, undefined, true);
  if (end !== undefined) {
    let path = "";
    recipe.steps.forEach((s, i) => {
      if (s.kind !== "comment" && s.disabled !== true) path = `/steps/${i}`;
    });
    out.push({ at: "end", path, op: qnameOf(end), from: end.from, to: end.to });
  }
  return out;
}
