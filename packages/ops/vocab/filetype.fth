\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ filetype: Detect File Type, Scan for Embedded Files and Extract Files (CyberChef's three signature ops).
\ The table of about 150 signatures (name, extensions, MIME type, description, magic bytes with offsets
\ and masks, an optional end finder) is data in src/filetype-sigs.ts, and the matching loop and the end
\ finders are three primitives in src/prims/filetype.ts (detect-list, scan-list, carve), because a bare FL
\ scan costs about 5.5 VM steps per byte per signature (see the primitive file). They are public words
\ that other vocabularies can call (the YARA ops reuse scan-list); none is an op, as each takes a list.
\ Everything else is FL: the category switches, the report text, the list of extracted files and the entry
\ op that takes one of them as bytes.
IN: filetype

\ The category names for the seven switches, in CyberChef's order.
: _cats ( images:bool video:bool audio:bool documents:bool applications:bool archives:bool misc:bool -- list )
  { }
  images [ "Images" append ] when
  video [ "Video" append ] when
  audio [ "Audio" append ] when
  documents [ "Documents" append ] when
  applications [ "Applications" append ] when
  archives [ "Archives" append ] when
  misc [ "Miscellaneous" append ] when ;

\ The four description lines of a match, each starting with indent.
: _lines ( m:record indent:str -- str )
  indent "File type:   " cat m "name" get cat "\n" cat
  indent cat "Extension:   " cat m "extensions" get cat "\n" cat
  indent cat "MIME type:   " cat m "mime" get cat "\n" cat
  m "description" get len 0 > [ indent cat "Description: " cat m "description" get cat "\n" cat ] when ;

: detect ( data:bytes images:bool=true video:bool=true audio:bool=true documents:bool=true applications:bool=true archives:bool=true miscellaneous:bool=true -- str )
  "Detect File Type: find the file formats whose signature (magic bytes) the data starts with, from a table of about 150 image, video, audio, document, application, archive and miscellaneous formats; the switches choose the categories searched. Each match is shown as File type, Extension, MIME type and Description (the line is left out when the description is empty), with a blank line between matches; no match gives a line saying the type is unknown. Signatures are checked at offset 0 only (use Scan for Embedded Files for the rest of the data). Some formats share a signature (a ZIP is also a JAR, an OOXML or an ODF file) and all of them are listed." doc
  "Forensics" category
  data images video audio documents applications archives miscellaneous _cats detect-list
  dup len 0 = [ drop
    "Unknown file type. Have you tried checking the entropy of this data to determine whether it might be encrypted or compressed?"
  ] [ [ "" _lines ] map "\n" join ] if ;

\ The text that opens the report of scan.
: _scan-intro ( -- str )
  "Scanning data for 'magic bytes' which may indicate embedded files. The following results may be false positives and should not be treated as reliable. Any sufficiently long file is likely to contain these magic bytes coincidentally.\n" ;

\ One match of the scan: its offset in decimal and hex, then the lines indented.
: _found ( m:record -- str )
  "\nOffset " m "offset" get int>str cat " (0x" cat m "offset" get 16 int>str-radix cat "):\n" cat
  m "  " _lines cat ;

: scan ( data:bytes images:bool=true video:bool=true audio:bool=true documents:bool=true applications:bool=true archives:bool=true miscellaneous:bool=true ignore-common:bool=true -- str )
  "Scan for Embedded Files: every offset of the data where the signature (magic bytes) of a known file format matches, with its name, extension, MIME type and description, in order of offset. The result is a guide only: any long data contains the short signatures by chance. With ignore-common (the default; CyberChef 11.5.0 has no such option and reports every match)  the short, ambiguous signatures (MZ, ICO, MP3 and AAC frame sync, a shebang, zlib headers, ...) are left out. The switches choose the categories. Extract Files cuts the files out." doc
  "Forensics" category
  data images video audio documents applications archives miscellaneous _cats ignore-common scan-list
  dup len 0 = [ drop "\nNo embedded files were found." ] [
    [ _found ] map ""  join
  ] if
  _scan-intro swap cat ;

: extract ( data:bytes images:bool=true video:bool=true audio:bool=true documents:bool=true applications:bool=true archives:bool=true miscellaneous:bool=false ignore-failed:bool=true minimum-size:int=100 -- list )
  "Extract Files: cut out the files whose signature is found in the data, using the end finder of each type (PNG up to IEND, JPEG to the EOI marker, GIF to its trailer, ZIP and JAR to the end record, PDF to the last %%EOF, ELF and PE from their headers, gzip and Zstandard by walking the stream, tar, 7z, SQLite, pcap, PEM, MP4 boxes, Ogg pages, RIFF, BMP, ICO, CAB, DEX, ...). The result is a list of records with name (extracted_at_0x<offset>.<extension>), offset, size, type (the MIME type) and data, in order of offset; files inside other files are extracted as well. A type that has no end finder is always left out (CyberChef: No extraction algorithm available is never an error), and a file that is damaged or cut short is left out (ignore-failed, the default) or is E_COERCE; a file smaller than minimum-size bytes (default 100, as CyberChef) is left out to prune false positives. The total size is bounded by the value limit. Use filetype:entry to continue a recipe with one of the files." doc
  "Forensics" category
  data images video audio documents applications archives miscellaneous _cats ignore-failed minimum-size carve ;

: entry ( data:bytes index:int=0 images:bool=true video:bool=true audio:bool=true documents:bool=true applications:bool=true archives:bool=true miscellaneous:bool=false ignore-failed:bool=true minimum-size:int=100 -- bytes )
  "The bytes of one file found by Extract Files, by its position in the list (0 is the first, the lowest offset). An index past the last file is E_RANGE and the message lists the first names. The other parameters are those of filetype:extract." doc
  "Forensics" category
  data images video audio documents applications archives miscellaneous _cats ignore-failed minimum-size carve
  dup len index <= index 0 < or [
    "the file index must be 0 to " over len 1 - int>str cat ", not " cat index int>str cat
    over len 0 = [ drop "there are no files to extract" ] when
    raise:range ] when
  index nth "data" get ;

META: detect
  param images "Look for image formats." ;
  param video "Look for video formats." ;
  param audio "Look for audio formats." ;
  param documents "Look for document formats." ;
  param applications "Look for executable and application formats." ;
  param archives "Look for archive and compression formats." ;
  param miscellaneous "Look for other formats (databases, captures, certificates, fonts, ...)." ;
  see-also filetype:scan filetype:extract ;
;

META: scan
  param images "Look for image formats." ;
  param video "Look for video formats." ;
  param audio "Look for audio formats." ;
  param documents "Look for document formats." ;
  param applications "Look for executable and application formats." ;
  param archives "Look for archive and compression formats." ;
  param miscellaneous "Look for other formats (databases, captures, certificates, fonts, ...)." ;
  param ignore-common "Leave out the short signatures that occur by chance in any data (MZ, ICO, MP3 and AAC frame sync, a shebang, ...)." ;
  see-also filetype:detect filetype:extract ;
;

META: extract
  param images "Look for image formats." ;
  param video "Look for video formats." ;
  param audio "Look for audio formats." ;
  param documents "Look for document formats." ;
  param applications "Look for executable and application formats." ;
  param archives "Look for archive and compression formats." ;
  param miscellaneous "Look for other formats (off by default: databases, captures, fonts, ...)." ;
  param ignore-failed "Leave out a file that cannot be extracted instead of raising an error." ;
  see-also filetype:entry filetype:scan filetype:detect ;
;

META: entry
  param index "Which of the extracted files to return (0 is the first)." ;
  param images "Look for image formats." ;
  param video "Look for video formats." ;
  param audio "Look for audio formats." ;
  param documents "Look for document formats." ;
  param applications "Look for executable and application formats." ;
  param archives "Look for archive and compression formats." ;
  param miscellaneous "Look for other formats (off by default)." ;
  param ignore-failed "Leave out a file that cannot be extracted instead of raising an error." ;
  see-also filetype:extract ;
;
