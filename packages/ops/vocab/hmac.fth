\ hmac: HMAC, RFC 2104, written in FL over the digest words of the other hash vocabularies (md5, sha1,
\ sha2, sha3 and ripemd160). Blake2 and BLAKE3 have keyed modes of their own and SHAKE has no fixed
\ output length, so they are not offered. The key is hashed when it is longer than the block size of
\ the hash, then zero-padded to the block size; the inner key is the padded key xor 0x36 and the outer
\ key is the padded key xor 0x5C. The MAC is raw bytes; chain hex:encode for text.
IN: hmac

USING: md5 sha1 sha2 sha3 ripemd160 ;

\ The digest of data under the hash named alg (one of the choices of digest). The names are tested in turn.
: _digest ( bytes str -- bytes )
  dup "md5" = [ drop md5:digest ] [
  dup "sha1" = [ drop sha1:digest ] [
  dup "sha224" = [ drop "224" sha2:digest ] [
  dup "sha256" = [ drop "256" sha2:digest ] [
  dup "sha384" = [ drop "384" sha2:digest ] [
  dup "sha512" = [ drop "512" sha2:digest ] [
  dup "sha512/224" = [ drop "512/224" sha2:digest ] [
  dup "sha512/256" = [ drop "512/256" sha2:digest ] [
  dup "sha3-224" = [ drop "224" sha3:digest ] [
  dup "sha3-256" = [ drop "256" sha3:digest ] [
  dup "sha3-384" = [ drop "384" sha3:digest ] [
  dup "sha3-512" = [ drop "512" sha3:digest ] [
  drop ripemd160:digest
  ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ The block size in bytes of the hash named alg (RFC 2104 section 2: the input block of the hash).
: _block ( str -- int )
  dup "sha3-224" = [ drop 144 ] [
  dup "sha3-256" = [ drop 136 ] [
  dup "sha3-384" = [ drop 104 ] [
  dup "sha3-512" = [ drop 72 ] [
  dup "sha384" = over "sha512" = or over "sha512/224" = or over "sha512/256" = or
  [ drop 128 ] [ drop 64 ] if
  ] if ] if ] if ] if ;

\ The key as one block of the hash's block size: a key longer than the block is hashed first, then
\ zero-padded to the block size (RFC 2104 step 1).
: _key-block ( key:bytes alg:str -- bytes )
  key len alg _block >
  [ key alg _digest ] [ key ] if
  dup len alg _block swap - util:zero-bytes cat ;

\ A block of the hash's block size filled with the byte v: the ipad (54, 0x36) or opad (92, 0x5C).
: _pad ( alg:str v:int -- bytes )
  0 alg _block range [ drop v ] map list>bytes ;

\ H(K0 xor opad || inner), the outer hash of RFC 2104.
: _outer ( inner:bytes alg:str k0:bytes -- bytes )
  k0 alg 92 _pad bxor inner cat alg _digest ;

\ H(K0 xor opad || H(K0 xor ipad || data)).
: _mac ( data:bytes k0:bytes alg:str -- bytes )
  k0 alg 54 _pad bxor data cat alg _digest alg k0 _outer ;

: digest ( bytes alg:choice{md5|sha1|sha224|sha256|sha384|sha512|sha512/224|sha512/256|sha3-224|sha3-256|sha3-384|sha3-512|ripemd160}="sha256" key:key{utf8|hex|latin1|base64}="" -- bytes )
  "The HMAC (RFC 2104) of the input under the key, with the chosen hash: the MAC bytes, as long as the hash (chain hex:encode for hex text). A key longer than the hash's block size is hashed first. Blake2, BLAKE3 and SHAKE are not offered: they have their own keyed modes or no fixed length." doc
  "Hashing" category
  key alg _key-block alg _mac ;

META: digest
  param alg "The hash: md5, sha1, sha224, sha256, sha384, sha512, sha512/224, sha512/256, sha3-224, sha3-256, sha3-384, sha3-512 or ripemd160." ;
  param key "The key, of any length (a key longer than the block size is hashed first). Empty by default." ;
  see-also md5:digest sha2:digest sha3:digest ;
;
