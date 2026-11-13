\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lznt1: the LZNT1 decompressor of [MS-XCA] section 2.5 (Windows NTFS compression, RtlDecompressBuffer),
\ written from that specification. The chunk and flag-group loop is one private primitive
\ (src/prims/lznt1.ts): an FL prototype cost 12 to 49 VM steps per output byte, which caps the output
\ near 200 KB under the default step limit, far below the 16 MiB value limit. The op and its documentation are FL.
IN: lznt1

: decompress ( data:bytes -- bytes )
  "Decompress LZNT1 data (MS-XCA 2.5; the Windows RtlDecompressBuffer format of NTFS compression). The buffer is a series of chunks, each with a 16-bit header (compressed flag, signature 3, size minus 3); a compressed chunk is flag bytes of literals and 2-byte match words whose displacement and length bit split follows the chunk position, an uncompressed chunk is stored. A zero header ends the data (a missing end marker is fine; bytes after it are ignored); empty input gives empty output. A bad signature, a chunk or word cut short, a match before the start of its chunk or a chunk that expands past 4096 bytes is E_COERCE naming the fault; output past the value limit stops with E_LIMIT_VALUE (the decompression bomb rule of the Wave 6 conventions)." doc
  "Compression" category
  data _decompress ;

META: decompress
  use-when "You have LZNT1 data from NTFS compression or a Windows RtlDecompressBuffer call, and want the bytes it holds." ;
;
