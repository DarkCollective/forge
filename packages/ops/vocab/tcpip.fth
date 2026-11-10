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
  see-also xor-checksum:checksum ;
;
