\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base64: Base64 as in RFC 4648. Written in FL: the alphabets and the checks are FL, and the symbols are
\ mapped to and from the alphabet with translate. The regrouping of three bytes into four 6-bit symbol
\ values and back is two private primitives (src/prims/base64.ts): in FL it cost about 50 VM steps per
\ 3 bytes, 1.1 million for 64 KiB, too much for the PEM, JWT and JWK words that call base64 many times.
\ Errors are E_COERCE (fail-coerce).
IN: base64

\ ---- tables ----

\ The tables are byte literals, so that using one costs a single step. A table of the encoder maps a
\ symbol value (0 to 63) to its alphabet byte (0 elsewhere); one of the decoder maps every byte to its
\ symbol value: 255 for a byte outside the alphabet, 254 for ASCII white space and 253 for =.

: _standard-chars ( -- bytes )
  #[
    41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50
    51 52 53 54 55 56 57 58 59 5a 61 62 63 64 65 66
    67 68 69 6a 6b 6c 6d 6e 6f 70 71 72 73 74 75 76
    77 78 79 7a 30 31 32 33 34 35 36 37 38 39 2b 2f
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  ] ;

: _url-chars ( -- bytes )
  #[
    41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50
    51 52 53 54 55 56 57 58 59 5a 61 62 63 64 65 66
    67 68 69 6a 6b 6c 6d 6e 6f 70 71 72 73 74 75 76
    77 78 79 7a 30 31 32 33 34 35 36 37 38 39 2d 5f
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  ] ;

: _standard-symbols ( -- bytes )
  #[
    ff ff ff ff ff ff ff ff ff fe fe fe fe fe ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    fe ff ff ff ff ff ff ff ff ff ff 3e ff ff ff 3f
    34 35 36 37 38 39 3a 3b 3c 3d ff ff ff fd ff ff
    ff 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e
    0f 10 11 12 13 14 15 16 17 18 19 ff ff ff ff ff
    ff 1a 1b 1c 1d 1e 1f 20 21 22 23 24 25 26 27 28
    29 2a 2b 2c 2d 2e 2f 30 31 32 33 ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ] ;

: _url-symbols ( -- bytes )
  #[
    ff ff ff ff ff ff ff ff ff fe fe fe fe fe ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    fe ff ff ff ff ff ff ff ff ff ff ff ff 3e ff ff
    34 35 36 37 38 39 3a 3b 3c 3d ff ff ff fd ff ff
    ff 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e
    0f 10 11 12 13 14 15 16 17 18 19 ff ff ff ff 3f
    ff 1a 1b 1c 1d 1e 1f 20 21 22 23 24 25 26 27 28
    29 2a 2b 2c 2d 2e 2f 30 31 32 33 ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ] ;

\ ---- encode ----

: _encode ( data:bytes alphabet:str padding:bool -- str )
  3 data len 3 mod - 3 mod :> fill
  data { 0 0 0 } list>bytes 0 fill slice cat _sextets
  alphabet "url" = [ _url-chars ] [ _standard-chars ] if
  translate bytes>latin1 :> text
  text 0 text len fill - slice
  padding [ "==" 0 fill slice cat ] when ;

: encode ( bytes alphabet:choice{standard|url}=standard padding:bool=true -- str )
  "Encode bytes as base64 text (RFC 4648)." doc
  "Encodings" category
  alphabet padding _encode ;

META: encode
  use-when "You need to carry binary data through a channel that only takes plain text, such as an email, a URL or JSON." ;
  param alphabet "The alphabet to use: standard (+ /) or url (- _)." ;
  param padding "Append = padding to a multiple of four characters." ;
  inverse decode ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-4" "RFC 4648, section 4: Base 64 encoding" ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-5" "RFC 4648, section 5: the URL-safe alphabet" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
  checks output charset "A-Za-z0-9+/=_-" ;
;

\ ---- decode ----

\ Raises the error for the first byte of data that is not in the alphabet (t is data run through the table).
: _bad-byte ( data:bytes t:bytes alphabet:str -- )
  t [ 255 = ] find :> at
  "byte 0x" { data at nth } list>bytes bytes>hex cat
  " is not in the " cat alphabet cat " alphabet" cat fail-coerce ;

\ core is the symbol values without the padding and pad the number of = characters.
: _finish ( core:bytes pad:int -- bytes )
  core len 4 mod :> rest
  rest 1 = [ "a single character cannot be the end of base64 data" fail-coerce ] when
  pad 2 > pad 0 > core len pad + 4 mod 0 <> and or [ "incorrect padding" fail-coerce ] when
  {
    [ rest 2 = ] [ core core len 1 - nth 15 band 0 <> ]
    [ rest 3 = ] [ core core len 1 - nth 3 band 0 <> ]
    [ false ]
  } cond [ "non-zero bits after the end of the data" fail-coerce ] when
  core { 0 0 0 } list>bytes 0 4 rest - 4 mod slice cat _unsextets
  0 core len 3 * 4 div slice ;

\ Symbol values, then the white space and the padding are taken out on the Latin-1 text of the bytes, so
\ that costs a few interpreter steps for any length.
: _decode ( data:bytes alphabet:str -- bytes )
  alphabet "url" = [ _url-symbols ] [ _standard-symbols ] if :> table
  data table translate :> t
  t bytes>latin1 :> s
  s "\u{FF}" split len 1 > [ data t alphabet _bad-byte ] when
  s "\u{FE}" split "" join :> symbols
  symbols "\u{FD}" split "" join :> core
  symbols len core len - :> pad
  symbols 0 core len slice core = not [ "data after the padding" fail-coerce ] when
  core latin1>bytes pad _finish ;

: decode ( bytes alphabet:choice{standard|url}=standard -- bytes )
  "Decode base64 text (RFC 4648). White space is ignored and padding is optional." doc
  "Encodings" category
  alphabet _decode ;

META: decode
  use-when "You have text of letters, digits, plus and slash, often ending in =, and want the bytes it stands for." ;
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
  inverse encode ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-4" "RFC 4648, section 4: Base 64 encoding" ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-5" "RFC 4648, section 5: the URL-safe alphabet" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
  checks input charset "A-Za-z0-9+/=_ \t\n\x0b\x0c\r-" ;
  expects "Base64 text" ;
;
