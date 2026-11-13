\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ diacritics: remove accents and other diacritical marks from text. The text is decomposed (NFD, by the unicode
\ vocabulary's normalize word), the combining marks are dropped, and it is composed again (NFC), so the other characters
\ keep their form. A few letters have a stroke instead of a mark and do not decompose (o with a stroke, d with a
\ stroke, l with a stroke, and so on); an option replaces those by their base letter. Written in FL.
IN: diacritics

\ True for a combining mark of the blocks that hold diacritics: Combining Diacritical Marks (U+0300 to U+036F),
\ Extended (U+1AB0 to U+1AFF), Supplement (U+1DC0 to U+1DFF), for Symbols (U+20D0 to U+20FF) and Half Marks (U+FE20
\ to U+FE2F).
: _mark? ( c:int -- bool )
  c 768 879 util:between? c 6832 6911 util:between? or c 7616 7679 util:between? or
  c 8400 8447 util:between? or c 65056 65071 util:between? or ;

\ { letter base } pairs of the letters with a stroke that do not decompose; names are those of the Unicode database.
: _strokes ( -- list )
  { { "\u{D8}" "O" } { "\u{F8}" "o" }       \ LATIN CAPITAL/SMALL LETTER O WITH STROKE
    { "\u{110}" "D" } { "\u{111}" "d" }     \ LATIN CAPITAL/SMALL LETTER D WITH STROKE
    { "\u{D0}" "D" } { "\u{F0}" "d" }       \ LATIN CAPITAL/SMALL LETTER ETH
    { "\u{141}" "L" } { "\u{142}" "l" }     \ LATIN CAPITAL/SMALL LETTER L WITH STROKE
    { "\u{126}" "H" } { "\u{127}" "h" }     \ LATIN CAPITAL/SMALL LETTER H WITH STROKE
    { "\u{166}" "T" } { "\u{167}" "t" }     \ LATIN CAPITAL/SMALL LETTER T WITH STROKE
    { "\u{131}" "i" } } ;                   \ LATIN SMALL LETTER DOTLESS I

: _replace ( acc:str pair:list -- str )
  acc pair 0 nth pair 1 nth true text:replace ;

: remove ( str strokes:bool=false -- str )
  "Remove diacritical marks (accents, cedillas, tildes, umlauts, combining marks of any kind in the blocks of the Unicode standard that hold them) from text: the text is decomposed, the marks are dropped and the rest is composed again, so \"Crème Brûlée\" becomes \"Creme Brulee\" and a letter that was written with a separate combining mark loses it too. With strokes true (off by default: CyberChef leaves these letters alone) the letters with a stroke that cannot be decomposed are also turned into their base letter: O with stroke, D with stroke, eth, L with stroke, H with stroke, T with stroke and dotless i. Other letters (ss, ae, oe, thorn) are not changed." doc
  "Language" category
  "nfd" unicode:normalize str>codes [ _mark? not ] filter codes>str "nfc" unicode:normalize
  strokes [ _strokes swap [ _replace ] reduce ] when ;

META: remove
  use-when "You have names or words with accents, such as Crème Brûlée, and want plain letters for a search or a comparison, without the marks." ;
  link "https://en.wikipedia.org/wiki/Diacritic" "Diacritic on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/Combining_character" "Combining character on Wikipedia" ;
  param strokes "Also turn the letters with a stroke (o with stroke, d with stroke, l with stroke and so on) into plain letters." ;
  see-also unicode:normalize ;
;
