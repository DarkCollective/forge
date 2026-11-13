\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ zip: the ZIP container (PKWARE APPNOTE 6.3), one file in (zip:zip) or any number out (zip:unzip,
\ zip:entry). Everything about the container is FL: the local file header, the central directory and
\ the end-of-central-directory record, the DOS date and time, the flags, the checks. The CRC-32 is
\ crc:checksum and the DEFLATE encoder is deflate:deflate. Two private primitives (src/prims/zip.ts):
\ _cd-offsets (the sequential walk of the directory, quadratic in FL) and _extract (inflate several
\ entries under ONE output budget, the decompression bomb rule applied to the sum of all entries).
\ Reading follows the central directory, not the local headers (a zip written to a stream has zero
\ sizes in the local header and a data descriptor after the data). Stored (0) and deflate (8) only;
\ encryption, ZIP64 and multi-disk archives are E_COERCE.
IN: zip

USING: crc deflate ;

\ The CRC-32 of the bytes as an integer, the form the headers hold (about 130 VM steps a call).
: _crc32 ( data:bytes -- int )
  data "CRC-32" crc:checksum 256 util:digits>int ;

\ ---- reading integers ----

\ n little-endian bytes of data at p as an integer; E_COERCE when the data ends first.
: _rd ( data:bytes p:int n:int -- int )
  data p n "zip data" util:need-bytes
  data p n util:le-int ;

\ v as n little-endian bytes.
: _le-bytes ( v:int n:int -- bytes )
  v n util:int>be-bytes rev ;

\ ---- DOS date and time (read as UTC) ----

\ Unix seconds of a DOS time and date; a zero day or month means the entry has no time: 0.
: _dos>unix ( t:int d:int -- int )
  d 31 band 0 = d 5 shr 15 band 0 = or [ 0 ] [
    1980 d 9 shr + d 5 shr 15 band d 31 band util:days-from-civil 86400 *
    t 11 shr 3600 * + t 5 shr 63 band 60 * + t 31 band 2 * +
  ] if ;

: _dos-date ( y:int m:int d:int -- int )
  y 1980 - 9 shl m 5 shl bor d bor ;

: _dos-time ( tod:int -- int )
  tod 3600 div 11 shl tod 60 div 60 mod 5 shl bor tod 60 mod 2 div bor ;

\ The DOS time and date words of Unix seconds; 0 is 1980-01-01 00:00:00, the earliest time.
: _unix>dos ( mtime:int -- int int )
  mtime 0 = [ 0 33 ] [
    mtime 86400 mod _dos-time
    mtime 86400 div util:civil-from-days _dos-date
  ] if ;

\ ---- the end of central directory record ----

: _eocd-at? ( data:bytes p:int -- bool )
  data p p 4 + slice #[ 50 4b 05 06 ] = ;

\ The offset of the last end-of-central-directory record: it ends the file, followed only by the
\ archive comment (at most 65535 bytes), so the search runs back from 22 bytes before the end.
: _scan ( data:bytes p:int lo:int -- int )
  p [ dup lo > over data swap _eocd-at? not and ] [ 1 - ] while ;

: _find-eocd ( data:bytes -- int )
  data len 22 < [ "not zip data: the end of central directory record is missing" raise:coerce ] when
  data data len 22 - data len 65557 - 0 max _scan
  dup data swap _eocd-at? not [
    "not zip data: the end of central directory record is missing (or the data is cut short)" raise:coerce
  ] when ;

: _check-eocd ( data:bytes q:int -- )
  data q 4 + 2 _rd 0 <> data q 6 + 2 _rd 0 <> or [ "multi-disk zip archives are not supported" raise:coerce ] when
  data q 10 + 2 _rd 65535 = data q 12 + 4 _rd 4294967295 = or data q 16 + 4 _rd 4294967295 = or [
    "zip64 archives are not supported" raise:coerce ] when ;

\ How far the archive's own offsets are shifted in the file: the directory sits just before its end
\ record, so bytes in front of the zip (a self-extracting archive) move every offset.
: _cd-at? ( data:bytes p:int -- bool )
  p 4 + data len <= [ data p p 4 + slice #[ 50 4b 01 02 ] = ] [ false ] if ;

: _shift2 ( data:bytes q:int cdoff:int -- int )
  data cdoff _cd-at? [ 0 ] [
    q data q 12 + 4 _rd - cdoff -
    dup 0 < [ "the zip central directory is damaged: it does not fit before its end record" raise:coerce ] when
  ] if ;

: _shift ( data:bytes q:int -- int )
  data q data q 16 + 4 _rd _shift2 ;

\ ---- the central directory ----

\ The offset of the data of the entry whose local header is at lo, past the name and extra field.
: _local-start ( data:bytes lo:int -- int )
  data lo 30 "zip data" util:need-bytes
  data lo 4 _rd 67324752 <> [ "the zip local file header is damaged: bad signature" raise:coerce ] when
  lo 30 + data lo 26 + 2 _rd + data lo 28 + 2 _rd + ;

: _slice-text ( data:bytes p:int n:int -- str )
  data p n "zip data" util:need-bytes
  data p p n + slice util:text-lossless ;

\ The Unix permission bits when the entry was made on Unix (host 3), otherwise 0.
: _mode ( madeby:int attr:int -- int )
  madeby 8 shr 3 = [ attr 16 shr 4095 band ] [ 0 ] if ;

: _dir? ( name:str attr:int -- bool )
  name "/" util:ends-with? attr 16 band 0 <> or ;

: _entry-record ( data:bytes cd:int delta:int name:str -- record )
  { { "name" name }
    { "dir" name data cd 38 + 4 _rd _dir? }
    { "mtime" data cd 12 + 2 _rd data cd 14 + 2 _rd _dos>unix }
    { "mode" data cd 4 + 2 _rd data cd 38 + 4 _rd _mode }
    { "flags" data cd 8 + 2 _rd }
    { "method" data cd 10 + 2 _rd }
    { "crc" data cd 16 + 4 _rd }
    { "csize" data cd 20 + 4 _rd }
    { "usize" data cd 24 + 4 _rd }
    { "start" data data cd 42 + 4 _rd delta + _local-start } }
  >record ;

: _cd-entry ( data:bytes cd:int delta:int -- record )
  data cd 46 "zip data" util:need-bytes
  data cd 4 _rd 33639248 <> [ "the zip central directory is damaged: bad entry signature" raise:coerce ] when
  data cd delta data cd 46 + data cd 28 + 2 _rd _slice-text _entry-record ;

: _entries-at ( data:bytes q:int delta:int -- list )
  data data q 16 + 4 _rd delta + data q 10 + 2 _rd _cd-offsets
  [ data swap delta _cd-entry ] map ;

\ The entries of the archive, one record each, in directory order.
: _entries ( data:bytes -- list )
  data _find-eocd
  data over _check-eocd
  data over _shift
  data -rot _entries-at ;

\ ---- reading entries ----

: _fail-entry ( m:record why:str -- )
  "zip entry " m "name" get cat " " cat why cat raise:coerce ;

: _check-entry ( m:record -- )
  m "flags" get 65 band 0 <> [ m "is encrypted (password-protected zip files are not supported)" _fail-entry ] when
  m "method" get dup 0 <> swap 8 <> and [
    m "uses compression method " m "method" get int>str cat " (only stored, 0, and deflate, 8, are supported)" cat _fail-entry
  ] when
  m "csize" get 4294967295 = m "usize" get 4294967295 = or [ m "needs zip64, which is not supported" _fail-entry ] when ;

: _plan-item ( m:record -- list )
  { m "start" get m "csize" get m "method" get } ;

: _verify ( m:record content:bytes -- )
  content len m "usize" get <> [
    m "has " content len int>str cat " bytes but the directory says " cat m "usize" get int>str cat " (corrupt data)" cat _fail-entry
  ] when
  content _crc32 m "crc" get <> [
    m "checksum mismatch: the CRC-32 of the data differs from the directory (corrupt data)" _fail-entry
  ] when ;

: _record ( m:record content:bytes -- record )
  { { "name" m "name" get } { "size" content len } { "dir" m "dir" get }
    { "mtime" m "mtime" get } { "mode" m "mode" get } { "data" content } }
  >record ;

: _records ( metas:list contents:list verify:bool -- list )
  verify [ metas [ contents swap nth _verify 0 ] mapi drop ] when
  metas [ contents swap nth _record ] mapi ;

: unzip ( data:bytes verify:bool=true -- list )
  "List a zip archive (PKWARE APPNOTE): one record per entry in directory order, with name (as stored), size, dir, mtime (Unix seconds; the DOS time is read as UTC; 0 when the entry has none), mode (the Unix permission bits for an entry made on Unix, else 0) and data (empty for a directory). The central directory is read, so archives written to a stream (data descriptors) and archives with bytes in front work. Stored and deflate entries only: an encrypted entry, another method, ZIP64 or a multi-disk archive is E_COERCE naming it. With verify (the default; CyberChef's Verify result is off) every entry's size and CRC-32 must match the directory (E_COERCE otherwise); off, damaged data is returned as it is. Corrupt or cut-short data is E_COERCE. The sum of all the entries is capped by the value limit (E_LIMIT_VALUE, 16 MiB for shared recipes, 64 MiB otherwise) while they are inflated, whatever sizes the archive claims. CyberChef's Password is not supported. To go on with one file, use zip:entry." doc
  "Compression" category
  data _entries dup [ _check-entry ] each
  dup [ _plan-item ] map data swap _extract
  verify _records ;

: entry ( data:bytes name:str verify:bool=true -- bytes )
  "The bytes of one entry of a zip archive, found by its name exactly as unzip lists it (the first, if the name is repeated). A name that is not there is E_RANGE and the message lists the first entries. Only that entry is inflated. verify, damaged or unsupported entries and the output limit are as for zip:unzip (the entry's own size is capped by the value limit)." doc
  "Compression" category
  data _entries name util:pick-named
  dup _check-entry
  dup _plan-item { } swap append data swap _extract 0 nth
  verify [ over over _verify ] when nip ;

\ ---- writing ----

: _check-mtime ( mtime:int -- )
  mtime 0 <> [ mtime 315532800 4354819199 "mtime (0, or Unix seconds from 1980-01-01 to the end of 2107)" util:check-int-range ] when ;

\ UTF-8 bytes of a field of at most 65535 bytes.
: _field ( s:str what:str -- bytes )
  s str>bytes
  dup len 65535 > [ what " is longer than 65535 bytes" cat raise:range ] when ;

: _name-bytes ( s:str -- bytes )
  s "the file name" _field
  dup len 0 = [ "the file name cannot be empty" raise:range ] when
  dup #[ 00 ] util:contains-bytes? [ "the file name cannot contain a NUL character" raise:range ] when ;

\ General purpose flags: bit 11 (UTF-8 names and comments) when either has a character above ASCII.
: _flags ( filename:str comment:str -- int )
  filename str>bytes len filename len <> comment str>bytes len comment len <> or [ 2048 ] [ 0 ] if ;

\ The "version made by" host: MS-DOS 0, Unix 3, Macintosh 7.
: _os-code ( os:str -- int )
  os "unix" = [ 3 ] [ os "macintosh" = [ 7 ] [ 0 ] if ] if ;

: _zip-local ( flags:int method:int time:int date:int crc:int csize:int usize:int name:bytes -- bytes )
  #[ 50 4b 03 04 ]
  method 0 = [ 10 ] [ 20 ] if 2 _le-bytes cat
  flags 2 _le-bytes cat method 2 _le-bytes cat
  time 2 _le-bytes cat date 2 _le-bytes cat
  crc 4 _le-bytes cat csize 4 _le-bytes cat usize 4 _le-bytes cat
  name len 2 _le-bytes cat 0 2 _le-bytes cat name cat ;

: _zip-central ( os:int mode:int flags:int method:int time:int date:int crc:int csize:int usize:int name:bytes comment:bytes -- bytes )
  #[ 50 4b 01 02 ]
  os 8 shl 20 bor 2 _le-bytes cat
  method 0 = [ 10 ] [ 20 ] if 2 _le-bytes cat
  flags 2 _le-bytes cat method 2 _le-bytes cat
  time 2 _le-bytes cat date 2 _le-bytes cat
  crc 4 _le-bytes cat csize 4 _le-bytes cat usize 4 _le-bytes cat
  name len 2 _le-bytes cat 0 2 _le-bytes cat comment len 2 _le-bytes cat
  0 2 _le-bytes cat 0 2 _le-bytes cat
  os 3 = [ 32768 mode bor 16 shl ] [ 0 ] if 4 _le-bytes cat
  0 4 _le-bytes cat name cat comment cat ;

: _zip-end ( body:bytes cen:bytes -- bytes )
  body cen cat #[ 50 4b 05 06 ] cat
  0 2 _le-bytes cat 0 2 _le-bytes cat 1 2 _le-bytes cat 1 2 _le-bytes cat
  cen len 4 _le-bytes cat body len 4 _le-bytes cat 0 2 _le-bytes cat ;

: _assemble ( name:bytes comment:bytes flags:int method:int os:int mode:int time:int date:int crc:int cdata:bytes usize:int -- bytes )
  flags method time date crc cdata len usize name _zip-local cdata cat
  os mode flags method time date crc cdata len usize name comment _zip-central
  _zip-end ;

: zip ( data:bytes filename:str="file.txt" comment:str="" method:choice{deflate|store}="deflate" os:choice{msdos|unix|macintosh}="msdos" level:int=6 mtime:int=0 mode:int=420 -- bytes )
  "A zip archive (PKWARE APPNOTE) holding the input as one file named filename (CyberChef's Zip takes one file too), the way every unzip reads it. method is deflate (the default; at level 0 the DEFLATE blocks are stored) or store (CyberChef's None (Store); the level is then not used). level is 0 to 9 as for deflate:deflate (E_RANGE otherwise). comment is the file's comment in the central directory. os is the host recorded in the entry: msdos (the default), unix (which also stores the permission bits mode, 420 is 0644) or macintosh. The name and comment are UTF-8 (the UTF-8 flag is set when they are not ASCII); an empty name, a NUL or more than 65535 bytes is E_RANGE. mtime is the modification time in Unix seconds, 0 by default (and then the format's earliest time, 1980-01-01 00:00:00; CyberChef writes its own idea of the time, so its bytes differ on every run); times are stored at DOS precision (2 seconds), read as UTC, and run from 1980 to 2107 (E_RANGE otherwise). CyberChef's Password (ZipCrypto) is not supported, and neither is its Fixed Huffman Coding (see the coverage note). The compressed bytes differ from CyberChef's; every unzip reads them." doc
  "Compression" category
  level 0 9 "the compression level" util:check-int-range
  mode 0 4095 "mode" util:check-int-range
  mtime _check-mtime
  filename _name-bytes
  comment "the comment" _field
  filename comment _flags
  method "store" = [ 0 ] [ 8 ] if
  os _os-code
  mode
  mtime _unix>dos
  data _crc32
  method "store" = [ data ] [ data level deflate:deflate ] if
  data len
  _assemble ;

META: unzip
  use-when "You have a zip archive that is not encrypted, and want to list its entries and read their contents." ;
  param verify "Check each entry's size and CRC-32 against the directory (CyberChef's Verify result); off, damaged data is returned anyway." ;
  see-also zip:entry zip:zip deflate:inflate ;
  inverse zip ;
  link "https://en.wikipedia.org/wiki/ZIP_(file_format)" "ZIP file format on Wikipedia" ;
;

META: entry
  use-when "You have a zip archive and want one file from it, found by its exact name, without listing the whole archive." ;
  param name "The entry's name as unzip lists it, for example docs/readme.txt." ;
  param verify "Check the entry's size and CRC-32 against the directory." ;
  see-also zip:unzip zip:zip ;
  link "https://en.wikipedia.org/wiki/ZIP_(file_format)" "ZIP file format on Wikipedia" ;
;

META: zip
  use-when "You have bytes and need a zip file that holds them as one named file, for a recipient or tool that expects a zip." ;
  param filename "The name the file gets inside the archive (UTF-8)." ;
  param comment "A comment stored with the file (UTF-8); empty stores none." ;
  param method "deflate compresses; store keeps the bytes as they are (CyberChef's None (Store))." ;
  param os "The host system recorded in the entry: msdos, unix or macintosh." ;
  param level "The DEFLATE level, 0 (stored blocks) to 9; 6 is the default. Not used with the store method." ;
  param mtime "The modification time in Unix seconds, 1980 to 2107 (0 means 1980-01-01 00:00:00 and keeps the output the same on every run)." ;
  param mode "The Unix permission bits (0 to 4095; 420 is 0644), stored when os is unix." ;
  see-also zip:unzip zip:entry deflate:deflate ;
  inverse unzip ;
  link "https://en.wikipedia.org/wiki/ZIP_(file_format)" "ZIP file format on Wikipedia" ;
;
