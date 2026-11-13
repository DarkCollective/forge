\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ zstd: Zstandard decompression (RFC 8878), beyond CyberChef (which has no Zstandard). The decoder is
\ one private primitive over fzstd (src/prims/zstd.ts): it walks the frames, refuses dictionary frames,
\ oversized windows and declared sizes, feeds fzstd in chunks, bounds the output at the value limit and
\ checks the XXH64 content checksum. Compression is not offered (it would need WASM).
IN: zstd

: decompress ( data:bytes verify:bool=true -- bytes )
  "Decompress a Zstandard stream (RFC 8878): one or more frames, concatenated frames and skippable frames included, as the zstd CLI writes them. With verify (the default) each frame's content checksum (XXH64, low 32 bits) must match, otherwise E_COERCE; without verify the checksum is not checked. Corrupt, cut-short or non-zstd data, a reserved bit, an invalid block and an empty input are E_COERCE naming the fault. A frame with a dictionary ID is E_COERCE: dictionaries are not supported. A frame whose window (the decoder allocates it) or declared content size is over the value limit is E_LIMIT_VALUE before any decoding, and output past the limit stops with E_LIMIT_VALUE (the decompression bomb rule of the Wave 6 conventions). Not supported: dictionaries, and compression." doc
  "Compression" category
  data verify _decompress ;

META: decompress
  use-when "You have Zstandard data, starting with the bytes 28 b5 2f fd, and want the bytes it holds." ;
  param verify "Check each frame's content checksum (XXH64); off, the checksum is skipped and corrupt content may come out unnoticed." ;
  see-also deflate:gunzip deflate:inflate ;
  link "https://www.rfc-editor.org/rfc/rfc8878" "RFC 8878: Zstandard compression" ;
  link "https://en.wikipedia.org/wiki/Zstandard" "Zstandard on Wikipedia" ;
;
