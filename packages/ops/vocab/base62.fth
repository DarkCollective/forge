\ base62: Base62 as a big-integer radix conversion, the same scheme as base58 (the data is one integer,
\ repeatedly divided by 62; a leading zero byte is a leading first-alphabet character). Two alphabets:
\ standard (0-9 A-Z a-z, the order of the ASCII table and of most Base62 libraries) and inverted
\ (0-9 a-z A-Z). There is no formal standard for Base62, so this is a convention, not an RFC. The
\ integer limit (maxIntBits, 65 536 bits) caps the data at about 8 KiB, which also bounds the
\ quadratic cost: a larger input fails with E_LIMIT_VALUE. Errors come from the raise vocabulary.
IN: base62

: _alphabet ( alphabet:str -- str )
  alphabet "inverted" =
  [ "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" ]
  [ "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" ] if ;

\ The number of leading zero elements: the index of the first non-zero one (all of them if none).
: _zeros ( b:bytes -- int )
  0 b len range [ b swap nth 0 <> ] filter
  dup len 0 = [ drop b len ] [ 0 nth ] if ;

\ ---- encode ----

: _step ( acc:bytes n:int alpha:bytes -- bytes int )
  acc { alpha n 62 mod nth } list>bytes cat n 62 div ;

\ The digits of n, most significant first (none for 0).
: _digits ( n:int alpha:bytes -- bytes )
  #[ ] n [ dup 0 > ] [ alpha _step ] while drop rev ;

: _enc ( data:bytes alpha:bytes -- str )
  0 data _zeros range [ drop alpha 0 nth ] map list>bytes
  data bytes>hex "0" swap cat 16 str>int-radix alpha _digits cat bytes>latin1 ;

: encode ( bytes alphabet:choice{standard|inverted}=standard -- str )
  "Encode bytes as Base62 text; each leading zero byte becomes a leading first-alphabet character. Data over about 8 KiB is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet str>bytes _enc ;

\ ---- decode ----

\ The bytes of n, most significant first (none for 0).
: _big ( n:int -- bytes )
  n 0 = [ #[ ] ] [ n n 16 int>str-radix len 1 + 2 div util:int>be-bytes ] if ;

\ z zero bytes, then the bytes of n.
: _out ( z:int n:int -- bytes )
  0 z range [ drop 0 ] map list>bytes n _big cat ;

: _decode ( data:bytes table:bytes -- bytes )
  data table util:check-symbols [ 254 <> ] filter
  dup _zeros swap 62 util:digits>int _out ;

: decode ( bytes alphabet:choice{standard|inverted}=standard -- bytes )
  "Decode Base62 text. White space is ignored; each leading first-alphabet character becomes a zero byte. Text over about 11 000 characters is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet 254 255 util:decode-table _decode ;

META: encode
  param alphabet "The alphabet: standard (0-9 A-Z a-z) or inverted (0-9 a-z A-Z)." ;
  see-also base62:decode base58:encode ;
;

META: decode
  param alphabet "The alphabet of the text: standard (0-9 A-Z a-z) or inverted (0-9 a-z A-Z)." ;
  see-also base62:encode base58:decode ;
;
