\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ tcpip: the Internet checksum of RFC 1071 (IPv4, TCP, UDP, ICMP), written in FL on the core
\ words; no primitives. The ones' complement sum of 16-bit big-endian words, with the carries
\ folded back in, is the sum reduced into 1..65535 (0 stays 0), so the fold is one modulo.
\ 65536 bytes take about 0.72 million steps (default limit: 10 million).
IN: tcpip

: checksum ( data:bytes -- bytes )
  "The Internet checksum (RFC 1071) as two big-endian bytes: the ones' complement of the ones' complement sum of the data read as 16-bit big-endian words, an odd last byte padded with a zero byte on the right. To verify, checksum a message that includes its checksum field: the result is 0000. Unlike CyberChef, which folds the carry once, the carry is folded until it is gone." doc
  "Hashing" category
  data bytes>list [ 2 mod 0 = [ 256 * ] when ] mapi util:sum
  dup 0 > [ 1 - 65535 mod 1 + ] when
  65535 swap - 2 util:int>be-bytes ;

META: checksum
  use-when "You are building or checking an IPv4, TCP, UDP or ICMP header and need its Internet checksum, or want to verify one with its field in place." ;
  see-also xor-checksum:checksum ;
  link "https://www.rfc-editor.org/rfc/rfc1071" "RFC 1071: computing the Internet checksum" ;
  link "https://en.wikipedia.org/wiki/Internet_checksum" "Internet checksum on Wikipedia" ;
;
