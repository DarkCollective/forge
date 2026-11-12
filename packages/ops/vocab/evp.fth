\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ evp: OpenSSL's EVP_BytesToKey key derivation, written in FL over the digest words of md5, sha1 and sha2, with
\ the parameters of CyberChef's "Derive EVP key" (passphrase, key size, iterations, hash, salt). The passphrase
\ is the input; the key size is in bytes (CyberChef counts bits). D(1) = H^iterations(passphrase || salt) and
\ D(i) = H^iterations(D(i-1) || passphrase || salt); the key is the first size bytes of D(1) || D(2) || ...
\ OpenSSL derives the key and the IV in one run: ask for key size + IV size bytes and slice. There is no RFC
\ for it. The key is raw bytes; chain hex:encode for text.
IN: evp

USING: md5 sha1 sha2 ;

\ The previous block D(i-1); set to the empty block by derive.
#[ ] VARIABLE _prev

\ The digest of data under the hash named alg (one of the choices of derive).
: _digest ( bytes str -- bytes )
  dup "md5" = [ drop md5:digest ] [
  dup "sha1" = [ drop sha1:digest ] [
  dup "sha256" = [ drop "256" sha2:digest ] [
  dup "sha384" = [ drop "384" sha2:digest ] [
  drop "512" sha2:digest
  ] if ] if ] if ] if ;

\ The next block: the hash, applied iter times, of the previous block, the passphrase and the salt.
: _block ( i:int pass:bytes salt:bytes alg:str iter:int -- bytes )
  _prev pass cat salt cat alg _digest
  iter 1 - [ alg _digest ] times
  dup _prev! ;

: derive ( password:bytes size:int=16 iterations:int=1 hash:choice{sha1|sha256|sha384|sha512|md5}="sha1" salt:key{hex|utf8|latin1|base64}="" -- bytes )
  "The key of OpenSSL's EVP_BytesToKey from the input passphrase, as raw bytes, size bytes long (CyberChef counts bits: its 128 bits is 16 bytes). Each block is the hash, applied iterations times, of the previous block, the passphrase and the salt; the blocks are joined and cut to size. The salt may be empty (OpenSSL uses 8 bytes; CyberChef generates a random one for an empty salt, but here the result is always the same for the same parameters). For a key and an IV, ask for both sizes together and slice. Limits (E_RANGE): size 1 to 1024, iterations at least 1; a large iteration count runs into the step limit (E_LIMIT_STEPS). Chain hex:encode for hex text." doc
  "Key derivation" category
  size 1 < size 1024 > or [ "the EVP key size must be 1 to 1024 bytes" raise:range ] when
  iterations 1 < [ "the EVP iteration count must be at least 1" raise:range ] when
  #[ ] _prev!
  1 size #[ ] hash _digest len util:ceil-div 1 + range [ password salt hash iterations _block ] map #[ ] bjoin
  0 size slice ;

META: derive
  use-when "You have a passphrase and the salt of a file made by openssl enc without -pbkdf2, and need its key and IV, for example to decrypt it with another tool." ;
  param size "The length of the derived key in bytes, 1 to 1024 (CyberChef's 128 bits is 16)." ;
  param iterations "How many times each block is hashed, at least 1 (OpenSSL's default is 1)." ;
  param hash "The hash: sha1, sha256, sha384, sha512 or md5." ;
  param salt "The salt, any length (OpenSSL's is 8 bytes), empty by default." ;
  see-also md5:digest sha2:digest pbkdf2:derive hex:encode ;
  link "https://www.openssl.org/docs/man3.0/man3/EVP_BytesToKey.html" "OpenSSL manual: EVP_BytesToKey" ;
;
