\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ magic: identification words for recipes. They say what the data is, as specifically as the bounded look of
\ the content checks (src/checks/identify.ts, WP 6.23a) can, so a recipe can branch on it with an `if` step
\ whose test is magic:is-format. The identification itself is one private primitive (src/prims/magic.ts), the
\ evaluator of the checks; the words, their documentation and the family rule are FL. No search and no
\ operation is run: only a prefix of the data is looked at. The exception is magic:magic, the report form of
\ the Magic engine (WP 6.33): the search itself is a host primitive (_search), which asks the engine of the
\ worker that runs the bake, and the report text is FL.
IN: magic

USING: util ;

\ Every id the identification can give: the rows of the Detect File Type table (src/filetype-sigs.ts) and the
\ generic kinds (pem and xml are in both). A test keeps this list equal to those two sources.
CHOICE: magic-format
  option png "PNG image." ;
  option jpeg "JPEG image." ;
  option gif-87a "GIF image." ;
  option gif-89a "GIF image." ;
  option bmp "BMP image." ;
  option tiff-le "TIFF image." ;
  option tiff-be "TIFF image." ;
  option bigtiff-le "BigTIFF image." ;
  option bigtiff-be "BigTIFF image." ;
  option webp "WebP image." ;
  option ico "Windows icon." ;
  option cur "Windows cursor." ;
  option psd "Photoshop image." ;
  option psb "Photoshop large document." ;
  option jp2 "JPEG 2000 image." ;
  option jxl-codestream "JPEG XL image." ;
  option jxl-container "JPEG XL image." ;
  option heic "HEIC image." ;
  option heic-heix "HEIC image." ;
  option heic-hevc "HEIC image." ;
  option heif-mif1 "HEIF image." ;
  option avif "AVIF image." ;
  option dds "DDS texture." ;
  option xcf "GIMP image." ;
  option icns "Apple icon image." ;
  option wmf "Windows metafile." ;
  option emf "Enhanced metafile." ;
  option exr "OpenEXR image." ;
  option radiance-hdr "Radiance HDR image." ;
  option fits "FITS image." ;
  option djvu "DjVu document." ;
  option mp4-isom "MP4 video." ;
  option mp4-iso2 "MP4 video." ;
  option mp4-mp41 "MP4 video." ;
  option mp4-mp42 "MP4 video." ;
  option mp4-avc1 "MP4 video." ;
  option mp4-dash "MP4 video." ;
  option m4v "M4V video." ;
  option quicktime "QuickTime movie." ;
  option "3gp" "3GPP video." ;
  option "3g2" "3GPP2 video." ;
  option f4v "F4V video." ;
  option iso-bmff "ISO base media file (MP4, M4A, QuickTime, 3GPP or another brand)." ;
  option avi "AVI video." ;
  option matroska "Matroska or WebM video." ;
  option flv "FLV video." ;
  option asf "Windows Media (ASF)." ;
  option mpeg-ps "MPEG program stream." ;
  option mpeg-video "MPEG video stream." ;
  option mpeg-ts "MPEG transport stream." ;
  option swf "Flash SWF." ;
  option swf-zlib "Flash SWF (zlib)." ;
  option swf-lzma "Flash SWF (LZMA)." ;
  option realmedia "RealMedia." ;
  option mp3-id3 "MP3 audio." ;
  option mp3-mpeg1 "MP3 audio." ;
  option mp3-mpeg2 "MP3 audio." ;
  option mp3-mpeg25 "MP3 audio." ;
  option aac-adts "AAC audio." ;
  option aac-adts-mpeg2 "AAC audio." ;
  option flac "FLAC audio." ;
  option ogg "Ogg data." ;
  option wav "WAV audio." ;
  option aiff "AIFF audio." ;
  option aifc "AIFF-C audio." ;
  option midi "MIDI file." ;
  option amr "AMR audio." ;
  option m4a "M4A audio." ;
  option ape "Monkey's Audio." ;
  option wavpack "WavPack audio." ;
  option musepack "Musepack audio." ;
  option caf "CAF audio." ;
  option au "AU audio." ;
  option ac3 "AC-3 audio." ;
  option dsf "DSF audio." ;
  option pdf "PDF document." ;
  option postscript "PostScript document." ;
  option eps-dos "EPS image." ;
  option rtf "RTF document." ;
  option ole2 "OLE2 compound document." ;
  option ooxml "Office Open XML document." ;
  option odt "ODT document." ;
  option ods "ODS spreadsheet." ;
  option odp "ODP presentation." ;
  option epub "EPUB e-book." ;
  option xml "XML document." ;
  option word-2 "Word 2.0 document." ;
  option wordperfect "WordPerfect document." ;
  option winhelp "WinHelp file." ;
  option chm "CHM help file." ;
  option elf "ELF executable." ;
  option pe "PE executable." ;
  option dos-mz "DOS executable." ;
  option macho-32-le "Mach-O object." ;
  option macho-64-le "Mach-O 64-bit object." ;
  option macho-32-be "Mach-O object." ;
  option macho-64-be "Mach-O 64-bit object." ;
  option macho-fat "Mach-O universal binary." ;
  option java-class "Java class." ;
  option dex "Dalvik executable." ;
  option odex "Optimized Dalvik executable." ;
  option wasm "WebAssembly module." ;
  option shebang "script with an interpreter line." ;
  option lua-bytecode "Lua bytecode." ;
  option minidump "Windows minidump." ;
  option zip "ZIP archive." ;
  option zip-empty "empty ZIP archive." ;
  option jar "JAR archive." ;
  option rar4 "RAR archive." ;
  option rar5 "RAR 5 archive." ;
  option "7z" "7-Zip archive." ;
  option gzip "gzip data." ;
  option bzip2 "bzip2 data." ;
  option bzip2-header "bzip2 data (the header alone)." ;
  option xz "XZ data." ;
  option zstd "Zstandard data." ;
  option lz4 "LZ4 data." ;
  option lz4-legacy "LZ4 legacy frame." ;
  option skippable-frame "LZ4 or Zstandard skippable frame." ;
  option lzma-alone "LZMA data (.lzma)." ;
  option lzip "lzip data." ;
  option tar "tar archive." ;
  option compress "compress data." ;
  option lzh "LHA archive." ;
  option cpio-newc "cpio archive." ;
  option cpio-crc "cpio archive." ;
  option cpio-odc "cpio archive." ;
  option ar "ar archive." ;
  option rpm "RPM package." ;
  option cab "CAB archive." ;
  option iso9660 "ISO 9660 image." ;
  option squashfs "SquashFS image." ;
  option xar "XAR archive." ;
  option arj "ARJ archive." ;
  option wim "WIM image." ;
  option zlib-default "zlib data." ;
  option zlib-best "zlib data." ;
  option sqlite "SQLite 3 database." ;
  option pcap-le "pcap capture." ;
  option pcap-be "pcap capture." ;
  option pcap-nano-le "pcap capture." ;
  option pcap-nano-be "pcap capture." ;
  option pcapng-le "pcapng capture." ;
  option pcapng-be "pcapng capture." ;
  option bplist "binary property list." ;
  option der-long "DER certificate." ;
  option der-mixed "DER certificate." ;
  option der-short "DER certificate." ;
  option pem "PEM armoured data (a label such as CERTIFICATE or PRIVATE KEY)." ;
  option lnk "Windows shortcut." ;
  option openssh-key "OpenSSH private key." ;
  option jks "Java KeyStore." ;
  option kdbx "KeePass 2 database." ;
  option kdb "KeePass 1 database." ;
  option luks "LUKS volume." ;
  option regf "Windows registry hive." ;
  option evtx "Windows event log." ;
  option prefetch "Windows prefetch file." ;
  option ttf "TrueType font." ;
  option otf "OpenType font." ;
  option ttc "TrueType collection." ;
  option woff "WOFF font." ;
  option woff2 "WOFF2 font." ;
  option git-pack "Git packfile." ;
  option vhd "VirtualBox VHD disk." ;
  option vmdk "VMware disk." ;
  option qcow "QCOW disk image." ;
  option krb5-ccache "Kerberos credential cache." ;
  option nes "NES ROM." ;
  option avro "Avro object container file." ;
  option json "JSON text." ;
  option base64 "Base64 text." ;
  option hex "Hex text." ;
  option utf8-text "Valid UTF-8 text; plain ASCII text counts as a child of it." ;
  option ascii-text "Plain ASCII text." ;
  option random-bytes "Random-looking bytes: high-entropy data with no signature." ;
;

: identify ( data:bytes -- str )
  "The id of the most specific identification of the data, such as gzip, png, pem, json, utf8-text, base64 or hex, and unknown when the data is not recognised. Only the start of the data is looked at, and no operation is run. Use magic:is-format to test for one format." doc
  "Forensics" category
  data _identity 0 nth ;

META: identify
  use-when "You want to know what the data is, as an id you can show or compare, such as gzip, png, pem or json." ;
  see-also magic:is-format filetype:detect ;
;

: is-format ( data:bytes format:choice<magic-format> -- bool )
  "True when the identification of the data is the format or a child of it: the family of an identification is the more general format it refines, so zip is true for an Office Open XML file or a JAR, and utf8-text is true for plain ASCII text. False for data that is not recognised." doc
  "Forensics" category
  data _identity dup 0 nth format = swap 1 nth format = or ;

META: is-format
  use-when "You want a recipe to branch on what the data is, as the test of an if step, for example to decode only data that is gzip." ;
  see-also magic:identify filetype:detect ;
  param format "The format to test for: a file type of the Detect File Type table, or a generic kind such as json, base64 or utf8-text." ;
;

\ ---- magic:magic ----

\ A score in hundredths as text: 87 is 0.87 and 130 is 1.30.
: _score-text ( hundredths:int -- str )
  hundredths 100 div int>str "." cat hundredths 100 mod 2 util:zero-pad cat ;

\ One block of the report, from { recipe score reasons preview }: four lines, the recipe as FL text.
: _block ( found:list -- str )
  found 0 nth :> recipe
  found 1 nth :> score
  found 2 nth :> reasons
  found 3 nth :> preview
  { "recipe: " recipe cat
    "score: " score _score-text cat
    "reasons: " reasons "; " join cat
    "output: " preview cat } "\n" join ;

: magic ( data:bytes depth:int[1..6]=3 intensive:bool=false crib:regex="" -- str )
  "Searches for recipes that make the data more readable or more recognisable (the Magic engine: decoders, decompressors and the like, each tried on its defaults) and reports the best candidates, best first, one block of four lines each, separated by a blank line: the recipe as FL text (the operations in order), the score (higher is better), the reasons and the first 80 characters of the output. It is the text form of the Magic button, and it is not a predicate: to branch on what the data is, test with magic:identify or magic:is-format. depth is the most operations in a candidate (1 to 6). crib is a regular expression the wanted output matches; it makes the engine try operations that show no sign of fitting the data. intensive is accepted and has no effect yet (it is for the extensive mode of a later version). The search runs inside the bake, so it counts towards the run's step, byte and time limits and stops with the run. It needs the Forge worker (a plain runtime reports an error), and it needs a hard kill, as it may run regular expressions. Gives no candidate when nothing beats the data as it is." doc
  "Forensics" category
  data depth crib intensive _search :> found
  found len 0 =
  [ "no candidate" ]
  [ found [ _block ] map "\n\n" join ] if ;

META: magic
  use-when "You do not know how the data is encoded or compressed and want a text report of the recipes the Magic engine suggests, like CyberChef's Magic." ;
  see-also magic:identify magic:is-format filetype:detect ;
  param depth "The most operations in a candidate, 1 to 6. A larger depth takes longer." ;
  param intensive "Accepted for CyberChef's sake; it has no effect until the extensive mode exists." ;
  param crib "A regular expression the wanted output must match, such as flag\\{ or the start of a known text. Empty for none." ;
;
