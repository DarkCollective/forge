\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ caret: caret and M- notation as printed by `cat -v` (POSIX/GNU cat). A control byte c (0 to 31)
\ is ^ and the character c + 64, DEL (127) is ^?, and a byte of 128 or more is M- followed by the
\ notation of the byte minus 128. Tab (9) and line feed (10) are left as they are, as cat -v does,
\ except after M-. The notation is not injective (a literal ^ or M- in the data reads as an
\ escape), exactly as for cat -v. The words are FL; E_COERCE comes from raise:coerce.
IN: caret

\ Notation of a byte 0 to 127, without the tab and line feed exception.
: _ctrl ( b:int -- str )
  b 127 = [ "^?" ] [ b 32 < [ "^" b 64 + util:cp>str cat ] [ b util:cp>str ] if ] if ;

: _piece ( b:int -- str )
  b 128 >= [ "M-" b 128 - _ctrl cat ]
  [ b 9 = b 10 = or [ b util:cp>str ] [ b _ctrl ] if ] if ;

: encode ( bytes -- str )
  "Caret and M- notation as in cat -v: control bytes as ^@ to ^_, DEL as ^?, bytes 128 and up as M- plus the notation of the byte minus 128. Tab and line feed stay literal. A literal ^ or M- in the data is not escaped (as in cat -v), so decode cannot always read it back." doc
  "Encodings" category
  bytes>list [ _piece ] map "" join ;

\ The control character that ^c stands for: c in @ A-Z [ \ ] ^ _ gives 0 to 31, ? gives 127.
: _ctrl-of ( c:int -- int )
  c 63 = [ 127 ]
  [ c 64 >= c 95 <= and [ c 64 - ] [ "a ^ must be followed by one of @ A-Z [ \\ ] ^ _ ?" raise:coerce 0 ] if ] if ;

\ p is the text right after a ^.
: _caret-piece ( p:str -- str )
  p len 0 = [ "a ^ at the end of the text has nothing to escape" raise:coerce ] when
  p 0 1 slice str>codes 0 nth _ctrl-of util:cp>str
  p 1 p len slice cat ;

: _join-escapes ( parts:list -- str )
  parts 0 nth parts 1 parts len slice [ _caret-piece ] map "" join cat ;

: _caret-seg ( seg:str -- str )
  seg "^" split _join-escapes ;

\ ^^ is an escape (0x1E) whose second character is itself a ^, so cut on pairs first, left to right.
: _carets ( s:str -- str )
  s "^^" split [ _caret-seg ] map 30 util:cp>str join ;

\ p is the text right after an M-: its first character gets 128 added.
: _meta-piece ( p:str -- str )
  p len 0 = [ "an M- at the end of the text has no character" raise:coerce ] when
  p 0 1 slice str>codes 0 nth dup 127 > [ "M- must be followed by an ASCII character" raise:coerce ] when
  128 + util:cp>str
  p 1 p len slice cat ;

: _join-metas ( parts:list -- str )
  parts 0 nth parts 1 parts len slice [ _meta-piece ] map "" join cat ;

\ M-M is the byte 0xCD, so it is cut out first (left to right) before the other M- are read.
: _metas ( s:str -- str )
  s "M-M" split 205 util:cp>str join "M-" split _join-metas ;

: decode ( str -- bytes )
  "Read cat -v caret and M- notation back to bytes: ^@ to ^_ and ^? are control bytes, M- adds 128 to the byte that follows (a character, or a ^ escape). ASCII characters otherwise stand for themselves. A ^ or M- that is not followed by a valid character, or a non-ASCII character, is E_COERCE. ^ is read before M-, left to right." doc
  "Encodings" category
  dup str>codes [ 127 > ] filter len 0 > [ "caret notation is ASCII text" raise:coerce ] when
  _carets _metas latin1>bytes ;

META: encode
  use-when "You have a file or terminal output with hidden control characters and want to see them as text, in the form that cat -v prints." ;
  link "https://en.wikipedia.org/wiki/Caret_notation" "Caret notation on Wikipedia" ;
  inverse decode ;
;

META: decode
  use-when "You have text copied from cat -v output, with ^ and M- marks, and want the bytes it stands for." ;
  link "https://en.wikipedia.org/wiki/Caret_notation" "Caret notation on Wikipedia" ;
  inverse encode ;
;
