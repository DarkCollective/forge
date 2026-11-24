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
 * The kinds of LANGUAGE-0.3.md section 17.0 are registered through `src/ext.ts` (this checks that the
 * shapes of ext-fixtures.ts still match `ExtKind` and `registerLiteralTag`) and each passes
 * `kindConformance`.
 */
import { describe, expect, it } from "vitest";
import * as extApi from "../../src/ext.js";
import { getExtKind, getLiteralTag, kindConformance } from "../../src/ext.js";
import { registerExtFixtures } from "./ext-fixtures.js";
import type { ExtRegistryApi } from "./ext-fixtures.js";

registerExtFixtures(extApi as unknown as ExtRegistryApi);

describe("the section 17.0 kinds, registered with src/ext.ts", () => {
  it("registers the three kinds and the two tags", () => {
    expect(["fx-pair", "fx-other", "fx-big"].map((k) => getExtKind(k)?.kind)).toEqual([
      "fx-pair",
      "fx-other",
      "fx-big",
    ]);
    expect(getLiteralTag("pair")?.kind).toBe("fx-pair");
    expect(getLiteralTag("big")?.kind).toBe("fx-big");
  });

  it("fx-pair conforms", () => {
    const k = getExtKind("fx-pair");
    expect(k).toBeDefined();
    expect(
      kindConformance(k as never, {
        small: { a: 1, b: 2 },
        large: { a: 99999, b: -99999 },
        other: { a: 0, b: 0 },
        text: "7,-8",
      }),
    ).toEqual([]);
  });

  it("fx-other conforms", () => {
    expect(kindConformance(getExtKind("fx-other") as never, { small: {}, large: {} })).toEqual([]);
  });

  it("fx-big conforms: sizeOf is the payload and so is a conservative bound of what it holds", () => {
    expect(
      kindConformance(getExtKind("fx-big") as never, {
        small: 10,
        large: 5_000_000,
        other: 11,
        minBytes: (n: number) => n,
      }),
    ).toEqual([]);
  });
});
