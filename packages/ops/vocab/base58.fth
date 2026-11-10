\ base58: Base58 (Bitcoin, Flickr and Ripple alphabets). Written in FL on top of its big integers:
\ the data is one integer, repeatedly divided by 58. A leading zero byte is a leading first-alphabet
\ character. The integer limit (maxIntBits, 65 536 bits) caps the data at about 8 KiB, which also
\ bounds the quadratic cost: a larger input fails with E_LIMIT_VALUE. Errors come
\ from the raise vocabulary (raise:coerce).
IN: base58

: _alphabet ( alphabet:str -- str )
  alphabet "flickr" =
  [ "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ" ]
  [ alphabet "ripple" =
    [ "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz" ]
    [ "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" ] if ] if ;

\ ---- encode ----

: encode ( bytes alphabet:choice{bitcoin|flickr|ripple}=bitcoin -- str )
  "Encode bytes as Base58 text; each leading zero byte becomes a leading first-alphabet character. Data over about 8 KiB is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet str>bytes util:bytes>symbols bytes>latin1 ;

\ ---- decode ----

\ The decode table: 255 for a byte outside the alphabet, 254 for ASCII white space, else the digit value.
: _table ( alpha:str -- bytes )
  alpha 254 255 util:decode-table ;

: decode ( bytes alphabet:choice{bitcoin|flickr|ripple}=bitcoin -- bytes )
  "Decode Base58 text. White space is ignored; each leading first-alphabet character becomes a zero byte. Text over about 11 000 characters is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet _table 58 util:symbols>bytes ;

META: encode
  param alphabet "The alphabet: bitcoin, flickr or ripple." ;
;

META: decode
  param alphabet "The alphabet of the text: bitcoin, flickr or ripple." ;
;
