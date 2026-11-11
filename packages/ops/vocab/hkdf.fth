\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hkdf: HKDF, RFC 5869, written in FL over hmac:digest, so every hash of the hmac vocabulary that CyberChef's
\ "Derive HKDF key" offers is available (CyberChef's Whirlpool-0 and Whirlpool-T are not; hmac has Whirlpool).
\ The input is the input keying material. Extract: PRK = HMAC(salt, IKM), where "no salt" uses HashLen zero
\ bytes and "skip" takes the IKM itself as the PRK. Expand: T(i) = HMAC(PRK, T(i-1) || info || i), the output
\ the first L bytes of T(1) || T(2) || ... The key is raw bytes; chain hex:encode for text.
IN: hkdf

USING: hmac ;

\ The previous block T(i-1) of the expansion; set to the empty block by _expand.
#[ ] VARIABLE _prev

\ The output length in bytes of the hash named alg: the HMAC of nothing under no key.
: _hlen ( alg:str -- int )
  #[ ] alg #[ ] hmac:digest len ;

\ The pseudo-random key (RFC 5869 section 2.2). skip: the keying material itself; no salt: HMAC under HashLen
\ zero bytes; otherwise HMAC under the salt.
: _prk ( ikm:bytes salt:bytes hash:str extract:str -- bytes )
  extract "skip" =
  [ ikm ]
  [ ikm hash extract "no salt" = [ hash _hlen util:zero-bytes ] [ salt ] if hmac:digest ] if ;

\ Block i of the expansion: HMAC(PRK, T(i-1) || info || i), where i is one byte.
: _block ( i:int prk:bytes info:bytes hash:str -- bytes )
  _prev info cat { i } list>bytes cat hash prk hmac:digest
  dup _prev! ;

\ The first n blocks of the expansion joined.
: _expand ( prk:bytes info:bytes hash:str n:int -- bytes )
  #[ ] _prev!
  1 n 1 + range [ prk info hash _block ] map #[ ] bjoin ;

: derive ( ikm:bytes salt:key{hex|base64|utf8|latin1}="" info:key{hex|base64|utf8|latin1}="" hash:choice{md2|md4|md5|sha0|sha1|sha224|sha256|sha384|sha512|sha512/224|sha512/256|ripemd128|ripemd160|ripemd256|ripemd320|has160|whirlpool|snefru}="sha256" extract:choice{"with salt"|"no salt"|skip}="with salt" length:int=16 -- bytes )
  "The HKDF output keying material (RFC 5869) from the input keying material, as raw bytes, length bytes long (0 gives no bytes). Extract mode: with salt (the PRK is the HMAC of the input under the salt), no salt (a salt of hash-length zero bytes, as the RFC says for no salt) or skip (the input itself is the PRK, the expand step only). The length is at most 255 times the hash length, else E_RANGE. Chain hex:encode for hex text." doc
  "Key derivation" category
  length 0 < [ "the HKDF length cannot be negative" raise:range ] when
  length hash _hlen 255 * > [ "the HKDF length is over 255 times the hash length" raise:range ] when
  ikm salt hash extract _prk
  info hash length hash _hlen util:ceil-div _expand
  0 length slice ;

META: derive
  param salt "The salt for the extract step, any length. Empty by default; used only when extract is with salt." ;
  param info "The context and application information for the expand step, any length. Empty by default." ;
  param hash "The hash of the HMAC; the hmac vocabulary's hashes less the SHA-3 family and Whirlpool-0 and -T." ;
  param extract "with salt: extract with the salt; no salt: with zero bytes; skip: no extract, the input is the PRK." ;
  param length "L, the number of output bytes, at most 255 times the hash length (CyberChef's default is 16)." ;
  see-also hmac:digest pbkdf2:derive hex:encode ;
;
