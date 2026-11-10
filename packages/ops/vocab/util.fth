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
