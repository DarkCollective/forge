\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lzma: LZMA in the .lzma ("LZMA alone") format, CyberChef's LZMA Compress and LZMA Decompress. The
\ codec is two private primitives over lzma1 (src/prims/lzma.ts): _compress and _decode. Everything
\ around it is FL: the level and the 13-byte header's framing (a short header, a properties byte out of
\ range), and the comparison of the output with the size the header declares. The primitive owns the
\ output limit, because only it can read ctx.limits.maxValueBytes.
IN: lzma

: compress ( data:bytes level:int=7 -- bytes )
  "An LZMA stream in the .lzma (LZMA alone) format: a 13-byte header (the properties, a dictionary size, the uncompressed size) and the LZMA data with its end marker. level is 1 (fastest) to 9 (smallest), CyberChef's Compression Mode, 7 by default; any other level is E_RANGE. The bytes differ from CyberChef's (another encoder), but xz --format=lzma, 7-Zip and Python's lzma module read them." doc
  "Compression" category
  level 1 9 "the compression level" util:check-int-range
  data level _compress ;

\ The header is 13 bytes, and the properties byte (lc, lp and pb packed as (pb * 5 + lp) * 9 + lc) is below 225.
: _check-header ( data:bytes -- )
  data len 13 < [ "unexpected EOF: an .lzma header is 13 bytes" raise:coerce ] when
  data 0 nth 225 >= [ "not LZMA data: the properties byte is out of range (lc, lp and pb)" raise:coerce ] when ;

\ The output must have the size the header declares; -1 (unknown) has nothing to compare with.
: _check-size ( out:bytes declared:int -- bytes )
  declared -1 <> [
    out len declared <> [
      "lzma data does not match its declared size (corrupt data): the output is " out len int>str cat
      " bytes, the header says " cat declared int>str cat " bytes" cat raise:coerce
    ] when
  ] when
  out ;

: decompress ( data:bytes -- bytes )
  "The bytes of an LZMA stream in the .lzma format (CyberChef's LZMA Decompress). The header is checked (shorter than 13 bytes, or a properties byte out of range, is E_COERCE). A declared size above the value limit (16 MiB for shared recipes, 64 MiB otherwise) is E_LIMIT_VALUE before anything is decoded. An unknown size (all 0xFF, as xz and Python write it) is decoded only up to the limit, and more output is E_LIMIT_VALUE: the decompression bomb rule of the wave 6 conventions. Corrupt or cut-short data is E_COERCE naming the fault, and so is output whose length differs from the declared size." doc
  "Compression" category
  data _check-header
  data _decode _check-size ;

META: compress
  param level "The compression level, 1 (fastest) to 9 (smallest); 7 is CyberChef's default." ;
  see-also lzma:decompress deflate:gzip ;
;

META: decompress
  see-also lzma:compress deflate:inflate ;
;
