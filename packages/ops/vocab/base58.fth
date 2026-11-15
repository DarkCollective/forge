\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base58: Base58 (Bitcoin, Flickr and Ripple alphabets). Written in FL on top of its big integers:
\ the data is one integer, repeatedly divided by 58. A leading zero byte is a leading first-alphabet
\ character. The integer limit (maxIntBits, 65 536 bits) caps the data at about 8 KiB, which also
\ bounds the quadratic cost: a larger input fails with E_LIMIT_VALUE. Errors are raised
\ with the core word fail-coerce.
IN: base58

\ The alphabet of Base58 text.
CHOICE: base58-alphabet
  option bitcoin "The Bitcoin alphabet." ;
  option flickr "The Flickr alphabet (lower case before upper case)." ;
  option ripple "The Ripple alphabet." ;
;

: _alphabet ( alphabet:str -- str )
  {
    [ alphabet "flickr" = ] [ "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ" ]
    [ alphabet "ripple" = ] [ "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz" ]
    [ "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" ]
  } cond ;

\ ---- encode ----

: encode ( bytes alphabet:choice<base58-alphabet>=bitcoin -- str )
  "Encode bytes as Base58 text; each leading zero byte becomes a leading first-alphabet character. Data over about 8 KiB is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet str>bytes util:bytes>symbols bytes>latin1 ;

META: encode
  use-when "You have bytes and want short text without the look-alike characters 0, O, I and l, for example an identifier that people will read aloud or type." ;
  param alphabet "The alphabet: bitcoin, flickr or ripple." ;
  inverse decode ;
  link "https://en.wikipedia.org/wiki/Base58" "Base58 on Wikipedia" ;
  checks output charset "1-9A-HJ-NP-Za-km-z" ;
;

\ ---- decode ----

\ The decode table: 255 for a byte outside the alphabet, 254 for ASCII white space, else the digit value.
: _table ( alpha:str -- bytes )
  alpha 254 255 util:decode-table ;

: decode ( bytes alphabet:choice<base58-alphabet>=bitcoin -- bytes )
  "Decode Base58 text. White space is ignored; each leading first-alphabet character becomes a zero byte. Text over about 11 000 characters is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet _table 58 util:symbols>bytes ;

META: decode
  use-when "You have base58 text, such as a Bitcoin address or a short ID, and want its bytes. This does not check a Base58Check checksum." ;
  param alphabet "The alphabet of the text: bitcoin, flickr or ripple." ;
  inverse encode ;
  link "https://en.wikipedia.org/wiki/Base58" "Base58 on Wikipedia" ;
  checks input charset "1-9A-HJ-NP-Za-km-z \t\n\x0b\x0c\r" ;
  expects "Base58 text" ;
;
