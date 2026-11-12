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
// The operations list as data (UI.md section 2.3, WP 3.2). Pure: the component renders this model,
// and the keyboard cursor indexes into `visible`, so the order here is the order on screen.
import type { CatalogueOp } from "@forge/ops";
import { searchOps } from "./search.js";

/** The vocabulary of user words (WP 3.7 promotes recipes into it). Shown in their own group. */
export const USER_VOCAB = "user";

export type SectionKind = "favourites" | "user" | "category" | "results";

export interface ListSection {
  /** Stable key, used for collapse state and element ids: `favourites`, `user`, `category:<name>`, `other`, `results`. */
  readonly id: string;
  readonly kind: SectionKind;
  readonly title: string;
  /** Every operation of the section (after the fit filter, if any), collapsed or not. */
  readonly ops: readonly CatalogueOp[];
  /** Index in `ListModel.visible` of the section's first row (only meaningful when not collapsed). */
  readonly start: number;
  readonly collapsed: boolean;
  /** Sections the user can fold (browse view). Search results always show. */
  readonly collapsible: boolean;
}

export interface ListModel {
  readonly mode: "browse" | "search";
  readonly sections: readonly ListSection[];
  /** Rows on screen, in order: the sections' operations, skipping collapsed sections. */
  readonly visible: readonly CatalogueOp[];
  /** Number of operations matching the query (search mode) or in the catalogue (browse mode), after the filter. */
  readonly total: number;
  /** Number of those operations the `keep` filter hid (0 with no filter). */
  readonly hidden: number;
}

/** Sections that start open in the browse view. Every other section starts collapsed. */
export function opensByDefault(kind: SectionKind): boolean {
  return kind === "favourites" || kind === "user";
}

export const OTHER_TITLE = "Other";
export const USER_TITLE = "User words";
export const FAVOURITES_TITLE = "Favourites";

/** The operations named in `favourites`, in favourite order. Unknown names are skipped. */
export function favouriteOps(
  ops: readonly CatalogueOp[],
  favourites: readonly string[],
): CatalogueOp[] {
  const byName = new Map<string, CatalogueOp>();
  for (const op of ops) byName.set(op.qname, op);
  const out: CatalogueOp[] = [];
  for (const qname of favourites) {
    const op = byName.get(qname);
    if (op !== undefined) out.push(op);
  }
  return out;
}

/**
 * Operations grouped for browsing: user words first, then one group per category in code-point order,
 * with operations that have no category under "Other" last. Order inside a group is the catalogue's.
 */
export function groupByCategory(
  ops: readonly CatalogueOp[],
): { title: string; id: string; ops: CatalogueOp[] }[] {
  const user: CatalogueOp[] = [];
  const byCategory = new Map<string, CatalogueOp[]>();
  const other: CatalogueOp[] = [];
  for (const op of ops) {
    if (op.vocab === USER_VOCAB) {
      user.push(op);
      continue;
    }
    const category = op.category === null || op.category.trim() === "" ? null : op.category;
    if (category === null) {
      other.push(op);
      continue;
    }
    const list = byCategory.get(category);
    if (list === undefined) byCategory.set(category, [op]);
    else list.push(op);
  }
  const groups: { title: string; id: string; ops: CatalogueOp[] }[] = [];
  if (user.length > 0) groups.push({ title: USER_TITLE, id: "user", ops: user });
  const names = [...byCategory.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    groups.push({ title: name, id: `category:${name}`, ops: byCategory.get(name) ?? [] });
  }
  if (other.length > 0) groups.push({ title: OTHER_TITLE, id: "other", ops: other });
  return groups;
}

/**
 * The whole list for the current query and fold state. With a query: the ranked matches in one
 * section. Without: favourites, then the category groups.
 *
 * `overrides` maps a section id to the user's choice (true = open). A section with no choice follows
 * `opensByDefault`: Favourites and User words start open, the categories (and "Other") start closed.
 * `keep`, when given, drops operations it rejects from every section (and from the match count);
 * browse sections left empty by it are not listed, and `hidden` counts what it removed.
 */
export function buildListModel(
  ops: readonly CatalogueOp[],
  favourites: readonly string[],
  query: string,
  overrides: ReadonlyMap<string, boolean> = new Map(),
  keep?: (op: CatalogueOp) => boolean,
): ListModel {
  const raw: {
    id: string;
    kind: SectionKind;
    title: string;
    ops: CatalogueOp[];
    collapsible: boolean;
  }[] = [];
  let mode: "browse" | "search" = "browse";
  let hidden = 0;
  const filter = (list: CatalogueOp[]): CatalogueOp[] => {
    if (keep === undefined) return list;
    const kept = list.filter(keep);
    hidden += list.length - kept.length;
    return kept;
  };

  if (query.trim() !== "") {
    mode = "search";
    raw.push({
      id: "results",
      kind: "results",
      title: "Results",
      ops: filter(searchOps(ops, query)),
      collapsible: false,
    });
  } else {
    // Favourites are counted in `hidden` only through the category groups, so nothing is counted twice.
    const favs = favouriteOps(ops, favourites);
    const favKept = keep === undefined ? favs : favs.filter(keep);
    if (keep === undefined || favKept.length > 0 || favs.length === 0) {
      raw.push({
        id: "favourites",
        kind: "favourites",
        title: FAVOURITES_TITLE,
        ops: favKept,
        collapsible: true,
      });
    }
    for (const group of groupByCategory(ops)) {
      const kind: SectionKind = group.id === "user" ? "user" : "category";
      const kept = filter(group.ops);
      if (keep !== undefined && kept.length === 0) continue;
      raw.push({ id: group.id, kind, title: group.title, ops: kept, collapsible: true });
    }
  }

  const sections: ListSection[] = [];
  const visible: CatalogueOp[] = [];
  let total = 0;
  for (const section of raw) {
    const open = overrides.get(section.id) ?? opensByDefault(section.kind);
    const isCollapsed = section.collapsible && !open;
    sections.push({
      id: section.id,
      kind: section.kind,
      title: section.title,
      ops: section.ops,
      start: visible.length,
      collapsed: isCollapsed,
      collapsible: section.collapsible,
    });
    if (!isCollapsed) visible.push(...section.ops);
    if (section.kind !== "favourites") total += section.ops.length;
  }
  return { mode, sections, visible, total, hidden };
}
