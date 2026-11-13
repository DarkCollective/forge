\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ case: letter case of text, and case-insensitive regular expressions. Written in FL over the core upper and lower
\ words and regex:find-all (the regex tokenizer finds the pieces of a pattern); no primitive. Case follows the
\ Unicode default case mapping of the host (String.prototype.toUpperCase and toLowerCase) one character at a time.
IN: case

USING: util ;

\ ---- swap case and alternating caps ----

\ The other case of one character: upper case becomes lower, anything else becomes upper.
: _swap-ch ( ch:str -- str )
  ch upper ch = [ ch lower ] [ ch upper ] if ;

: swap-case ( data:str -- str )
  "Swap the case of every letter: upper case becomes lower case and lower case becomes upper case. Characters without case stay as they are. The case of each character is mapped alone, so the German sharp s (which has no single upper case letter) becomes SS." doc
  "Text" category
  data str>codes [ util:cp>str _swap-ch ] map "" join ;

0 VARIABLE _k

\ A letter alternates; anything without case is kept and does not count.
: _alt-ch ( ch:str first-upper:bool -- str )
  ch upper ch lower =
  [ ch ]
  [ _k 1 band 0 = first-upper = [ ch upper ] [ ch lower ] if
    _k 1 + _k! ] if ;

: alternating ( data:str first:choice{lower|upper}="lower" -- str )
  "Alternate the case of the letters: the first letter is lower case (or upper case with first set to upper), the next the other case, and so on. Characters without case are kept and do not count, so the alternation carries on across them and Hello, World! becomes hElLo, WoRlD! (the W is the sixth letter, so it is upper case). CyberChef's Alternating Caps starts with a lower case letter too." doc
  "Text" category
  0 _k!
  data str>codes [ util:cp>str first "upper" = _alt-ch ] map "" join ;

\ ---- all casings ----

\ The tokens of a text for all-casings: one cased letter, or a run of anything else.
: _casing-tokens ( s:str -- list )
  s "\\p{Lu}|\\p{Ll}|\\p{Lt}|[^\\p{Lu}\\p{Ll}\\p{Lt}]+" "" util:match-texts ;

: _cased? ( tok:str -- bool )
  tok len 1 = tok upper tok lower <> and ;

: _grow ( vars:list tok:str -- list )
  tok _cased?
  [ vars [ tok lower cat ] map vars [ tok upper cat ] map cat ]
  [ vars [ tok cat ] map ]
  if ;

: all-casings ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Every combination of upper and lower case of the letters in the text, one per line (or joined by the delimiter), as CyberChef's Get All Casings does. Letters with a different upper and lower case form get both; everything else is kept. The first combination is all lower case, and the first letter varies fastest (the second combination has the first letter in upper case). At most 12 such letters (4,096 combinations): more is E_RANGE. Unlike CyberChef, which counts every character, the number of combinations is two to the power of the letters only." doc
  "Text" category
  data _casing-tokens
  dup [ _cased? ] filter len 12 >
  [ "at most 12 letters with a case can be combined (4096 combinations)" raise:range ] when
  { "" } [ _grow ] reduce
  delimiter util:delimiter join ;

\ ---- case-insensitive regular expressions ----
\ A pattern is cut into pieces with regex:find-all: an escape, a named group, a quoted character class, or one character.
\ Only plain characters and the insides of classes change; everything else is copied.

\ The one-code-point string of the other case of ch, or "" when it has none (or the other case is longer).
: _other ( ch:str -- str )
  ch upper ch <> ch upper len 1 = and
  [ ch upper ]
  [ ch lower ch <> ch lower len 1 = and [ ch lower ] [ "" ] if ]
  if ;

: _join-range ( a:str b:str -- str )
  a "" = b "" = or [ "" ] [ a "-" cat b cat ] if ;

\ The range lo-hi of ASCII letters of one case has the other-case range; any other range has none.
: _letter-range-other ( lo:str hi:str -- str )
  lo util:letters? hi util:letters? and lo upper lo = hi upper hi = = and
  [ lo _other hi _other _join-range ]
  [ "" ] if ;

\ The extra text a class token needs: the other case of a letter, or of a range of ASCII letters; else "".
: _other-tok ( t:str -- str )
  t len 1 =
  [ t _other ]
  [ t len 3 = [ t 1 2 slice "-" = ] [ false ] if
    [ t 0 1 slice t 2 3 slice _letter-range-other ] [ "" ] if ]
  if ;

: _add-new ( acc:list x:str -- list )
  x "" = [ acc ] [ acc x util:contains? [ acc ] [ acc x append ] if ] if ;

: _pieces ( pattern:str -- list )
  pattern
  "\\\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\\{[0-9A-Fa-f]+\\}|[pP]\\{[^}]*\\}|k<[^>]*>|c[A-Za-z]|[\\s\\S])|\\(\\?<[A-Za-z_$][^>]*>|\\[(?:\\\\[\\s\\S]|[^\\]\\\\])*\\]|[\\s\\S]"
  "" util:match-texts ;

\ The pieces of the inside of a class: an escape, a range of two characters, or a character.
: _class-tokens ( body:str -- list )
  body
  "(?:\\\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\\{[0-9A-Fa-f]+\\}|[pP]\\{[^}]*\\}|c[A-Za-z]|[\\s\\S])|[^\\\\])-(?:\\\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\\{[0-9A-Fa-f]+\\}|[pP]\\{[^}]*\\}|c[A-Za-z]|[\\s\\S])|[^\\\\])|\\\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\\{[0-9A-Fa-f]+\\}|[pP]\\{[^}]*\\}|c[A-Za-z]|[\\s\\S])|[^\\\\]"
  "" util:match-texts ;

: _neg? ( cls:str -- bool )
  cls len 2 > [ cls 1 2 slice "^" = ] [ false ] if ;

\ The inside of a class "[...]" or "[^...]".
\ Kept private: it only resembles hexdump:_uncolon (see the ops README, Justified exceptions).
: _body ( cls:str -- str )
  cls cls _neg? [ 2 ] [ 1 ] if cls len 1 - slice ;

: _wrap ( body:str neg:bool -- str )
  neg [ "[^" ] [ "[" ] if body cat "]" cat ;

: _class-to ( cls:str -- str )
  cls _body _class-tokens
  dup [ _other-tok ] map swap [ _add-new ] reduce
  "" join cls _neg? _wrap ;

: _piece-to ( p:str -- str )
  p len 1 =
  [ p _other dup "" = [ drop p ]
    [ p upper p = p lower p <> and
      [ "[" swap cat p cat "]" cat ]
      [ "[" p cat swap cat "]" cat ] if ] if ]
  [ p 0 1 slice "[" = [ p _class-to ] [ p ] if ]
  if ;

: to-insensitive-regex ( pattern:str -- str )
  "Rewrite a regular expression (ECMAScript syntax) so that it matches without regard to case, whatever flags it runs with: every letter outside a class becomes a class of both its cases, the lower case first as in CyberChef (h and H both become [hH]), and in a character class the other case of each letter or range of ASCII letters is added, so [a-f] becomes [a-fA-F]. Escapes (\\d, \\x41, \\u00e9, \\p{Lu}, \\k<name>), group names and quantifiers are copied unchanged. Letters whose other case is not one code point (the German sharp s) are left as they are. The output is the pattern text only, no slashes." doc
  "Text" category
  pattern _pieces [ _piece-to ] map "" join ;

\ Keep a class token unless the other case of it is already kept.
: _keep ( acc:list x:str -- list )
  x _other-tok dup "" =
  [ drop acc x append ]
  [ acc swap util:contains? [ acc ] [ acc x append ] if ]
  if ;

\ A class that is left with one plain letter and is not negated needs no brackets.
: _bare? ( kept:list neg:bool -- bool )
  kept len 1 = neg not and
  [ kept 0 nth dup len 1 = swap _other "" <> and ]
  [ false ] if ;

: _class-from ( cls:str -- str )
  cls _body _class-tokens { } [ _keep ] reduce
  dup cls _neg? _bare?
  [ 0 nth ]
  [ "" join cls _neg? _wrap ]
  if ;

: _piece-from ( p:str -- str )
  p len 1 > [ p 0 1 slice "[" = ] [ false ] if
  [ p _class-from ] [ p ] if ;

: from-insensitive-regex ( pattern:str -- str )
  "The reverse of to-insensitive-regex: a character class that holds both cases of a letter ([xX]) is written with the first one (x), and in a bigger class the second case of a letter or range is dropped when its first case is already there ([a-zA-Z0-9] becomes [a-z0-9]). Everything else is copied, so a pattern that never used the other case is unchanged. to-insensitive-regex followed by this gives the original pattern back when the original had no class with both cases of one letter." doc
  "Text" category
  pattern _pieces [ _piece-from ] map "" join ;

META: swap-case
  use-when "You have text with the case the wrong way round, such as a caps-lock mistake, and want each letter's case swapped." ;
  link "https://en.wikipedia.org/wiki/Letter_case" "Letter case on Wikipedia" ;
  see-also case:alternating text:upper text:lower ;
;

META: alternating
  use-when "You want text in alternating upper and lower case, as in a mocking meme, and have plain text to change." ;
  link "https://en.wikipedia.org/wiki/Letter_case" "Letter case on Wikipedia" ;
  param first "Whether the first letter is lower case (the default) or upper case." ;
  see-also case:swap-case ;
;

META: all-casings
  use-when "You have a word and want every upper and lower case version of it, for example to list the case variants of a password guess." ;
  param delimiter "What is written between the combinations: a line feed by default." ;
  see-also case:swap-case ;
;

META: to-insensitive-regex
  use-when "You have a regular expression and want it to match the text whatever its case, for example in a search box that ignores case." ;
  inverse from-insensitive-regex ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  see-also case:from-insensitive-regex regex:test ;
;

META: from-insensitive-regex
  use-when "You have a regular expression that spells out both cases in brackets, such as [aA], and want the short form that you would write by hand." ;
  inverse to-insensitive-regex ;
  link "https://en.wikipedia.org/wiki/Regular_expression" "Regular expression on Wikipedia" ;
  see-also case:to-insensitive-regex ;
;
