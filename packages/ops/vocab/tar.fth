\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ tar: the tar container (POSIX ustar, IEEE 1003.1), one file in (tar:tar) or any number out
\ (tar:untar, tar:entry). FL on the core words, plus three small primitives (src/prims/tar.ts): _headers
\ (the sequential walk over the headers, which is quadratic in FL: 12,000 entries took over 30 s), _oct
\ (an octal field, 250 VM steps each in FL) and _sum (the byte sum of the header checksum, 2,500 steps in
\ FL). The format: 512-byte headers with octal fields, the header checksum, padding to whole blocks and
\ the two zero blocks that end an archive. Reading takes ustar (name prefix included), the older v7
\ headers and the GNU long-name form (a type L entry); writing is ustar. An entry's data is a slice of
\ the input, so the total of all entries can never pass the input length (the bomb rule needs no budget).
IN: tar

\ ---- fields ----

\ The bytes of a field up to its first NUL.
: _cstr ( field:bytes -- bytes )
  field bytes>latin1 "\x00" split 0 nth latin1>bytes ;

\ The checksum of a header block: the sum of its bytes with the 8 checksum bytes counted as spaces.
: _header-sum ( h:bytes -- int )
  h _sum h 148 156 slice _sum - 256 + ;

: _full-name ( h:bytes -- str )
  h 0 100 slice _cstr util:text-lossless
  h 257 262 slice #[ 75 73 74 61 72 ] = h 345 500 slice _cstr len 0 > and
  [ h 345 500 slice _cstr util:text-lossless "/" cat swap cat ] when ;

\ ---- reading ----

: _meta2 ( h:bytes p:int -- record )
  { { "name" h _full-name }
    { "type" h 156 nth }
    { "size" h 124 136 slice "size" _oct }
    { "mode" h 100 108 slice "mode" _oct 4095 band }
    { "mtime" h 136 148 slice "mtime" _oct }
    { "start" p 512 + } }
  >record ;

: _meta ( data:bytes p:int -- record )
  data p p 512 + slice p _meta2 ;

\ A long name (GNU type L): the data of the entry, up to its NUL.
: _long-name ( data:bytes m:record -- str )
  data m "start" get dup m "size" get + slice _cstr util:text-lossless ;

\ type 0, a NUL (v7) and 7 (contiguous) are files, 5 is a directory; links, devices and the extended
\ headers (L, K, x, g) are not entries.
: _kind ( m:record -- str )
  m "type" get dup 53 = [ drop "dir" ] [
    dup 48 = over 0 = or swap 55 = or [ "file" ] [ "skip" ] if ] if ;


: _record2 ( data:bytes m:record name:str isdir:bool -- record )
  { { "name" name }
    { "size" isdir [ 0 ] [ m "size" get ] if }
    { "dir" isdir }
    { "mtime" m "mtime" get }
    { "mode" m "mode" get }
    { "data" isdir [ #[ ] ] [ data m "start" get dup m "size" get + slice ] if } }
  >record ;

: _record ( data:bytes m:record name:str -- record )
  data m name m _kind "dir" = name "/" util:ends-with? or _record2 ;

\ The name of entry i: the data of a type L entry just before it when there is one.
: _name-for ( data:bytes metas:list i:int -- str )
  i 0 > [ metas i 1 - nth "type" get 76 = ] [ false ] if
  [ data metas i 1 - nth _long-name ] [ metas i nth "name" get ] if ;

\ The record of header i, or an empty list when it is not an entry.
: _entry ( data:bytes metas:list i:int -- any )
  metas i nth dup _kind "skip" = [ drop { } ] [ data swap data metas i _name-for _record ] if ;

: _entries2 ( data:bytes metas:list -- list )
  0 metas len range [ data metas rot _entry ] map
  [ type "record" = ] filter ;

: _entries ( data:bytes verify:bool -- list )
  data data verify _headers [ data swap _meta ] map _entries2 ;

: untar ( data:bytes verify:bool=true -- list )
  "List a tar archive: one record per file or directory in archive order, with name (a ustar prefix is joined with a slash; a GNU long name, type L, is used), size, dir, mtime (Unix seconds), mode (the permission bits, 0 to 4095) and data (empty for a directory). Read are ustar, the older v7 headers and the GNU long-name form; entries that are not files or directories (links, devices, FIFOs) and the extended headers (GNU K, PAX x and g) are skipped, and PAX path and size records are not applied. The archive ends at two zero blocks or at the end of the data. With verify (the default; CyberChef does not check) every header checksum must match (E_COERCE); off, a damaged header is read as it is. Empty input, a bad octal field or data that ends early is E_COERCE. An entry is a slice of the input, so the total is never above the input. Use tar:entry to go on with one file." doc
  "Compression" category
  data verify _entries ;

: entry ( data:bytes name:str verify:bool=true -- bytes )
  "The bytes of one file of a tar archive, found by its name exactly as tar:untar lists it (the first, if the name is repeated). A name that is not there is E_RANGE and the message lists the first entries. verify and damaged data are as for tar:untar." doc
  "Compression" category
  data verify _entries name util:pick-named "data" get ;

\ ---- writing ----

: _pad ( b:bytes n:int -- bytes )
  b n b len - util:zero-bytes cat ;

\ v in octal, left-padded with zeros to w - 1 digits, then a NUL.
: _octf ( v:int w:int -- bytes )
  v 8 int>str-radix dup len w 1 - swap - 0 max "0" swap util:repeat-str swap cat latin1>bytes #[ 00 ] cat ;

: _ok-split? ( nameb:bytes i:int -- bool )
  i 0 > i 155 <= and nameb len i - 1 - dup 1 >= swap 100 <= and and ;

: _cut ( nameb:bytes i:int -- bytes bytes )
  nameb 0 i slice nameb i 1 + nameb len slice ;

\ ( prefix name ) of a path: a name of up to 100 bytes stays whole; a longer one is cut at a slash into a
\ prefix of up to 155 bytes and a name of up to 100.
: _split-name ( nameb:bytes -- bytes bytes )
  nameb len 100 <= [ #[ ] nameb ] [
    0 nameb len range [ nameb swap nth 47 = ] filter [ nameb swap _ok-split? ] filter
    dup len 0 = [ "the file name is too long for the ustar format (100 bytes, or up to 255 when a slash splits it into 155 and 100)" raise:range ] when
    0 nth nameb swap _cut
  ] if ;

: _tar-name ( s:str -- bytes )
  s str>bytes
  dup len 0 = [ "the file name cannot be empty" raise:range ] when
  dup len 255 > [ "the file name is longer than 255 bytes" raise:range ] when
  dup #[ 00 ] util:contains-bytes? [ "the file name cannot contain a NUL character" raise:range ] when ;

: _seal ( h:bytes -- bytes )
  h 0 148 slice h _header-sum 7 _octf cat #[ 20 ] cat h 156 512 slice cat ;

: _header ( prefix:bytes name:bytes mode:int uid:int gid:int size:int mtime:int -- bytes )
  name 100 _pad
  mode 8 _octf cat uid 8 _octf cat gid 8 _octf cat size 12 _octf cat mtime 12 _octf cat
  #[ 20 20 20 20 20 20 20 20 30 ] cat
  100 util:zero-bytes cat
  #[ 75 73 74 61 72 00 30 30 ] cat
  80 util:zero-bytes cat
  prefix 155 _pad cat 12 util:zero-bytes cat
  _seal ;

: tar ( data:bytes filename:str="file.txt" mode:int=436 mtime:int=0 uid:int=0 gid:int=0 -- bytes )
  "A tar archive (POSIX ustar) holding the input as one file named filename, as CyberChef's Tar does (one file; it writes the current time, so its bytes differ on every run). The header holds the permission bits mode (436 is 0664, CyberChef's), the Unix time mtime (0 by default, so the output is the same on every run), uid and gid (0), type 0 and no owner names; the data is padded to 512 bytes and two zero blocks end the archive. A name of up to 100 bytes goes in the name field; a longer one (up to 255) is cut at a slash into the ustar prefix and name, otherwise E_RANGE. An empty name or a NUL is E_RANGE, and so is a mode, id or time that does not fit its field. GNU tar, bsdtar and Python read the output." doc
  "Compression" category
  mode 0 4095 "mode" util:check-int-range
  uid 0 2097151 "uid" util:check-int-range
  gid 0 2097151 "gid" util:check-int-range
  mtime 0 8589934591 "mtime" util:check-int-range
  filename _tar-name _split-name
  mode uid gid data len mtime _header
  data cat
  data len 512 mod dup 0 = [ drop 0 ] [ 512 swap - ] if util:zero-bytes cat
  1024 util:zero-bytes cat ;

META: untar
  use-when "You have a tar archive, or a .tar.gz once it has been gunzipped, and want to list its files and read their contents." ;
  param verify "Check each header's checksum; off, a damaged header is read anyway." ;
  see-also tar:entry tar:tar zip:unzip ;
  link "https://en.wikipedia.org/wiki/Tar_(computing)" "Tar on Wikipedia" ;
;

META: entry
  use-when "You have a tar archive and want one file from it, found by its exact name." ;
  param name "The file's name as untar lists it, for example docs/readme.txt." ;
  param verify "Check each header's checksum." ;
  see-also tar:untar tar:tar ;
  link "https://en.wikipedia.org/wiki/Tar_(computing)" "Tar on Wikipedia" ;
;

META: tar
  use-when "You have bytes and need a tar archive holding them as one file with a given name, for example to pass to a tool that reads tar." ;
  param filename "The name of the file in the archive (UTF-8, up to 255 bytes)." ;
  param mode "The permission bits, 0 to 4095 (436 is 0664)." ;
  param mtime "The modification time in Unix seconds; 0 keeps the output the same on every run." ;
  param uid "The owner's user id (0 to 2097151)." ;
  param gid "The owner's group id (0 to 2097151)." ;
  see-also tar:untar tar:entry ;
  link "https://en.wikipedia.org/wiki/Tar_(computing)" "Tar on Wikipedia" ;
;
