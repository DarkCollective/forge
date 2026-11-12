\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ gost: the GOST R 34.11-94 hash (RFC 5831), built on the GOST 28147-89 block cipher. 256-bit digest.
\ The digest is 32 raw bytes; chain hex:encode for text. The hash itself is _hash, a private
\ primitive (src/prims/gost.ts); the parameter and the metadata are FL. The newer GOST R 34.11-2012
\ is the separate vocabulary streebog.
IN: gost

: digest ( bytes sbox:choice{"test"|"cryptopro"}="cryptopro" -- bytes )
  "The GOST R 34.11-94 digest (RFC 5831) of the input as 32 raw bytes. Chain hex:encode for hex text. The S-box set is the one of the cipher: the RFC 5831 test parameters or the CryptoPro parameters (RFC 4357)." doc
  "Hashing" category
  sbox _hash ;

META: digest
  use-when "You need a GOST R 34.11-94 digest, the Russian standard that Streebog replaced, to match a value. Choose the S-box set that the value names." ;
  param sbox "The substitution box: test (the RFC 5831 test parameters) or cryptopro (id-GostR3411-94-CryptoProParamSet)." ;
  link "https://www.rfc-editor.org/rfc/rfc5831" "RFC 5831: GOST R 34.11-94 with test parameters" ;
  link "https://www.rfc-editor.org/rfc/rfc4357" "RFC 4357: GOST parameter sets, CryptoPro included" ;
  link "https://en.wikipedia.org/wiki/GOST_(hash_function)" "GOST hash function on Wikipedia" ;
;
