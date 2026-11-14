\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ quoted-printable: the Quoted-Printable content transfer encoding, RFC 2045 section 6.7.
\
\ Encoding rules (the encoder emits this subset, all of which any RFC 2045 decoder reads):
\   - printable ASCII 33 to 126 except "=" (61) stands for itself;
\   - "=" and every byte outside 9, 10, 32 to 126 is =XX (upper-case hex), so a lone CR is =0D;
\   - space and tab stand for themselves except at the end of a line (before a line break or at the
\     end of the data), where they are =20 and =09 (rule 3);
\   - a CRLF in the data is a hard line break and is written as CRLF; a lone LF is also kept, as LF,
\     so the data round-trips unchanged;
\   - an encoded line has at most 76 characters (rule 5): a longer line gets soft breaks, "=" then
\     CRLF, after at most 75 characters, never inside an =XX.
\ Decoding rules: see decode. The words are FL and need no primitive; the soft-break loop keeps
\ its position in a variable because a cut point depends on the previous one. E_COERCE comes from
\ the raise vocabulary (raise:coerce).
IN: quoted-printable

0 VARIABLE _pos
"" VARIABLE _acc

\ One byte of a line; last says it is the last byte of its line (trailing white space is encoded).
: _token ( b:int last:bool -- str )
  b 61 <> b 33 >= and b 126 <= and [ b util:cp>str ]
  [ b 32 = b 9 = or last not and [ b util:cp>str ] [ "=" b util:byte>hex cat ] if ] if ;

: _tokens ( line:bytes -- str )
  line bytes>list [ line len 1 - = _token ] mapi "" join ;

\ The end of the next soft-broken chunk: k, moved back so that it does not fall inside an =XX.
: _cut ( enc:bytes k:int -- int )
  enc k 1 - nth 61 = [ k 1 - ] [ enc k 2 - nth 61 = [ k 2 - ] [ k ] if ] if ;

: _emit ( enc:bytes k:int -- )
  _acc enc _pos k slice bytes>latin1 cat "=\r\n" cat _acc!
  k _pos! ;

\ Cut one encoded line into lines of at most 76 characters, each but the last ending in "=" CRLF.
: _wrap ( enc:bytes -- str )
  0 _pos! "" _acc!
  [ enc len _pos - 76 > ] [ enc enc _pos 75 + _cut _emit ] while
  _acc enc _pos enc len slice bytes>latin1 cat ;

\ The line break after line piece p: CRLF if it ended in CR, else LF; none after the last piece.
: _term ( p:str has:bool -- str )
  has [ p "\r" util:ends-with? [ "\r\n" ] [ "\n" ] if ] [ "" ] if ;

: _core ( p:str has:bool -- str )
  has p "\r" util:ends-with? and [ p 0 p len 1 - slice ] [ p ] if ;

: _enc-line2 ( p:str has:bool -- str )
  p has _core latin1>bytes _tokens str>bytes _wrap p has _term cat ;

: _enc-line ( p:str i:int n:int -- str )
  p i n 1 - <> _enc-line2 ;

: _enc-lines ( lines:list -- str )
  lines [ lines len _enc-line ] mapi "" join ;

: encode ( bytes -- str )
  "Quoted-Printable (RFC 2045 section 6.7). Printable ASCII stays; = and other bytes become =XX (upper-case hex); a space or tab at the end of a line becomes =20 or =09; CRLF and a lone LF are kept as line breaks; a lone CR is =0D. Lines are cut with soft breaks (= then CRLF) so none is longer than 76 characters." doc
  "Encodings" category
  bytes>latin1 "\n" split _enc-lines ;

\ ---- decode ----

: _ws? ( c:int -- bool )
  c 32 = c 9 = or ;

: _rtrim ( s:str -- str )
  s [ _ws? ] util:trim-end ;

: _unescape ( s:str -- bytes )
  s "=" "= must be followed by two hex digits or a line break" util:hex-unescape ;

\ The line body: CR before a line break and trailing white space removed.
: _body ( p:str has:bool -- str )
  has p "\r" util:ends-with? and [ p 0 p len 1 - slice _rtrim ] [ p _rtrim ] if ;

\ A soft line break: the body without its final =, and no line break.
: _dec-line3 ( b:str p:str has:bool -- bytes )
  b "=" util:ends-with?
  [ b 0 b len 1 - slice _unescape ]
  [ b _unescape has [ p "\r" util:ends-with? [ #[ 0d 0a ] ] [ #[ 0a ] ] if ] [ #[ ] ] if cat ] if ;

: _dec-line2 ( p:str has:bool -- bytes )
  p has _body p has _dec-line3 ;

: _dec-line ( p:str i:int n:int -- bytes )
  p i n 1 - <> _dec-line2 ;

: _dec-lines ( lines:list -- bytes )
  lines [ lines len _dec-line ] mapi #[ ] bjoin ;

: decode ( bytes -- bytes )
  "Decode Quoted-Printable (RFC 2045 section 6.7). =XX (either case of the hex digits) is a byte; = followed by a line break (CRLF or LF) is a soft break and is removed; = as the very last character is also removed. Space and tab before a line break or at the end of the data are transport padding and are deleted. All other bytes, including 8-bit bytes, stand for themselves; CRLF and LF line breaks are kept. An = followed by anything else (not two hex digits, or a single character) is E_COERCE." doc
  "Encodings" category
  bytes>latin1 "\n" split _dec-lines ;

META: encode
  use-when "You have text or bytes that must go in an email body or MIME part that carries only 7-bit ASCII lines." ;
  link "https://www.rfc-editor.org/rfc/rfc2045" "RFC 2045, section 6.7: Quoted-Printable" ;
  link "https://en.wikipedia.org/wiki/Quoted-printable" "Quoted-printable on Wikipedia" ;
  inverse decode ;
  checks output charset "\t\n\r\x20-\x7e" ;
;

META: decode
  use-when "You have quoted-printable text from an email source, with =3D or =C3=A9 codes and soft line breaks, and want the original bytes." ;
  link "https://www.rfc-editor.org/rfc/rfc2045" "RFC 2045, section 6.7: Quoted-Printable" ;
  link "https://en.wikipedia.org/wiki/Quoted-printable" "Quoted-printable on Wikipedia" ;
  inverse encode ;
;
