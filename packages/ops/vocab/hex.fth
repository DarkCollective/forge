\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hex: hexadecimal text. Written in FL on the core words bytes>hex and hex>bytes; there are no primitives.
IN: hex

\ ---- encode ----

\ The text between two bytes for a delimiter choice.
: _separator ( choice:str -- str )
  choice { "space" [ " " ] "colon" [ ":" ] [ "" ] } case ;

\ The two lower-case digits of every byte value, by value.
MEMO: _pairs ( -- list )
  0 256 range [ { } swap append list>bytes bytes>hex ] map ;

\ The digits of data with sep after each byte, less the last sep. data must not be empty.
: _delimited ( data:bytes sep:str -- str )
  _pairs :> pairs
  [ data [ pairs swap nth emit-all sep emit-all ] each ] collect-str :> text
  text 0 text len sep len - slice ;

: _digits ( data:bytes delimiter:str up:bool -- str )
  delimiter _separator :> sep
  {
    [ data len 0 = sep len 0 = or ] [ data bytes>hex ]
    [ data sep _delimited ]
  } cond
  up [ upper ] when ;

: encode ( bytes delimiter:choice{none|space|colon}=none case:choice{lower|upper}=lower -- str )
  "Encode bytes as hex digits, two per byte." doc
  "Encodings" category
  delimiter case "upper" = _digits ;

META: encode
  use-when "You have bytes or text and want to see or send them as hex digits, for example to read a binary value or to write a fingerprint as aa:bb:cc." ;
  param delimiter "What to put between the bytes: nothing, a space or a colon." ;
  param case "Digits a-f in lower case, or A-F in upper case." ;
  inverse decode ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-8" "RFC 4648, section 8: Base16" ;
  link "https://en.wikipedia.org/wiki/Hexadecimal" "Hexadecimal on Wikipedia" ;
  checks output charset "0-9a-fA-F :" ;
;

\ ---- decode ----

: decode ( bytes -- bytes )
  "Decode pairs of hex digits (either case); white space between digits is ignored." doc
  "Encodings" category
  bytes>latin1 hex>bytes ;

META: decode
  use-when "You have hex digits, with or without spaces, and want the bytes or text they stand for, for example from a hex dump or a copied key." ;
  inverse encode ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-8" "RFC 4648, section 8: Base16" ;
  link "https://en.wikipedia.org/wiki/Hexadecimal" "Hexadecimal on Wikipedia" ;
  checks input charset "0-9a-fA-F \t\n\x0b\x0c\r" ;
  expects "hex text" ;
;
