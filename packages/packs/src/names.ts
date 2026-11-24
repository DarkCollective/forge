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
import { CORE_EXT_KINDS } from "@forge/lang";
import { INTERNAL_VOCABS } from "@forge/ops";
import type { ManifestEffect } from "./types.js";

/**
 * The pack API level (PACKS section 9, PK20): the contract between core and packs. An incompatible
 * change to the entry interfaces, the viewer and helper contracts, `ExtKind`, `PackIndex` or the
 * registry shapes bumps it. A manifest whose `requires.packApi` differs fails with `requires-api`.
 */
export const PACK_API = 1;

/** The manifest format this package validates. */
export const MANIFEST_FORMAT = 1;

/** Pack ids that no pack may use (PACKS section 2.3). */
export const RESERVED_PACK_IDS: readonly string[] = Object.freeze([
  "core",
  "user",
  "recipe",
  "all",
  "none",
  "packs",
]);

/**
 * The kind names core owns and a pack may never claim (`kind-reserved`, PK3): `table` (`@forge/ops`,
 * T21) and the two the language owns, `null` and `array` (`CORE_EXT_KINDS` of `@forge/lang`).
 */
export const CORE_KIND_NAMES: readonly string[] = Object.freeze(["table", ...CORE_EXT_KINDS]);

/**
 * The vocabulary names core owns that are known without reading the repository: the language's
 * `core`, the user unit's `user` and the internal vocabularies of `@forge/ops`. The vocabulary files
 * and primitive modules of core are passed in `ManifestContext.coreVocabs`.
 */
export const CORE_VOCAB_NAMES: readonly string[] = Object.freeze([
  "core",
  "user",
  ...INTERNAL_VOCABS,
]);

/**
 * The effect labels a manifest may list, in the order of PACKS section 6.2. The list is closed (PK11):
 * `+net` is not defined. It equals the `enum` of the manifest schema, and a test keeps the two equal.
 */
export const MANIFEST_EFFECTS: readonly ManifestEffect[] = Object.freeze([
  "+async",
  "+random",
  "+time",
  "+media",
]);

/** The licences a pack and its `externalCode` may carry (`licence-list`; a proposal of PACKS 2.4). */
export const LICENCE_ALLOW_LIST: readonly string[] = Object.freeze([
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
]);
