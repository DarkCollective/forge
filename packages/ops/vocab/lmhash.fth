\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lmhash: the LAN Manager password hash (MS-NLMP 3.3.1 LMOWFv1). The text is upper-cased, encoded as
\ ISO 8859-1, zero-padded or truncated to 14 bytes, and the constant "KGS!@#$%" is DES-encrypted under
\ each 7-byte half. Upper-casing comes before the truncation, as CyberChef's "LM Hash" does. The DES
\ work is _hash, a private primitive (src/prims/lmhash.ts) over the single-block DES of des.ts, which
\ FL cannot call from the des vocabulary. Its own vocabulary, like nthash, because its input is text.
IN: lmhash

: digest ( text:str -- bytes )
  "The LM hash of a password: the text is upper-cased, encoded as ISO 8859-1, zero-padded or cut to 14 bytes, and the constant KGS!@#$% is DES-encrypted under each 7-byte half; 16 raw bytes. Chain hex:encode for hex text. A very weak legacy hash: do not use it to store passwords." doc
  "Hashing" category
  text upper "iso-8859-1" charset:encode _hash ;

META: digest
  see-also nthash:digest hex:encode ;
;
