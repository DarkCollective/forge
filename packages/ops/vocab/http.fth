\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ http: Strip HTTP headers and Dechunk HTTP response (CyberChef's Networking ops), on bytes. The header search is
\ FL on the Latin-1 text of the message (a split, a few VM steps for any length); the chunked transfer coding
\ (RFC 9112 section 7.1) is one private primitive, _dechunk (src/prims/http.ts), because collecting the chunks in FL
\ is quadratic and overran the allocation limit at 64 KiB (measured, see the primitive).
IN: http

\ The offset in p of the end of the first occurrence of sep (the characters before it plus adv, the length of sep), or -1.
: _first ( p:str sep:str adv:int -- int )
  p sep split dup len 1 = [ drop -1 ] [ 0 nth len adv + ] if ;

: _min-pos ( a:int b:int -- int )
  a 0 < [ b ] [ b 0 < [ a ] [ a b min ] if ] if ;

\ Where the body starts in the text s: after the first empty line (CRLF CRLF, LF LF, or a mix of the two), counted
\ in characters, or -1 when there is none. A text that starts with an empty line has no header block at all. The
\ search runs on the text with a line feed in front, so that the first line is also preceded by a line end.
: _body-start ( s:str -- int )
  "\n" s cat dup "\n\n" 2 _first swap "\n\r\n" 3 _first _min-pos
  dup 0 >= [ 1 - ] when ;

: strip-headers ( data:bytes -- bytes )
  "Remove the HTTP header block from a request or response (Strip HTTP headers): everything up to and including the first empty line, which ends a header block with CRLF CRLF, LF LF or a mix (the first line of the message is part of the block). What follows, the body, is the output. A message with no empty line has no complete header block and is E_COERCE (CyberChef returns it unchanged); one that starts with an empty line has an empty header block and is returned after that line. Bytes in, bytes out; the search is on the bytes as Latin-1, so any encoding works." doc
  "Networking" category
  data bytes>latin1 _body-start
  dup 0 < [ drop "no empty line ends the HTTP header block (no CRLF CRLF or LF LF in the data)" raise:coerce #[ ] ]
  [ data swap data len slice ] if ;

: dechunk ( data:bytes -- bytes )
  "Decode a chunked HTTP body (Dechunk HTTP response, RFC 9112 section 7.1): each chunk is its size in hex digits, optional chunk extensions after a semicolon (skipped), a line end, that many bytes and a line end; a chunk of size 0 ends the chunks, followed by the trailer fields (skipped) and the empty line that closes the message. A bare LF is accepted for CRLF. The output is the chunk data joined; it is never longer than the input. Empty input, a size that is not hexadecimal, a size that runs past the data, a missing line end, a missing last chunk or trailer end (truncation) and bytes after the end of the message are E_COERCE with the offset. Run Strip HTTP headers first on a whole response." doc
  "Networking" category
  data _dechunk ;

META: strip-headers
  see-also http:dechunk ;
;

META: dechunk
  see-also http:strip-headers ;
;
