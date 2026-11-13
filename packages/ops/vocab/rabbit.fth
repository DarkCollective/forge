\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rabbit: the Rabbit stream cipher (RFC 4503). Bytes in, bytes out. The state is eight 32-bit variables with a
\ carry, so it is a private primitive (src/prims/rabbit.ts); the parameters and the metadata are FL.
\ The default byte order is the RFC's (most significant byte first); Little is Crypto++'s, as in CyberChef.
IN: rabbit

: crypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" endianness:choice{Big|Little}="Big" -- bytes )
  "Rabbit (RFC 4503) of the input bytes: they are XORed with the Rabbit key stream, so the same word encrypts and decrypts. The key is 16 bytes (E_RANGE otherwise). The IV is empty (no IV setup, RFC appendix A.1) or 8 bytes (A.2); other lengths are E_RANGE. endianness Big is the RFC's byte order (its test vectors); Little is the Crypto++ order. A last block shorter than 16 bytes uses the rightmost bytes of the key stream block in Big order and the leftmost in Little (CyberChef's convention). Chain hex:encode for text." doc
  "Encryption" category
  key iv endianness "Little" = _crypt ;

META: crypt
  use-when "You have a 16-byte Rabbit key and data from an RFC 4503 system, and you need the key stream applied to it. For new designs, use ChaCha20 or AES-GCM." ;
  param key "The Rabbit key: 16 bytes." ;
  param iv "The initialisation vector: 8 bytes, or empty for none." ;
  param endianness "Big follows RFC 4503 (the test vectors of its appendix A); Little is the byte order of Crypto++." ;
  see-also hex:encode ;
  link "https://www.rfc-editor.org/rfc/rfc4503" "RFC 4503: the Rabbit stream cipher" ;
  link "https://en.wikipedia.org/wiki/Stream_cipher" "Stream cipher on Wikipedia" ;
;
