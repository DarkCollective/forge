\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
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

\ ---- encode ----

: encode ( bytes alphabet:choice{standard|inverted}=standard -- str )
  "Encode bytes as Base62 text; each leading zero byte becomes a leading first-alphabet character. Data over about 8 KiB is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet str>bytes util:bytes>symbols bytes>latin1 ;

\ ---- decode ----

: decode ( bytes alphabet:choice{standard|inverted}=standard -- bytes )
  "Decode Base62 text. White space is ignored; each leading first-alphabet character becomes a zero byte. Text over about 11 000 characters is E_LIMIT_VALUE." doc
  "Encodings" category
  alphabet _alphabet 254 255 util:decode-table 62 util:symbols>bytes ;

META: encode
  use-when "You need bytes as a short string of letters and digits for a URL or an ID, and the other side uses the same alphabet, since Base62 has no formal standard." ;
  link "https://en.wikipedia.org/wiki/Base62" "Base62 on Wikipedia" ;
  inverse decode ;
  param alphabet "The alphabet: standard (0-9 A-Z a-z) or inverted (0-9 a-z A-Z)." ;
  see-also base62:decode base58:encode ;
  checks output charset "0-9A-Za-z" ;
;

META: decode
  use-when "You have a string of letters and digits, such as a short URL ID, and want the bytes behind it. Base62 has no formal standard, so the alphabet must match." ;
  link "https://en.wikipedia.org/wiki/Base62" "Base62 on Wikipedia" ;
  inverse encode ;
  param alphabet "The alphabet of the text: standard (0-9 A-Z a-z) or inverted (0-9 a-z A-Z)." ;
  see-also base62:encode base58:decode ;
  checks input charset "0-9A-Za-z \t\n\x0b\x0c\r" ;
  expects "Base62 text" ;
;
