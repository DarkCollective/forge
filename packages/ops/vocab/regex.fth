\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ regex: regular expressions (ECMAScript, always with the u flag). The words are TypeScript
\ primitives (src/prims/regex.ts); this unit only adds the parameter help.
IN: regex

META: test
  use-when "You have a text and a regular expression, and want to know only whether the pattern matches anywhere in the text." ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: find-all
  use-when "You have a text and a regular expression, and want each match with its position and its capture groups, for example every number in a log line." ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: replace
  use-when "You have a text and a regular expression, and want each match replaced, with captured parts copied into the replacement, such as swapping two words." ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  param pattern "The regular expression." ;
  param replacement "Replacement text. $1 to $99, $<name>, $& and $$ are special, as in ECMAScript." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;

META: split
  use-when "You have a text and a regular expression as separator, such as runs of digits or a comma, and want the pieces between the separators." ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  param pattern "The regular expression." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
;
