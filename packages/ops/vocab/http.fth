\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ http: Strip HTTP headers and Dechunk HTTP response (CyberChef's Networking ops), on bytes. The header search is
\ FL on the Latin-1 text of the message (a split, a few VM steps for any length); the chunked transfer coding
\ (RFC 9112 section 7.1) is FL too, collecting the chunks with a collector (a linear walk).
IN: http

\ The offset in p of the end of the first occurrence of sep (the characters before it plus adv, the length of sep), or -1.
: _first ( p:str sep:str adv:int -- int )
  p sep split dup len 1 = [ drop -1 ] [ 0 nth len adv + ] if ;

: _min-pos ( a:int b:int -- int )
  {
    [ a 0 < ] [ b ]
    [ b 0 < ] [ a ]
    [ a b min ]
  } cond ;

\ Where the body starts in the text s: after the first empty line (CRLF CRLF, LF LF, or a mix of the two), counted
\ in characters, or -1 when there is none. A text that starts with an empty line has no header block at all. The
\ search runs on the text with a line feed in front, so that the first line is also preceded by a line end.
: _body-start ( s:str -- int )
  "\n" s cat :> t
  t "\n\n" 2 _first t "\n\r\n" 3 _first _min-pos
  dup 0 >= [ 1 - ] when ;

: strip-headers ( data:bytes -- bytes )
  "Remove the HTTP header block from a request or response (Strip HTTP headers): everything up to and including the first empty line, which ends a header block with CRLF CRLF, LF LF or a mix (the first line of the message is part of the block). What follows, the body, is the output. A message with no empty line has no complete header block and is E_COERCE (CyberChef returns it unchanged); one that starts with an empty line has an empty header block and is returned after that line. Bytes in, bytes out; the search is on the bytes as Latin-1, so any encoding works." doc
  "Networking" category
  data bytes>latin1 _body-start :> pos
  pos 0 < [ "no empty line ends the HTTP header block (no CRLF CRLF or LF LF in the data)" fail-coerce ] when
  data pos data len slice ;

\ ---- dechunk ----
\ Each chunk starts where the one before it ends, so the walk keeps the offset p of the next chunk on the stack and
\ emits the data of every chunk into a collector (linear time and allocation). It reads strictly, as the recipient
\ of RFC 9112 may, but accepts a bare LF where CRLF is expected (section 2.2). A length is only compared with the
\ bytes that are left, so nothing is allocated from it; the output is never longer than the input.

\ The offset of the first line feed at or after p, or -1. The search looks at a window of w bytes at a time and
\ doubles it, so that a line costs time in proportion to its own length, not to the rest of the data.
: _lf ( data:bytes p:int w:int -- int )
  p w + data len min :> e
  data p e slice bytes>latin1 "\n" split :> parts
  {
    [ parts len 1 > ] [ p parts 0 nth len + ]
    [ e data len = ] [ -1 ]
    [ data p w 2 * recurse ]
  } cond ;

\ The two hex digits of a byte, for the messages.
: _hex2 ( b:int -- str )
  { b } list>bytes bytes>hex ;

\ The size and whether it is too big to be one, of a run of hex digits. More than 13 significant digits is too big
\ (they would not be exact in a double), whatever the maxIntBits limit says.
: _size ( digits:str -- int bool )
  digits len 13 <= [ digits 16 str>int-radix false ] [
    digits str>bytes [ 48 = not ] find :> z
    {
      [ z 0 < ] [ 0 false ]
      [ digits len z - 13 > ] [ 0 true ]
      [ digits z digits len slice 16 str>int-radix false ]
    } cond
  ] if ;

\ Checks what follows the size on the chunk size line that starts at p: from q to end, optional white space, then a
\ chunk extension, which starts with a semicolon and has no control character.
: _check-ext ( data:bytes p:int q:int end:int -- )
  data q end slice :> rest
  rest [ dup 32 = swap 9 = or not ] find :> k
  k 0 >= [
    q k + :> r
    data r nth 59 = not [
      "the chunk size line at offset " p int>str cat " has an unexpected byte 0x" cat data r nth _hex2 cat
      " after the size" cat fail-coerce
    ] when
    data r end slice [ dup 0 = swap 13 = or ] find :> j
    j 0 >= [ "the chunk extension at offset " r j + int>str cat " holds a control character" cat fail-coerce ] when
  ] when ;

\ One trailer line at p: the offset after it and whether it was not the empty line that closes the message.
: _trailer-line ( data:bytes p:int -- int bool )
  data p 32 _lf :> tl
  tl 0 < [
    "the trailer at offset " p int>str cat " has no end: the empty line that closes the message is missing (truncated)"
    cat fail-coerce
  ] when
  tl p > [ data tl 1 - nth 13 = ] [ false ] if :> cr
  cr [ tl 1 - ] [ tl ] if p = not :> more
  tl 1 + more ;

\ The trailer fields (lines, skipped) and the empty line after the last chunk; nothing may follow.
: _trailer ( data:bytes p:int -- )
  p [ data swap _trailer-line ] loop :> e
  e data len = not [
    data len e - int>str " bytes follow the last chunk and its trailer, at offset " cat e int>str cat fail-coerce
  ] when ;

\ The chunk that starts at p: emits its data, and leaves the offset after it and whether more chunks may follow.
: _chunk ( data:bytes p:int -- int bool )
  data p 32 _lf :> lf
  lf 0 < [
    "the chunk size line at offset " p int>str cat " has no line end (truncated, or not chunked data)" cat fail-coerce
  ] when
  lf p > [ data lf 1 - nth 13 = ] [ false ] if [ lf 1 - ] [ lf ] if :> end
  data p end slice :> line
  line [ hex-digit? not ] find :> k
  k 0 < [ line len ] [ k ] if :> nd
  nd 0 = [
    "the chunk size at offset " p int>str cat " is not hexadecimal (byte 0x" cat data p nth _hex2 cat ")" cat fail-coerce
  ] when
  nd line len < [ data p p nd + end _check-ext ] when
  line 0 nd slice bytes>latin1 _size :> big :> size
  lf 1 + :> a
  data len a - :> left
  size 0 = big not and [ data a _trailer a false ] [
    big size left > or [
      "the chunk at offset " a int>str cat " declares " cat big [ "a size too large to fit" ] [ size int>str " bytes" cat ] if
      cat " but only " cat left int>str cat " are left (truncated)" cat fail-coerce
    ] when
    data a a size + slice emit-all
    a size + :> b
    {
      [ data b util:byte-at 13 = data b 1 + util:byte-at 10 = and ] [ b 2 + ]
      [ data b util:byte-at 10 = ] [ b 1 + ]
      [ b data len >= ] [
        "the chunk data ends at offset " b int>str cat " without its line end (truncated)" cat fail-coerce
      ]
      [
        "the chunk data at offset " b int>str cat " is not followed by a line end (byte 0x" cat data b nth _hex2 cat ")" cat
        fail-coerce
      ]
    } cond :> c
    c data len >= [ "the chunked data ends without the last chunk (size 0): truncated" fail-coerce ] when
    c true
  ] if ;

: dechunk ( data:bytes -- bytes )
  "Decode a chunked HTTP body (Dechunk HTTP response, RFC 9112 section 7.1): each chunk is its size in hex digits, optional chunk extensions after a semicolon (skipped), a line end, that many bytes and a line end; a chunk of size 0 ends the chunks, followed by the trailer fields (skipped) and the empty line that closes the message. A bare LF is accepted for CRLF. The output is the chunk data joined; it is never longer than the input. Empty input, a size that is not hexadecimal, a size that runs past the data, a missing line end, a missing last chunk or trailer end (truncation) and bytes after the end of the message are E_COERCE with the offset. Run Strip HTTP headers first on a whole response." doc
  "Networking" category
  data len 0 = [ "the input is empty" fail-coerce ] when
  [ 0 [ data swap _chunk ] loop drop ] collect-bytes ;

META: strip-headers
  use-when "You have a raw HTTP request or response with its headers and body together, and want only the body bytes." ;
  see-also http:dechunk ;
  link "https://www.rfc-editor.org/rfc/rfc9112" "RFC 9112: HTTP/1.1" ;
;

META: dechunk
  use-when "You have a chunked HTTP body, with hex sizes before its pieces and a zero at the end, and want the joined content." ;
  see-also http:strip-headers ;
  link "https://www.rfc-editor.org/rfc/rfc9112#section-7.1" "RFC 9112, section 7.1: chunked transfer coding" ;
  link "https://en.wikipedia.org/wiki/Chunked_transfer_encoding" "Chunked transfer encoding on Wikipedia" ;
;
