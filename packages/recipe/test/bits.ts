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
/** A bit writer for hand-made deflate streams (RFC 1951): fields go low bit first, Huffman codes high bit first. */
export class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private n = 0;

  /** A field of `count` bits, least significant bit first. */
  bits(value: number, count: number): this {
    for (let i = 0; i < count; i++) this.bit((value >> i) & 1);
    return this;
  }

  /** A Huffman code of `len` bits, most significant bit first. */
  code(value: number, len: number): this {
    for (let i = len - 1; i >= 0; i--) this.bit((value >> i) & 1);
    return this;
  }

  /** A literal/length symbol of the fixed code. */
  fixedLit(sym: number): this {
    if (sym < 144) return this.code(0x30 + sym, 8);
    if (sym < 256) return this.code(0x190 + sym - 144, 9);
    if (sym < 280) return this.code(sym - 256, 7);
    return this.code(0xc0 + sym - 280, 8);
  }

  alignToByte(): this {
    while (this.n !== 0) this.bit(0);
    return this;
  }

  bytes(): Uint8Array {
    const copy = [...this.out];
    if (this.n > 0) copy.push(this.acc);
    return Uint8Array.from(copy);
  }

  private bit(b: number): void {
    this.acc |= b << this.n;
    if (++this.n === 8) {
      this.out.push(this.acc);
      this.acc = 0;
      this.n = 0;
    }
  }
}
