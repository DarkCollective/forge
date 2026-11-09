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

/* global setTimeout, clearTimeout, performance */
// Test-only fixture primitives (RECIPES.md section 10.3, G2-4). Plain JavaScript, so that a worker thread
// can import it. Both are catalogue ops of the vocabulary `fx` and return a fresh copy of the data.

/** `( bytes ms:int[0..3600000] -- bytes )`: resolves after `ms` milliseconds, or when the run is aborted. */
function sleep(data, ms, ctx) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(data.slice()), ms);
    ctx.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(data.slice());
      },
      { once: true },
    );
  });
}

/** `( bytes ms:int[0..3600000] -- bytes )`: a synchronous busy-wait that nothing can interrupt. */
function busy(data, ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin
  }
  return data.slice();
}

export const primitives = [
  {
    vocab: "fx",
    name: "sleep",
    effect: "( bytes ms:int[0..3600000] -- bytes )",
    fn: sleep,
    effects: ["+async"],
    doc: "Wait for a number of milliseconds (test fixture).",
    category: "Test",
  },
  {
    vocab: "fx",
    name: "busy",
    effect: "( bytes ms:int[0..3600000] -- bytes )",
    fn: busy,
    doc: "Busy-wait for a number of milliseconds (test fixture).",
    category: "Test",
  },
];
