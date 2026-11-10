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
import { describe, expect, it } from "vitest";
import { deepElementsFromPoint } from "./dnd.js";

interface Root {
  elementsFromPoint(x: number, y: number): unknown[];
}
const el = (name: string, shadowRoot: Root | null = null) => ({ name, shadowRoot });

describe("deepElementsFromPoint", () => {
  it("looks through shadow roots, innermost first", () => {
    const inner = el("inner");
    const shadow: Root = { elementsFromPoint: () => [inner] };
    const host = el("host", shadow);
    const doc: Root = { elementsFromPoint: () => [host] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([inner, host]);
  });

  it("terminates when a shadow root reports its own host (Chromium)", () => {
    const shadow: Root = { elementsFromPoint: () => [] };
    const host = el("host", shadow);
    shadow.elementsFromPoint = () => [host];
    const doc: Root = { elementsFromPoint: () => [host] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([host]);
  });

  it("lists each element once", () => {
    const a = el("a");
    const shadow: Root = { elementsFromPoint: () => [a] };
    const host = el("host", shadow);
    const doc: Root = { elementsFromPoint: () => [a, host, a] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([a, host]);
  });
});
