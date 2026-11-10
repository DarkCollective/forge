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
// Pure helpers of the URL state (UI.md WP 3.6; RECIPES.md section 7). No DOM, no I/O.
import type { EncodeShareResult, RecipeIssue, ShareError } from "@forge/recipe";
import type { LinkNotice } from "./ui-state.js";

/** The recipe-only fragment follows recipe edits after this quiet period. */
export const FRAGMENT_DEBOUNCE_MS = 500;

/** The fragment without its leading `#`. */
export function fragmentOf(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

export type HashAction = "none" | "own" | "decode";

/**
 * What to do with `location.hash`: nothing (empty, or an ordinary anchor with no `key=value`),
 * nothing because Forge itself wrote it, or decode it as a share fragment.
 */
export function classifyHash(hash: string, lastWritten: string | null): HashAction {
  const fragment = fragmentOf(hash);
  if (fragment === "") return "none";
  if (lastWritten !== null && fragment === lastWritten) return "own";
  return fragment.includes("=") ? "decode" : "none";
}

export type AutoFragment =
  | { readonly action: "set"; readonly fragment: string }
  /** The recipe holds secrets (key values): keep them out of the address bar and history. */
  | { readonly action: "clear" }
  /** The recipe cannot be encoded now (invalid, too long): leave the address bar as it is. */
  | { readonly action: "keep" };

export function secretWarnings(warnings: readonly RecipeIssue[]): RecipeIssue[] {
  return warnings.filter((w) => w.code === "secret-in-url");
}

/** The decision for the automatic, recipe-only fragment. */
export function autoFragmentFor(result: EncodeShareResult): AutoFragment {
  if (!result.ok) return { action: "keep" };
  if (secretWarnings(result.warnings).length > 0) return { action: "clear" };
  return { action: "set", fragment: result.fragment };
}

/** The URL for `history.replaceState`: same path and query, the given fragment (or none). */
export function urlWithFragment(
  loc: { readonly pathname: string; readonly search: string },
  fragment: string | null,
): string {
  return `${loc.pathname}${loc.search}${fragment === null || fragment === "" ? "" : `#${fragment}`}`;
}

/** The link the share dialog shows (UI.md: origin + pathname + "#" + fragment). */
export function shareUrl(
  loc: { readonly origin: string; readonly pathname: string },
  fragment: string,
): string {
  return `${loc.origin}${loc.pathname}#${fragment}`;
}

function issueLine(issue: RecipeIssue): string {
  return `${issue.code}${issue.path === "" ? "" : ` at ${issue.path}`}: ${issue.message}`;
}

const MAX_DETAILS = 12;

function cap(lines: string[]): string[] {
  if (lines.length <= MAX_DETAILS) return lines;
  return [...lines.slice(0, MAX_DETAILS), `…and ${lines.length - MAX_DETAILS} more`];
}

export function describeShareError(error: ShareError): LinkNotice {
  return {
    severity: "error",
    summary: `This link could not be opened (${error.code}): ${error.message}`,
    details: cap((error.issues ?? []).map(issueLine)),
  };
}

/** A notice for a link that loaded but came with warnings (pin mismatch, alias, catalogue mismatch), or null. */
export function describeWarnings(warnings: readonly RecipeIssue[]): LinkNotice | null {
  if (warnings.length === 0) return null;
  return {
    severity: "warning",
    summary: `The link was opened with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
    details: cap(warnings.map(issueLine)),
  };
}

/** Describe an `encodeShare` failure for the share dialog. */
export function describeEncodeError(error: ShareError): string {
  switch (error.code) {
    case "fragment-too-long":
      return `The link would be too long (${error.message}). Leave out the input or shorten the recipe.`;
    case "input-too-large":
      return `The input is too large to put in a link (${error.message}). Leave it out and share the input another way.`;
    case "invalid-recipe":
      return `The recipe has errors and cannot be shared yet: ${error.message}`;
    default:
      return `The link could not be created (${error.code}): ${error.message}`;
  }
}
