\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ scrypt: the password-based key derivation function of RFC 7914, with the parameters of CyberChef's
\ "Scrypt" (salt, N, r, p, key length; the password is the input). The key is raw bytes; chain
\ hex:encode for text. The work is _derive, a private primitive (src/prims/scrypt.ts) over the audited
\ @noble/hashes library: scrypt is memory-hard and far too slow in FL.
IN: scrypt

: derive ( password:bytes salt:key{hex|base64|utf8|latin1}="" n:int=16384 r:int=8 p:int=1 length:int=64 -- bytes )
  "The scrypt key (RFC 7914) of the input password, as raw bytes, length bytes long. N is the CPU and memory cost (a power of two), r the block size and p the parallelism; memory is 128 * N * r bytes. Limits (E_RANGE): N a power of two from 2 to 1,048,576, N * r at most 2,097,152 (256 MiB), N * r * p at most 8,388,608, length 1 to 4096. So the RFC 7914 case with N = 1,048,576 (1 GiB) is out of range. Chain hex:encode for hex text." doc
  "Key derivation" category
  password salt n r p length _derive ;

META: derive
  param salt "The salt, any length, empty by default." ;
  param n "The cost N, a power of two (CyberChef's Iterations); memory is 128 * N * r bytes, at most 256 MiB." ;
  param r "The block size r (CyberChef's Memory factor)." ;
  param p "The parallelism p (CyberChef's Parallelization factor)." ;
  param length "The length of the derived key in bytes, 1 to 4096." ;
  see-also pbkdf2:derive hex:encode ;
;
