\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ blockmode: the one shared implementation of the block cipher modes (ECB, CBC, CFB, OFB, CTR) and
\ PKCS#7 padding, written in FL over a block function that the caller passes as a quotation. This
\ vocabulary is internal (it is in INTERNAL_VOCABS): its words are callable from every vocabulary
\ (blockmode:encrypt, or USING: blockmode) and are never listed in the catalogue. A block cipher
\ vocabulary (DES, Blowfish, SM4, ...) supplies only a private single-block primitive and calls
\ these words with a quotation, so the modes are never written twice. The quotations have the effect
\ ( block:bytes -- bytes ): the caller closes over the key, e.g. [ key _encrypt-block ].
\
\ The block size bs is in bytes (any size; the ciphers here use 4, 8 or 16). CFB is full-block CFB (CFB-64 for
\ 8-byte blocks, CFB-128 for 16), OFB is the standard output feedback, and CTR increments the whole
\ counter block as one big-endian integer, wrapping at the block size (NIST SP 800-38A, appendix B.1).
\ SP 800-38A leaves the incrementing function to the application, and CyberChef's ciphers use two others,
\ so two more counter modes exist for compatibility: CTR32 increments only the last four bytes, big-endian
\ modulo 2^32, with no carry into the rest (node-forge's inc32, used by CyberChef for AES, DES, Triple DES,
\ Blowfish and SM4), and CTRLE reads the whole block as a little-endian integer (CyberChef's Twofish and
\ RC6). A cipher word turns its CTR mode into one of them with blockmode:ctr-as. The last block of CFB,
\ OFB and CTR may be short; the key stream is cut to fit. Padding is PKCS#7 and applies to ECB and CBC
\ only.
\
\ Errors: a bad IV length or an unknown mode is E_RANGE; an input that is not whole blocks (padding
\ off, or any decryption in ECB or CBC) and bad padding are E_COERCE.
IN: blockmode

\ Not USING: raise, whose range would hide the core word range; the raise words are called qualified.
USING: util ;

#[ ] VARIABLE _prev
0 VARIABLE _ctr0
#[ ] VARIABLE _head

\ ---- PKCS#7 padding ----

: _fill ( n:int -- bytes )
  0 n range [ drop n ] map list>bytes ;

: pad ( data:bytes bs:int -- bytes )
  "PKCS#7 padding (RFC 5652 section 6.3): n bytes of the value n are appended, n being 1 to bs so that the length becomes a multiple of bs; data already a whole number of blocks gets a full block of padding." doc
  data bs data len bs mod - _fill cat ;

\ The padding length read from the last byte of data, checked to be 1 to bs.
: _pad-len ( data:bytes bs:int -- int )
  data len bs mod 0 <> data len 0 = or
  [ "bad padding: the length is not a whole number of blocks" raise:coerce ] when
  data data len 1 - nth
  dup 1 < over bs > or [ "bad padding: the last byte is out of range" raise:coerce ] when ;

\ data without its last p bytes, after checking that all of them are p.
: _strip ( data:bytes p:int -- bytes )
  data data len p - data len slice [ p <> ] filter len 0 >
  [ "bad padding: the padding bytes differ" raise:coerce ] when
  data 0 data len p - slice ;

: unpad ( data:bytes bs:int -- bytes )
  "Remove and check PKCS#7 padding: the last byte p must be 1 to bs and the last p bytes must all be p, else E_COERCE (also for a length that is not a whole number of blocks or is zero)." doc
  data data bs _pad-len _strip ;

\ ---- blocks ----

\ The blocks of data as a list of bytes: bs bytes each, the last one shorter if bs does not divide the length.
: _blocks ( data:bytes bs:int -- list )
  0 data len bs ceil-div range [ bs * dup bs + data len min data -rot slice ] map ;

: _join ( blocks:list -- bytes )
  blocks #[ ] bjoin ;

\ data, after checking that it is a whole number of blocks.
: _whole ( data:bytes bs:int -- bytes )
  data len bs mod 0 <>
  [ "the input is not a whole number of blocks (use PKCS#7 padding or a multiple of the block size)" raise:coerce ] when
  data ;

\ The data to encrypt in ECB or CBC: padded, or checked to be whole blocks.
: _prep ( data:bytes bs:int padding:bool -- bytes )
  padding [ data bs pad ] [ data bs _whole ] if ;

\ The decrypted data of ECB or CBC with the padding removed when it is on.
: _finish ( out:bytes bs:int padding:bool -- bytes )
  padding [ out bs unpad ] [ out ] if ;

\ ---- modes ----

: _ecb ( data:bytes bs:int f:quot -- bytes )
  data bs _blocks f map _join ;

: _cbc-enc ( data:bytes iv:bytes bs:int f:quot -- bytes )
  iv _prev!
  data bs _blocks [ _prev bxor f call dup _prev! ] map _join ;

: _cbc-dec ( data:bytes iv:bytes bs:int f:quot -- bytes )
  iv _prev!
  data bs _blocks [ dup f call _prev bxor swap _prev! ] map _join ;

\ f is always the encryption function in CFB, OFB and CTR.
: _cfb-enc ( data:bytes iv:bytes bs:int f:quot -- bytes )
  iv _prev!
  data bs _blocks [ _prev f call bxor dup _prev! ] map _join ;

: _cfb-dec ( data:bytes iv:bytes bs:int f:quot -- bytes )
  iv _prev!
  data bs _blocks [ dup _prev f call bxor swap _prev! ] map _join ;

: _ofb ( data:bytes iv:bytes bs:int f:quot -- bytes )
  iv _prev!
  data bs _blocks [ _prev f call dup _prev! bxor ] map _join ;

\ Set up the counter of a CTR mode from the IV: the value that block i adds to (_ctr0), and for CTR32 the
\ head that stays fixed (all but the last four bytes, _head).
: _ctr-init ( iv:bytes mode:str -- )
  mode "CTR32" =
  [ iv 0 iv len 4 - slice _head! iv iv len 4 - iv len slice 256 digits>int _ctr0! ] [
  mode "CTRLE" =
  [ iv rev 256 digits>int _ctr0! ]
  [ iv 256 digits>int _ctr0! ] if ] if ;

\ The counter block i places after the IV: the IV as a big-endian integer plus i, in bs bytes (wrapping);
\ for CTR32 only the last four bytes count; for CTRLE the integer is little-endian.
: _ctr-block ( i:int bs:int mode:str -- bytes )
  mode "CTR32" =
  [ _head _ctr0 i + 4 util:int>be-bytes cat ] [
  mode "CTRLE" =
  [ _ctr0 i + bs util:int>be-bytes rev ]
  [ _ctr0 i + bs util:int>be-bytes ] if ] if ;

: _ctr ( data:bytes mode:str iv:bytes bs:int f:quot -- bytes )
  iv mode _ctr-init
  data bs _blocks [ bs mode _ctr-block f call bxor ] mapi _join ;

\ ---- checks ----

: _check ( mode:str iv:bytes bs:int -- )
  mode "ECB" = mode "CBC" = or mode "CFB" = or mode "OFB" = or mode "CTR" = or mode "CTR32" = or mode "CTRLE" = or not
  [ "unknown mode (use ECB, CBC, CFB, OFB, CTR, CTR32 or CTRLE)" raise:range ] when
  mode "ECB" <> iv len bs <> and
  [ "the IV must be one block long" raise:range ] when ;

\ ---- the public words ----

: encrypt ( data:bytes mode:str iv:bytes bs:int padding:bool enc:quot -- bytes )
  "Encrypt data in a mode (ECB, CBC, CFB, OFB or CTR; CTR32 and CTRLE are CTR with the other two counter conventions, see the file header) with a block function enc ( block:bytes -- bytes ) of bs-byte blocks that encrypts one block under a key the quotation closes over. The IV must be bs bytes (ignored for ECB, E_RANGE if the length is wrong). padding on applies PKCS#7 to ECB and CBC; with it off those two need whole blocks (E_COERCE). CFB, OFB and CTR never pad and keep the length." doc
  mode iv bs _check
  mode "ECB" = [ data bs padding _prep bs enc _ecb ] [
  mode "CBC" = [ data bs padding _prep iv bs enc _cbc-enc ] [
  mode "CFB" = [ data iv bs enc _cfb-enc ] [
  mode "OFB" = [ data iv bs enc _ofb ]
  [ data mode iv bs enc _ctr ] if ] if ] if ] if ;

: decrypt ( data:bytes mode:str iv:bytes bs:int padding:bool enc:quot dec:quot -- bytes )
  "Decrypt data in a mode (ECB, CBC, CFB, OFB, CTR, CTR32 or CTRLE). enc ( block:bytes -- bytes ) encrypts one block and dec decrypts one; ECB and CBC use dec, and CFB, OFB and CTR use enc (their decryption runs the cipher forwards), so give both. padding on removes and checks PKCS#7 in ECB and CBC (E_COERCE if it is bad); with it off the input must be whole blocks. The other arguments are as for encrypt." doc
  mode iv bs _check
  mode "ECB" = [ data bs _whole bs dec _ecb bs padding _finish ] [
  mode "CBC" = [ data bs _whole iv bs dec _cbc-dec bs padding _finish ] [
  mode "CFB" = [ data iv bs enc _cfb-dec ] [
  mode "OFB" = [ data iv bs enc _ofb ]
  [ data mode iv bs enc _ctr ] if ] if ] if ] if ;

: ctr-as ( mode:str variant:str -- str )
  "The mode a cipher passes to encrypt or decrypt: variant (CTR32 or CTRLE) when mode is CTR, and mode itself otherwise. It lets a cipher word give CTR the counter convention of its CyberChef counterpart in one place." doc
  mode "CTR" = [ variant ] [ mode ] if ;
