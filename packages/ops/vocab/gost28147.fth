\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ gost28147: the GOST 28147-89 block cipher (RFC 5830) with CyberChef's S-box choices, the modes ECB, CBC, CFB,
\ OFB and CTR, optional CryptoPro key meshing (RFC 4357 section 2.3.2), and the RFC 4357 key wrap and unwrap
\ (sections 6.1 to 6.5). The cipher block is a private primitive pair (src/prims/gost28147.ts); ECB, CBC, CFB
\ and OFB without meshing run on the shared blockmode layer. The GOST counter mode ("gamma", RFC 5830 section
\ 6.2, with its own constants, not a plain counter) and any mode with key meshing change the key or the
\ register inside the stream, which a block quotation cannot, so they go to the private _crypt-ext. The hash
\ GOST R 34.11-94 is the separate vocabulary gost. Not covered from CyberChef: Magma and Kuznyechik (the 2015
\ ciphers), the Signal-COM S-boxes (E-SC, D-SC) and its SC key wrap.
IN: gost28147

\ Does the call need the primitive instead of the blockmode layer?
: _ext? ( mode:str mesh:str -- bool )
  mode "CTR" = mesh "CP" = mode "ECB" <> and or ;

: _ext-enc ( data:bytes key:bytes iv:bytes mode:str padding:bool sbox:str mesh:bool -- bytes )
  data mode "CBC" = padding and [ 8 blockmode:pad ] when
  key iv mode sbox mesh false _crypt-ext ;

: _ext-dec ( data:bytes key:bytes iv:bytes mode:str padding:bool sbox:str mesh:bool -- bytes )
  data key iv mode sbox mesh true _crypt-ext
  mode "CBC" = padding and [ 8 blockmode:unpad ] when ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" meshing:choice{NO|CP}="NO" -- bytes )
  "GOST 28147-89 encryption of the input bytes: 64-bit blocks, a 256-bit key (32 bytes, E_RANGE otherwise), 32 rounds, words little-endian as in RFC 5830. sbox selects the substitution table (E-TEST and E-A to E-D are the RFC 4357 encryption sets, D-TEST and D-A its digest sets, E-Z the TC26 set of Magma). The IV is 8 bytes for CBC, CFB, OFB and CTR (empty means eight zero bytes; E_RANGE for any other length) and unused for ECB. CFB and OFB are the 64-bit forms and CTR is the GOST gamma mode of RFC 5830 section 6.2 (not a plain counter). padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE). meshing CP is the CryptoPro key meshing (RFC 4357 section 2.3.2), which changes the key and the feedback register every 1024 bytes in CBC, CFB, OFB and CTR (ECB is unaffected). Chain hex:encode for text." doc
  "Encryption" category
  key sbox _check-key
  mode meshing _ext?
  [ key iv len 0 = [ #[ 00 00 00 00 00 00 00 00 ] ] [ iv ] if mode padding "pkcs7" = sbox meshing "CP" = _ext-enc ]
  [ mode iv len 0 = [ #[ 00 00 00 00 00 00 00 00 ] ] [ iv ] if 8 padding "pkcs7" = [ key sbox _encrypt-block ] blockmode:encrypt ] if ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" meshing:choice{NO|CP}="NO" -- bytes )
  "GOST 28147-89 decryption, the inverse of gost28147:encrypt with the same key, IV, mode, padding, S-box and meshing. PKCS#7 padding that does not check (usually a wrong key or IV) and CBC or ECB input that is not whole blocks are E_COERCE. A key of the wrong length is E_RANGE." doc
  "Encryption" category
  key sbox _check-key
  mode meshing _ext?
  [ key iv len 0 = [ #[ 00 00 00 00 00 00 00 00 ] ] [ iv ] if mode padding "pkcs7" = sbox meshing "CP" = _ext-dec ]
  [ mode iv len 0 = [ #[ 00 00 00 00 00 00 00 00 ] ] [ iv ] if 8 padding "pkcs7" = [ key sbox _encrypt-block ] [ key sbox _decrypt-block ] blockmode:decrypt ] if ;

: wrap-key ( bytes key:key{hex|utf8|latin1|base64} ukm:key{hex|utf8|latin1|base64} sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" wrapping:choice{NO|CP}="NO" -- bytes )
  "GOST 28147-89 key wrap (RFC 4357 section 6.1, or with wrapping CP section 6.3, which diversifies the key by the UKM first). The input is the 32-byte content key (E_COERCE otherwise), key is the 32-byte key encryption key (E_RANGE) and ukm the 8-byte user key material (E_RANGE). The output is CEK_ENC (the content key in ECB under the KEK) followed by CEK_MAC (the 4-byte IMIT with the UKM as the initial register), 36 bytes: CyberChef's layout, which leaves out the UKM that RFC 4357 puts in front (chain the UKM bytes in front with cat to get the RFC's 44 bytes). Not covered: CyberChef's SC (Signal-COM) wrapping." doc
  "Encryption" category
  key ukm sbox wrapping _wrap ;

: unwrap-key ( bytes key:key{hex|utf8|latin1|base64} ukm:key{hex|utf8|latin1|base64} sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" wrapping:choice{NO|CP}="NO" -- bytes )
  "GOST 28147-89 key unwrap (RFC 4357 section 6.2, or with wrapping CP section 6.4), the inverse of gost28147:wrap-key. The input is the 36 bytes CEK_ENC and CEK_MAC without the UKM (E_COERCE otherwise); the MAC is checked and a mismatch (a wrong KEK, UKM or S-box, or damaged data) is E_COERCE, returning no key." doc
  "Encryption" category
  key ukm sbox wrapping _unwrap ;

META: encrypt
  param key "The GOST 28147-89 key: 32 bytes." ;
  param iv "The initialisation vector (synchro message): 8 bytes for CBC, CFB, OFB and CTR (empty means zeros). Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR (GOST gamma) or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  param sbox "The substitution table: E-TEST (id-Gost28147-89-TestParamSet), E-A, E-B, E-C, E-D (CryptoPro A to D), E-Z (TC26 Z), D-TEST or D-A (the digest sets of RFC 4357 section 11.2)." ;
  param meshing "CP applies the CryptoPro key meshing (a new key every 1024 bytes); NO does not." ;
  see-also gost28147:decrypt gost28147:wrap-key gost:digest hex:encode ;
;

META: decrypt
  param key "The key used to encrypt." ;
  param iv "The initialisation vector used to encrypt (empty means zeros)." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  param sbox "The substitution table used to encrypt." ;
  param meshing "Whether the CryptoPro key meshing was used to encrypt." ;
  see-also gost28147:encrypt hex:decode ;
;

META: wrap-key
  param key "The key encryption key (KEK): 32 bytes." ;
  param ukm "The user key material: 8 bytes, unique for each wrapped key." ;
  param sbox "The substitution table." ;
  param wrapping "NO is the plain wrap of RFC 4357 section 6.1; CP is the CryptoPro wrap of section 6.3 (KEK diversification by the UKM)." ;
  see-also gost28147:unwrap-key gost28147:encrypt ;
;

META: unwrap-key
  param key "The key encryption key (KEK): 32 bytes." ;
  param ukm "The user key material used to wrap." ;
  param sbox "The substitution table used to wrap." ;
  param wrapping "NO or CP, as used to wrap." ;
  see-also gost28147:wrap-key gost28147:decrypt ;
;
