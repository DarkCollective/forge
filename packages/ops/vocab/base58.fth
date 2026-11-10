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

: _step ( acc:bytes n:int alpha:bytes -- bytes int )
  acc { alpha n 58 mod nth } list>bytes cat n 58 div ;

\ The digits of n, most significant first (none for 0).
: _digits ( n:int alpha:bytes -- bytes )
  #[ ] n [ dup 0 > ] [ alpha _step ] while drop rev ;

: _byte-count ( n:int -- int )
  n 0 = [ 0 ] [ n 16 int>str-radix len 1 + 2 div ] if ;

: _enc3 ( len:int n:int alpha:bytes -- str )
  0 len n _byte-count - range [ drop alpha 0 nth ] map list>bytes
  n alpha _digits cat bytes>latin1 ;

: encode ( bytes alphabet:choice{bitcoin|flickr|ripple}=bitcoin -- str )
  "Encode bytes as Base58 text; each leading zero byte becomes a leading first-alphabet character. Data over about 8 KiB is E_LIMIT_VALUE." doc
  "Encodings" category
  dup len swap bytes>hex "0" swap cat 16 str>int-radix alphabet _alphabet str>bytes _enc3 ;

\ ---- decode ----

: _isspace ( b:int -- bool )
  b 32 = b 9 >= b 13 <= and or ;

\ 255 for a byte outside the alphabet, 254 for ASCII white space, else the digit value.
: _code-of ( alpha:str b:int -- int )
  b _isspace
  [ 254 ]
  [ alpha { b } codes>str split dup len 2 = [ 0 nth len ] [ drop 255 ] if ] if ;

: _table ( alpha:str -- bytes )
  0 256 range [ alpha swap _code-of ] map list>bytes ;

\ The number of leading zero digits.
: _lead0 ( b:bytes -- int )
  0 [ dup b len < [ dup b swap nth 0 = ] [ false ] if ] [ 1 + ] while ;

: _value ( vals:bytes -- int )
  vals 0 [ swap 58 * + ] reduce ;

: _out ( z:int n:int -- bytes )
  0 z range [ drop 0 ] map list>bytes
  n 0 =
  [ #[ ] ]
  [ n 16 int>str-radix dup len 2 mod 1 = [ "0" swap cat ] when hex>bytes ] if
  cat ;

: _decode ( data:bytes table:bytes -- bytes )
  data table translate [ 254 <> ] filter
  dup [ 255 = ] filter len 0 <> [ "a character is not in the alphabet" raise:coerce ] when
  dup _lead0 swap _value _out ;

: decode ( bytes alphabet:choice{bitcoin|flickr|ripple}=bitcoin -- bytes )
  "Decode Base58 text. White space is ignored; each leading first-alphabet character becomes a zero byte. Text over about 11 000 characters is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet _table _decode ;

META: encode
  param alphabet "The alphabet: bitcoin, flickr or ripple." ;
;

META: decode
  param alphabet "The alphabet of the text: bitcoin, flickr or ripple." ;
;
