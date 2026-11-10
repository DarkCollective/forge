\ morse: International Morse code as in ITU-R M.1677-1 (letters, digits and the punctuation it
\ defines). The words are FL and need no primitive; a character or code with no meaning is
\ E_COERCE, raised by raise:coerce.
IN: morse

: _pairs ( -- list )
  { { "A" ".-" } { "B" "-..." } { "C" "-.-." } { "D" "-.." } { "E" "." } { "F" "..-." }
    { "G" "--." } { "H" "...." } { "I" ".." } { "J" ".---" } { "K" "-.-" } { "L" ".-.." }
    { "M" "--" } { "N" "-." } { "O" "---" } { "P" ".--." } { "Q" "--.-" } { "R" ".-." }
    { "S" "..." } { "T" "-" } { "U" "..-" } { "V" "...-" } { "W" ".--" } { "X" "-..-" }
    { "Y" "-.--" } { "Z" "--.." }
    { "0" "-----" } { "1" ".----" } { "2" "..---" } { "3" "...--" } { "4" "....-" }
    { "5" "....." } { "6" "-...." } { "7" "--..." } { "8" "---.." } { "9" "----." }
    { "." ".-.-.-" } { "," "--..--" } { "?" "..--.." } { "'" ".----." } { "!" "-.-.--" }
    { "/" "-..-." } { "(" "-.--." } { ")" "-.--.-" } { "&" ".-..." } { ":" "---..." }
    { ";" "-.-.-." } { "=" "-...-" } { "+" ".-.-." } { "-" "-....-" } { "_" "..--.-" }
    { "\"" ".-..-." } { "$" "...-..-" } { "@" ".--.-." } } ;

: _table ( -- record )
  _pairs >record ;

: _flip ( pair:list -- list )
  pair 1 nth { } swap append pair 0 nth append ;

: _decode-table ( -- record )
  _pairs [ _flip ] map >record ;

: _lookup ( table:record key:str -- str )
  [ table key get ] [ drop "no Morse code for this character" raise:coerce ] try ;

\ Not classical:_atbash-code: this folds a lower-case letter to upper case, that reflects a letter within its case.
: _upper-cp ( cp:int -- int )
  cp 97 122 util:between? [ cp 32 - ] [ cp ] if ;

: _letter-code ( cp:int table:record -- str )
  table cp _upper-cp util:cp>str _lookup ;

: _word-code ( word:str table:record -- str )
  word str>codes [ table _letter-code ] map " " join ;

: _sep-of ( w:str -- str )
  w "newline" = [ "\n" ] [ " / " ] if ;

: _encode-words ( words:list table:record sep:str -- str )
  words [ table _word-code ] map sep join ;

: _ws-to-space ( s:str -- str )
  s str>codes [ dup util:space? [ drop 32 ] when ] map codes>str ;

: _breaks ( s:str -- str )
  s "\n" split " / " join "\r" split " / " join "/" split " / " join ;

: _decode-token ( t:str table:record -- str )
  t "/" = t len 0 = or [ " " ] [ table t _lookup ] if ;

: _decode-tokens ( tokens:list table:record -- str )
  tokens [ table _decode-token ] map "" join ;

: encode ( str word-separator:choice{slash|newline}=slash -- str )
  "Letters separated by one space, words by \" / \" (or a newline). Case-insensitive. Input white space separates words; a character with no Morse code is E_COERCE." doc
  "Encodings" category
  _ws-to-space " " split [ len 0 > ] filter _table word-separator _sep-of _encode-words ;

: decode ( str -- str )
  "Decode Morse to upper-case text. Words are separated by /, a newline or a run of spaces; letters by one space. Unknown code is E_COERCE." doc
  "Encodings" category
  _breaks " " split _decode-table _decode-tokens " " split [ len 0 > ] filter " " join ;

META: encode
  param word-separator "What to put between words: \" / \" or a newline." ;
;
