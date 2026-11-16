\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hmac: HMAC, RFC 2104, written in FL over the digest words of the other hash vocabularies (md2,
\ md4, md5, sha0, sha1, sha2, sha3, ripemd, ripemd160, has160, whirlpool and snefru). Blake2 and
\ BLAKE3 have keyed modes of their own and SHAKE has no fixed output length, so they are not
\ offered. The key is hashed when it is longer than the block size of the hash, then zero-padded to
\ the block size; the inner key is the padded key xor 0x36 and the outer key is the padded key xor
\ 0x5C. The MAC is raw bytes; chain hex:encode for text.
IN: hmac

USING: md2 md4 md5 sha0 sha1 sha2 sha3 ripemd ripemd160 has160 whirlpool snefru ;

\ The digest of data under the hash named alg (one of the choices of digest).
: _digest ( data:bytes alg:str -- bytes )
  alg {
    "md2" [ data md2:digest ]
    "md4" [ data md4:digest ]
    "md5" [ data md5:digest ]
    "sha0" [ data sha0:digest ]
    "sha1" [ data sha1:digest ]
    "sha224" [ data "224" sha2:digest ]
    "sha256" [ data "256" sha2:digest ]
    "sha384" [ data "384" sha2:digest ]
    "sha512" [ data "512" sha2:digest ]
    "sha512/224" [ data "512/224" sha2:digest ]
    "sha512/256" [ data "512/256" sha2:digest ]
    "sha3-224" [ data "224" sha3:digest ]
    "sha3-256" [ data "256" sha3:digest ]
    "sha3-384" [ data "384" sha3:digest ]
    "sha3-512" [ data "512" sha3:digest ]
    "ripemd128" [ data "128" ripemd:digest ]
    "ripemd256" [ data "256" ripemd:digest ]
    "ripemd320" [ data "320" ripemd:digest ]
    "has160" [ data has160:digest ]
    "whirlpool" [ data whirlpool:digest ]
    "snefru" [ data "128" "8" snefru:digest ]
    [ data ripemd160:digest ]
  } case ;

\ The block size in bytes of the hash named alg (RFC 2104 section 2: the input block of the hash). MD2
\ takes 16 bytes (RFC 1319) and Snefru-128 takes 48 (its 512-bit block less the 128-bit chaining value);
\ the SHA-3 sizes are the rates of the sponge.
: _block ( alg:str -- int )
  alg {
    "md2" [ 16 ]
    "snefru" [ 48 ]
    "sha3-224" [ 144 ]
    "sha3-256" [ 136 ]
    "sha3-384" [ 104 ]
    "sha3-512" [ 72 ]
    "sha384" [ 128 ]
    "sha512" [ 128 ]
    "sha512/224" [ 128 ]
    "sha512/256" [ 128 ]
    [ 64 ]
  } case ;

\ The key as one block of the hash's block size: a key longer than the block is hashed first, then
\ zero-padded to the block size (RFC 2104 step 1).
: _key-block ( key:bytes alg:str -- bytes )
  alg _block :> size
  key len size > [ key alg _digest ] [ key ] if
  dup len size swap - zero-bytes cat ;

\ A block of the hash's block size filled with the byte v: the ipad (54, 0x36) or opad (92, 0x5C).
: _pad ( alg:str v:int -- bytes )
  0 alg _block range [ drop v ] map list>bytes ;

\ H(K0 xor opad || inner), the outer hash of RFC 2104.
: _outer ( inner:bytes alg:str k0:bytes -- bytes )
  k0 alg 92 _pad bxor inner cat alg _digest ;

\ H(K0 xor opad || H(K0 xor ipad || data)).
: _mac ( data:bytes k0:bytes alg:str -- bytes )
  k0 alg 54 _pad bxor data cat alg _digest alg k0 _outer ;

: digest ( bytes alg:choice{md2|md4|md5|sha0|sha1|sha224|sha256|sha384|sha512|sha512/224|sha512/256|sha3-224|sha3-256|sha3-384|sha3-512|ripemd128|ripemd160|ripemd256|ripemd320|has160|whirlpool|snefru}="sha256" key:key{utf8|hex|latin1|base64}="" -- bytes )
  "The HMAC (RFC 2104) of the input under the key, with the chosen hash: the MAC bytes, as long as the hash (chain hex:encode for hex text). A key longer than the hash's block size is hashed first. Blake2, BLAKE3 and SHAKE are not offered: they have their own keyed modes or no fixed length." doc
  "Hashing" category
  key alg _key-block alg _mac ;

META: digest
  use-when "You have a shared secret key and a message, and need the HMAC value that a protocol or API names, to check it or to make one for a test." ;
  param alg "The hash: md2, md4, md5, sha0, sha1, the SHA-2 and SHA-3 sizes, ripemd128/160/256/320, has160, whirlpool or snefru (128 bits, 8 passes)." ;
  param key "The key, of any length (a key longer than the block size is hashed first). Empty by default." ;
  see-also md5:digest sha2:digest sha3:digest ;
  link "https://www.rfc-editor.org/rfc/rfc2104" "RFC 2104: HMAC" ;
  link "https://www.rfc-editor.org/rfc/rfc4231" "RFC 4231: HMAC with SHA-2 test cases" ;
  link "https://en.wikipedia.org/wiki/HMAC" "HMAC on Wikipedia" ;
;
