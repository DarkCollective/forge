\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ clean: remove noise from text and bytes (white space, null bytes, ANSI escape sequences). Written in FL over the
\ core string words, util:drop-byte and regex:replace; no primitive.
IN: clean

USING: util ;

\ s without the character c when on is true.
: _drop-char ( s:str c:str on:bool -- str )
  on [ s c split "" join ] [ s ] if ;

: remove-whitespace ( data:str spaces:bool=true carriage-returns:bool=true line-feeds:bool=true tabs:bool=true form-feeds:bool=true full-stops:bool=false -- str )
  "Delete the chosen white space characters from the text: spaces, carriage returns, line feeds, tabs, form feeds and, off by default, full stops (the same six options and defaults as CyberChef's Remove whitespace). Only those exact characters go; other Unicode spaces such as the no-break space stay. Use the white space words of the text vocabularies for anything finer." doc
  "Text" category
  data " " spaces _drop-char
  "\r" carriage-returns _drop-char
  "\n" line-feeds _drop-char
  "\t" tabs _drop-char
  "\x0c" form-feeds _drop-char
  "." full-stops _drop-char ;

: remove-null-bytes ( data:bytes -- bytes )
  "Delete every zero byte (0x00) from the data; every other byte stays in order. A few interpreter steps for any length." doc
  "Text" category
  data 0 util:drop-byte ;

: remove-ansi ( data:str -- str )
  "Delete ANSI escape sequences (ECMA-48 and the common terminal extensions): CSI sequences (ESC [ or the single code point U+009B, then parameter bytes 0x30-0x3F, intermediate bytes 0x20-0x2F and a final byte 0x40-0x7E, which covers the colour and cursor codes), string sequences (OSC, DCS, SOS, PM and APC, ended by BEL or ESC \\) and the other two-byte ESC sequences. Ordinary text, including a lone ESC at the very end, is kept." doc
  "Text" category
  data
  "(?:\\x1b\\[|\\x9b)[0-?]*[ -/]*[@-~]|\\x1b[\\]PX^_][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[ -/]*[0-~]"
  "" "" regex:replace ;

META: remove-whitespace
  param spaces "Delete spaces (U+0020)." ;
  param carriage-returns "Delete carriage returns (U+000D)." ;
  param line-feeds "Delete line feeds (U+000A)." ;
  param tabs "Delete tabs (U+0009)." ;
  param form-feeds "Delete form feeds (U+000C)." ;
  param full-stops "Delete full stops (U+002E)." ;
  see-also util:strip-space ;
;

META: remove-null-bytes
  see-also clean:remove-whitespace ;
;

META: remove-ansi
  see-also clean:remove-null-bytes ;
;
