\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ argon2: Argon2d, Argon2i and Argon2id, RFC 9106, with the parameters of CyberChef's "Argon2" (salt,
\ iterations, memory in KiB, parallelism, hash length in bytes, type, output format) and its "Argon2
\ compare". The password is the input. The encoded output is the PHC string
\ $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash> (unpadded base64) as ASCII bytes; CyberChef's hex output is
\ the raw output chained through hex:encode. The work is _derive and _verify, private primitives
\ (src/prims/argon2.ts) over the audited @noble/hashes library: Argon2 is memory-hard.
IN: argon2

: derive ( password:bytes salt:key{utf8|hex|latin1|base64}="somesalt" iterations:int=3 memory:int=4096 parallelism:int=1 length:int=32 type:choice{argon2i|argon2d|argon2id}="argon2i" output:choice{encoded|raw}="encoded" -- bytes )
  "The Argon2 hash (RFC 9106, version 0x13) of the input password. With output encoded (the default, as CyberChef) the result is the PHC string $argon2i$v=19$m=4096,t=3,p=1$salt$hash as ASCII bytes, with the salt and the hash in unpadded base64; with raw it is the length-byte hash (chain hex:encode for hex). The salt is at least 8 bytes. Limits (E_RANGE): memory 8 to 262,144 KiB (256 MiB) and at least 8 * parallelism, iterations 1 to 64, memory * iterations at most 1,048,576, parallelism 1 to 64, length 4 to 1024." doc
  "Key derivation" category
  password salt iterations memory parallelism length type output "encoded" = _derive ;

: compare ( password:bytes encoded:str -- bool )
  "True when the input password gives the hash in the encoded Argon2 string ($argon2id$v=19$m=..,t=..,p=..$salt$hash, as argon2:derive writes it; a missing version means v=16). The hash is recomputed with the parameters in the string and compared in constant time. A string that is not a well-formed encoded Argon2 hash is E_COERCE; a cost in it above the limits of argon2:derive is E_RANGE. Where CyberChef returns the text Match or No match, this is a bool." doc
  "Key derivation" category
  password encoded _verify ;

META: derive
  use-when "You have a password, a salt and the cost settings, and need the Argon2 hash a system stored, or want to make a new one for a password file." ;
  param salt "The salt, at least 8 bytes (CyberChef's default is the text somesalt)." ;
  param iterations "The time cost t (passes over the memory), 1 to 64." ;
  param memory "The memory cost m in KiB, at most 262,144 (256 MiB)." ;
  param parallelism "The number of lanes p, 1 to 64." ;
  param length "The length of the hash in bytes, 4 to 1024." ;
  param type "argon2i (CyberChef's default), argon2d or argon2id (the choice RFC 9106 recommends)." ;
  param output "encoded: the PHC string (CyberChef's default); raw: the hash bytes (chain hex:encode for hex)." ;
  see-also argon2:compare ;
  link "https://www.rfc-editor.org/rfc/rfc9106" "RFC 9106: Argon2 memory-hard hashing" ;
  link "https://en.wikipedia.org/wiki/Argon2" "Argon2 on Wikipedia" ;
;

META: compare
  use-when "You have a stored Argon2 hash string and a password to try, and want a yes or no without working out the salt and cost settings yourself." ;
  param encoded "The encoded hash, as written by argon2:derive." ;
  link "https://www.rfc-editor.org/rfc/rfc9106" "RFC 9106: Argon2 memory-hard hashing" ;
  link "https://en.wikipedia.org/wiki/Argon2" "Argon2 on Wikipedia" ;
;
