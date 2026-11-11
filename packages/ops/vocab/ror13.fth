\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ror13: the ROR13 hash used for API name hashing in shellcode (CyberChef's ROR13 is exactly this loop and
\ is not a cipher): h = 0; for each byte b, h = ror32(h, 13) + b (mod 2^32). Written in FL on the core words;
\ no primitives. ror32(h, 13) is (h mod 2^13) * 2^19 + h div 2^13. 65536 bytes take about 1.3 million steps
\ (default limit: 10 million). The result is four big-endian bytes, like the checksums; CyberChef prints it
\ as 0x and eight upper-case hex digits.
IN: ror13

: hash ( data:bytes -- bytes )
  "The ROR13 API-name hash used in shellcode (for example in the Metasploit block_api stubs): starting from 0, each byte rotates the 32-bit accumulator right by 13 bits and is then added to it modulo 2^32. The result is four big-endian bytes (chain hex:encode; CyberChef shows it as 0x and upper-case hex). The input is hashed as given: to hash an API name the way a stub does, add the terminating zero byte (and use upper-case or wide characters where the stub does) before this step. The empty input gives 00000000." doc
  "Hashing" category
  data bytes>list 0 [ swap dup 8192 mod 524288 * swap 8192 div + + 4294967296 mod ] reduce
  4 util:int>be-bytes ;

META: hash
  see-also adler32:checksum hex:encode ;
;
