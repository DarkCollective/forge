\ braille: bytes as 8-dot Unicode Braille patterns (Forge's own design, not CyberChef's table). Byte b
\ is the code point U+2800 + b (Unicode block "Braille Patterns", U+2800 to U+28FF), so the mapping
\ is lossless for every byte value. The words are FL and need no primitive; E_COERCE comes from the
\ raise vocabulary (raise:coerce).
IN: braille

: encode ( bytes -- str )
  "Write each byte as the 8-dot Braille pattern U+2800 plus the byte. Lossless: byte 0 is the blank pattern U+2800." doc
  "Encodings" category
  bytes>list [ 10240 + ] map codes>str ;

: _outside? ( cp:int -- bool )
  cp 10240 < cp 10495 > or ;

: decode ( str -- bytes )
  "Read Braille patterns U+2800 to U+28FF as bytes (code point minus U+2800). ASCII white space between patterns is ignored; any other character is E_COERCE." doc
  "Encodings" category
  str>codes [ util:space? not ] filter
  dup [ _outside? ] filter len 0 >
  [ "not a Braille pattern (U+2800 to U+28FF)" raise:coerce ] when
  [ 10240 - ] map list>bytes ;
