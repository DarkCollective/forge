\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lz4: the LZ4 frame format (lz4/doc/lz4_Frame_format.md): Compress and Decompress. No library: the
\ block coder and XXH32 are four private primitives (src/prims/lz4.ts): _xxh32, _blocks, _legacy and
\ _encode, because the loops over every byte are far too slow in FL. The frame itself is FL: the magic
\ numbers, the FLG and BD descriptor, the optional content size, the header checksum (a byte of XXH32),
\ the content checksum, concatenated frames, skippable frames (read and ignored) and the legacy frame
\ (magic 0x184C2102). The block checksums are checked inside _blocks.
IN: lz4

\ The XXH32 (seed 0) of the bytes as four little-endian bytes, the way the frame stores it.
: _xxh-bytes ( data:bytes -- bytes )
  data 0 _xxh32 4 util:int>be-bytes rev ;

\ ---- compress ----

\ The BD block-size id: 4 is 64 KB, 5 is 256 KB, 6 is 1 MB, 7 is 4 MB.
: _bs-id ( s:str -- int )
  s "64KB" = [ 4 ] [ s "256KB" = [ 5 ] [ s "1MB" = [ 6 ] [ 7 ] if ] if ] if ;

: _flg ( independent:bool bchk:bool csize:bool cchk:bool -- int )
  64
  independent [ 32 ] [ 0 ] if bor
  bchk [ 16 ] [ 0 ] if bor
  csize [ 8 ] [ 0 ] if bor
  cchk [ 4 ] [ 0 ] if bor ;

\ FLG, BD and the optional 8-byte content size.
: _descriptor ( id:int flg:int csize:bool len:int -- bytes )
  flg 1 util:int>be-bytes id 16 * 1 util:int>be-bytes cat
  csize [ len 8 util:int>be-bytes rev cat ] when ;

\ The descriptor followed by its checksum byte: bits 8 to 15 of the XXH32 of the descriptor.
: _with-hc ( desc:bytes -- bytes )
  desc desc 0 _xxh32 8 shr 255 band 1 util:int>be-bytes cat ;

: compress ( data:bytes level:int=1 block-size:choice{64KB|256KB|1MB|4MB}="4MB" independent:bool=true block-checksum:bool=false content-checksum:bool=true content-size:bool=false -- bytes )
  "An LZ4 frame (magic 0x184D2204) of the input, like CyberChef's LZ4 Compress (lz4js: independent 4 MB blocks, a content checksum, no content size) but with the frame's options as parameters. level is 0 (blocks stored) or 1 to 9: a greedy matcher that follows up to 2^(level-1) hash-chain links, so 1 is the fastest (the lz4 command's default, and the default here), and 9 the smallest; any other level is E_RANGE. The bytes differ from other encoders', but every LZ4 decoder (the lz4 command included) reads them. A block that does not shrink is stored, and with block-checksum each block carries an XXH32." doc
  "Compression" category
  level 0 9 "the compression level" util:check-int-range
  #[ 04 22 4d 18 ]
  block-size _bs-id independent block-checksum content-size content-checksum _flg content-size data len _descriptor
  _with-hc cat
  data  1 block-size _bs-id 2 * 8 + shl  independent block-checksum level _encode cat
  #[ 00 00 00 00 ] cat
  content-checksum [ data _xxh-bytes cat ] when ;

\ ---- decompress ----

: _flags-check ( flg:int bd:int -- )
  flg 6 shr 1 <> [ "not a supported LZ4 frame: the version is not 1" raise:coerce ] when
  flg 2 band 0 <> [ "the LZ4 frame sets a reserved flag bit" raise:coerce ] when
  flg 1 band 0 <> [ "the LZ4 frame needs a dictionary, which is not supported" raise:coerce ] when
  bd 143 band 0 <> [ "the LZ4 frame sets a reserved block descriptor bit" raise:coerce ] when
  bd 4 shr 7 band 4 < [ "the LZ4 frame's block maximum size id is invalid (4 to 7 are valid)" raise:coerce ] when ;

\ The index of the header checksum byte of the frame at p.
: _hc-pos ( p:int flg:int -- int )
  p 6 + flg 8 band 0 <> [ 8 ] [ 0 ] if + ;

: _trailer ( out:bytes e:int data:bytes flg:int p:int verify:bool -- bytes int )
  verify flg 8 band 0 <> and [
    out len data p 6 + 8 util:le-int <> [
      "LZ4 content size mismatch: the size in the header differs from the output (corrupt data)" raise:coerce ] when ] when
  flg 4 band 0 = [ out e ] [
    data len e - 4 < [ "LZ4 data is cut short: the content checksum is missing" raise:coerce ] when
    verify [
      data e e 4 + slice out _xxh-bytes <> [
        "LZ4 checksum mismatch: the XXH32 of the output differs from the trailer (corrupt data)" raise:coerce ] when ] when
    out e 4 + ] if ;

: _frame-body ( data:bytes p:int verify:bool flg:int bd:int -- bytes int )
  flg bd _flags-check
  data len p flg _hc-pos - 1 < [ "LZ4 data is cut short: the frame header is incomplete" raise:coerce ] when
  verify [
    data p 4 + p flg _hc-pos slice _xxh-bytes 1 nth data p flg _hc-pos nth <> [
      "LZ4 frame header checksum mismatch (corrupt header)" raise:coerce ] when ] when
  data p flg _hc-pos 1 + flg 32 band 0 <> flg 16 band 0 <> 1 bd 4 shr 7 band 2 * 8 + shl verify _blocks
  data flg p verify _trailer ;

: _frame ( data:bytes p:int verify:bool -- bytes int )
  data len p - 7 < [ "LZ4 data is cut short: the frame header is incomplete" raise:coerce ] when
  data p verify data p 4 + nth data p 5 + nth _frame-body ;

: _skip ( data:bytes p:int -- bytes int )
  data len p - 8 < [ "LZ4 data is cut short: a skippable frame header is incomplete" raise:coerce ] when
  p 8 + data p 4 + 4 util:le-int + dup data len > [
    "LZ4 data is cut short: a skippable frame runs past the end" raise:coerce ] when
  data 0 0 slice swap ;

: _one ( data:bytes p:int verify:bool magic:int -- bytes int )
  magic 0x184d2204 = [ data p verify _frame ] [
    magic 0x184c2102 = [ data p 4 + _legacy ] [
      magic 0xfffffff0 band 0x184d2a50 = [ data p _skip ] [
        "not LZ4 data: the frame magic number (04 22 4d 18) is missing" raise:coerce ] if ] if ] if ;

: _frames ( data:bytes p:int verify:bool -- bytes )
  data len p - 4 < [ "not LZ4 data: the frame magic number is incomplete" raise:coerce ] when
  data p verify data p 4 util:le-int _one
  dup data len < [ data swap verify recurse cat ] [ drop ] if ;

: decompress ( data:bytes verify:bool=true -- bytes )
  "Decompress LZ4 frames (lz4_Frame_format.md): the header is parsed (version, flags, block maximum size; a frame that needs a dictionary is E_COERCE), the blocks are decoded, and with verify (the default) the header checksum, every block checksum, the content checksum and the content size must be present and agree, otherwise E_COERCE. Frames written one after the other are joined, skippable frames (0x184D2A50 to 5F) are skipped, and a legacy frame (0x184C2102) is read; any other magic number is E_COERCE, as is data cut short. The size claimed in the header never sizes a buffer: output past the value limit stops with E_LIMIT_VALUE." doc
  "Compression" category
  data 0 verify _frames ;

META: compress
  use-when "You have bytes and need an LZ4 frame, for example to store data for an lz4 tool or a service that reads LZ4." ;
  param level "The compression level: 0 stores, 1 to 9 compress (1 fastest and the default; 9 searches 256 candidates per position). CyberChef's LZ4 Compress has no parameters." ;
  param block-size "The largest block: 64KB, 256KB, 1MB or 4MB (lz4js and the lz4 command default to 4MB)." ;
  param independent "Independent blocks (the default): each block decodes alone. Off lets a block refer back into the 64 KB before it (smaller, like lz4 -BD)." ;
  param block-checksum "Add an XXH32 after every block (lz4 -BX)." ;
  param content-checksum "Add the XXH32 of the whole input at the end (on by default, as lz4js and lz4 write it)." ;
  param content-size "Store the input length in the header (lz4 --content-size)." ;
  checks output magic-bytes format "lz4" ;
  see-also lz4:decompress lzstring:compress deflate:gzip ;
  inverse decompress ;
  link "https://lz4.org/" "LZ4 home page" ;
;

META: decompress
  use-when "You have an LZ4 frame, starting with 04 22 4d 18, and want the bytes it holds." ;
  param verify "Check the header checksum, the block and content checksums and the content size; off, damaged checksums are ignored and the data is still returned." ;
  checks input magic-bytes format "lz4" ;
  checks input magic-bytes "02214c18" ;
  checks input magic-bytes "502a4d18" ;
  see-also lz4:compress deflate:gunzip ;
  inverse compress ;
  link "https://lz4.org/" "LZ4 home page" ;
;
