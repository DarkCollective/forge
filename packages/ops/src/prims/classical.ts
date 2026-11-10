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
 * classical primitives. Only `_ls47` is a primitive: the LS47 cipher is a sequential state machine
 * (the board and the marker change after every letter) whose step in FL costs about 800
 * interpreter steps per letter, so 64 KiB of text needs about 54 million steps against the default
 * limit of 10 million (measured with the first FL version; see the report of WP 5.9). The step
 * is a few array moves in TypeScript. The key derivation from a password, the validation of the
 * text and the nonce and signature handling stay in FL (vocab/classical.fth). The name starts
 * with `_`, so the word is private and not an operation.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

/** The 49 letters of the standard LS47 board, row by row. */
const ALPHABET = "_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()";

/** Place on the standard board of each byte value, or -1 for a byte that is not a board letter. */
const STANDARD = new Int8Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) STANDARD[ALPHABET.charCodeAt(i)] = i;

/**
 * Encrypt (dec false) or decrypt (dec true) text with an LS47 board of 49 bytes (a permutation of
 * the alphabet). Letters outside the alphabet and an invalid board are E_COERCE.
 */
function ls47(text: Uint8Array, key: Uint8Array, dec: boolean): Uint8Array {
  if (key.length !== 49) throw coerceFailure("LS47 key", "board", "the board needs 49 tiles");
  const board = Uint8Array.from(key);
  const seen = new Set<number>();
  for (const b of board) {
    if ((STANDARD[b] as number) < 0 || seen.has(b)) {
      throw coerceFailure("LS47 key", "board", "the board must use each LS47 letter once");
    }
    seen.add(b);
  }
  const out = new Uint8Array(text.length);
  const sign = dec ? -1 : 1;
  let mr = 0;
  let mc = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as number;
    if ((STANDARD[ch] as number) < 0) {
      throw coerceFailure("text", "LS47 letters", "a character is not in the LS47 alphabet");
    }
    const q = board.indexOf(ch);
    const qr = Math.floor(q / 7);
    const qc = q % 7;
    const t = STANDARD[board[mr * 7 + mc] as number] as number;
    const orow = (((qr + sign * Math.floor(t / 7)) % 7) + 7) % 7;
    const ocol = (((qc + sign * (t % 7)) % 7) + 7) % 7;
    const letter = board[orow * 7 + ocol] as number;
    out[i] = letter;
    const prow = dec ? orow : qr;
    const c = dec ? ch : letter;
    // The row of the plain letter moves one place right (its last tile goes to the front).
    const s = prow * 7;
    const lastTile = board[s + 6] as number;
    for (let j = 6; j > 0; j--) board[s + j] = board[s + j - 1] as number;
    board[s] = lastTile;
    // The column of the cipher letter, found again after that, moves one place down.
    const col = board.indexOf(c) % 7;
    const bottom = board[42 + col] as number;
    for (let r = 6; r > 0; r--) board[r * 7 + col] = board[(r - 1) * 7 + col] as number;
    board[col] = bottom;
    // The marker moves by the offset of the cipher letter.
    const sc = STANDARD[c] as number;
    mr = (mr + Math.floor(sc / 7)) % 7;
    mc = (mc + (sc % 7)) % 7;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("classical", "_ls47", "( text:bytes key:bytes dec:bool -- bytes )", ls47, {
    doc: "The LS47 letter-by-letter cipher on a given board (private helper of classical:ls47-encrypt and ls47-decrypt).",
    category: "Classical ciphers",
  }),
];
