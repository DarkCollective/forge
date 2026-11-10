\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xor-checksum: the column-wise XOR of the blocks of the data (CyberChef's XOR Checksum), written
\ in FL on the core words; no primitives. 65536 bytes take about 0.79 million steps with a block
\ size of 4, 2.4 million with 65536 (default limit: 10 million).
IN: xor-checksum

\ The xor of the bytes at positions i, i + bs, i + 2 bs, ... (none: 0).
: _column ( data:bytes i:int bs:int -- int )
  0 data len i - bs + 1 - bs div range [ bs * i + data swap nth ] map 0 [ bxor ] reduce ;

: checksum ( data:bytes blocksize:int[1..65536]=4 -- bytes )
  "Split the data into blocks of blocksize bytes and xor the blocks together, byte position by byte position. The last block is treated as if padded with zero bytes. The result is always blocksize bytes; empty input gives zeros." doc
  "Hashing" category
  0 blocksize range [ data swap blocksize _column ] map list>bytes ;

META: checksum
  param blocksize "The block size in bytes, which is also the size of the result." ;
  see-also bits:xor ;
;
