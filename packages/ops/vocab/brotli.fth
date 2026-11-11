\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ brotli: Brotli decompression (RFC 7932), beyond CyberChef's set of decoders. The decoder is a
\ vendored copy of the brotli 2.1.0 decoder with an output cap (src/vendor/brotli, src/prims/brotli.ts).
\ Compression is not offered (the compressor is not used).
IN: brotli

: decompress ( data:bytes -- bytes )
  "Decompress a Brotli stream (RFC 7932), using the built-in static dictionary as the format requires. Corrupt or cut-short data (including an input of no bytes), non-zero padding after the last meta-block, and bytes after it are E_COERCE naming the fault, as the reference decoder reports them.Output past the value limit stops with E_LIMIT_VALUE: the decoder checks each meta-block's claimed length before it allocates for it, so a small stream that claims a large output stops at once (the decompression bomb rule of the Wave 6 conventions). Not supported: a custom dictionary, and compression." doc
  "Compression" category
  data _decompress ;

META: decompress
  see-also deflate:inflate zstd:decompress ;
;
