\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ aes-kw: AES Key Wrap and Key Unwrap (RFC 3394), the key wrapping algorithm, over the audited
\ @noble/ciphers (src/prims/aes-kw.ts). The data and the wrapped key are bytes; the key-encryption key is a
\ key-type parameter, so hex, UTF-8, Latin-1 and Base64 come for free. The RFC 3394 default IV is fixed.
IN: aes-kw

: wrap ( bytes kek:key{hex|utf8|latin1|base64} -- bytes )
  "AES Key Wrap (RFC 3394): wraps the key data under the key-encryption key (KEK) of 16, 24 or 32 bytes (E_RANGE otherwise). The key data is a multiple of 8 bytes and at least 16 (E_COERCE otherwise). The output is 8 bytes longer than the input. The IV is the RFC 3394 default (A6A6A6A6A6A6A6A6), so there is no IV parameter. Chain hex:encode for text." doc
  "Encryption" category
  kek _wrap ;

: unwrap ( bytes kek:key{hex|utf8|latin1|base64} -- bytes )
  "AES Key Unwrap (RFC 3394), the inverse of aes-kw:wrap under the same key-encryption key. The wrapped key is a multiple of 8 bytes and at least 24 (E_COERCE otherwise). A wrong key or corrupted data fails the RFC 3394 integrity check, which is E_COERCE, and no key data is returned. A key-encryption key of the wrong length is E_RANGE." doc
  "Encryption" category
  kek _unwrap ;

META: wrap
  param kek "The key-encryption key: 16, 24 or 32 bytes (AES-128, -192 or -256)." ;
  see-also aes-kw:unwrap hex:encode ;
;

META: unwrap
  param kek "The key-encryption key that wrapped the key: 16, 24 or 32 bytes." ;
  see-also aes-kw:wrap hex:decode ;
;
