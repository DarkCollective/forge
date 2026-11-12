\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base45: Base45 as in RFC 9285. Two bytes are one 16-bit number written as three base-45 digits, least
\ significant first (c + d*45 + e*45^2); a final single byte is two digits. The alphabet includes the
\ space, so unlike the other encodings white space is not ignored. Errors come from the raise
\ vocabulary (raise:coerce).
IN: base45

: _alpha ( -- bytes )
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:" str>bytes ;

\ ---- encode ----

\ The count base-45 digits of n, least significant first.
: _digits ( n:int count:int -- bytes )
  0 count range [ 45 swap pow n swap div 45 mod ] map list>bytes ;

\ The 16-bit number of the pair of bytes i.
: _pair ( d:bytes i:int -- int )
  d i 2 * nth 256 * d i 2 * 1 + nth + ;

: _enc ( data:bytes -- bytes )
  0 data len 2 div range [ data swap _pair 3 _digits ] map #[ ] bjoin
  data len 2 mod 1 = [ data data len 1 - nth 2 _digits cat ] when ;

: _chars ( v:bytes a:bytes -- str )
  v [ a swap nth ] map bytes>latin1 ;

: encode ( bytes -- str )
  "Encode bytes as Base45 text (RFC 9285): two bytes become three characters, a last single byte two." doc
  "Encodings" category
  _enc _alpha _chars ;

\ ---- decode ----

\ The decode table: 255 for a byte outside the alphabet; the space is a symbol, so nothing is skipped.
: _table ( -- bytes )
  _alpha bytes>latin1 255 255 util:decode-table ;

\ The 16-bit number of the three digits at i.
: _triple ( v:bytes i:int -- int )
  v i 3 * nth v i 3 * 1 + nth 45 * + v i 3 * 2 + nth 2025 * + ;

: _two ( n:int -- bytes )
  n 65535 > [ "a group of three characters is more than 65535" raise:coerce ] when
  { } n 256 div append n 256 mod append list>bytes ;

\ The byte of the last two digits.
: _one ( v:bytes -- bytes )
  v v len 2 - nth v v len 1 - nth 45 * + dup 255 >
  [ "a group of two characters is more than 255" raise:coerce ] when
  { } swap append list>bytes ;

: _dec ( v:bytes -- bytes )
  v len 3 mod 1 = [ "a length of that kind cannot be Base45 text" raise:coerce ] when
  0 v len 3 div range [ v swap _triple _two ] map #[ ] bjoin
  v len 3 mod 2 = [ v _one cat ] when ;

: decode ( bytes -- bytes )
  "Decode Base45 text (RFC 9285). The alphabet includes the space, so white space is not skipped; a character outside it, a length of 3n+1, or a group whose value is too big is E_COERCE." doc
  "Encodings" category
  _table util:check-symbols _dec ;

META: encode
  use-when "You need to put binary data in a QR code that uses the alphanumeric mode, such as a digital health certificate, and want text the code will hold." ;
  link "https://www.rfc-editor.org/rfc/rfc9285" "RFC 9285: Base45 data encoding" ;
  inverse decode ;
  see-also base45:decode base32:encode ;
;

META: decode
  use-when "You have Base45 text, such as the content of a QR code, and want the bytes it stands for." ;
  link "https://www.rfc-editor.org/rfc/rfc9285" "RFC 9285: Base45 data encoding" ;
  inverse encode ;
  see-also base45:encode base32:decode ;
;
