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

/**
 * The FL prelude of `core` (docs/LANGUAGE-0.2.md section 13): twenty `util` words promoted to the
 * core vocabulary, as verbatim copies of the `packages/ops/vocab/util.fth` definitions with
 * `raise:range` replaced by `fail-range`. `createRuntime` loads this unit trusted, into `core`.
 * `_lead-step` is the private helper of `count-leading`.
 *
 * The promoted words are: between? cp>str int>be-bytes space? starts-with? repeat-str pad-hex
 * check-int-range digits>int contains? strip-space trim-end zero-bytes trim-start ends-with?
 * count-leading dec-digit? hex-digit? sum ceil-div.
 */
export const PRELUDE_WORDS: readonly string[] = Object.freeze([
  "space?",
  "between?",
  "check-int-range",
  "cp>str",
  "int>be-bytes",
  "digits>int",
  "ceil-div",
  "sum",
  "dec-digit?",
  "hex-digit?",
  "repeat-str",
  "pad-hex",
  "contains?",
  "starts-with?",
  "ends-with?",
  "strip-space",
  "count-leading",
  "trim-start",
  "trim-end",
  "zero-bytes",
]);

/** The prelude source: one unit, `IN: core`. */
export const PRELUDE_SOURCE: string = String.raw`IN: core

: space? ( b:int -- bool )
  "True for ASCII white space: tab, line feed, vertical tab, form feed, carriage return (9 to 13) and space (32)." doc
  b 32 = b 9 >= b 13 <= and or ;

: between? ( n:int lo:int hi:int -- bool )
  "True when lo <= n <= hi (both ends included)." doc
  n lo >= n hi <= and ;

: check-int-range ( n:int lo:int hi:int what:str -- )
  "Raises E_RANGE unless lo <= n <= hi (both ends included). The message is what, then must be lo to hi, not n: 12 checked against 0 9 for the compression level gives the compression level must be 0 to 9, not 12." doc
  n lo < n hi > or [
    what " must be " cat lo int>str cat " to " cat hi int>str cat ", not " cat n int>str cat fail-range
  ] when ;

: cp>str ( cp:int -- str )
  "The one-character string of a code point (0 to 0x10FFFF, not a surrogate: anything else is the error codes>str raises)." doc
  { cp } codes>str ;

: int>be-bytes ( v:int n:int -- bytes )
  "The low n bytes of v, most significant first (big-endian); higher bytes are dropped and an n of 0 gives no bytes." doc
  0 n range [ n 1 - swap - 8 * v swap shr 255 band ] map list>bytes ;

: digits>int ( vals:bytes radix:int -- int )
  "The integer whose digits are the elements of vals, most significant digit first, in the given radix: a positional fold. Digits are not checked against the radix. Large inputs are bounded by the integer limit (E_LIMIT_VALUE)." doc
  vals 0 [ swap radix * + ] reduce ;

: ceil-div ( n:int d:int -- int )
  "n divided by d, rounded up: the number of groups of d needed for n items (0 for n = 0). d must be positive and n non-negative." doc
  n d 1 - + d div ;

: sum ( xs:list -- int )
  "The sum of a list of integers (0 for the empty list). For a list of floats write the fold yourself." doc
  xs 0 [ + ] reduce ;

: dec-digit? ( c:int -- bool )
  "True for the ASCII decimal digits 0 to 9 (codes 48 to 57)." doc
  c 48 57 between? ;

: hex-digit? ( c:int -- bool )
  "True for an ASCII hexadecimal digit: 0 to 9, A to F or a to f." doc
  c 48 >= c 57 <= and c 65 >= c 70 <= and or c 97 >= c 102 <= and or ;

: repeat-str ( s:str n:int -- str )
  "The text s repeated n times (the empty string for 0)." doc
  0 n range [ drop s ] map "" join ;

: pad-hex ( v:int n:int -- str )
  "The lower-case hex digits of a non-negative integer, left-padded with zeros to at least n digits (never truncated)." doc
  v 16 int>str-radix dup len n <
  [ n over len - dup 16 <= [ "0000000000000000" swap 0 swap slice ] [ "0" swap repeat-str ] if swap cat ]
  when ;

: contains? ( items:list x:any -- bool )
  "True when some element of the list equals x (a linear search; an empty list has nothing)." doc
  items [ x = ] filter len 0 > ;

: starts-with? ( s:str prefix:str -- bool )
  "True when s begins with prefix; false (not an error) when s is shorter than prefix. Every string starts with the empty string." doc
  s len prefix len >= [ s 0 prefix len slice prefix = ] [ false ] if ;

: ends-with? ( s:str suffix:str -- bool )
  "True when s ends with suffix; false (not an error) when s is shorter than suffix." doc
  s len suffix len >= [ s s len suffix len - s len slice suffix = ] [ false ] if ;

: strip-space ( s:str -- str )
  "The text without any of its ASCII white space characters (see space?), wherever they are." doc
  s str>codes [ space? not ] filter codes>str ;

: _lead-step ( acc:int c:int pred:quot -- int )
  acc 0 < [ acc ] [ c pred call [ acc 1 + ] [ acc neg 1 - ] if ] if ;

: count-leading ( items pred:quot -- int )
  "The number of elements at the start of items (a list, bytes or the like) for which pred ( element -- bool ) holds, stopping at the first that fails. Zero for an empty sequence." doc
  items 0 [ pred _lead-step ] reduce
  dup 0 < [ neg 1 - ] when ;

: trim-start ( s:str pred:quot -- str )
  "The text without its leading characters whose code satisfies pred ( code:int -- bool )." doc
  0 [ dup s len < [ dup s swap dup 1 + slice str>codes 0 nth pred call ] [ false ] if ] [ 1 + ] while
  s swap s len slice ;

: trim-end ( s:str pred:quot -- str )
  "The text without its trailing characters whose code satisfies pred ( code:int -- bool )." doc
  s 0 s len s str>codes rev pred count-leading - slice ;

: zero-bytes ( n:int -- bytes )
  "n zero bytes (none for 0)." doc
  0 n range [ drop 0 ] map list>bytes ;
`;
