\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ unicode-format: text decorated with combining characters, so that it looks underlined or struck through in plain text
\ (chat boxes, bios) that has no styling. Written in FL.
IN: unicode-format

\ The combining characters to put after each character: U+0332 COMBINING LOW LINE, U+0336 COMBINING LONG STROKE OVERLAY.
: _marks ( underline:bool strike:bool -- str )
  strike [ "\u{336}" ] [ "" ] if underline [ "\u{332}" ] [ "" ] if cat ;

\ Every character except a line break is followed by the marks.
: _decorate ( s:str marks:str -- str )
  s str>codes [ dup 10 = over 13 = or [ util:cp>str ] [ util:cp>str marks cat ] if ] map "" join ;

: decorate ( str underline:bool=false strikethrough:bool=false -- str )
  "Put combining characters after each character of the text so that it looks underlined (U+0332 COMBINING LOW LINE) and or struck through (U+0336 COMBINING LONG STROKE OVERLAY) wherever Unicode text is shown. Line feeds and carriage returns are left alone. Both options false (the default, as in CyberChef) leaves the text unchanged; with both on the strikethrough mark goes first, then the underline. The marks go after every code point, also after one that is itself a combining mark." doc
  "Language" category
  underline strikethrough _marks _decorate ;

META: decorate
  param underline "Underline: put U+0332 after each character." ;
  param strikethrough "Strikethrough: put U+0336 after each character." ;
;
