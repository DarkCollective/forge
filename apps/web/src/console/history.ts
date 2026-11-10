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
// Input history for the console line (Up/Down). Pure and in memory only: the session is not persisted.

export class CommandHistory {
  private readonly entries: string[] = [];
  /** Position in `entries`; `entries.length` means "the line being typed". */
  private index = 0;
  private draft = "";

  constructor(private readonly max = 200) {}

  get size(): number {
    return this.entries.length;
  }

  /** Record a submitted line (blank lines and immediate repeats are skipped) and return to the end. */
  push(line: string): void {
    const text = line.trimEnd();
    if (text.trim() !== "" && this.entries[this.entries.length - 1] !== text) {
      this.entries.push(text);
      if (this.entries.length > this.max) this.entries.shift();
    }
    this.index = this.entries.length;
    this.draft = "";
  }

  /** Up: the previous entry, or `undefined` at the oldest one. `current` is kept as the draft on leaving the end. */
  previous(current: string): string | undefined {
    if (this.entries.length === 0 || this.index === 0) return undefined;
    if (this.index === this.entries.length) this.draft = current;
    this.index -= 1;
    return this.entries[this.index];
  }

  /** Down: the next entry, then the draft; `undefined` when already at the draft. */
  next(): string | undefined {
    if (this.index >= this.entries.length) return undefined;
    this.index += 1;
    return this.index === this.entries.length ? this.draft : this.entries[this.index];
  }

  /** Forget the navigation position (for example after the user edits a recalled line). */
  resetPosition(): void {
    this.index = this.entries.length;
    this.draft = "";
  }
}
