\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ generate-all: one text report of many hashes (generate-all:hashes) or many checksums
\ (generate-all:checksums) of the same input, one algorithm per line with its digest in hex. They call
\ the digest and checksum words of the other vocabularies, so every line is exactly what that word
\ gives. It is its own vocabulary, not part of hash-analysis: it depends on thirty hash vocabularies,
\ and loading all of them for a guess from a digest length would be wasteful (and the hash vocabularies
\ point back to hash-analysis in their see-also notes, which would be a dependency cycle). The CRC
\ presets are one private primitive, _crcs (src/prims/generate-all.ts): one call for the 171 presets, which
\ share the loop of crc:_crc (src/prims/crc.ts) and are held equal to crc:checksum by its tests.
IN: generate-all

USING: hex md2 md4 md5 md6 sha0 sha1 sha2 sha3 keccak shake ripemd has160 whirlpool blake2b blake2s blake3
  streebog gost snefru sm3 lmhash nthash ssdeep crc adler32 fletcher ;

\ The name with a colon, padded with spaces to at least width characters, then the digest.
: _line ( name:str hex:str names:bool width:int -- str )
  names
  [ name ":" cat dup len width swap - 1 max " " swap util:repeat-str cat hex cat ]
  [ hex ]
  if "\n" cat ;

\ One report line: f computes the raw bytes of the digest of data. The line is shown when length is
\ "all" or equals the digest size in bits.
: _h ( data:bytes name:str bits:int f:quot length:str names:bool width:int -- str )
  length "all" = length bits int>str = or
  [ name  data f call "none" "lower" hex:encode  names width _line ]
  [ "" ]
  if ;

\ The NT and LM hashes (128 bits) take text: f computes the raw bytes of the hash of the input read as UTF-8.
\ Binary input that is not text f can take gets the note msg instead of failing the report.
: _text ( data:bytes name:str f:quot msg:str length:str names:bool -- str )
  length "all" = length "128" = or
  [ [ data bytes>str f call "none" "lower" hex:encode ]
    [ drop msg ]
    try
    name swap names 14 _line ]
  [ "" ]
  if ;

\ ssdeep text has no fixed size, so it is listed for "all" only.
: _ss ( data:bytes length:str names:bool -- str )
  length "all" =
  [ "SSDEEP" data ssdeep:digest names 14 _line ]
  [ "" ]
  if ;

: hashes ( data:bytes length:choice{"all"|"128"|"160"|"224"|"256"|"320"|"384"|"512"}="all" names:bool=true -- str )
  "A report of the hashes of the input, one per line with the digest in hex: MD2, MD4, MD5, MD6, SHA-0, SHA-1, the SHA-2 sizes, the SHA-3 sizes, Keccak, SHAKE128 (32 bytes) and SHAKE256 (64 bytes), RIPEMD, HAS-160, Whirlpool, BLAKE2b, BLAKE2s, BLAKE3 (32 bytes), Streebog, GOST R 34.11-94 (CryptoPro), Snefru (8 passes), SM3, the LM hash, the NT hash and SSDEEP. Each line is what the digest word of that family gives, with its default parameters. length keeps only the digests of that many bits (SSDEEP, which is text, only for all). names off gives the digests alone. The input must be text for the LM hash line (UTF-8 with characters up to U+00FF) and for the NT hash line (UTF-8), but not for the others; where it is not, the line holds a note." doc
  "Hashing" category
  { data "MD2" 128 [ md2:digest ] length names 14 _h
    data "MD4" 128 [ md4:digest ] length names 14 _h
    data "MD5" 128 [ md5:digest ] length names 14 _h
    data "MD6" 256 [ 256 64 "" md6:digest ] length names 14 _h
    data "SHA0" 160 [ sha0:digest ] length names 14 _h
    data "SHA1" 160 [ sha1:digest ] length names 14 _h
    data "SHA2 224" 224 [ "224" sha2:digest ] length names 14 _h
    data "SHA2 256" 256 [ "256" sha2:digest ] length names 14 _h
    data "SHA2 384" 384 [ "384" sha2:digest ] length names 14 _h
    data "SHA2 512" 512 [ "512" sha2:digest ] length names 14 _h
    data "SHA2 512/224" 224 [ "512/224" sha2:digest ] length names 14 _h
    data "SHA2 512/256" 256 [ "512/256" sha2:digest ] length names 14 _h
    data "SHA3 224" 224 [ "224" sha3:digest ] length names 14 _h
    data "SHA3 256" 256 [ "256" sha3:digest ] length names 14 _h
    data "SHA3 384" 384 [ "384" sha3:digest ] length names 14 _h
    data "SHA3 512" 512 [ "512" sha3:digest ] length names 14 _h
    data "Keccak 224" 224 [ "224" keccak:digest ] length names 14 _h
    data "Keccak 256" 256 [ "256" keccak:digest ] length names 14 _h
    data "Keccak 384" 384 [ "384" keccak:digest ] length names 14 _h
    data "Keccak 512" 512 [ "512" keccak:digest ] length names 14 _h
    data "Shake 128" 256 [ "128" 32 shake:digest ] length names 14 _h
    data "Shake 256" 512 [ "256" 64 shake:digest ] length names 14 _h
    data "RIPEMD-128" 128 [ "128" ripemd:digest ] length names 14 _h
    data "RIPEMD-160" 160 [ "160" ripemd:digest ] length names 14 _h
    data "RIPEMD-256" 256 [ "256" ripemd:digest ] length names 14 _h
    data "RIPEMD-320" 320 [ "320" ripemd:digest ] length names 14 _h
    data "HAS-160" 160 [ has160:digest ] length names 14 _h
    data "Whirlpool" 512 [ whirlpool:digest ] length names 14 _h
    data "BLAKE2b-128" 128 [ 16 #[ ] blake2b:digest ] length names 14 _h
    data "BLAKE2b-160" 160 [ 20 #[ ] blake2b:digest ] length names 14 _h
    data "BLAKE2b-256" 256 [ 32 #[ ] blake2b:digest ] length names 14 _h
    data "BLAKE2b-384" 384 [ 48 #[ ] blake2b:digest ] length names 14 _h
    data "BLAKE2b-512" 512 [ 64 #[ ] blake2b:digest ] length names 14 _h
    data "BLAKE2s-128" 128 [ 16 #[ ] blake2s:digest ] length names 14 _h
    data "BLAKE2s-160" 160 [ 20 #[ ] blake2s:digest ] length names 14 _h
    data "BLAKE2s-256" 256 [ 32 #[ ] blake2s:digest ] length names 14 _h
    data "BLAKE3" 256 [ 32 #[ ] blake3:digest ] length names 14 _h
    data "Streebog-256" 256 [ "256" streebog:digest ] length names 14 _h
    data "Streebog-512" 512 [ "512" streebog:digest ] length names 14 _h
    data "GOST" 256 [ "cryptopro" gost:digest ] length names 14 _h
    data "Snefru-128" 128 [ "128" "8" snefru:digest ] length names 14 _h
    data "Snefru-256" 256 [ "256" "8" snefru:digest ] length names 14 _h
    data "SM3" 256 [ sm3:digest ] length names 14 _h
    data "LM Hash" [ lmhash:digest ] "(the input is not UTF-8 text of Latin-1 characters)" length names _text
    data "NT Hash" [ nthash:digest ] "(the input is not valid UTF-8 text)" length names _text
    data length names _ss }
  "" join ;

\ The CRC preset lines of util:crc-presets whose width is length (every line for all).
: _crc-lines ( length:str -- list )
  util:crc-presets "\n" split [ len 0 > ] filter
  length "all" = [ ] [ [ " " split 1 nth length = ] filter ] if ;

\ The report lines of the CRC presets: their names with the digests from the one primitive.
: _crc-report ( data:bytes lines:list names:bool -- str )
  lines len 0 =
  [ "" ]
  [ data lines "\n" join _crcs "\n" split
    [ lines swap nth " " split 0 nth swap names 26 _line ] mapi
    "" join ]
  if ;

: checksums ( data:bytes length:choice{"all"|"3"|"4"|"5"|"6"|"7"|"8"|"10"|"11"|"12"|"13"|"14"|"15"|"16"|"17"|"21"|"24"|"30"|"31"|"32"|"40"|"64"|"82"}="all" names:bool=true -- str )
  "A report of the checksums of the input, one per line with the value in hex: every CRC preset of crc:checksum (171 names, each as ceil(width/4) hex digits), then Adler-32 and Fletcher-8, -16, -32 and -64. Each line is the value the checksum word gives. length keeps only the checksums of that many bits (3 to 82). names off gives the values alone. Without a length filter the work is a few million VM steps for 64 KiB of input." doc
  "Hashing" category
  data length _crc-lines names _crc-report
  data "Adler-32" 32 [ adler32:checksum ] length names 26 _h cat
  data "Fletcher-8" 8 [ "8" fletcher:checksum ] length names 26 _h cat
  data "Fletcher-16" 16 [ "16" fletcher:checksum ] length names 26 _h cat
  data "Fletcher-32" 32 [ "32" fletcher:checksum ] length names 26 _h cat
  data "Fletcher-64" 64 [ "64" fletcher:checksum ] length names 26 _h cat ;

META: hashes
  param length "Show only the digests with this many bits, or all of them." ;
  param names "Put the algorithm name before each digest." ;
  see-also generate-all:checksums hash-analysis:analyse ;
;

META: checksums
  param length "Show only the checksums with this many bits, or all of them." ;
  param names "Put the checksum name before each value." ;
  see-also generate-all:hashes ;
;
