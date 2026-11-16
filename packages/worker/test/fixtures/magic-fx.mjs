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

/* global performance */
// Test-only fixture primitives for the Magic engine (PLAN.md WP 6.29): operations with no parameters that
// misbehave. Plain JavaScript, so that a worker thread can import it.

/** `( bytes -- bytes )`: a synchronous loop that nothing can interrupt but the watchdog. */
function spin() {
  for (;;) {
    // spin
  }
}

/** `( bytes -- bytes )`: a synchronous busy-wait of 150 ms, then the data reversed. */
function slow(data) {
  const end = performance.now() + 150;
  while (performance.now() < end) {
    // spin
  }
  return data.slice().reverse();
}

export const primitives = [
  {
    vocab: "mfx",
    name: "spin",
    effect: "( bytes -- bytes )",
    fn: spin,
    doc: "Never returns (test fixture).",
    category: "Test",
  },
  {
    vocab: "mfx",
    name: "slow",
    effect: "( bytes -- bytes )",
    fn: slow,
    doc: "Busy-wait 150 ms and reverse the data (test fixture).",
    category: "Test",
  },
];
