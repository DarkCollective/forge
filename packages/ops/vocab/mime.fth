\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ mime: MIME Decoding, the encoded-words of RFC 2047 in header text (=?charset?B?...?= and =?charset?Q?...?=).
\ Written in FL over the regex words, base64 and the charset vocabulary (every character set it decodes).
IN: mime

USING: charset base64 util raise ;

\ MIME charset names (lower case) and the name charset:decode knows them by, as "|name=target|name=target|". us-ascii is
\ checked here (it is UTF-8 text without a byte above 127).
"|utf-8=utf-8|utf8=utf-8|us-ascii=ascii|ascii=ascii|iso-8859-1=iso-8859-1|iso_8859-1=iso-8859-1|latin1=iso-8859-1|l1=iso-8859-1|iso-8859-2=iso-8859-2|iso-8859-3=iso-8859-3|iso-8859-4=iso-8859-4|iso-8859-5=iso-8859-5|iso-8859-6=iso-8859-6|iso-8859-7=iso-8859-7|iso-8859-8=iso-8859-8|iso-8859-10=iso-8859-10|iso-8859-13=iso-8859-13|iso-8859-14=iso-8859-14|iso-8859-15=iso-8859-15|iso-8859-16=iso-8859-16|windows-1250=windows-1250|windows-1251=windows-1251|windows-1252=windows-1252|windows-1253=windows-1253|windows-1254=windows-1254|windows-1255=windows-1255|windows-1256=windows-1256|windows-1257=windows-1257|windows-1258=windows-1258|cp1250=windows-1250|cp1251=windows-1251|cp1252=windows-1252|windows-874=windows-874|koi8-r=koi8-r|koi8-u=koi8-u|macintosh=macintosh|x-mac-cyrillic=x-mac-cyrillic|ibm866=ibm866|cp866=ibm866|utf-16le=utf-16le|utf-16be=utf-16be|gb2312=gbk|gbk=gbk|gb18030=gb18030|big5=big5|euc-jp=euc-jp|iso-2022-jp=iso-2022-jp|shift_jis=shift_jis|shift-jis=shift_jis|euc-kr=euc-kr|" CONSTANT _names

\ The charset name of an encoded word without the RFC 2231 language part (utf-8*en), in lower case.
: _bare ( cs:str -- str )
  cs lower "*" split 0 nth ;

\ The matches of a charset name in the table (none when the name has characters a name never has).
: _found ( name:str -- list )
  name "^[a-z0-9_-]+$" "" regex:test
  [ _names "\\|" name cat "=([^|]*)\\|" cat "" regex:find-all ] [ { } ] if ;

\ The name charset:decode knows a MIME charset name by; an unknown name is E_COERCE.
: _lookup ( name:str -- str )
  name _found len 0 =
  [ "unsupported character set " name cat " in an encoded word" cat raise:coerce ] when
  name _found 0 nth "groups" get 0 nth ;

\ The bytes of a Q encoded text: _ is a space, =XX a byte, any other printable ASCII character itself.
: _q-bytes ( text:str -- bytes )
  text "^[!-~]*$" "" regex:test not
  [ "an encoded word holds a character that is not printable ASCII" raise:coerce ] when
  text "_" split " " join "=" "= must be followed by two hex digits in a Q encoded word" util:hex-unescape ;

: _word-bytes ( enc:str text:str -- bytes )
  enc lower "q" = [ text _q-bytes ] [ text str>bytes "standard" base64:decode ] if ;

\ ASCII text is UTF-8 text without a byte above 127.
: _ascii-text ( b:bytes -- str )
  b bytes>list [ 127 > ] filter len 0 >
  [ "a us-ascii encoded word holds a byte above 127" raise:coerce ] when
  b bytes>str ;

\ The characters of bytes in the character set name. UTF-8, ISO 8859-1 and ASCII are read here: charset:decode builds
\ its tables on every call, which costs about 0.5 MB of the total allocation limit each time.
: _decode-bytes ( b:bytes name:str -- str )
  name "utf-8" = [ b bytes>str ] [
  name "iso-8859-1" = [ b bytes>latin1 ] [
  name "ascii" = [ b _ascii-text ] [
  b name true charset:decode ] if ] if ] if ;

\ The charset name (as charset:decode knows it) and the bytes of one encoded word, from its regex groups.
: _name-of ( g:list -- str )
  g 0 nth _bare _lookup ;

: _bytes-of ( g:list -- bytes )
  g 1 nth g 2 nth _word-bytes ;

\ Words of these sets are decoded here, one at a time (see _decode-bytes).
: _fast? ( name:str -- bool )
  name "utf-8" = name "iso-8859-1" = or name "ascii" = or ;

\ A set whose words can be decoded together, joined with a NUL: not UTF-16 (a NUL is half a unit) and not the
\ stateful ISO-2022-JP.
: _joinable? ( name:str -- bool )
  name _fast? not name "utf-16le" = not and name "utf-16be" = not and name "iso-2022-jp" = not and ;

\ True when none of the byte strings holds a NUL.
: _no-nul? ( bs:list -- bool )
  bs [ bytes>latin1 "\x00" split len 1 = ] filter len bs len = ;

: _per-word ( bs:list name:str -- list )
  bs [ name _decode-bytes ] map ;

\ charset:decode builds its tables on every call (about 0.5 MB of the total allocation limit, so about 1,800 words
\ in one header stopped it): all the words of a set are decoded in one call, joined with a NUL that every joinable
\ set reads as itself, and split again. Another number of pieces falls back to one call a word.
: _joined ( bs:list name:str -- list )
  bs [ bytes>latin1 ] map "\x00" join latin1>bytes name true charset:decode "\x00" split ;

: _group-texts ( bs:list name:str -- list )
  name _joinable? bs len 1 > and bs _no-nul? and
  [ bs name _joined dup len bs len = [ ] [ drop bs name _per-word ] if ]
  [ bs name _per-word ] if ;

\ The pairs (index as text, decoded text) of the words in the set called name; idxs are their positions.
: _pairs-of ( idxs:list bss:list name:str -- list )
  idxs [ bss swap nth ] map name _group-texts
  idxs [ int>str ] map swap zip ;

: _acc ( acc:list name:str names:list bss:list -- list )
  acc 0 names len core:range [ names swap nth name = ] filter bss name _pairs-of cat ;

\ The texts of a record of pairs from index 0 to n - 1.
: _ordered ( recs:record n:int -- list )
  0 n core:range [ int>str recs swap get ] map ;

\ The decoded text of every word, in order; names and bss hold the set name and the bytes of each word.
: _texts ( names:list bss:list -- list )
  names list:unique { } [ names bss _acc ] reduce >record names len _ordered ;

\ The decoded text of every encoded word of the matches, in order.
: _decoded ( ms:list -- list )
  ms [ "groups" get ] map dup [ _name-of ] map swap [ _bytes-of ] map _texts ;

\ The text between match i-1 (or the start) and match i.
: _gap ( i:int ms:list s:str -- str )
  i 0 =
  [ s 0 ms 0 nth "start" get slice ]
  [ s ms i 1 - nth "end" get ms i nth "start" get slice ] if ;

\ Blank text between two encoded words is dropped (RFC 2047 section 6.2); other text stays.
: _piece ( i:int ms:list s:str texts:list -- str )
  i ms s _gap
  i 0 > over "\\S" "" regex:test not and [ drop "" ] when
  texts i nth cat ;

: _assemble-with ( s:str ms:list texts:list -- str )
  0 ms len core:range [ ms s texts _piece ] map "" join
  s ms ms len 1 - nth "end" get s len slice cat ;

: _assemble ( s:str ms:list -- str )
  ms len 0 = [ s ] [ s ms ms _decoded _assemble-with ] if ;

: decode ( data:str -- str )
  "Decode the encoded-words of RFC 2047 in header text, as CyberChef's MIME Decoding does: =?charset?B?base64?= and =?charset?Q?quoted-printable?= (in Q, _ is a space and =XX a byte) become the text they stand for, the text around them is kept, and white space between two encoded words is dropped. A line break written CR LF is read as LF first (CyberChef does that to the whole text). The character set is any that Decode text knows by its MIME name (utf-8, us-ascii, iso-8859-1 and the other ISO 8859 parts that exist there but 9, the windows-125x pages, koi8-r, gb2312, big5, shift_jis, euc-jp, euc-kr, utf-16le and utf-16be; CyberChef knows utf-8, us-ascii and iso-8859-1 to 16), a language part (utf-8*en, RFC 2231) is ignored. A word must be well formed to be decoded: no white space or ? inside it, the encoding letter B or Q (any case); anything else stays as text. An unknown character set, bytes that are not valid in their character set, bad base64, a bad =XX or a character that is not printable ASCII in a Q word is E_COERCE (CyberChef: Unhandled Charset, Incorrectly Encoded Word). Each word is decoded on its own, as the RFC says a character must not be split between words (the words of one character set are handed to the decoder together, joined with a NUL, to save its set-up cost)." doc
  "Data format" category
  data "\r\n" split "\n" join
  dup "=\\?([^?\\s]+)\\?([BbQq])\\?([^?\\s]*)\\?=" "" regex:find-all _assemble ;
