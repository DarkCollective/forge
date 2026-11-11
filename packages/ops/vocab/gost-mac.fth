\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ gost-mac: CyberChef's "GOST Sign" and "GOST Verify". Despite the names these are not public key signatures: in CyberChef
\ they are the MAC modes ("imitovstavka") of the GOST block ciphers. Here only the GOST 28147-89 MAC (IMIT, RFC 5830
\ section 8) is offered, with CyberChef's S-box choices that gost28147 has and its MAC length of 8 to 64 bits; the MACs of
\ the 2015 ciphers (Magma, Kuznyechik) are not, as in gost28147. The GOST R 34.10 public key signature is the separate
\ vocabulary gost3410. The IMIT is _imit, a private primitive (src/prims/gost-mac.ts): the 16-round loop over each
\ block is far too slow in FL at 64 KiB. The MAC is raw bytes; chain hex:encode for text.
IN: gost-mac

\ The MAC of the data, size bytes long, from the key, IV (empty means eight zero bytes) and S-box.
: _mac ( data:bytes key:bytes iv:bytes sbox:str size:int -- bytes )
  data key iv 8 util:iv-or-zeros sbox size _imit ;

: sign ( data:bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" mac-length:int[8..64]=32 -- bytes )
  "The GOST 28147-89 MAC (the IMIT of RFC 5830 section 8) of the input bytes: CyberChef's GOST Sign for its GOST 28147 (1989) algorithm. The key is 256 bits (32 bytes, E_RANGE otherwise); the IV is the initial value of the register, 8 bytes, empty meaning eight zero bytes (the standard's); the data is padded with zero bytes to whole 8-byte blocks; sbox selects the substitution table as in gost28147:encrypt. The MAC is the first mac-length bits of the final register (32 by default; a multiple of 8 from 8 to 64, E_RANGE otherwise), as raw bytes: chain hex:encode for the hex text CyberChef prints. Not covered: CyberChef's Magma and Kuznyechik MACs and the E-SC and D-SC S-boxes." doc
  "Encryption" category
  mac-length 8 mod 0 <> [ "the MAC length must be a multiple of 8 bits, from 8 to 64" raise:range ] when
  data key iv sbox mac-length 8 div _mac ;

: verify ( data:bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mac:toggle{hex|utf8|latin1|base64}="" sbox:choice{E-TEST|E-A|E-B|E-C|E-D|E-Z|D-TEST|D-A}="E-TEST" -- str )
  "Check a GOST 28147-89 MAC of the input bytes (CyberChef's GOST Verify for its GOST 28147 (1989) algorithm): the MAC is computed with the key, IV and S-box as gost-mac:sign does, as long as the MAC given (1 to 8 bytes, E_RANGE otherwise; CyberChef takes the bit length from the hex digits), and compared. The answer is The signature matches or The signature does not match." doc
  "Encryption" category
  mac len dup 1 < swap 8 > or [ "the MAC must be 1 to 8 bytes" raise:range ] when
  data key iv sbox mac len _mac mac =
  [ "The signature matches" ] [ "The signature does not match" ] if ;

META: sign
  param key "The 256-bit key (32 bytes)." ;
  param iv "The initial register, 8 bytes; empty is eight zero bytes." ;
  param sbox "The S-box set: E-TEST, E-A, E-B, E-C, E-D, E-Z, D-TEST or D-A." ;
  param mac-length "The MAC length in bits: 8 to 64 in steps of 8." ;
  see-also gost-mac:verify gost28147:encrypt hex:encode ;
;

META: verify
  param key "The 256-bit key (32 bytes)." ;
  param iv "The initial register, 8 bytes; empty is eight zero bytes." ;
  param mac "The MAC to check, 1 to 8 bytes (hex by default)." ;
  param sbox "The S-box set." ;
  see-also gost-mac:sign gost28147:encrypt ;
;
