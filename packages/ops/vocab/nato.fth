\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ nato: the ICAO spelling alphabet (ICAO Annex 10, Volume II, section 5.2.1.3; also ITU-R M.1172 and NATO's), in both
\ directions. Letters are spelled Alfa, Bravo, Charlie, ... Zulu (with the ICAO spellings Alfa and Juliett); digits
\ either as plain English words or in the ICAO radiotelephony pronunciation (Wun, Too, Tree, Fower, Fife, Six, Seven,
\ Ait, Niner). Written in FL.
IN: nato

: _letters ( -- list )
  { "Alfa" "Bravo" "Charlie" "Delta" "Echo" "Foxtrot" "Golf" "Hotel" "India" "Juliett" "Kilo" "Lima" "Mike"
    "November" "Oscar" "Papa" "Quebec" "Romeo" "Sierra" "Tango" "Uniform" "Victor" "Whiskey" "X-ray" "Yankee" "Zulu" } ;

: _plain-digits ( -- list )
  { "Zero" "One" "Two" "Three" "Four" "Five" "Six" "Seven" "Eight" "Nine" } ;

: _icao-digits ( -- list )
  { "Zero" "Wun" "Too" "Tree" "Fower" "Fife" "Six" "Seven" "Ait" "Niner" } ;

\ The token for a character: the word of a letter or digit, "/" for a space, the character itself otherwise.
: _token ( c:int digits:str -- str )
  c 65 90 util:between? c 97 122 util:between? or
  [ _letters c 32 bor 97 - nth ]
  [ c util:dec-digit?
    [ digits "icao" = [ _icao-digits ] [ _plain-digits ] if c 48 - nth ]
    [ c 32 = [ "/" ] [ c util:cp>str ] if ] if ] if ;

: encode ( str digits:choice{plain|icao}="plain" delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="space" -- str )
  "Spell text with the ICAO spelling alphabet (the NATO phonetic alphabet): each letter (either case) becomes its word (Alfa, Bravo, Charlie, ... Zulu) and each digit its word, plain (Zero, One, Two, Three, Four, Five, Six, Seven, Eight, Nine) or as ICAO pronounces them (Zero, Wun, Too, Tree, Fower, Fife, Six, Seven, Ait, Niner). A space becomes a slash, so words stay apart; every other character is kept as it is. The words are joined by the delimiter (one of the wave 5 delimiters except none, so that decode can split them again)." doc
  "Language" category
  str>codes [ digits _token ] map delimiter util:delimiter join ;

META: encode
  use-when "You need to spell out a code, a serial number or a call sign over a bad phone line, and want each letter or digit given its NATO word." ;
  inverse decode ;
  link "https://en.wikipedia.org/wiki/NATO_phonetic_alphabet" "NATO phonetic alphabet on Wikipedia" ;
  param digits "plain: Zero, One, Two ... Nine. icao: Zero, Wun, Too, Tree, Fower, Fife, Six, Seven, Ait, Niner." ;
  param delimiter "The text between the words." ;
  see-also nato:decode morse:encode ;
;

\ { word character } pairs of every word that decode knows: letters, both digit spellings and the usual variants.
: _pairs ( -- list )
  _letters [ lower ] map "ABCDEFGHIJKLMNOPQRSTUVWXYZ" str>codes [ util:cp>str ] map zip
  _plain-digits [ lower ] map "0123456789" str>codes [ util:cp>str ] map zip cat
  _icao-digits [ lower ] map "0123456789" str>codes [ util:cp>str ] map zip cat
  { { "alpha" "A" } { "juliet" "J" } { "xray" "X" } { "whisky" "W" } { "/" " " } } cat ;

\ The character of a token (the word in either case, without the white space around it), or the token itself when it
\ is no word.
: _char ( t:str table:record -- str )
  [ table t [ util:space? ] util:trim-start [ util:space? ] util:trim-end lower get ] [ drop t ] try ;

: _chars ( tokens:list table:record -- str )
  tokens [ table _char ] map "" join ;

: decode ( str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="space" -- str )
  "Read text spelled with the ICAO spelling alphabet back: the input is split at the delimiter, and each word (in any case, with spaces around it ignored) becomes its character, a letter in upper case or a digit. Both digit spellings are understood, and so are the variants Alpha, Juliet, Xray, Whisky and Nine. A slash becomes a space. A token that is not a word is kept as it is, and empty tokens are dropped, so decode reads encode's output back except for the case of letters (and a slash or a delimiter that was in the text)." doc
  "Language" category
  delimiter util:delimiter split [ len 0 > ] filter _pairs >record _chars ;

META: decode
  use-when "You have text spelled with NATO words such as Alfa and Bravo, and want the letters and digits they stand for." ;
  inverse encode ;
  link "https://en.wikipedia.org/wiki/NATO_phonetic_alphabet" "NATO phonetic alphabet on Wikipedia" ;
;
