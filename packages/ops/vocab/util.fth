\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ util: shared FL helpers for the operation vocabularies. This vocabulary is internal (it is in
\ INTERNAL_VOCABS), so its words are callable from every vocabulary (util:name, or USING: util) but
\ are never listed in the catalogue and have no category. Private (_) words cannot be called across
\ vocabularies, so anything more than one vocabulary needs belongs here: check util before writing a
\ helper, and move a helper here when a second vocabulary wants it (npm run dupes finds copies).
IN: util

: space? ( b:int -- bool )
  "True for ASCII white space: tab, line feed, vertical tab, form feed, carriage return (9 to 13) and space (32)." doc
  b 32 = b 9 >= b 13 <= and or ;

: between? ( n:int lo:int hi:int -- bool )
  "True when lo <= n <= hi (both ends included)." doc
  n lo >= n hi <= and ;

: check-int-range ( n:int lo:int hi:int what:str -- )
  "Raises E_RANGE unless lo <= n <= hi (both ends included). The message is what, then must be lo to hi, not n: 12 checked against 0 9 for the compression level gives the compression level must be 0 to 9, not 12." doc
  n lo < n hi > or [
    what " must be " cat lo int>str cat " to " cat hi int>str cat ", not " cat n int>str cat raise:range
  ] when ;

: cp>str ( cp:int -- str )
  "The one-character string of a code point (0 to 0x10FFFF, not a surrogate: anything else is the error codes>str raises)." doc
  { cp } codes>str ;

\ The table entry of byte b: its index in alpha, else ws or pad, else 255.
: _code-of ( b:int alpha:str ws:int pad:int -- int )
  alpha b cp>str split dup len 2 = [ 0 nth len ]
  [ drop b 61 = [ pad ] [ b space? [ ws ] [ 255 ] if ] if ] if ;

: surrogate? ( cp:int -- bool )
  "True for a UTF-16 surrogate code point, U+D800 to U+DFFF (55296 to 57343): not a character on its own." doc
  cp 55296 57343 between? ;

: _code-chunks ( codes:list n:int -- list )
  0 codes len n + 1 - n div range [ n * dup n + codes len min codes -rot slice codes>str ] map ;

\ str-chunks slices the list of code points, not the string: slicing a string at a code point offset costs time in
\ proportion to the offset, which made a 64 KiB string cut at 7 take seconds.
: str-chunks ( s:str n:int -- list )
  "The pieces of s of n characters each, in order; the last one is shorter when n does not divide the length. The empty string gives no pieces. n must be at least 1." doc
  s str>codes n _code-chunks ;

: decode-table ( alpha:str ws:int pad:int -- bytes )
  "A 256-byte lookup table for translate: entry b is the index of byte b in alpha. A byte outside alpha gives ws for ASCII white space, pad for = and 255 otherwise; pass 255 for a marker you do not need." doc
  0 256 range [ alpha ws pad _code-of ] map list>bytes ;

: separator ( choice:str -- str )
  "The text for a delimiter choice: none gives the empty string, comma a comma, newline a line feed and anything else (space) a space." doc
  choice "none" = [ "" ]
  [ choice "comma" = [ "," ] [ choice "newline" = [ "\n" ] [ " " ] if ] if ] if ;

: delimiter ( choice:str -- str )
  "The text for a delimiter choice of the wave 5 list and line ops: space (one space), comma, semicolon, colon, newline (a line feed, U+000A), crlf (carriage return then line feed), cr (a lone carriage return), tab and none (the empty string). Anything else is E_RANGE. Use the header form delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab|none}=\"newline\" (see the ops README, Wave 5 conventions). Unlike separator, an unknown choice is an error." doc
  choice "space" = [ " " ] [
  choice "comma" = [ "," ] [
  choice "semicolon" = [ ";" ] [
  choice "colon" = [ ":" ] [
  choice "newline" = [ "\n" ] [
  choice "crlf" = [ "\r\n" ] [
  choice "cr" = [ "\r" ] [
  choice "tab" = [ "\t" ] [
  choice "none" = [ "" ] [
  "unknown delimiter choice (use space, comma, semicolon, colon, newline, crlf, cr, tab or none)" raise:range ""
  ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

: space-or-comma? ( b:int -- bool )
  "True for the separators of numeric text: ASCII white space (see space?) and the comma (44)." doc
  b 44 = b space? or ;

: check-symbols ( data:bytes table:bytes -- bytes )
  "Translate data through a decode table (see decode-table) and raise E_COERCE (a character is not in the alphabet) if any byte maps to 255. The translated bytes are returned with any other marker (white space, padding) left in place for the caller to handle. A constant number of interpreter steps for any length: the marker is looked for in the Latin-1 text of the bytes." doc
  data table translate
  dup bytes>latin1 255 cp>str split len 1 >
  [ "a character is not in the alphabet" raise:coerce ] when ;

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

\ ---- characters and text ----

: dec-digit? ( c:int -- bool )
  "True for the ASCII decimal digits 0 to 9 (codes 48 to 57)." doc
  c 48 57 between? ;

: hex-digit? ( c:int -- bool )
  "True for an ASCII hexadecimal digit: 0 to 9, A to F or a to f." doc
  c 48 >= c 57 <= and c 65 >= c 70 <= and or c 97 >= c 102 <= and or ;

: byte>hex ( b:int -- str )
  "Two upper-case hex digits of a byte 0 to 255, e.g. 0A or FF." doc
  b 256 + 16 int>str-radix 1 3 slice upper ;

: repeat-str ( s:str n:int -- str )
  "The text s repeated n times (the empty string for 0)." doc
  0 n range [ drop s ] map "" join ;

: pad-hex ( v:int n:int -- str )
  "The lower-case hex digits of a non-negative integer, left-padded with zeros to at least n digits (never truncated)." doc
  v 16 int>str-radix dup len n <
  [ n over len - dup 16 <= [ "0000000000000000" swap 0 swap slice ] [ "0" swap repeat-str ] if swap cat ]
  when ;

: zero-pad ( n:int w:int -- str )
  "The decimal digits of a non-negative integer, left-padded with zeros to at least w digits (never cut): 7 and 3 give 007, 1234 and 2 give 1234." doc
  "0" w n int>str len - 0 max repeat-str n int>str cat ;

: ordinal-suffix ( n:int -- str )
  "The English ordinal suffix of a non-negative integer: st, nd, rd or th (1 gives st, 2 nd, 3 rd, 11 to 13 th, 21 st, 111 th)." doc
  n 100 mod dup 11 >= swap 13 <= and
  [ "th" ]
  [ n 10 mod dup 1 = [ drop "st" ] [ dup 2 = [ drop "nd" ] [ 3 = [ "rd" ] [ "th" ] if ] if ] if ] if ;

: tdiv ( a:int b:int -- int )
  "Integer division that rounds towards zero (div rounds down, so -7 2 div is -4 and -7 2 tdiv is -3). b must be positive." doc
  a 0 < [ a neg b div neg ] [ a b div ] if ;

: round-div ( n:int d:int -- int )
  "n divided by d, rounded to the nearest integer, halves up. n must not be negative and d must be positive." doc
  n 2 * d + d 2 * div ;

: contains? ( items:list x:any -- bool )
  "True when some element of the list equals x (a linear search; an empty list has nothing)." doc
  items [ x = ] filter len 0 > ;

: total-text ( items:list total:bool -- str )
  "The items one per line; with total true, a line Total found: N (N is the number of items) and a blank line go in front. The output of the extractors and the date finder." doc
  items "\n" join
  total [ "Total found: " items len int>str cat "\n\n" cat swap cat ] when ;

: match-texts ( s:str pattern:str flags:str -- list )
  "The text of every match of a regular expression in s, in order, as a list of strings (regex:find-all keeps position and groups too; this keeps the text only). flags are the regex flags, empty for none." doc
  s pattern flags regex:find-all [ "text" get ] map ;

: starts-with? ( s:str prefix:str -- bool )
  "True when s begins with prefix; false (not an error) when s is shorter than prefix. Every string starts with the empty string." doc
  s len prefix len >= [ s 0 prefix len slice prefix = ] [ false ] if ;

: ends-with? ( s:str suffix:str -- bool )
  "True when s ends with suffix; false (not an error) when s is shorter than suffix." doc
  s len suffix len >= [ s s len suffix len - s len slice suffix = ] [ false ] if ;

: strip-space ( s:str -- str )
  "The text without any of its ASCII white space characters (see space?), wherever they are." doc
  s str>codes [ space? not ] filter codes>str ;

\ ---- scanning and trimming ----

\ Fold step of count-leading: acc >= 0 is still counting, acc < 0 is -(count) - 1 once pred failed.
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

\ ---- numeric text ----

: number-tokens ( s:str -- list )
  "The tokens of numeric text: s split at runs of ASCII white space and commas (see space-or-comma?), empty pieces dropped." doc
  s str>codes [ dup space-or-comma? [ drop 32 ] when ] map codes>str " " split
  [ len 0 > ] filter ;

\ One unsigned byte value written in the radix; anything else is E_COERCE with msg.
: _byte-number ( t:str radix:int msg:str -- int )
  t 0 1 slice "-" = [ msg raise:coerce ] when
  t radix str>int-radix
  dup 255 > [ msg raise:coerce ] when ;

: numbers>bytes ( data:bytes radix:int msg:str -- bytes )
  "Decode text of byte values written in the radix (2 to 36), separated by white space and/or commas (see number-tokens), to bytes. A value that is negative, not a number of the radix or over 255 is E_COERCE with the message msg." doc
  data bytes>latin1 number-tokens [ radix msg _byte-number ] map list>bytes ;

\ ---- hex escapes ----

\ p is the text after an escape introducer: the byte of its two leading hex digits (E_COERCE with
\ msg if either is not one), then the rest of p as Latin-1 bytes.
: _hex-escape ( p:str msg:str -- bytes )
  p len 2 < [ msg raise:coerce ] when
  p 0 1 slice "-" = [ msg raise:coerce ] when
  [ p 0 2 slice 16 str>int-radix ] [ drop -1 ] try
  dup 0 < [ msg raise:coerce ] when
  { } swap append list>bytes
  p 2 p len slice latin1>bytes cat ;

: _unescape-pieces ( pieces:list msg:str -- bytes )
  pieces 0 nth latin1>bytes
  pieces 1 pieces len slice [ msg _hex-escape ] map #[ ] bjoin cat ;

: hex-unescape ( s:str marker:str msg:str -- bytes )
  "Decode text in which each marker (for example % or =) introduces two hex digits (either case) that stand for one byte: the text is read as Latin-1 and the escapes are replaced by their bytes. A marker not followed by two hex digits is E_COERCE with the message msg." doc
  s marker split msg _unescape-pieces ;

\ ---- bytes and integers ----

: text-lossless ( b:bytes -- str )
  "The bytes as text without ever failing: UTF-8 when they are valid UTF-8, otherwise Latin-1 (one character per byte). For names in container formats (zip, tar), which are UTF-8 in newer files and the local code page in older ones." doc
  [ b bytes>str ] [ drop b bytes>latin1 ] try ;

: le-int ( data:bytes p:int n:int -- int )
  "The n bytes of data at p read as one little-endian unsigned integer (the first byte is the least significant; n of 0 gives 0). The caller has checked that the bytes are there: a read past the end is the slice error (use need-bytes first)." doc
  data p p n + slice rev 256 digits>int ;

: need-bytes ( data:bytes p:int n:int what:str -- )
  "Raises E_COERCE with the message what then is cut short unless data holds n bytes from offset p (a truncated file). what names the data, for example gzip data." doc
  p n + data len > [ what " is cut short" cat raise:coerce ] when ;

: names-of ( records:list -- list )
  "The name field of each record of a list, in order (the entries of an archive)." doc
  records [ "name" get ] map ;

\ E_RANGE for a name that is not there: it lists the first entries (the first eight) to help.
: _no-entry-named ( records:list name:str -- )
  records len 0 = [ "there are no entries, so there is no entry named " name cat raise:range ] when
  "no entry named " name cat ", the first entries are: " cat
  records names-of 0 records len 8 min slice ", " join cat raise:range ;

: pick-named ( records:list name:str -- record )
  "The first record of a list whose name field is exactly name. A name that is not there is E_RANGE, and the message lists the first eight names." doc
  0 records len range [ records swap nth "name" get name = ] filter
  dup len 0 = [ records name _no-entry-named ] when
  0 nth records swap nth ;

: zero-bytes ( n:int -- bytes )
  "n zero bytes (none for 0)." doc
  0 n range [ drop 0 ] map list>bytes ;

: byte-at ( d j:int -- int )
  "The element j of d (bytes, or a list of ints), or 0 past the end." doc
  j d len < [ d j nth ] [ 0 ] if ;

: bit-field ( d:bytes p:int n:int -- int )
  "The n bits (n up to 13) of d starting at bit position p (most significant bit first), zero padded past the end of d." doc
  d p 8 div byte-at 16 shl d p 8 div 1 + byte-at 8 shl bor d p 8 div 2 + byte-at bor
  24 p 8 mod - n - shr 1 n shl 1 - band ;

: nibbles>byte ( nibs i:int -- int )
  "Byte i made of two elements of nibs (a list or bytes of values 0 to 15): element 2i is the high nibble and 2i + 1 the low." doc
  nibs i 2 * nth 4 shl nibs i 2 * 1 + nth bor ;

: int>bytes ( n:int -- bytes )
  "The big-endian bytes of a non-negative integer, as few as possible: none at all for 0. Linear in the length (it goes through hex text)." doc
  n 0 =
  [ #[ ] ]
  [ n 16 int>str-radix dup len 2 mod 1 = [ "0" swap cat ] when hex>bytes ] if ;

\ Adds the symbol for n mod radix in front of acc, and gives n div radix.
: _symbol-step ( acc:bytes n:int alpha:bytes radix:int -- bytes int )
  acc { alpha n radix mod nth } list>bytes cat n radix div ;

: int>symbols ( n:int alpha:bytes -- bytes )
  "The digits of a non-negative integer written with the bytes of alpha as symbols, the radix being the length of alpha, most significant first; none for 0." doc
  #[ ] n [ dup 0 > ] [ alpha alpha len _symbol-step ] while drop rev ;

\ The big-endian integer of the digits (for a bytes with zero-prefix use).
: bytes>symbols ( data:bytes alpha:bytes -- bytes )
  "Big-integer radix conversion for Base58 and Base62 style text. The data is one big-endian integer written with the bytes of alpha as symbols (radix = the length of alpha), and each leading zero byte is one more copy of the first symbol. The integer limit of the language applies (E_LIMIT_VALUE)." doc
  0 data [ 0 = ] count-leading range [ drop alpha 0 nth ] map list>bytes
  data bytes>hex "0" swap cat 16 str>int-radix alpha int>symbols cat ;

\ z zero bytes, then the bytes of n.
: _zero-prefixed ( z:int n:int -- bytes )
  z zero-bytes n int>bytes cat ;

: symbols>bytes ( data:bytes table:bytes radix:int -- bytes )
  "The inverse of bytes>symbols. table is a decode table (see decode-table) built with 254 for white space and 255 for a byte outside the alphabet: an unknown symbol is E_COERCE and white space is ignored. Each leading zero digit becomes a zero byte. The integer limit applies (E_LIMIT_VALUE)." doc
  data table check-symbols [ 254 <> ] filter
  dup [ 0 = ] count-leading swap radix digits>int _zero-prefixed ;

\ ---- lists and byte searches ----

: list-flatten ( ll:list -- list )
  "The elements of a list of lists (or of bytes) joined in order into one list: one level of nesting removed. An empty ll gives the empty list." doc
  ll { } [ cat ] reduce ;

: contains-bytes? ( data:bytes needle:bytes -- bool )
  "True when data holds the bytes of needle side by side, in order; an empty needle is always found. The search is done on the Latin-1 text of both, so it takes a few interpreter steps for any length." doc
  needle len 0 =
  [ true ]
  [ data bytes>latin1 needle bytes>latin1 split len 1 > ]
  if ;

: drop-byte ( data:bytes b:int -- bytes )
  "The bytes of data without any byte equal to b (0 to 255). Done on the Latin-1 text, so it takes a few interpreter steps for any length." doc
  data bytes>latin1 b cp>str split "" join latin1>bytes ;

: popcount-26 ( m:int -- int )
  "How many of the low 26 bits of m are set: the size of a set of letters held as a bit mask (bit 0 = A)." doc
  0 26 range 0 [ m swap shr 1 band + ] reduce ;

\ ---- letters, permutations and rotor machines ----

: letter? ( c:int -- bool )
  "True for an ASCII letter, A to Z or a to z." doc
  c 32 bor 97 - dup 0 >= swap 25 <= and ;

: letters? ( t:str -- bool )
  "True when t is not empty and every character is an ASCII letter (either case)." doc
  t str>bytes [ letter? not ] filter len 0 = t len 0 > and ;

: digits? ( t:str -- bool )
  "True when t is not empty and every character is an ASCII decimal digit." doc
  t str>bytes [ dec-digit? not ] filter len 0 = t len 0 > and ;

: letter-indices ( s:str -- bytes )
  "The letters of s (either case) as numbers 0 to 25, A = 0. A character that is not a letter gives a meaningless number, so check with letters? first; a character above U+00FF is E_RANGE." doc
  s upper latin1>bytes [ 65 - ] map ;

: digit-values ( s:str -- bytes )
  "The digits of s as numbers 0 to 9. A character that is not a digit gives a meaningless number, so check with digits? first; a character above U+00FF is E_RANGE." doc
  s latin1>bytes [ 48 - ] map ;

: letter-table ( -- bytes )
  "A 256-byte table for translate: a letter byte (either case) becomes its number 0 to 25, every other byte 255." doc
  0 256 range [ dup 32 bor 97 - dup 0 >= over 25 <= and [ nip ] [ drop drop 255 ] if ] map list>bytes ;

: letter-numbers ( s:str -- bytes )
  "The letters of s (either case) as numbers 0 to 25, A = 0, with every other character dropped. Unlike letter-indices it accepts any text." doc
  s str>bytes letter-table translate [ 255 <> ] filter ;

: count-of ( items x:any -- int )
  "How many elements of items (bytes or a list of any values) equal x (compared with =)." doc
  items [ x = ] filter len ;

: index-of ( p:bytes i:int -- int )
  "The position of the first element of p equal to i; E_RANGE when there is none. For a permutation this is the inverse permutation at i." doc
  0 p len range [ p swap nth i = ] filter 0 nth ;

: perm-invert ( p:bytes -- bytes )
  "The inverse of a permutation of 0 to len-1 given as bytes: element p[i] = j becomes element j = i. E_RANGE if p is not a permutation." doc
  0 p len range [ p swap index-of ] map list>bytes ;

: perm? ( items n:int -- bool )
  "True when items (a list or bytes of ints) has exactly n elements and uses each of 0 to n-1 once. n up to 65000 or so (the check is a bit mask)." doc
  items len n = items 0 [ 1 swap shl bor ] reduce 1 n shl 1 - = and ;

: table-compose3 ( p:bytes f1:bytes f2:bytes -- bytes )
  "The 26-byte table of x -> f2[f1[p[x]]]: three 26-byte permutations applied in turn, p first." doc
  0 26 range [ p swap nth f1 swap nth f2 swap nth ] map list>bytes ;

: rotor-shifted ( w:bytes s:int -- bytes )
  "The 26-byte table of a rotor with wiring w (a permutation of 0 to 25, input contact to output contact) turned by shift s (window position minus ring setting): x -> (w[(x + s) mod 26] - s) mod 26. Use perm-invert of w for the signal going the other way." doc
  0 26 range [ s + 26 mod w swap nth s - 26 mod ] map list>bytes ;

: rotor-shift-table ( w:bytes -- bytes )
  "The 676-byte table of a rotor for every shift: entry s*26 + x is rotor-shifted of w at s, for x. A machine keeps s*26 as the row offset of each rotor and steps it with (offset + 26) mod 676." doc
  0 676 range [ dup 26 div swap 26 mod over + 26 mod w swap nth swap - 26 mod ] map list>bytes ;

: rotor-notch-flags ( turn:bytes ring:int -- bytes )
  "A 676-byte flag table for a rotor stepped by row offset (see rotor-shift-table). turn holds the window positions 0 to 25 of its turnover notches (any number, or none); ring is the ring setting 0 to 25. Entry s*26 is 1 when the window position (s + ring) mod 26 is a notch, every other entry is 0." doc
  0 676 range
  [ dup 26 mod 0 =
    [ 26 div ring + 26 mod turn swap count-of 0 > [ 1 ] [ 0 ] if ]
    [ drop 0 ] if ]
  map list>bytes ;

: rotor-reflect-table ( r:bytes fl:bytes il:bytes -- bytes )
  "A 676-byte table for the rotor next to the reflector: for each shift s and contact x, the signal goes through the rotor (fl, a rotor-shift-table), then the fixed 26-byte permutation r (a reflector, possibly with fixed rotors folded in), then back through the rotor (il, the rotor-shift-table of its inverse wiring)." doc
  0 676 range [ dup dup 26 mod - swap fl swap nth r swap nth + il swap nth ] map list>bytes ;

\ The value 0 to 25 of one setting token: a number 1 to 26 or a single letter.
: _setting-token ( t:str what:str -- int )
  t digits?
  [ t len 3 < [ t str>int 1 - ] [ -1 ] if
    dup 0 < over 25 > or [ what ": a number must be 1 to 26" cat raise:range ] when ]
  [ t len 1 = t letters? and
    [ t str>bytes 0 nth 32 bor 97 - ]
    [ what ": write letters (BUL), letters apart (B U L) or numbers 1 to 26 (2 21 12)" cat raise:range 0 ] if ]
  if ;

: letter-settings ( s:str n:int what:str -- bytes )
  "Machine settings (ring settings, start positions) as n numbers 0 to 25: one word of n letters (BUL), or n tokens separated by white space or commas, each a letter or a number 1 to 26 (B U L, 2 21 12). The wrong count or a bad token is E_RANGE with a message that starts with what." doc
  s number-tokens
  dup len 0 = [ what ": the setting is empty" cat raise:range ] when
  dup len 1 = over 0 nth letters? and
  [ 0 nth str>bytes [ 32 bor 97 - ] map ]
  [ [ what _setting-token ] map list>bytes ] if
  dup len n <>
  [ what ": " cat n int>str cat " settings are needed" cat raise:range ] when ;

\ The partner of letter i in a flat list of plugboard letters (pairs side by side), else i.
: _plug-partner ( i:int fl:bytes -- int )
  0 fl len range [ fl swap nth i = ] filter
  dup len 0 = [ drop i ] [ 0 nth 1 bxor fl swap nth ] if ;

: _plug-pair ( t:str -- bytes )
  t len 2 = t letters? and not
  [ "plugboard: each pair is two letters, like AB" raise:range ] when
  t letter-indices ;

: plugboard-table ( s:str -- bytes )
  "A plugboard written as letter pairs (AB CD EF, separated by white space or commas, either case) as a 26-byte permutation that swaps each pair and leaves the other letters alone. A group that is not two different letters, or a letter used twice, is E_RANGE." doc
  s number-tokens [ _plug-pair ] map #[ ] [ cat ] reduce
  0 26 range [ over swap count-of 1 > ] filter len 0 >
  [ "plugboard: a letter may be in one pair only" raise:range ] when
  0 26 range [ over _plug-partner ] map list>bytes nip ;

\ ---- cycles and teleprinter (ITA2) text ----

: cycle-bytes ( pat:bytes start:int n:int -- bytes )
  "n bytes of the endless repetition of pat, the first being pat[start] (start counted from 0, below the length of pat). Built by doubling, so it is linear in n; n 0 gives no bytes." doc
  pat [ dup len start n + < ] [ dup cat ] while
  start start n + slice ;

: ita2-alphabet ( -- str )
  "The 32 teleprinter characters (ITA2) in Bletchley Park notation, ordered by their five-bit code (impulse 1 is bit 0): / null, E, 4 line feed, A, 9 space, S, I, U, 3 carriage return, D, R, J, N, F, C, K, T, Z, L, W, H, Y, P, Q, O, B, G, 5 figure shift, M, X, V, 8 letter shift." doc
  "/E4A9SIU3DRJNFCKTZLWHYPQOBG5MXV8" ;

: ita2-code ( u:int tbl:bytes -- int )
  "The code of a Bletchley Park character: u is its upper-case byte and tbl the table of ita2-alphabet from decode-table. + gives 27 (figure shift) and - gives 31 (letter shift); otherwise the table entry (254 white space, 255 not a character)." doc
  u 43 = [ 27 ] [ u 45 = [ 31 ] [ tbl u nth ] if ] if ;

: ita2-entry ( b:int base:bytes -- int )
  "The code of the byte b (either case) in Bletchley Park notation, through the alphabet table base (see ita2-code)." doc
  b 97 122 between? [ b 32 - ] [ b ] if base ita2-code ;

: ita2-table2 ( base:bytes -- bytes )
  "The 256-byte translate table of Bletchley Park notation built from an alphabet table (see ita2-entry)." doc
  0 256 range [ base ita2-entry ] map list>bytes ;

: ita2-table ( -- bytes )
  "A 256-byte table for translate: the ITA2 code of each Bletchley Park character in either case, 27 for + and 31 for -, 254 for ASCII white space and 255 for any other byte." doc
  ita2-alphabet 254 255 decode-table ita2-table2 ;

: from-bp ( s:str -- bytes )
  "The ITA2 codes (0 to 31) of text in Bletchley Park notation, either case, white space ignored. Any other character is E_COERCE." doc
  s str>bytes ita2-table translate
  dup [ 255 = ] filter len 0 <>
  [ "not an ITA2 character: use the letters, 3 4 5 8 9 / (and + and -); white space is ignored" raise:coerce ] when
  [ 254 <> ] filter ;

\ ---- keyed alphabets and squares ----

\ acc with c appended, when c is in alpha and not yet in acc.
: _keyed-alphabet-step ( acc:bytes alpha:bytes c:int -- bytes )
  alpha [ c = ] filter len 0 >
  acc [ c = ] filter len 0 =
  and
  [ acc c 1 int>be-bytes cat ] [ acc ] if ;

: keyed-alphabet ( key:bytes alpha:bytes -- bytes )
  "The order of a keyed square: the distinct bytes of key that are in alpha, in key order, then the rest of alpha in its order. Repeats and bytes not in alpha are dropped from the key." doc
  key alpha cat #[ ] [ alpha swap _keyed-alphabet-step ] reduce ;

: square-positions ( grid:bytes -- bytes )
  "A 256-byte table for translate: entry b is the position of the byte b in grid (0 to len-1), and 255 for any byte not in grid. Build it from keyed-alphabet." doc
  grid bytes>str 255 255 decode-table ;

: upper-merge-i ( code:int -- int )
  "A letter code made upper case (bit 5 cleared) with J merged into I. Use it on letters only: other codes are only masked." doc
  code 223 band dup 74 = [ drop 73 ] when ;

\ ---- checksums ----

: crc-presets ( -- str )
  "The CRC presets of CyberChef's CRC Checksum as text, one line per name and each line led by a line feed (so a search for line feed, name, space finds it): name, width in bits, poly, init, refin, refout, xorout (hex; T or F for the two reflect flags). Parameters from Greg Cook's catalogue of parametrised CRC algorithms. Shared by crc and generate-all." doc
  "\nCRC-3/GSM 3 3 0 F F 7\nCRC-3/ROHC 3 3 7 T T 0\nCRC-4/G-704 4 3 0 T T 0\nCRC-4/INTERLAKEN 4 3 F F F F\nCRC-4/ITU 4 3 0 T T 0\nCRC-5/EPC 5 09 09 F F 00\nCRC-5/EPC-C1G2 5 09 09 F F 00\nCRC-5/G-704 5 15 00 T T 00\nCRC-5/ITU 5 15 00 T T 00\nCRC-5/USB 5 05 1F T T 1F\nCRC-6/CDMA2000-A 6 27 3F F F 00\nCRC-6/CDMA2000-B 6 07 3F F F 00\nCRC-6/DARC 6 19 00 T T 00\nCRC-6/G-704 6 03 00 T T 00\nCRC-6/GSM 6 2F 00 F F 3F\nCRC-6/ITU 6 03 00 T T 00\nCRC-7/MMC 7 09 00 F F 00\nCRC-7/ROHC 7 4F 7F T T 00\nCRC-7/UMTS 7 45 00 F F 00\nCRC-8 8 07 00 F F 00\nCRC-8/8H2F 8 2F FF F F FF\nCRC-8/AES 8 1D FF T T 00\nCRC-8/AUTOSAR 8 2F FF F F FF\nCRC-8/BLUETOOTH 8 A7 00 T T 00\nCRC-8/CDMA2000 8 9B FF F F 00\nCRC-8/DARC 8 39 00 T T 00\nCRC-8/DVB-S2 8 D5 00 F F 00\nCRC-8/EBU 8 1D FF T T 00\nCRC-8/GSM-A 8 1D 00 F F 00\nCRC-8/GSM-B 8 49 00 F F FF\nCRC-8/HITAG 8 1D FF F F 00\nCRC-8/I-432-1 8 07 00 F F 55\nCRC-8/I-CODE 8 1D FD F F 00\nCRC-8/ITU 8 07 00 F F 55\nCRC-8/LTE 8 9B 00 F F 00\nCRC-8/MAXIM 8 31 00 T T 00\nCRC-8/MAXIM-DOW 8 31 00 T T 00\nCRC-8/MIFARE-MAD 8 1D C7 F F 00\nCRC-8/NRSC-5 8 31 FF F F 00\nCRC-8/OPENSAFETY 8 2F 00 F F 00\nCRC-8/ROHC 8 07 FF T T 00\nCRC-8/SAE-J1850 8 1D FF F F FF\nCRC-8/SAE-J1850-ZERO 8 1D 00 F F 00\nCRC-8/SMBUS 8 07 00 F F 00\nCRC-8/TECH-3250 8 1D FF T T 00\nCRC-8/WCDMA 8 9B 00 T T 00\nCRC-10/ATM 10 233 000 F F 000\nCRC-10/CDMA2000 10 3D9 3FF F F 000\nCRC-10/GSM 10 175 000 F F 3FF\nCRC-10/I-610 10 233 000 F F 000\nCRC-11/FLEXRAY 11 385 01A F F 000\nCRC-11/UMTS 11 307 000 F F 000\nCRC-12/3GPP 12 80F 000 F T 000\nCRC-12/CDMA2000 12 F13 FFF F F 000\nCRC-12/DECT 12 80F 000 F F 000\nCRC-12/GSM 12 D31 000 F F FFF\nCRC-12/UMTS 12 80F 000 F T 000\nCRC-13/BBC 13 1CF5 0000 F F 0000\nCRC-14/DARC 14 0805 0000 T T 0000\nCRC-14/GSM 14 202D 0000 F F 3FFF\nCRC-15/CAN 15 4599 0000 F F 0000\nCRC-15/MPT1327 15 6815 0000 F F 0001\nCRC-16 16 8005 0000 T T 0000\nCRC-16/A 16 1021 C6C6 T T 0000\nCRC-16/ACORN 16 1021 0000 F F 0000\nCRC-16/ARC 16 8005 0000 T T 0000\nCRC-16/AUG-CCITT 16 1021 1D0F F F 0000\nCRC-16/AUTOSAR 16 1021 FFFF F F 0000\nCRC-16/B 16 1021 FFFF T T FFFF\nCRC-16/BLUETOOTH 16 1021 0000 T T 0000\nCRC-16/BUYPASS 16 8005 0000 F F 0000\nCRC-16/CCITT 16 1021 0000 T T 0000\nCRC-16/CCITT-FALSE 16 1021 FFFF F F 0000\nCRC-16/CCITT-TRUE 16 1021 0000 T T 0000\nCRC-16/CCITT-ZERO 16 1021 0000 F F 0000\nCRC-16/CDMA2000 16 C867 FFFF F F 0000\nCRC-16/CMS 16 8005 FFFF F F 0000\nCRC-16/DARC 16 1021 FFFF F F FFFF\nCRC-16/DDS-110 16 8005 800D F F 0000\nCRC-16/DECT-R 16 0589 0000 F F 0001\nCRC-16/DECT-X 16 0589 0000 F F 0000\nCRC-16/DNP 16 3D65 0000 T T FFFF\nCRC-16/EN-13757 16 3D65 0000 F F FFFF\nCRC-16/EPC 16 1021 FFFF F F FFFF\nCRC-16/EPC-C1G2 16 1021 FFFF F F FFFF\nCRC-16/GENIBUS 16 1021 FFFF F F FFFF\nCRC-16/GSM 16 1021 0000 F F FFFF\nCRC-16/I-CODE 16 1021 FFFF F F FFFF\nCRC-16/IBM 16 8005 0000 T T 0000\nCRC-16/IBM-3740 16 1021 FFFF F F 0000\nCRC-16/IBM-SDLC 16 1021 FFFF T T FFFF\nCRC-16/IEC-61158-2 16 1DCF FFFF F F FFFF\nCRC-16/ISO-HDLC 16 1021 FFFF T T FFFF\nCRC-16/ISO-IEC-14443-3-A 16 1021 C6C6 T T 0000\nCRC-16/ISO-IEC-14443-3-B 16 1021 FFFF T T FFFF\nCRC-16/KERMIT 16 1021 0000 T T 0000\nCRC-16/LHA 16 8005 0000 T T 0000\nCRC-16/LJ1200 16 6F63 0000 F F 0000\nCRC-16/LTE 16 1021 0000 F F 0000\nCRC-16/M17 16 5935 FFFF F F 0000\nCRC-16/MAXIM 16 8005 0000 T T FFFF\nCRC-16/MAXIM-DOW 16 8005 0000 T T FFFF\nCRC-16/MCRF4XX 16 1021 FFFF T T 0000\nCRC-16/MODBUS 16 8005 FFFF T T 0000\nCRC-16/NRSC-5 16 080B FFFF T T 0000\nCRC-16/OPENSAFETY-A 16 5935 0000 F F 0000\nCRC-16/OPENSAFETY-B 16 755B 0000 F F 0000\nCRC-16/PROFIBUS 16 1DCF FFFF F F FFFF\nCRC-16/RIELLO 16 1021 B2AA T T 0000\nCRC-16/SPI-FUJITSU 16 1021 1D0F F F 0000\nCRC-16/T10-DIF 16 8BB7 0000 F F 0000\nCRC-16/TELEDISK 16 A097 0000 F F 0000\nCRC-16/TMS37157 16 1021 89EC T T 0000\nCRC-16/UMTS 16 8005 0000 F F 0000\nCRC-16/USB 16 8005 FFFF T T FFFF\nCRC-16/V-41-LSB 16 1021 0000 T T 0000\nCRC-16/V-41-MSB 16 1021 0000 F F 0000\nCRC-16/VERIFONE 16 8005 0000 F F 0000\nCRC-16/X-25 16 1021 FFFF T T FFFF\nCRC-16/XMODEM 16 1021 0000 F F 0000\nCRC-16/ZMODEM 16 1021 0000 F F 0000\nCRC-17/CAN-FD 17 1685B 00000 F F 00000\nCRC-21/CAN-FD 21 102899 000000 F F 000000\nCRC-24/BLE 24 00065B 555555 T T 000000\nCRC-24/FLEXRAY-A 24 5D6DCB FEDCBA F F 000000\nCRC-24/FLEXRAY-B 24 5D6DCB ABCDEF F F 000000\nCRC-24/INTERLAKEN 24 328B63 FFFFFF F F FFFFFF\nCRC-24/LTE-A 24 864CFB 000000 F F 000000\nCRC-24/LTE-B 24 800063 000000 F F 000000\nCRC-24/OPENPGP 24 864CFB B704CE F F 000000\nCRC-24/OS-9 24 800063 FFFFFF F F FFFFFF\nCRC-30/CDMA 30 2030B9C7 3FFFFFFF F F 3FFFFFFF\nCRC-31/PHILIPS 31 04C11DB7 7FFFFFFF F F 7FFFFFFF\nCRC-32 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/AAL5 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/ADCCP 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/AIXM 32 814141AB 00000000 F F 00000000\nCRC-32/AUTOSAR 32 F4ACFB13 FFFFFFFF T T FFFFFFFF\nCRC-32/BASE91-C 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/BASE91-D 32 A833982B FFFFFFFF T T FFFFFFFF\nCRC-32/BZIP2 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/C 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/CASTAGNOLI 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/CD-ROM-EDC 32 8001801B 00000000 T T 00000000\nCRC-32/CKSUM 32 04C11DB7 00000000 F F FFFFFFFF\nCRC-32/D 32 A833982B FFFFFFFF T T FFFFFFFF\nCRC-32/DECT-B 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/INTERLAKEN 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/ISCSI 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/ISO-HDLC 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/JAMCRC 32 04C11DB7 FFFFFFFF T T 00000000\nCRC-32/MEF 32 741B8CD7 FFFFFFFF T T 00000000\nCRC-32/MPEG-2 32 04C11DB7 FFFFFFFF F F 00000000\nCRC-32/NVME 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/PKZIP 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/POSIX 32 04C11DB7 00000000 F F FFFFFFFF\nCRC-32/Q 32 814141AB 00000000 F F 00000000\nCRC-32/SATA 32 04C11DB7 52325032 F F 00000000\nCRC-32/V-42 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/XFER 32 000000AF 00000000 F F 00000000\nCRC-32/XZ 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-40/GSM 40 0004820009 0000000000 F F FFFFFFFFFF\nCRC-64/ECMA-182 64 42F0E1EBA9EA3693 0000000000000000 F F 0000000000000000\nCRC-64/GO-ECMA 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/GO-ISO 64 000000000000001B FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/MS 64 259C84CBA6426349 FFFFFFFFFFFFFFFF T T 0000000000000000\nCRC-64/NVME 64 AD93D23594C93659 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/REDIS 64 AD93D23594C935A9 0000000000000000 T T 0000000000000000\nCRC-64/WE 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF F F FFFFFFFFFFFFFFFF\nCRC-64/XZ 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-82/DARC 82 0308C0111011401440411 000000000000000000000 T T 000000000000000000000" ;

\ ---- ciphers and tokens ----

: iv-or-zeros ( iv:bytes n:int -- bytes )
  "The IV, or n zero bytes when it is empty: the default of the ciphers that let the IV be left out (CyberChef's TEA, XTEA, RC6 and GOST 28147-89 treat an empty IV as zeros). n is the block size in bytes." doc
  iv len 0 = [ n zero-bytes ] [ iv ] if ;

: b64url-encode ( data:bytes padding:bool -- bytes )
  "data as URL-safe Base64 (RFC 4648 section 5, - and _) text, as bytes; padding on appends = to a multiple of four characters. The form JWT, Flask cookies and Fernet tokens use." doc
  data "url" padding base64:encode str>bytes ;

: b64url-decode ( text:bytes -- bytes )
  "The bytes of URL-safe Base64 text (given as bytes), with or without padding; text that is not URL-safe Base64 is E_COERCE." doc
  text "url" base64:decode ;

\ ---- calendar (days since 1970-01-01, proleptic Gregorian; Howard Hinnant's algorithms, public domain) ----

: _days-adj ( y:int m:int d:int -- int )
  y 400 div 146097 *
  y 400 mod dup 365 * over 4 div + swap 100 div -
  +
  m 9 + 12 mod 153 * 2 + 5 div d + 1 - +
  719468 - ;

: days-from-civil ( y:int m:int d:int -- int )
  "The number of days from 1970-01-01 to year y, month m (1 to 12) and day d (before 1970 negative). The day may run past the end of the month (31 February is early March), and the year may be zero or negative." doc
  y m 2 <= [ 1 ] [ 0 ] if - m d _days-adj ;

\ Step 4 of civil-from-days: mp counts months from March; the year ticks over in January and February.
: _civil4 ( mp:int doy:int y0:int -- int int int )
  y0 mp 2 + 12 div + mp 2 + 12 mod 1 + doy 153 mp * 2 + 5 div - 1 + ;

: _civil3 ( doy:int y0:int -- int int int )
  doy 5 * 2 + 153 div doy y0 _civil4 ;

: _civil2 ( yoe:int era:int doe:int -- int int int )
  doe 365 yoe * yoe 4 div + yoe 100 div - - yoe era 400 * + _civil3 ;

: _civil1 ( era:int doe:int -- int int int )
  doe doe 1460 div - doe 36524 div + doe 146096 div - 365 div era doe _civil2 ;

: civil-from-days ( days:int -- int int int )
  "The year, month (1 to 12) and day of the month of a day count from 1970-01-01, as three integers on the stack (year first). Floor division makes it right before 1970 too; the inverse of days-from-civil." doc
  days 719468 + dup 146097 div swap 146097 mod _civil1 ;

\ YYYY-MM-DDTHH:MM:SS.mmm from a year, month, day and the milliseconds into the day.
: _stamp-text ( y:int m:int d:int tod:int -- str )
  y 4 zero-pad "-" cat m 2 zero-pad cat "-" cat d 2 zero-pad cat "T" cat
  tod 3600000 div 2 zero-pad cat ":" cat tod 60000 div 60 mod 2 zero-pad cat ":" cat
  tod 1000 div 60 mod 2 zero-pad cat "." cat tod 1000 mod 3 zero-pad cat ;

: iso-from-ms ( ms:int -- str )
  "The UTC date and time of a Unix time in milliseconds as ISO 8601 text to the millisecond, without the zone letter: 1700000000123 gives 2023-11-14T22:13:20.123 (write Z after it). The year is at least four digits; times before the year 0 are not supported." doc
  ms 86400000 div civil-from-days ms 86400000 mod _stamp-text ;
