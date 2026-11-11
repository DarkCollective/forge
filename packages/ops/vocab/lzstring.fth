\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lzstring: LZString (pieroxy's lz-string, here 1.5.0) compress and decompress. The format is defined by
\ the library, which two private primitives call (src/prims/lzstring.ts): _compress and _decompress. They
\ also hold the output limit (the quadratic expansion of the format makes a stream's size a poor guide).
\ The format is a choice, checked by the parameter header (the primitives check it again).
IN: lzstring

: compress ( data:bytes format:choice{default|utf16|base64|uri}="default" -- bytes )
  "LZString-compress text (lz-string 1.5.0). The input is UTF-8 text (anything else is E_COERCE). The output is bytes: default is the library's 16-bit code units as UCS-2 big-endian byte pairs (what its compressToUint8Array writes; CyberChef shows the same units as a string, which cannot carry lone surrogates), utf16 is compressToUTF16 as UTF-8, base64 is compressToBase64 and uri is compressToEncodedURIComponent, both ASCII." doc
  "Compression" category
  data format _compress ;

: decompress ( data:bytes format:choice{default|utf16|base64|uri}="default" -- bytes )
  "LZString-decompress to UTF-8 text bytes (lz-string 1.5.0); format is the one compress wrote (default is UCS-2 big-endian byte pairs, an even length). Empty input, input outside that format's alphabet or not UTF-8, a truncated stream (no end marker), a code that names no dictionary entry and text that holds an unpaired surrogate are E_COERCE. The expansion is checked before the library builds any string: output past the value limit is E_LIMIT_VALUE." doc
  "Compression" category
  data format _decompress ;

META: compress
  param format "default: the 16-bit units as big-endian byte pairs; utf16: compressToUTF16 (UTF-8); base64: compressToBase64; uri: compressToEncodedURIComponent. CyberChef offers default, UTF16 and Base64." ;
  see-also lzstring:decompress ;
;

META: decompress
  param format "The format compress wrote: default, utf16, base64 or uri." ;
  see-also lzstring:compress ;
;
