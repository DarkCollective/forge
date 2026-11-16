\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ id3: Extract ID3 (CyberChef's op): the ID3 tags of an audio file as text. ID3v2.2, 2.3 and 2.4 at the start
\ of the data (the header, the extended header, the unsynchronisation of the whole tag or of one frame, the
\ frames with their sizes, flags and padding) and ID3v1 and v1.1 in the last 128 bytes. Text frames are decoded
\ by their encoding byte (ISO-8859-1, UTF-16 with a byte order mark, UTF-16BE, UTF-8); user text and URL
\ frames, comments and lyrics, pictures (the MIME type, picture type, description and size, not the image),
\ private frames, play counters and ratings are read by their layouts; every other frame is shown by its size.
\ A compressed or encrypted frame is named, not decoded. All FL. A size in the data is only compared with the
\ bytes that exist, never used to allocate; at most 1,000 frames are read; a tag, a frame or a field that runs
\ past the data is E_COERCE with the offset. The layout of the report is Forge's own.
IN: id3

\ ---- tables ----

: _frame-names ( -- str )
  "|AENC:Audio encryption|APIC:Attached picture|ASPI:Audio seek point index|COMM:Comments|COMR:Commercial frame|ENCR:Encryption method registration|EQU2:Equalisation (2)|EQUA:Equalization|ETCO:Event timing codes|GEOB:General encapsulated object|GRID:Group identification registration|IPLS:Involved people list|LINK:Linked information|MCDI:Music CD identifier|MLLT:MPEG location lookup table|OWNE:Ownership frame|PCNT:Play counter|POPM:Popularimeter|POSS:Position synchronisation frame|PRIV:Private frame|RBUF:Recommended buffer size|RVA2:Relative volume adjustment (2)|RVAD:Relative volume adjustment|RVRB:Reverb|SEEK:Seek frame|SIGN:Signature frame|SYLT:Synchronised lyric/text|SYTC:Synchronised tempo codes|TALB:Album/Movie/Show title|TBPM:BPM (beats per minute)|TCOM:Composer|TCON:Content type|TCOP:Copyright message|TDAT:Date|TDEN:Encoding time|TDLY:Playlist delay|TDOR:Original release time|TDRC:Recording time|TDRL:Release time|TDTG:Tagging time|TENC:Encoded by|TEXT:Lyricist/Text writer|TFLT:File type|TIME:Time|TIPL:Involved people list|TIT1:Content group description|TIT2:Title/songname/content description|TIT3:Subtitle/Description refinement|TKEY:Initial key|TLAN:Language(s)|TLEN:Length|TMCL:Musician credits list|TMED:Media type|TMOO:Mood|TOAL:Original album/movie/show title|TOFN:Original filename|TOLY:Original lyricist(s)/text writer(s)|TOPE:Original artist(s)/performer(s)|TORY:Original release year|TOWN:File owner/licensee|TPE1:Lead performer(s)/Soloist(s)|TPE2:Band/orchestra/accompaniment|TPE3:Conductor/performer refinement|TPE4:Interpreted, remixed, or otherwise modified by|TPOS:Part of a set|TPRO:Produced notice|TPUB:Publisher|TRCK:Track number/Position in set|TRDA:Recording dates|TRSN:Internet radio station name|TRSO:Internet radio station owner|TSIZ:Size|TSOA:Album sort order|TSOP:Performer sort order|TSOT:Title sort order|TSRC:ISRC (international standard recording code)|TSSE:Software/Hardware and settings used for encoding|TSST:Set subtitle|TXXX:User defined text information frame|TYER:Year|UFID:Unique file identifier|USER:Terms of use|USLT:Unsynchronised lyric/text transcription|WCOM:Commercial information|WCOP:Copyright/Legal information|WOAF:Official audio file webpage|WOAR:Official artist/performer webpage|WOAS:Official audio source webpage|WORS:Official Internet radio station homepage|WPAY:Payment|WPUB:Publishers official webpage|WXXX:User defined URL link frame|" ;

\ The v2.2 identifiers and the v2.3 identifiers they became.
: _v22-ids ( -- str )
  "|BUF:RBUF|CNT:PCNT|COM:COMM|CRA:AENC|ETC:ETCO|EQU:EQUA|GEO:GEOB|IPL:IPLS|LNK:LINK|MCI:MCDI|MLL:MLLT|PIC:APIC|POP:POPM|REV:RVRB|RVA:RVAD|SLT:SYLT|STC:SYTC|TAL:TALB|TBP:TBPM|TCM:TCOM|TCO:TCON|TCR:TCOP|TDA:TDAT|TDY:TDLY|TEN:TENC|TFT:TFLT|TIM:TIME|TKE:TKEY|TLA:TLAN|TLE:TLEN|TMT:TMED|TOA:TOPE|TOF:TOFN|TOL:TOLY|TOR:TORY|TOT:TOAL|TP1:TPE1|TP2:TPE2|TP3:TPE3|TP4:TPE4|TPA:TPOS|TPB:TPUB|TRC:TSRC|TRD:TRDA|TRK:TRCK|TSI:TSIZ|TSS:TSSE|TT1:TIT1|TT2:TIT2|TT3:TIT3|TXT:TEXT|TXX:TXXX|TYE:TYER|UFI:UFID|ULT:USLT|WAF:WOAF|WAR:WOAR|WAS:WOAS|WCM:WCOM|WCP:WCOP|WPB:WPUB|WXX:WXXX|" ;

: _genres ( -- str )
  "|0:Blues|1:Classic Rock|2:Country|3:Dance|4:Disco|5:Funk|6:Grunge|7:Hip-Hop|8:Jazz|9:Metal|a:New Age|b:Oldies|c:Other|d:Pop|e:R&B|f:Rap|10:Reggae|11:Rock|12:Techno|13:Industrial|14:Alternative|15:Ska|16:Death Metal|17:Pranks|18:Soundtrack|19:Euro-Techno|1a:Ambient|1b:Trip-Hop|1c:Vocal|1d:Jazz+Funk|1e:Fusion|1f:Trance|20:Classical|21:Instrumental|22:Acid|23:House|24:Game|25:Sound Clip|26:Gospel|27:Noise|28:AlternRock|29:Bass|2a:Soul|2b:Punk|2c:Space|2d:Meditative|2e:Instrumental Pop|2f:Instrumental Rock|30:Ethnic|31:Gothic|32:Darkwave|33:Techno-Industrial|34:Electronic|35:Pop-Folk|36:Eurodance|37:Dream|38:Southern Rock|39:Comedy|3a:Cult|3b:Gangsta|3c:Top 40|3d:Christian Rap|3e:Pop/Funk|3f:Jungle|40:Native American|41:Cabaret|42:New Wave|43:Psychedelic|44:Rave|45:Showtunes|46:Trailer|47:Lo-Fi|48:Tribal|49:Acid Punk|4a:Acid Jazz|4b:Polka|4c:Retro|4d:Musical|4e:Rock & Roll|4f:Hard Rock|50:Folk|51:Folk-Rock|52:National Folk|53:Swing|54:Fast Fusion|55:Bebop|56:Latin|57:Revival|58:Celtic|59:Bluegrass|5a:Avantgarde|5b:Gothic Rock|5c:Progressive Rock|5d:Psychedelic Rock|5e:Symphonic Rock|5f:Slow Rock|60:Big Band|61:Chorus|62:Easy Listening|63:Acoustic|64:Humour|65:Speech|66:Chanson|67:Opera|68:Chamber Music|69:Sonata|6a:Symphony|6b:Booty Bass|6c:Primus|6d:Porn Groove|6e:Satire|6f:Slow Jam|70:Club|71:Tango|72:Samba|73:Folklore|74:Ballad|75:Power Ballad|76:Rhythmic Soul|77:Freestyle|78:Duet|79:Punk Rock|7a:Drum Solo|7b:A Cappella|7c:Euro-House|7d:Dance Hall|7e:Goa|7f:Drum & Bass|80:Club-House|81:Hardcore Techno|82:Terror|83:Indie|84:BritPop|85:Afro-Punk|86:Polsk Punk|87:Beat|88:Christian Gangsta Rap|89:Heavy Metal|8a:Black Metal|8b:Crossover|8c:Contemporary Christian|8d:Christian Rock|8e:Merengue|8f:Salsa|90:Thrash Metal|91:Anime|92:Jpop|93:Synthpop|" ;

MEMO: _picture-types ( -- list )
  { "Other" "32x32 pixels file icon" "Other file icon" "Cover (front)" "Cover (back)" "Leaflet page" "Media"
    "Lead artist" "Artist" "Conductor" "Band" "Composer" "Lyricist" "Recording location" "During recording"
    "During performance" "Movie/video screen capture" "A bright coloured fish" "Illustration" "Band logotype"
    "Publisher logotype" } ;

\ ---- bytes ----

: _tail ( b:bytes i:int -- bytes )
  b i b len min b len slice ;

\ A syncsafe integer of four bytes (7 bits each) at p, and whether the bytes are syncsafe.
: _syncsafe ( d:bytes p:int -- int )
  d p p 4 + slice 128 digits>int ;

: _syncsafe? ( d:bytes p:int -- bool )
  d p p 4 + slice [ 128 < ] filter len 4 = ;

\ The tag with every 0xFF 0x00 turned back into 0xFF (the unsynchronisation scheme).
: _unsync ( b:bytes -- bytes )
  b bytes>latin1 "\xff\x00" split "\xff" join latin1>bytes ;

: _byte ( b:bytes i:int -- int )
  b i util:byte-at ;

\ ---- text ----

: _hi? ( u:int -- bool )
  u 55296 >= u 56319 <= and ;

: _lo? ( u:int -- bool )
  u 56320 >= u 57343 <= and ;

\ Whether the unit at i is a low (or high) surrogate; false outside the list.
: _lo-at? ( units:list i:int -- bool )
  i 0 >= i units len < and [ units i nth _lo? ] [ false ] if ;

: _hi-at? ( units:list i:int -- bool )
  i 0 >= i units len < and [ units i nth _hi? ] [ false ] if ;

\ One UTF-16 unit as a code point: a surrogate pair becomes one code point, the second half of a pair -1.
: _fix ( u:int i:int units:list -- int )
  {
    [ u _hi? [ units i 1 + _lo-at? ] [ false ] if ] [ 65536 u 55296 - 1024 * + units i 1 + nth 56320 - + ]
    [ u _lo? [ units i 1 - _hi-at? ] [ false ] if ] [ -1 ]
    [ u util:surrogate? ] [ 65533 ]
    [ u ]
  } cond ;

\ The code points of UTF-16 units: a lone surrogate is U+FFFD and byte order marks are dropped.
: _utf16-codes ( units:list -- list )
  units [ units _fix ] mapi [ dup 0 >= swap 65279 <> and ] filter ;

: _utf16-text ( b:bytes be:bool -- str )
  0 b len 2 div range [ 2 * b swap 2 be [ be-bytes>int ] [ le-bytes>int ] if ] map _utf16-codes codes>str ;

\ UTF-16 with a byte order mark (FF FE little, FE FF big; none: little endian).
: _utf16-bom ( b:bytes -- str )
  b #[ fe ff ] util:starts-with-bytes? [ b true _utf16-text ] [ b false _utf16-text ] if ;

: _text ( b:bytes enc:int -- str )
  enc {
    1 [ b _utf16-bom ]
    2 [ b true _utf16-text ]
    3 [ b util:text-lossless ]
    [ b bytes>latin1 ]
  } case ;

\ ---- terminated fields ----

: _nul-at ( b:bytes -- int )
  b bytes>latin1 "\x00" split 0 nth len ;

: _z16? ( b:bytes i:int -- bool )
  i 1 + b len < [ b i nth 0 = b i 1 + nth 0 = and ] [ false ] if ;

\ The offset of the first aligned 00 00 of UTF-16 data (looked for in the first 1,024 bytes), else its length.
: _nul16-at ( b:bytes -- int )
  0 b len 2 div 512 min range [ 2 * ] map [ b swap _z16? ] filter
  dup len 0 = [ drop b len ] [ 0 nth ] if ;

\ ( before after ): the bytes up to the terminator of the encoding and those after it.
: _split ( b:bytes enc:int -- bytes bytes )
  enc 1 = enc 2 = or
  [ b 0 b _nul16-at slice b b _nul16-at 2 + _tail ]
  [ b 0 b _nul-at slice b b _nul-at 1 + _tail ] if ;

: _split8 ( b:bytes -- bytes bytes )
  b 0 b _nul-at slice b b _nul-at 1 + _tail ;

: _latin1-nul ( b:bytes -- str )
  b _split8 drop bytes>latin1 ;

\ Text values separated by NULs (ID3v2.4) joined with a semicolon; empty ones dropped.
: _values ( s:str -- str )
  s "\x00" split [ len 0 > ] filter "; " join ;

: _field-text ( b:bytes enc:int -- str )
  b enc _text _values ;

: _hex-text ( b:bytes -- str )
  b 0 b len 24 min slice bytes>hex
  b len 24 > [ "..." cat ] when ;

: _size-text ( n:int -- str )
  n int>str " bytes" cat ;

\ ---- genres ----

: _genre-name ( n:int -- str )
  _genres n 16 int>str-radix util:name-in-table dup len 0 = [ drop "Unknown" ] when
  " (" cat n int>str cat ")" cat ;

: _digits? ( s:str -- bool )
  s len 0 > s util:digits? and ;

: _paren-inner ( s:str -- str )
  s ")" split 0 nth dup len 1 max 1 swap slice ;

: _paren-rest ( s:str -- str )
  s ")" split dup len 1 swap slice ")" join ;

: _genre-paren ( s:str -- str )
  s _paren-inner _digits? not [ s ] [
    s _paren-rest dup len 0 = [ drop s _paren-inner str>int _genre-name ] when ] if ;

\ "17", "(17)", "(17)Rock" and plain names; numbers above 191 stay as they are.
: _genre-one ( s:str -- str )
  {
    [ s _digits? ] [ s str>int _genre-name ]
    [ s "(" starts-with? ] [ s _genre-paren ]
    [ s ]
  } cond ;

: _genre-text ( s:str -- str )
  s "\x00" split [ len 0 > ] filter [ _genre-one ] map "; " join ;

\ ---- the frames of a tag ----

: _frame-cap ( -- int )
  1000 ;

: _idchar? ( c:int -- bool )
  c 48 >= c 57 <= and c 65 >= c 90 <= and or ;

: _idlen ( v:int -- int )
  v 2 = [ 3 ] [ 4 ] if ;

: _hdrlen ( v:int -- int )
  v 2 = [ 6 ] [ 10 ] if ;

\ A frame header with a valid identifier starts at pos.
: _frame-ok? ( pos:int b:bytes v:int -- bool )
  pos v _hdrlen + b len <= [
    b pos nth 0 <>
    b pos pos v _idlen + slice [ _idchar? ] all? and
  ] [ false ] if ;

\ The size field of the frame header at pos.
: _frame-size ( b:bytes v:int pos:int -- int )
  {
    [ v 2 = ] [ b pos 3 + 3 be-bytes>int ]
    [ v 3 = ] [ b pos 4 + 4 be-bytes>int ]
    [ b pos 4 + _syncsafe? ] [ b pos 4 + _syncsafe ]
    [ b pos 4 + 4 be-bytes>int ]
  } cond ;

\ The record of the frame at pos: id, at (where its data starts), size, flags and next (where the next frame starts).
: _frame-rec ( b:bytes v:int pos:int size:int -- record )
  pos v _hdrlen + size + b len > [
    "the ID3v2 frame " b pos pos v _idlen + slice bytes>latin1 cat " at offset " cat pos int>str cat
    " declares " cat size int>str cat " bytes but only " cat b len pos v _hdrlen + - int>str cat
    " are left (truncated)" cat fail-coerce ] when
  { { "id" b pos pos v _idlen + slice bytes>latin1 } { "at" pos v _hdrlen + } { "size" size }
    { "flags" v 2 = [ 0 ] [ b pos 8 + 2 be-bytes>int ] if } { "next" pos v _hdrlen + size + } } >record ;

: _frame-at ( b:bytes v:int pos:int -- record )
  b v pos b v pos _frame-size _frame-rec ;

\ ( pos n ) after reading the frame at pos: emits it, and returns where the next one starts and the count so far.
: _take ( pos:int n:int b:bytes v:int -- int int )
  b v pos _frame-at :> rec
  rec emit
  rec "next" get n 1 + ;

\ Every frame from start, up to the padding, the end of the tag or _frame-cap frames.
: _frames ( b:bytes v:int start:int -- list )
  [
    start 0
    [ dup _frame-cap < [ over b v _frame-ok? ] [ false ] if ] [ b v _take ] while
    drop drop
  ] collect ;

\ ---- the layouts of the frames ----

: _head ( b:bytes n:int -- bytes )
  b 0 n b len min slice ;

: _pair-text ( d:str v:str -- str )
  d len 0 = [ v ] [ d ": " cat v cat ] if ;

\ T***: an encoding byte and text. TCON also names genres by number.
: _tframe-text ( id:str data:bytes enc:int -- str )
  id "TCON" = [ data 1 _tail enc _text _genre-text ] [ data 1 _tail enc _field-text ] if ;

: _tframe ( id:str data:bytes -- str )
  id data data 0 _byte _tframe-text ;

\ TXXX: encoding, description, value.
: _txxx ( data:bytes -- str )
  data 0 _byte :> enc
  data 1 _tail enc _split :> after :> before
  before enc _field-text after enc _field-text _pair-text ;

\ WXXX: encoding, description, URL.
: _wxxx ( data:bytes -- str )
  data 0 _byte :> enc
  data 1 _tail enc _split :> url :> desc
  desc enc _field-text url _latin1-nul _pair-text ;

\ COMM and USLT: encoding, language, description, text.
: _comm ( data:bytes -- str )
  data 0 _byte :> enc
  data 1 _tail 3 _head bytes>latin1 :> lang
  data 4 _tail enc _split :> body :> desc
  "[" lang cat "] " cat desc enc _field-text body enc _field-text _pair-text cat ;

\ APIC (v2.3 and v2.4) and PIC (v2.2): the image itself is not shown, only what it is and how big.
: _apic-out ( mime:str ptype:int desc:str pic:bytes -- str )
  mime ", " cat
  _picture-types ptype over len < [ ptype nth ] [ drop "type " ptype int>str cat ] if cat
  ", " cat pic len _size-text cat
  desc len 0 > [ ", \"" cat desc cat "\"" cat ] when ;

: _apic ( data:bytes -- str )
  data 0 _byte :> enc
  data 1 _tail _split8 :> after :> mime
  after 0 _byte :> ptype
  after 1 _tail enc _split :> pic :> descb
  mime bytes>latin1 ptype descb enc _field-text pic _apic-out ;

: _pic ( data:bytes -- str )
  data 0 _byte :> enc
  data 4 _byte :> ptype
  data 5 _tail enc _split :> pic :> descb
  data 1 _tail 3 _head bytes>latin1 ptype descb enc _field-text pic _apic-out ;

\ PRIV and UFID: an owner and data.
: _priv ( data:bytes -- str )
  data _split8 :> after :> owner
  owner bytes>latin1 ", " cat after len _size-text cat ;

: _ufid ( data:bytes -- str )
  data _split8 :> after :> owner
  owner bytes>latin1 ": " cat after util:printable-bytes? [ after bytes>latin1 ] [ after _hex-text ] if cat ;

\ A big-endian number of the bytes (0 when there are none).
: _beall ( b:bytes -- int )
  b len 0 = [ 0 ] [ b 0 b len be-bytes>int ] if ;

\ POPM: an e-mail address, a rating byte and a counter.
: _popm ( data:bytes -- str )
  data _split8 :> after :> email
  email bytes>latin1 ", rating " cat after 0 _byte int>str cat ", counter " cat after 1 _tail _beall int>str cat ;

\ GEOB: encoding, MIME type, file name, description, object.
: _geob ( data:bytes -- str )
  data 0 _byte :> enc
  data 1 _tail _split8 :> after :> mime
  after enc _split :> rest :> fname
  rest enc _split :> obj :> desc
  mime bytes>latin1 ", \"" cat fname enc _field-text cat "\", \"" cat desc enc _field-text cat "\", " cat
  obj len _size-text cat ;

\ The description of a frame by its identifier (id as written, nid as ID3v2.3) and its data.
: _describe ( id:str nid:str data:bytes -- str )
  {
    [ data len 0 = ] [ "(empty)" ]
    [ nid "TXXX" = ] [ data _txxx ]
    [ nid "WXXX" = ] [ data _wxxx ]
    [ nid "COMM" = nid "USLT" = or ] [ data _comm ]
    [ nid "APIC" = ] [ id "PIC" = [ data _pic ] [ data _apic ] if ]
    [ nid "PRIV" = ] [ data _priv ]
    [ nid "UFID" = ] [ data _ufid ]
    [ nid "POPM" = ] [ data _popm ]
    [ nid "PCNT" = ] [ data _beall int>str ]
    [ nid "GEOB" = ] [ data _geob ]
    [ nid 0 1 slice "T" = ] [ nid data _tframe ]
    [ nid 0 1 slice "W" = ] [ data _latin1-nul ]
    [ data len _size-text ]
  } cond ;

\ ---- the flags of a frame ----

: _flag? ( v:int f:int name:str -- bool )
  v {
    3 [
      name {
        "comp" [ f 128 band 0 <> ]
        "enc" [ f 64 band 0 <> ]
        "group" [ f 32 band 0 <> ]
        [ false ]
      } case
    ]
    4 [
      name {
        "comp" [ f 8 band 0 <> ]
        "enc" [ f 4 band 0 <> ]
        "group" [ f 64 band 0 <> ]
        "unsync" [ f 2 band 0 <> ]
        "dli" [ f 1 band 0 <> ]
        [ false ]
      } case
    ]
    [ false ]
  } case ;

\ The bytes in front of the data of a frame: a group byte, an encryption method byte, a data length.
: _skip ( v:int f:int -- int )
  v f "group" _flag? [ 1 ] [ 0 ] if
  v f "enc" _flag? [ 1 ] [ 0 ] if +
  v f "dli" _flag? [ 4 ] [ 0 ] if + ;

: _body ( id:str nid:str raw:bytes v:int f:int tu:bool -- str )
  {
    [ v f "comp" _flag? ] [ "[compressed frame, " raw len _size-text cat ", not decoded]" cat ]
    [ v f "enc" _flag? ] [ "[encrypted frame, " raw len _size-text cat ", not decoded]" cat ]
    [
      id nid raw v f _skip _tail
      v f "unsync" _flag? tu or [ _unsync ] when
      _describe
    ]
  } cond ;

: _name-part ( nid:str -- str )
  _frame-names nid util:name-in-table dup len 0 = [ drop "" ] [ " (" swap cat ")" cat ] if ;

: _frame-line ( rec:record b:bytes v:int tu:bool -- str )
  rec "id" get :> id
  {
    [ v 2 = ] [ _v22-ids id util:name-in-table dup len 0 = [ drop id ] when ]
    [ id ]
  } cond :> nid
  "  " id cat nid _name-part cat ": " cat
  id nid b rec "at" get dup rec "size" get + slice v rec "flags" get tu _body cat
  "\n" cat ;

\ ---- the report of an ID3v2 tag ----

: _tag-flags ( v:int fl:int -- str )
  [
    fl 128 band 0 <> [ "unsynchronisation" emit ] when
    fl 64 band 0 <> [ v 2 = [ "compression" ] [ "extended header" ] if emit ] when
    v 3 >= fl 32 band 0 <> and [ "experimental" emit ] when
    v 4 = fl 16 band 0 <> and [ "footer" emit ] when
  ] collect ", " join ;

: _v2-head ( d:bytes v:int fl:int size:int n:int -- str )
  "ID3v2." v int>str cat "." cat d 4 nth int>str cat " tag: " cat 10 size + int>str cat " bytes, " cat
  n int>str cat n 1 = [ " frame" ] [ " frames" ] if cat
  v fl _tag-flags dup len 0 = [ drop ] [ " (" swap cat ")" cat cat ] if
  "\n" cat ;

\ Where the frames start: after the extended header, which is skipped.
: _ext-size ( v:int fl:int body:bytes -- int )
  v 2 > fl 64 band 0 <> and [
    v 3 = [ body 0 4 be-bytes>int 4 + ] [ body 0 4 _syncsafe? [ body 0 _syncsafe ] [ 0 ] if ] if
  ] [ 0 ] if ;

: _v2b ( d:bytes v:int fl:int size:int body:bytes -- str )
  v 2 = fl 64 band 0 <> and [
    d v fl size 0 _v2-head "  (the tag is compressed and is not decoded)\n" cat exit
  ] when
  body v v fl body _ext-size body len min _frames :> frames
  d v fl size frames len _v2-head
  frames [ body v v 4 = fl 128 band 0 <> and _frame-line ] map "" join cat ;

: _v2 ( d:bytes v:int fl:int size:int -- str )
  10 size + d len > [
    "the ID3v2 tag declares " size int>str cat " bytes after its header but only " cat d len 10 - int>str cat
    " are left (truncated)" cat fail-coerce ] when
  d v fl size d 10 10 size + slice v 4 < fl 128 band 0 <> and [ _unsync ] when _v2b ;

: _v2? ( d:bytes -- bool )
  {
    [ d len 10 < ] [ false ]
    [ d #[ 49 44 33 ] util:starts-with-bytes? not ] [ false ]
    [ d 3 nth dup 2 >= swap 4 <= and ] [ d 6 _syncsafe? ]
    [ false ]
  } cond ;

: _report-v2 ( d:bytes -- str )
  d d 3 nth d 5 nth d 6 _syncsafe _v2 ;

\ ---- ID3v1 ----

: _v1? ( d:bytes -- bool )
  d len 128 < [ false ] [ d d len 128 - _tail 3 _head #[ 54 41 47 ] = ] if ;

\ A field of ID3v1: up to the first NUL, trailing spaces dropped; ISO-8859-1 as the standard says, or UTF-8 when
\ the bytes are valid UTF-8 (many writers, ffmpeg among them, put UTF-8 in the fields).
: _v1-str ( d:bytes off:int n:int -- str )
  d off off n + slice bytes>latin1 "\x00" split 0 nth latin1>bytes util:text-lossless [ 32 = ] trim-end ;

: _v1-genre ( g:int -- str )
  {
    [ g 255 = ] [ "not set" ]
    [ g 191 > ] [ "Unknown (" g int>str cat ")" cat ]
    [ g _genre-name ]
  } cond ;

: _v1-lines ( d:bytes base:int -- str )
  d base 125 + _byte 0 = d base 126 + _byte 0 <> and :> v11
  v11 [ "ID3v1.1 tag\n" ] [ "ID3v1 tag\n" ] if
  "  Title: " cat d base 3 + 30 _v1-str cat "\n" cat
  "  Artist: " cat d base 33 + 30 _v1-str cat "\n" cat
  "  Album: " cat d base 63 + 30 _v1-str cat "\n" cat
  "  Year: " cat d base 93 + 4 _v1-str cat "\n" cat
  "  Comment: " cat
  v11 [ d base 97 + 28 _v1-str ] [ d base 97 + 30 _v1-str ] if cat "\n" cat
  v11 [ "  Track: " d base 126 + _byte int>str cat "\n" cat cat ] when
  "  Genre: " cat d base 127 + _byte _v1-genre cat "\n" cat ;

: _report-v1 ( d:bytes -- str )
  d d len 128 - _v1-lines ;

: _both ( a:str b:str -- str )
  {
    [ a len 0 = b len 0 = and ] [ "No ID3 tag found.\n" ]
    [ a len 0 = b len 0 = or ] [ a b cat ]
    [ a "\n" cat b cat ]
  } cond ;

: extract ( data:bytes -- str )
  "Extract ID3: the ID3 tags of an audio file (an MP3 or any file with an ID3v2 tag at its start and an ID3v1 tag in its last 128 bytes) as text. For ID3v2.2, 2.3 and 2.4: the version, the size, the flags (unsynchronisation, extended header, footer) and one line per frame, Identifier (name): value. Text frames are decoded by their encoding byte (ISO-8859-1, UTF-16 with or without a byte order mark, UTF-8); several values are joined with a semicolon; genres given by number (17, (17)Rock) get their ID3v1 name; TXXX and WXXX show description: value; comments and lyrics show [language] description: text; pictures show the MIME type, the picture type, the size and the description, not the image; PRIV, UFID, POPM, PCNT and GEOB are read by their layouts; any other frame shows its size. Compressed and encrypted frames are named, not decoded. For ID3v1 and v1.1: title, artist, album, year, comment, track and genre. No tag gives No ID3 tag found.; a tag or frame that runs past the data is E_COERCE with the offset. At most 1,000 frames are read." doc
  "Extractors" category
  data _v2? [ data _report-v2 ] [ "" ] if
  data _v1? [ data _report-v1 ] [ "" ] if
  _both ;

META: extract
  use-when "You have an MP3 or other audio file as bytes or hex and want its ID3 tags, such as title, artist and album, as readable text." ;
  checks input magic-bytes format "mp3-id3" ;
  checks input magic-bytes format "mp3-mpeg1" ;
  checks input magic-bytes format "mp3-mpeg2" ;
  checks input magic-bytes format "mp3-mpeg25" ;
  checks input magic-bytes "544147" ;
  expects "MP3 or other audio with an ID3 tag" ;
  link "https://en.wikipedia.org/wiki/ID3" "ID3 on Wikipedia" ;
  see-also exif:extract ;
;
