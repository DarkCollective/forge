\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base64-offsets: Show Base64 offsets, the CyberChef operation of that name, as text (CyberChef marks the characters with
\ HTML; Forge does not). Written in FL over the base64 primitive: the data is encoded in the standard alphabet and the
\ characters are translated into the chosen alphabet with a 256-byte table, so a 64 KiB input costs a few thousand
\ VM steps. Offset 1 and 2 are the encodings of the data behind one and two unknown bytes (zeros here).
IN: base64-offsets

USING: alphabet list ;

\ The standard-alphabet index of a character code: 0 to 63, 64 for the padding, 255 for any other code.
: _std-index ( c:int -- int )
  c 65 90 util:between? [ c 65 - ] [
    c 97 122 util:between? [ c 71 - ] [
      c 48 57 util:between? [ c 4 + ] [
        c 43 = [ 62 ] [ c 47 = [ 63 ] [ c 61 = [ 64 ] [ 255 ] if ] if ] if
      ] if
    ] if
  ] if ;

\ The translation table from the standard alphabet to the chosen one (other codes stay as they are).
: _table ( alpha:bytes -- bytes )
  0 256 range [ dup _std-index dup alpha len < [ nip alpha swap nth ] [ drop ] if ] map list>bytes ;

\ The number of padding characters of n bytes.
: _pad-count ( n:int -- int )
  3 n 3 mod - 3 mod ;

\ The characters of the encoding of bytes, without padding, in the chosen alphabet.
: _chars ( z:bytes table:bytes -- str )
  z "standard" false base64:encode str>bytes table translate bytes>str ;

\ The wanted part of the text: the characters that depend on unknown bytes before the data (k of them, and one that
\ depends on them partly) and the last character when the data stops inside a group (it depends on the bytes that
\ would follow) are left out unless show-variable is on, which also adds the padding.
: _trim ( text:str k:int nz:int show:bool pad-char:str -- str )
  show [ 0 ] [ k 0 > [ k 1 + ] [ k ] if ] if
  text len show [ 0 ] [ nz 3 mod 0 <> [ 1 ] [ 0 ] if ] if -
  text -rot slice
  show [ pad-char nz _pad-count util:repeat-str cat ] when ;

: _line2 ( z:bytes table:bytes k:int show:bool pad-char:str -- str )
  z table _chars k z len show pad-char _trim ;

: _line ( data:bytes k:int table:bytes show:bool pad-char:str -- str )
  data len 0 = [ "" ] [ k util:zero-bytes data cat table k show pad-char _line2 ] if ;

: _check-alphabet ( a:str -- )
  a str>codes [ int>str ] map list:unique len a len <> [ "the alphabet must not repeat a character" raise:range ] when
  a len 64 < a len 65 > or [ "the alphabet must hold 64 or 65 characters" raise:range ] when
  a str>codes [ 127 > ] filter len 0 <> [ "the alphabet must hold ASCII characters only" raise:range ] when ;

: _alphabet ( alphabet:str -- bytes )
  alphabet "none" alphabet:expand dup _check-alphabet str>bytes ;

: _input ( data:bytes input-type:str -- bytes )
  input-type "hex" = [ data bytes>str hex>bytes ] [ input-type "base64" = [ data "standard" base64:decode ] [ data ] if ] if ;

: _run ( data:bytes table:bytes show:bool pad-char:str -- str )
  show [ "Offset 0: " ] [ "" ] if data 0 table show pad-char _line cat
  "\n" cat show [ "Offset 1: " ] [ "" ] if cat data 1 table show pad-char _line cat
  "\n" cat show [ "Offset 2: " ] [ "" ] if cat data 2 table show pad-char _line cat ;

: _go ( data:bytes alpha:bytes show:bool -- str )
  data len 0 = [ "the input is empty" raise:coerce ] when
  data alpha _table show alpha len 64 > [ alpha 64 nth util:cp>str ] [ "" ] if _run ;

: show ( data:bytes alphabet:str="A-Za-z0-9+/=" show-variable:bool=true input-type:choice{raw|hex|base64}=raw -- str )
  "Show how the Base64 encoding of the data looks when it starts at each of the three alignments, as CyberChef's Show Base64 offsets does, as text. Offset 0 is the encoding of the data. Offsets 1 and 2 are what the same bytes look like when one or two other bytes (zeros here) come before them. With show-variable on (the default) the three lines are labelled Offset 0:, Offset 1: and Offset 2: and hold the whole encoding: the leading characters that only stand for the unknown bytes (CyberChef colours them red and green), the last character when the data stops inside a three-byte group (it depends on the bytes that would follow), and the = padding. With it off the three lines have no label and hold only the characters that the data alone fixes. CyberChef colours the characters and shows the static part decoded as a tooltip, and writes four lines of explanation above the offsets; text has neither, so Forge writes neither. The alphabet is written with ranges (A-Za-z0-9+/=) and has 64 characters, or 65 when the last one is the padding (no padding without it). input-type reads the data as it is, as hex (an addition to CyberChef's raw and Base64) or as Base64 text first. The alphabet must be 64 or 65 different ASCII characters; empty data (CyberChef: Please enter a string.) and hex or Base64 text that is not valid are E_COERCE." doc
  "Data format" category
  data input-type _input alphabet _alphabet show-variable _go ;

META: show
  param alphabet "The Base64 alphabet, with ranges: 64 characters, or 65 with the padding character last." ;
  param show-variable "Keep the characters that depend on the unknown neighbouring bytes, and the padding." ;
  param input-type "How to read the input: as it is, as hex text or as Base64 text." ;
  see-also base64:encode ;
;
