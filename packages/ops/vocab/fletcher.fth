\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ fletcher: the Fletcher checksums with CyberChef's conventions, written in FL on the core words;
\ no primitives. Data is read as words of s bytes, least significant byte first (s = 1 for
\ Fletcher-8 and -16, 2 for -32, 4 for -64; a short last word is padded with zero bytes), and
\ both sums are reduced modulo 2^(bits/2) - 1 (CyberChef reduces by 0xf, 0xff, 0xffff and
\ 0xffffffff). Reducing at every step equals reducing once at the end, so with n words
\ a = sum of the words and b = sum over i of (n - i) * word i, in a few linear passes.
\ 65536 bytes take about 1.6 million steps (default limit: 10 million).
IN: fletcher

\ Bytes per word.
: _s ( bits:int -- int )
  bits 16 div 1 max ;

\ Each byte times the place value of its position inside its word of s bytes.
: _words ( data:bytes s:int -- list )
  data bytes>list [ s mod 8 * 1 swap shl * ] mapi ;

\ The number of words of s bytes in n bytes, counting a short last word.
: _nw ( n:int s:int -- int )
  n s 1 - + s div ;

\ The sum over the words of (nw - index) * word, from the per-byte values of _words.
: _weighted ( ws:list s:int nw:int -- int )
  ws [ s div nw swap - * ] mapi 0 [ + ] reduce ;

: _fletcher ( data:bytes bits:int -- bytes )
  data bits _s _words
  dup 0 [ + ] reduce 1 bits 2 div shl 1 - mod
  swap bits _s data len bits _s _nw _weighted 1 bits 2 div shl 1 - mod
  1 bits 2 div shl * + bits 8 div util:int>be-bytes ;

: checksum ( data:bytes size:choice{8|16|32|64}=16 -- bytes )
  "A Fletcher checksum as size/8 big-endian bytes: the second sum b first, then the first sum a (CyberChef prints b then a). Fletcher-8 and -16 add one byte at a time, modulo 15 and 255; Fletcher-32 and -64 add little-endian 16-bit and 32-bit words, modulo 65535 and 4294967295, with a short last word zero-padded." doc
  "Hashing" category
  data size str>int _fletcher ;

META: checksum
  param size "Checksum size in bits: 8, 16, 32 or 64." ;
  see-also crc:checksum ;
;
