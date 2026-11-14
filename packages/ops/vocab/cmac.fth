\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ cmac: CMAC (NIST SP 800-38B, RFC 4493) over AES or Triple DES, the parameters of CyberChef's "CMAC"
\ (key, algorithm). The MAC is raw bytes; chain hex:encode for CyberChef's hex text. The construction is FL
\ over the public words aes:encrypt and triple-des:encrypt, used as block functions: one block in ECB with
\ no padding gives the subkey seed, and CBC with a zero IV and no padding gives the CBC-MAC state of the
\ blocks before the last one, in a single call whatever the length of the data.
IN: cmac

\ The block size in bytes: 16 for AES, 8 for Triple DES.
: _bs ( algorithm:str -- int ) algorithm "AES" = [ 16 ] [ 8 ] if ;

\ The constant Rb of the doubling: 0x87 for a 128-bit block, 0x1b for a 64-bit block.
: _rb ( algorithm:str -- int ) algorithm "AES" = [ 135 ] [ 27 ] if ;

\ One cipher call with no IV and no padding (an AES call also takes the empty additional data).
: _crypt ( data:bytes key:bytes mode:str algorithm:str -- bytes )
  algorithm "AES" =
  [ data key algorithm _bs zero-bytes mode "none" #[ ] aes:encrypt ]
  [ data key algorithm _bs zero-bytes mode "none" triple-des:encrypt ]
  if ;

\ The big-endian integer of the bytes.
: _be ( b:bytes -- int ) b bytes>list 0 [ swap 8 shl + ] reduce ;

\ Doubling in GF(2^n): shift left by one bit, and XOR Rb into the result when a bit fell off the top.
: _dbl ( l:bytes rb:int -- bytes )
  l len :> n
  l _be :> v
  v 1 shl 1 n 8 * shl 1 - band
  v n 8 * 1 - shr rb * bxor
  n int>be-bytes ;

\ The last block of the data, padded with 0x80 and zeros when it is partial, XORed with the subkey (K1 for a
\ complete block, K2 for a padded one).
: _last ( tail:bytes complete:bool k1:bytes k2:bytes -- bytes )
  complete
  [ tail k1 bxor ]
  [ tail #[ 80 ] cat k1 len tail len - 1 - zero-bytes cat k2 bxor ]
  if ;

\ The CBC-MAC state after the blocks before the last one: the last block of the CBC encryption of head with a
\ zero IV, or zeros when there are none.
: _state ( head:bytes key:bytes algorithm:str -- bytes )
  head len 0 =
  [ algorithm _bs zero-bytes ]
  [ head key "CBC" algorithm _crypt dup len algorithm _bs - over len slice ]
  if ;

: digest ( data:bytes key:key{hex|utf8|latin1|base64} algorithm:choice{AES|TDES}="AES" -- bytes )
  "The CMAC (NIST SP 800-38B, RFC 4493) of the input under the key. AES takes a 16, 24 or 32-byte key and gives a 16-byte tag; TDES (Triple DES) takes a 16-byte (two-key) or 24-byte key and gives an 8-byte tag. A key of another length is E_RANGE. Chain hex:encode for text." doc
  "Hashing" category
  algorithm _bs :> bs
  bs zero-bytes key "ECB" algorithm _crypt algorithm _rb _dbl :> k1
  k1 algorithm _rb _dbl :> k2
  data len bs ceil-div 1 max 1 - bs * :> from
  data len 0 > data len bs mod 0 = and :> complete
  data from data len slice complete k1 k2 _last :> last
  data 0 from slice key algorithm _state last bxor
  key "ECB" algorithm _crypt ;

META: digest
  use-when "You have a block-cipher key, AES or Triple DES, and a message, and need the CMAC tag that a standard or protocol names for them." ;
  param key "The MAC key: 16, 24 or 32 bytes for AES, 16 or 24 bytes for Triple DES." ;
  param algorithm "The block cipher: AES (default, as CyberChef) or TDES (Triple DES)." ;
  see-also hmac:digest hex:encode ;
  link "https://www.rfc-editor.org/rfc/rfc4493" "RFC 4493: AES-CMAC" ;
;
