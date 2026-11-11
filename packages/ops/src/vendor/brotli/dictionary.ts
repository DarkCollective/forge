/* Copyright 2013 Google Inc. All Rights Reserved.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

   Collection of static dictionary words.
*/
// @ts-nocheck: Modified by Darkcollective, LLC, 2026: type-check pragma (vendored upstream JavaScript, brotli 2.1.0; see NOTICE and the vendor note in packages/ops/README.md).


// Modified by Darkcollective, LLC, 2026: output cap. The '#dictionary-data' import of the upstream
// package is replaced by the vendored dictionary.bin (a Brotli stream of the dictionary, as base64
// text, as the upstream browser build reads it). Its size is the known 122,784 bytes, and the decode
// is capped at that size. base64-js is not used: the reader is below.
import { decompress } from './decode.js';
import dictionaryBin from './dictionary-bin.js';

export let dictionary;

const DICTIONARY_SIZE = 122784;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Bytes(text) {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64.indexOf(text[i]);
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

export function init() {
  dictionary = decompress(base64Bytes(dictionaryBin), DICTIONARY_SIZE);
}

export const offsetsByLength = new Uint32Array([
     0,     0,     0,     0,     0,  4096,  9216, 21504, 35840, 44032,
 53248, 63488, 74752, 87040, 93696, 100864, 104704, 106752, 108928, 113536,
 115968, 118528, 119872, 121280, 122016,
]);

export const sizeBitsByLength = new Uint8Array([
  0,  0,  0,  0, 10, 10, 11, 11, 10, 10,
 10, 10, 10,  9,  9,  8,  7,  7,  8,  7,
  7,  6,  6,  5,  5,
]);

export const minDictionaryWordLength = 4;
export const maxDictionaryWordLength = 24;
