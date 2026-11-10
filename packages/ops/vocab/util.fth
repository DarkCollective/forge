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

: cp>str ( cp:int -- str )
  "The one-character string of a code point (0 to 0x10FFFF, not a surrogate: anything else is the error codes>str raises)." doc
  { cp } codes>str ;

\ The table entry of byte b: its index in alpha, else ws or pad, else 255.
: _code-of ( b:int alpha:str ws:int pad:int -- int )
  alpha b cp>str split dup len 2 = [ 0 nth len ]
  [ drop b 61 = [ pad ] [ b space? [ ws ] [ 255 ] if ] if ] if ;

: decode-table ( alpha:str ws:int pad:int -- bytes )
  "A 256-byte lookup table for translate: entry b is the index of byte b in alpha. A byte outside alpha gives ws for ASCII white space, pad for = and 255 otherwise; pass 255 for a marker you do not need." doc
  0 256 range [ alpha ws pad _code-of ] map list>bytes ;

: separator ( choice:str -- str )
  "The text for a delimiter choice: none gives the empty string, comma a comma, newline a line feed and anything else (space) a space." doc
  choice "none" = [ "" ]
  [ choice "comma" = [ "," ] [ choice "newline" = [ "\n" ] [ " " ] if ] if ] if ;

: space-or-comma? ( b:int -- bool )
  "True for the separators of numeric text: ASCII white space (see space?) and the comma (44)." doc
  b 44 = b space? or ;

: check-symbols ( data:bytes table:bytes -- bytes )
  "Translate data through a decode table (see decode-table) and raise E_COERCE (a character is not in the alphabet) if any byte maps to 255. The translated bytes are returned with any other marker (white space, padding) left in place for the caller to handle." doc
  data table translate
  dup [ 255 = ] filter len 0 <> [ "a character is not in the alphabet" raise:coerce ] when ;

: int>be-bytes ( v:int n:int -- bytes )
  "The low n bytes of v, most significant first (big-endian); higher bytes are dropped and an n of 0 gives no bytes." doc
  0 n range [ n 1 - swap - 8 * v swap shr 255 band ] map list>bytes ;

: digits>int ( vals:bytes radix:int -- int )
  "The integer whose digits are the elements of vals, most significant digit first, in the given radix: a positional fold. Digits are not checked against the radix. Large inputs are bounded by the integer limit (E_LIMIT_VALUE)." doc
  vals 0 [ swap radix * + ] reduce ;

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

: count-of ( d:bytes v:int -- int )
  "How many elements of d (bytes or a list of ints) equal v." doc
  d [ v = ] filter len ;

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
