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
 * sigaba primitive. Only `_run`, the per-letter loop of the machine, is a primitive. Each letter
 * needs 5 passes through the cipher bank and 4 signals through the 5 control rotors (25 rotor
 * passes) plus the stepping of up to 8 rotors. In FL one rotor pass costs about 26 VM steps (measured),
 * so a letter costs several hundred and 64 KiB of text would need tens of millions of steps against
 * the 10 million default budget. All parsing, validation, wiring selection, the index bank and the
 * letter mapping stay in FL (vocab/sigaba.fth); the stepping rules are documented there.
 *
 * Rotor model (vocab/sigaba.fth has the derivation). A rotor has a wiring W (face A contact m is
 * joined to face B contact W[m]) and a window letter p:
 *   forward, signal left to right:   c -> W[(c + p) mod 26] - p       the letter steps p -> p - 1
 *   forward, signal right to left:   c -> Winv[(c + p) mod 26] - p
 *   reversed, signal left to right:  c -> p - Winv[(p - c) mod 26]    the letter steps p -> p + 1
 *   reversed, signal right to left:  c -> p - W[(p - c) mod 26]
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** The index input (0 to 9) that each control output letter (A to Z) feeds. */
const INDEX_INPUT = [9, 1, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8];
/** The cipher rotor (0 leftmost) that each index output (0 to 9) steps. */
const CIPHER_OF_OUTPUT = [0, 4, 4, 3, 3, 2, 2, 1, 1, 0];
/** The control signals F, G, H and I. */
const SIGNALS = [5, 6, 7, 8];
/** The window letter O, at which the slower rotor steps along with the faster one. */
const LETTER_O = 14;

const mod26 = (n: number): number => ((n % 26) + 26) % 26;

function checkPermutation(bytes: Uint8Array, n: number, what: string): void {
  const seen = new Uint8Array(n);
  for (const v of bytes) {
    if (v >= n || seen[v] === 1)
      throw rangeFailure(`${what} is not a permutation of 0 to ${n - 1}`);
    seen[v] = 1;
  }
}

/** One bank of five 26-contact rotors. */
class Bank {
  readonly wire = new Array<Uint8Array>(5);
  readonly inv = new Array<Uint8Array>(5);
  readonly reversed = new Array<boolean>(5);
  readonly pos = new Array<number>(5);

  constructor(wirings: Uint8Array, orient: Uint8Array, pos: Uint8Array, what: string) {
    for (let i = 0; i < 5; i++) {
      const w = wirings.slice(i * 26, i * 26 + 26);
      checkPermutation(w, 26, `${what} rotor wiring`);
      const inv = new Uint8Array(26);
      for (let m = 0; m < 26; m++) inv[w[m] as number] = m;
      this.wire[i] = w;
      this.inv[i] = inv;
      this.reversed[i] = orient[i] === 1;
      const p = pos[i] as number;
      if (p > 25) throw rangeFailure(`${what} rotor position is not a letter`);
      this.pos[i] = p;
    }
  }

  /** Rotor i with the signal going left to right. */
  ltr(i: number, c: number): number {
    const p = this.pos[i] as number;
    if (this.reversed[i] === true) return mod26(p - (this.inv[i] as Uint8Array)[mod26(p - c)]!);
    return mod26((this.wire[i] as Uint8Array)[(c + p) % 26]! - p);
  }

  /** Rotor i with the signal going right to left. */
  rtl(i: number, c: number): number {
    const p = this.pos[i] as number;
    if (this.reversed[i] === true) return mod26(p - (this.wire[i] as Uint8Array)[mod26(p - c)]!);
    return mod26((this.inv[i] as Uint8Array)[(c + p) % 26]! - p);
  }

  step(i: number): void {
    this.pos[i] = mod26((this.pos[i] as number) + (this.reversed[i] === true ? 1 : -1));
  }
}

/**
 * Encipher (or decipher) data, a byte per letter with values 0 to 25.
 * `cipher` and `control` are 5 wirings of 26 bytes, left to right; `state` is 20 bytes: the 5 cipher
 * and 5 control orientations (1 is reversed) and then the 5 cipher and 5 control window letters;
 * `index` is the permutation of 0 to 9 that the whole index bank makes.
 */
function run(
  data: Uint8Array,
  cipherWiring: Uint8Array,
  controlWiring: Uint8Array,
  state: Uint8Array,
  index: Uint8Array,
  decrypt: boolean,
): Uint8Array {
  if (cipherWiring.length !== 130 || controlWiring.length !== 130 || state.length !== 20) {
    throw rangeFailure("sigaba: the rotor tables have the wrong size");
  }
  if (index.length !== 10) throw rangeFailure("sigaba: the index bank has the wrong size");
  checkPermutation(index, 10, "the index bank");
  const cipher = new Bank(cipherWiring, state.slice(0, 5), state.slice(10, 15), "cipher");
  const control = new Bank(controlWiring, state.slice(5, 10), state.slice(15, 20), "control");
  // Which cipher rotor an active index input steps: input -> index permutation -> output -> rotor.
  const stepOfInput = new Array<number>(10);
  for (let i = 0; i < 10; i++)
    stepOfInput[i] = 1 << (CIPHER_OF_OUTPUT[index[i] as number] as number);
  const out = new Uint8Array(data.length);
  for (let n = 0; n < data.length; n++) {
    let x = data[n] as number;
    if (x > 25) throw rangeFailure("sigaba: a letter value is over 25");
    if (decrypt) for (let i = 4; i >= 0; i--) x = cipher.rtl(i, x);
    else for (let i = 0; i < 5; i++) x = cipher.ltr(i, x);
    out[n] = x;
    // The stepping maze: F, G, H and I through the control rotors, right to left.
    let mask = 0;
    for (const signal of SIGNALS) {
      let c = signal;
      for (let i = 4; i >= 0; i--) c = control.rtl(i, c);
      mask |= stepOfInput[INDEX_INPUT[c] as number] as number;
    }
    for (let i = 0; i < 5; i++) if ((mask & (1 << i)) !== 0) cipher.step(i);
    // Control rotors 2 (fast), 3 (medium) and 1 (slow), an odometer that turns over at O.
    const carryMedium = control.pos[2] === LETTER_O;
    control.step(2);
    if (carryMedium) {
      const carrySlow = control.pos[3] === LETTER_O;
      control.step(3);
      if (carrySlow) control.step(1);
    }
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "sigaba",
    "_run",
    "( data:bytes cipher:bytes control:bytes state:bytes index:bytes decrypt:bool -- bytes )",
    run,
    {
      doc: "Run the SIGABA rotor stack over letters 0 to 25 (private helper of sigaba:crypt).",
      category: "Cipher machines",
    },
  ),
];
