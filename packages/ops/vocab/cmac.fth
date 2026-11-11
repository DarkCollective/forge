\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ cmac: CMAC (NIST SP 800-38B, RFC 4493) over AES or Triple DES, the parameters of CyberChef's "CMAC"
\ (key, algorithm). The MAC is raw bytes; chain hex:encode for CyberChef's hex text. The work is _mac, a
\ private primitive (src/prims/cmac.ts) that calls the TypeScript block functions of AES and Triple DES
\ directly, because the block words of the aes and triple-des vocabularies are private to them.
IN: cmac

: digest ( data:bytes key:key{hex|utf8|latin1|base64} algorithm:choice{AES|TDES}="AES" -- bytes )
  "The CMAC (NIST SP 800-38B, RFC 4493) of the input under the key. AES takes a 16, 24 or 32-byte key and gives a 16-byte tag; TDES (Triple DES) takes a 16-byte (two-key) or 24-byte key and gives an 8-byte tag. A key of another length is E_RANGE. Chain hex:encode for text." doc
  "Hashing" category
  data key algorithm _mac ;

META: digest
  param key "The MAC key: 16, 24 or 32 bytes for AES, 16 or 24 bytes for Triple DES." ;
  param algorithm "The block cipher: AES (default, as CyberChef) or TDES (Triple DES)." ;
  see-also hmac:digest hex:encode ;
;
