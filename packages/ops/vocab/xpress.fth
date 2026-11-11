\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xpress: the two XPRESS decompressors of [MS-XCA], written from that specification: Plain LZ77
\ (sections 2.3 and 2.4) and LZ77+Huffman (sections 2.1 and 2.2). The decoders are private primitives
\ (src/prims/xpress.ts): the match loops and the bit-level Huffman decoding cost far more than the 13 VM
\ steps per byte that already cap an FL loop near 750 KB (a prototype of the simpler LZNT1 loop took 12 to
\ 49 steps per output byte). The ops and their documentation are FL.
IN: xpress

: decompress ( data:bytes -- bytes )
  "Decompress XPRESS Plain LZ77 data (MS-XCA 2.4; CyberChef's XPRESS Decompress): 32-bit flag words choose between literal bytes and 16-bit match words (13-bit offset up to 8192, 3-bit length, extended with a shared 4-bit nibble, a byte, 16 bits or 32 bits for long matches). The data ends at a match flag with no input left. Truncated data, a match before the start of the output or a bad long length is E_COERCE naming the fault; empty input is E_COERCE (the stream starts with a flag word); output past the value limit stops with E_LIMIT_VALUE (the decompression bomb rule of the Wave 6 conventions)." doc
  "Compression" category
  data _lz77 ;

: huffman-decompress ( data:bytes -- bytes )
  "Decompress XPRESS LZ77+Huffman data (MS-XCA 2.2; CyberChef's XPRESS LZ77+Huffman Decompress): blocks of 64 KiB of output, each a 256-byte table of 512 four-bit code lengths (symbols 0-255 literals, 256-511 matches with a 15-bit offset and a length that grows through extra bytes) and a bit stream read in 16-bit words; the end-of-data symbol (256) ends the data. An invalid Huffman table (over-subscribed or incomplete), truncated data, a match before the start of the output or a bad long length is E_COERCE naming the fault; empty input is E_COERCE; output past the value limit stops with E_LIMIT_VALUE (the decompression bomb rule of the Wave 6 conventions)." doc
  "Compression" category
  data _huffman ;

META: decompress
  see-also xpress:huffman-decompress lznt1:decompress ;
;

META: huffman-decompress
  see-also xpress:decompress lznt1:decompress ;
;
