\ regex: regular expressions (ECMAScript, always with the u flag). The words are TypeScript
\ primitives (src/prims/regex.ts); this unit only adds the parameter help.
IN: regex

META: test
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: find-all
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: replace
  param pattern "The regular expression." ;
  param replacement "Replacement text. $1 to $99, $<name>, $& and $$ are special, as in ECMAScript." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: split
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;
