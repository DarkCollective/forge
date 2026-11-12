\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ pbkdf2: PBKDF2 with HMAC, RFC 8018 section 5.2 (PKCS #5 v2.1), the parameters of CyberChef's "Derive
\ PBKDF2 key" (passphrase, key size, iterations, hash, salt). The passphrase is the input; the salt is
\ a key-type parameter; the key size is in bytes (CyberChef counts bits). The derived key is raw bytes;
\ chain hex:encode for text. The work is _derive, a private primitive (src/prims/pbkdf2.ts) over the
\ audited @noble/hashes library, because a real iteration count is far beyond the FL step budget.
IN: pbkdf2

: derive ( password:bytes size:int=16 iterations:int=1 hash:choice{sha1|sha256|sha384|sha512|md5}="sha1" salt:key{hex|utf8|latin1|base64}="" -- bytes )
  "The PBKDF2-HMAC key (RFC 8018) derived from the input passphrase, as raw bytes, size bytes long (CyberChef counts bits: its 128 bits is 16 bytes). The salt may be empty; where CyberChef generates a random salt for an empty one, the result here is always the same for the same parameters. Limits (E_RANGE): size 1 to 1024 bytes, iterations at least 1, and iterations times the number of hash blocks of the key at most 2,000,000. Chain hex:encode for hex text." doc
  "Key derivation" category
  password salt size iterations hash _derive ;

META: derive
  use-when "You have a password and a salt and need the key a system derived from them, for example to decrypt a file or to check a stored hash." ;
  param size "The length of the derived key in bytes, 1 to 1024 (CyberChef's 128 bits is 16)." ;
  param iterations "The iteration count, at least 1. Iterations times the key's hash blocks is capped at 2,000,000." ;
  param hash "The HMAC hash: sha1, sha256, sha384, sha512 or md5." ;
  param salt "The salt, any length, empty by default." ;
  see-also hmac:digest hex:encode ;
  link "https://www.rfc-editor.org/rfc/rfc8018#section-5.2" "RFC 8018, section 5.2: PBKDF2" ;
  link "https://www.rfc-editor.org/rfc/rfc6070" "RFC 6070: PBKDF2 test vectors" ;
  link "https://en.wikipedia.org/wiki/PBKDF2" "PBKDF2 on Wikipedia" ;
;
