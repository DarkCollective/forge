\ util: shared FL helpers for the operation vocabularies. This vocabulary is internal (it is in
\ INTERNAL_VOCABS), so its words are callable from every vocabulary (util:name, or USING: util) but
\ are never listed in the catalogue and have no category. Private (_) words cannot be called across
\ vocabularies, so anything more than one vocabulary needs belongs here: check util before writing a
\ helper, and move a helper here when a second vocabulary wants it (npm run dupes finds copies).
IN: util

: space? ( b:int -- bool )
  "True for ASCII white space: tab, line feed, vertical tab, form feed, carriage return (9 to 13) and space (32)." doc
  b 32 = b 9 >= b 13 <= and or ;

\ The table entry of byte b: its index in alpha, else ws or pad, else 255.
: _code-of ( b:int alpha:str ws:int pad:int -- int )
  alpha { b } codes>str split dup len 2 = [ 0 nth len ]
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
