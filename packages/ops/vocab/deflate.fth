\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ deflate: raw DEFLATE (RFC 1951), zlib (RFC 1950) and gzip (RFC 1952), the exemplar of the "Wave 6
\ conventions" of packages/ops/README.md. The entropy coding is two private primitives over fflate
\ (src/prims/deflate.ts): _deflate and _inflate. Everything around it is FL: the zlib header and its
\ Adler-32 trailer (adler32:checksum), the gzip header fields (flags, mtime, file name, comment, header
\ CRC-16) and its CRC-32 and ISIZE trailer (crc:checksum), concatenated gzip members, and the checks.
\ 65536 bytes cost about 1 million VM steps either way (the checksum), against a limit of 10 million.
IN: deflate

USING: adler32 crc ;

\ ---- raw ----

: deflate ( data:bytes level:int=6 -- bytes )
  "A raw DEFLATE stream (RFC 1951) of the input. level is 0 (stored blocks, CyberChef's None) or 1 to 9 (fflate picks fixed or dynamic Huffman blocks by size: CyberChef's Dynamic Huffman Coding is the default 6; there is no Fixed-only mode); any other level is E_RANGE. The bytes differ from other encoders' but every inflater reads them." doc
  "Compression" category
  level 0 9 "the compression level" util:check-int-range
  data level _deflate ;

: inflate ( data:bytes start:int=0 -- bytes )
  "Inflate a raw DEFLATE stream (RFC 1951) that begins at byte start of the input (CyberChef's Start index); bytes after the stream are ignored. A corrupt or cut-short stream is E_COERCE naming the fault; a start beyond the input is E_RANGE; output past the value limit stops with E_LIMIT_VALUE (the decompression bomb rule of the Wave 6 conventions)." doc
  "Compression" category
  start 0 data len "the start index" util:check-int-range
  data start _inflate drop ;

\ ---- zlib ----

\ The two header bytes of zlib for a level: CM 8 and a 32 KiB window, FLEVEL 0 (levels 0 and 1),
\ 1 (2 to 5), 2 (6) or 3 (7 to 9) as zlib sets it, and FCHECK so the 16 bits are a multiple of 31.
: _zlib-header ( level:int -- bytes )
  level 2 < [ #[ 78 01 ] ] [
    level 6 < [ #[ 78 5e ] ] [
      level 6 = [ #[ 78 9c ] ] [ #[ 78 da ] ] if ] if ] if ;

: zlib-deflate ( data:bytes level:int=6 -- bytes )
  "A zlib stream (RFC 1950) of the input: the two header bytes, the raw DEFLATE stream and the big-endian Adler-32 of the input. level is 0 to 9 as for deflate:deflate (E_RANGE otherwise); the header's FLEVEL follows zlib's own levels." doc
  "Compression" category
  level 0 9 "the compression level" util:check-int-range
  level _zlib-header data level _deflate cat data adler32:checksum cat ;

: _zlib-check-header ( data:bytes s:int -- )
  data len s - 2 < [ "zlib data is shorter than its two header bytes" raise:coerce ] when
  data s nth 8 shl data s 1 + nth bor 31 mod 0 <> [
    "not zlib data: the header check (a multiple of 31) fails" raise:coerce ] when
  data s nth 15 band 8 <> [ "not zlib data: the compression method is not deflate (8)" raise:coerce ] when
  data s nth 4 shr 7 > [ "zlib header window size is over 32 KiB" raise:coerce ] when
  data s 1 + nth 32 band 0 <> [ "zlib data needs a preset dictionary, which is not supported" raise:coerce ] when ;

: _check-adler ( out:bytes data:bytes e:int -- )
  data len e - 4 < [ "zlib data is cut short: the Adler-32 checksum is missing" raise:coerce ] when
  data e e 4 + slice out adler32:checksum <> [
    "zlib checksum mismatch: the Adler-32 of the output differs from the trailer (corrupt data)" raise:coerce ] when ;

: _zlib-finish ( out:bytes e:int data:bytes verify:bool -- bytes )
  verify [ out data e _check-adler ] when out ;

: zlib-inflate ( data:bytes start:int=0 verify:bool=true -- bytes )
  "Inflate zlib data (RFC 1950) that begins at byte start. The header is checked (not zlib, another method, a preset dictionary: E_COERCE), and with verify (the default; CyberChef's Verify result is off) the Adler-32 trailer must be present and match the output, otherwise E_COERCE. Without verify the trailer is not read. Output past the value limit stops with E_LIMIT_VALUE. CyberChef's buffer size and expansion options do not exist here: the primitive manages its own buffers." doc
  "Compression" category
  start 0 data len "the start index" util:check-int-range
  data start _zlib-check-header
  data start 2 + _inflate data verify _zlib-finish ;

\ ---- gzip ----

: _crc32 ( data:bytes -- bytes )
  data "CRC-32" crc:checksum ;

\ A file name or comment as Latin-1 bytes (RFC 1952); a character above U+00FF or a NUL is E_RANGE.
: _gz-text ( s:str what:str -- bytes )
  s latin1>bytes
  dup #[ 00 ] util:contains-bytes? [ what " cannot contain a NUL character" cat raise:range ] when ;

: _gz-flags ( fname:bytes comment:bytes header-crc:bool -- int )
  fname len 0 > [ 8 ] [ 0 ] if
  comment len 0 > [ 16 ] [ 0 ] if bor
  header-crc [ 2 ] [ 0 ] if bor ;

\ XFL as gzip writes it: 2 for the slowest level, 4 for the fastest, else 0. OS 255 (unknown).
: _gz-header ( level:int mtime:int fname:bytes comment:bytes header-crc:bool -- bytes )
  #[ 1f 8b 08 ] fname comment header-crc _gz-flags 1 util:int>be-bytes cat
  mtime 4 util:int>be-bytes rev cat
  level 9 = [ #[ 02 ] ] [ level 2 < [ #[ 04 ] ] [ #[ 00 ] ] if ] if cat
  #[ ff ] cat
  fname len 0 > [ fname cat #[ 00 ] cat ] when
  comment len 0 > [ comment cat #[ 00 ] cat ] when ;

\ The header followed by the low 16 bits of its CRC-32, little-endian, when asked for.
: _gz-header-crc ( hdr:bytes header-crc:bool -- bytes )
  header-crc [ hdr hdr _crc32 2 4 slice rev cat ] [ hdr ] if ;

\ The CRC-32 and the length modulo 2^32 of the input, each little-endian.
: _gz-trailer ( data:bytes -- bytes )
  data _crc32 rev data len 4 util:int>be-bytes rev cat ;

: gzip ( data:bytes level:int=6 filename:str="" comment:str="" header-crc:bool=false mtime:int=0 -- bytes )
  "A gzip file (RFC 1952) of the input: a 10-byte header, the optional zero-terminated Latin-1 file name and comment, the optional header CRC-16 (CyberChef's Include file checksum), the raw DEFLATE stream, and the little-endian CRC-32 and length. level is 0 to 9 as for deflate:deflate (E_RANGE otherwise). mtime is the modification time in Unix seconds, 0 by default (CyberChef writes the current time, which makes its output differ on every run); the OS byte is 255 (unknown) and XFL follows the level as gzip writes it. A file name or comment with a NUL or above U+00FF is E_RANGE." doc
  "Compression" category
  level 0 9 "the compression level" util:check-int-range
  mtime 0 4294967295 "mtime" util:check-int-range
  level mtime filename "the file name" _gz-text comment "the comment" _gz-text header-crc _gz-header
  header-crc _gz-header-crc
  data level _deflate cat data _gz-trailer cat ;

\ The offset after the FEXTRA field when the flag is set (a 2-byte length, then the field).
: _gz-extra-end ( p:int data:bytes flg:int -- int )
  flg 4 band 0 = [ p ] [
    data p 2 "gzip data" util:need-bytes
    data p 2 util:le-int p + 2 +
    dup data len > [ "the gzip extra field runs past the end of the data" raise:coerce ] when ] if ;

\ The index of the first zero byte at or after p, or the length when there is none; it looks at
\ 256 bytes at a time (a byte search that is a few steps per window), so a long run of non-zero bytes is cheap.
: _zero-pos ( data:bytes p:int -- int )
  p data len >= [ data len ] [
    data p p 256 + data len min slice
    dup #[ 00 ] util:contains-bytes?
    [ [ 0 <> ] util:count-leading p + ]
    [ drop data p 256 + recurse ] if ] if ;

\ The offset after a zero-terminated string when the flag holds.
: _gz-zstr-end ( p:int data:bytes flag:bool what:str -- int )
  flag [
    data p _zero-pos
    dup data len >= [ "the gzip " what cat " is not terminated" cat raise:coerce ] when 1 + ] [ p ] if ;

\ The offset after the header CRC-16 when the flag is set; with verify it must match the header.
: _gz-hcrc ( p:int data:bytes m:int flg:int verify:bool -- int )
  flg 2 band 0 = [ p ] [
    data p 2 "gzip data" util:need-bytes
    verify [
      data m p slice _crc32 2 4 slice rev data p p 2 + slice <> [
        "gzip header checksum mismatch (corrupt header)" raise:coerce ] when ] when
    p 2 + ] if ;

: _gz-fields ( p:int data:bytes flg:int m:int verify:bool -- int )
  p data flg _gz-extra-end
  data flg 8 band 0 <> "file name" _gz-zstr-end
  data flg 16 band 0 <> "comment" _gz-zstr-end
  data m flg verify _gz-hcrc ;

\ The offset of the deflate stream of the gzip member that starts at m.
: _gz-header-end ( data:bytes m:int verify:bool -- int )
  data m 10 "gzip data" util:need-bytes
  data m nth 31 <> data m 1 + nth 139 <> or [ "not gzip data: the magic number 1f 8b is missing" raise:coerce ] when
  data m 2 + nth 8 <> [ "the gzip compression method is not deflate (8)" raise:coerce ] when
  data m 3 + nth 224 band 0 <> [ "the gzip header sets reserved flag bits" raise:coerce ] when
  m 10 + data data m 3 + nth m verify _gz-fields ;

\ Checks the CRC-32 and length trailer of a member whose deflate stream ended at e; the offset after it.
: _gz-trailer-check ( out:bytes e:int data:bytes -- )
  data e 8 "gzip data" util:need-bytes
  data e e 4 + slice out _crc32 rev <> [
    "gzip checksum mismatch: the CRC-32 of the output differs from the trailer (corrupt data)" raise:coerce ] when
  data e 4 + 4 util:le-int out len 4294967296 mod <> [
    "gzip length mismatch: the size in the trailer differs from the output (corrupt data)" raise:coerce ] when ;

: _gz-member ( data:bytes m:int verify:bool -- bytes int )
  data m verify _gz-header-end data swap _inflate
  verify [ over over data _gz-trailer-check ] when
  8 + data len min ;

\ True when another gzip member (1f 8b) starts at e.
: _gz-more? ( data:bytes e:int -- bool )
  data len e - 2 < [ false ] [ data e nth 31 = data e 1 + nth 139 = and ] if ;

: _gz-all ( data:bytes m:int verify:bool -- bytes )
  data m verify _gz-member
  dup data swap _gz-more?
  [ data swap verify recurse cat ] [ drop ] if ;

: gunzip ( data:bytes verify:bool=true -- bytes )
  "Decompress gzip data (RFC 1952): the header is parsed (name, comment, extra field and header CRC-16 are skipped; a missing magic number, another method or reserved flags are E_COERCE), the stream is inflated, and with verify (the default) the CRC-32 and length of the trailer must be present and match, otherwise E_COERCE. Members written one after the other are joined, as gzip does; other bytes after the last member are ignored. Output past the value limit stops with E_LIMIT_VALUE." doc
  "Compression" category
  data 0 verify _gz-all ;

META: deflate
  use-when "You have bytes and need a raw DEFLATE stream, without a zlib or gzip wrapper, for example to put inside a zip entry." ;
  param level "The compression level: 0 stores, 1 to 9 compress (6 default). CyberChef's None is 0 and its Dynamic Huffman Coding is any level from 1; Fixed Huffman Coding has no equivalent." ;
  see-also deflate:inflate deflate:zlib-deflate deflate:gzip ;
  inverse inflate ;
  link "https://www.rfc-editor.org/rfc/rfc1951" "RFC 1951: DEFLATE compressed data format" ;
  link "https://en.wikipedia.org/wiki/Deflate" "Deflate on Wikipedia" ;
;

META: inflate
  use-when "You have a raw DEFLATE stream, such as the data inside a zip entry, and want the bytes it holds." ;
  param start "The byte offset in the input where the DEFLATE stream begins (CyberChef's Start index)." ;
  checks input binary ;
  expects "raw DEFLATE data" ;
  see-also deflate:deflate deflate:zlib-inflate deflate:gunzip ;
  inverse deflate ;
  link "https://www.rfc-editor.org/rfc/rfc1951" "RFC 1951: DEFLATE compressed data format" ;
  link "https://en.wikipedia.org/wiki/Deflate" "Deflate on Wikipedia" ;
;

META: zlib-deflate
  use-when "You have bytes and need a zlib stream, with its two-byte header and Adler-32 trailer, as used by HTTP deflate bodies and PNG images." ;
  param level "The compression level, 0 (stored) to 9; 6 is the default." ;
  checks output magic-bytes "7801" ;
  checks output magic-bytes "785e" ;
  checks output magic-bytes "789c" ;
  checks output magic-bytes "78da" ;
  see-also deflate:zlib-inflate deflate:deflate adler32:checksum ;
  inverse zlib-inflate ;
  link "https://www.rfc-editor.org/rfc/rfc1950" "RFC 1950: zlib compressed data format" ;
  link "https://en.wikipedia.org/wiki/Zlib" "Zlib on Wikipedia" ;
;

META: zlib-inflate
  use-when "You have zlib data, usually starting with 78 9c or 78 da, and want the bytes inside, such as an HTTP deflate body or PNG image data." ;
  param start "The byte offset in the input where the zlib header begins." ;
  param verify "Check the Adler-32 trailer (CyberChef's Verify result); off, the trailer is not read." ;
  checks input binary ;
  expects "zlib data" ;
  see-also deflate:zlib-deflate deflate:inflate adler32:checksum ;
  inverse zlib-deflate ;
  link "https://www.rfc-editor.org/rfc/rfc1950" "RFC 1950: zlib compressed data format" ;
  link "https://en.wikipedia.org/wiki/Zlib" "Zlib on Wikipedia" ;
;

META: gzip
  use-when "You have bytes and need a gzip file or body, for example to serve compressed text or to make a .gz test file." ;
  param level "The compression level, 0 (stored) to 9; 6 is the default." ;
  param filename "The original file name stored in the header (Latin-1); empty stores none." ;
  param comment "A comment stored in the header (Latin-1); empty stores none." ;
  param header-crc "Add the CRC-16 of the header to the header (CyberChef's Include file checksum)." ;
  param mtime "The modification time in Unix seconds (0 to 4294967295); 0 means none, and keeps the output the same on every run." ;
  checks output magic-bytes format "gzip" ;
  see-also deflate:gunzip deflate:deflate crc:checksum ;
  inverse gunzip ;
  link "https://www.rfc-editor.org/rfc/rfc1952" "RFC 1952: gzip file format" ;
  link "https://en.wikipedia.org/wiki/Gzip" "Gzip on Wikipedia" ;
;

META: gunzip
  use-when "You have gzip data, such as a .gz file or an HTTP body sent with Content-Encoding gzip, and want the original bytes." ;
  param verify "Check the CRC-32 and length of the trailer; off, a damaged trailer is ignored and the data is still returned." ;
  checks input magic-bytes format "gzip" ;
  see-also deflate:gzip deflate:inflate crc:checksum ;
  inverse gzip ;
  link "https://www.rfc-editor.org/rfc/rfc1952" "RFC 1952: gzip file format" ;
  link "https://en.wikipedia.org/wiki/Gzip" "Gzip on Wikipedia" ;
;
