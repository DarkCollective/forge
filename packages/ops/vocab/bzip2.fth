\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bzip2: the bzip2 file format (Burrows-Wheeler transform, MTF, Huffman), written from the format with no
\ library. The codec is two private primitives (src/prims/bzip2.ts): _compress and _decompress, because the
\ bit-level loops and the per-byte CRC-32 (MSB first) are far too slow in FL at 64 KiB. The words here are the
\ parameters, their range checks and the metadata.
IN: bzip2

: compress ( data:bytes block-size:int=9 work-factor:int=30 -- bytes )
  "A bzip2 stream (BZh1 to BZh9) of the input. block-size is the block size in hundreds of kilobytes, 1 to 9 (CyberChef's Block size, default 9; else E_RANGE). work-factor is accepted for CyberChef's recipes (0 to 250, else E_RANGE) and ignored: it tunes libbzip2's fallback between two sorting algorithms, and Forge sorts one way. The empty input gives the 14-byte empty stream. The bytes can differ from libbzip2's (a different Huffman refinement), and every bzip2 reads them." doc
  "Compression" category
  block-size 1 9 "the block size" util:check-int-range
  work-factor 0 250 "the work factor" util:check-int-range
  data block-size _compress ;

: decompress ( data:bytes verify:bool=true -- bytes )
  "Decompress bzip2 data: one stream or several written one after the other (as bzip2 -d joins them); bytes after the last stream that do not begin another one are ignored. Randomised blocks (a deprecated form) are read. With verify (the default) every block CRC and the stream CRC must match, otherwise E_COERCE; a missing magic, a bad block size digit, a bad Huffman table, a block larger than its stated size or data that ends early is E_COERCE naming the fault. Output past the value limit stops with E_LIMIT_VALUE (the decompression bomb rule). CyberChef's low-memory option is not offered: it chooses a slower algorithm in libbzip2 and the result is the same." doc
  "Compression" category
  data verify _decompress ;

META: compress
  param block-size "The block size in hundreds of kilobytes, 1 to 9 (900 kB by default)." ;
  param work-factor "CyberChef's work factor, 0 to 250. Accepted and ignored: Forge has one sorting method." ;
  see-also bzip2:decompress deflate:gzip ;
;

META: decompress
  param verify "Check the CRC-32 of each block and of the stream; off, a damaged checksum is ignored and the data is still returned." ;
  see-also bzip2:compress deflate:gunzip ;
;
