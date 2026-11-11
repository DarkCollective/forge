\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ search: counting, fuzzy matching and comparing samples. Written in FL over split, regex:find-all and
\ list:sort-by; no primitive.
IN: search

USING: util list ;

\ ---- count ----

: count ( data:str pattern:str[1..] mode:choice{string|regex}="string" ignore-case:bool=false -- int )
  "How many times the pattern occurs in the text. Mode string looks for the exact text, counting non-overlapping occurrences from the left (aa in aaaa is 2); mode regex takes an ECMAScript regular expression (the u flag) and counts its matches, empty ones included. With ignore-case, upper and lower case match each other (string mode folds both texts to lower case first). The pattern may not be empty." doc
  "Analysis" category
  mode "regex" =
  [ data pattern ignore-case [ "i" ] [ "" ] if regex:find-all len ]
  [ ignore-case [ data lower pattern lower ] [ data pattern ] if split len 1 - ]
  if ;

\ ---- fuzzy match ----

\ One character as it is compared: itself, or lower case when the one-code-point lower case form exists.
: _fold ( ch:str cs:bool -- str )
  cs [ ch ] [ ch lower dup len 1 = [ ] [ drop ch ] if ] if ;

\ The index of the first c in fs at or after from, or -1.
: _find-next ( fs:str from:int c:str -- int )
  fs from fs len slice c split dup len 1 =
  [ drop -1 ]
  [ 0 nth len from + ]
  if ;

: _failed? ( acc:list -- bool )
  acc len 0 > [ acc acc len 1 - nth 0 < ] [ false ] if ;

: _from ( acc:list -- int )
  acc len 0 = [ 0 ] [ acc acc len 1 - nth 1 + ] if ;

\ Add the next matched position to acc (greedy, leftmost); -1 when there is none, and then nothing more is added.
: _step ( acc:list fs:str c:str -- list )
  acc _failed?
  [ acc ]
  [ acc fs acc _from c _find-next append ]
  if ;

: _sep-code? ( c:int -- bool )
  c 128 < c util:letter? not and c util:dec-digit? not and ;

\ True at the start of the text and after an ASCII character that is not a letter or a digit.
: _boundary? ( p:int orig:list -- bool )
  p 0 = [ true ] [ orig p 1 - nth str>codes 0 nth _sep-code? ] if ;

\ The points of the i-th matched position: 1, 4 more if it follows the previous one, 6 more at a word start.
: _term ( ps:list i:int orig:list -- int )
  1
  i 0 > [ ps i nth ps i 1 - nth 1 + = ] [ false ] if [ 4 + ] when
  ps i nth orig _boundary? [ 6 + ] when ;

: _score ( ps:list orig:list -- int )
  0 ps len range [ ps swap orig _term ] map util:sum
  ps ps len 1 - nth ps 0 nth - 1 + ps len - - ;

: _csv ( ps:list -- str )
  ps [ int>str ] map "," join ;

\ The matched positions of the folded query q in the folded line fs (the greedy leftmost match).
: _positions ( fs:str q:list -- list )
  q { } [ fs swap _step ] reduce ;

\ { -score row }, the row being score, space, the matched positions, space, the line.
: _make ( ps:list orig:list s:int -- list )
  { s neg
    s int>str " " cat ps _csv cat " " cat orig "" join cat } ;

\ { } for a line that does not hold the query as a subsequence, else { -score row }.
: _scored-fs ( orig:list fs:str q:list -- list )
  fs q _positions dup _failed?
  [ drop { } ]
  [ dup orig _score orig swap _make ]
  if ;

: _scored ( line:str q:list cs:bool -- list )
  line str>codes [ util:cp>str ] map
  dup [ cs _fold ] map "" join q _scored-fs ;

: _fuzzy-rows ( lines:list q:list cs:bool -- list )
  lines [ q cs _scored ] map [ len 0 > ] filter ;

: _arrange ( scored:list best:bool -- list )
  best
  [ scored [ 1 nth ] map scored [ 0 nth ] map list:sort-by ]
  [ scored [ 1 nth ] map ]
  if ;

: fuzzy ( data:str query:str[1..] case-sensitive:bool=false best-first:bool=true delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Fuzzy search: keep the lines (the pieces of the text between delimiters) that contain all the characters of the query in order, not necessarily next to each other, and score them. Each line is matched greedily from the left: every query character takes the first occurrence after the previous one. The score adds 1 for each matched character, 4 more when it directly follows the previous matched one, 6 more at the start of the line or after an ASCII character that is not a letter or a digit (a word start), and takes off the number of unmatched characters between the first and the last match. Case is ignored unless case-sensitive is set. A line becomes one row of three columns separated by single spaces: the score, the matched positions (code point offsets, from 0, joined by commas; neither holds a space) and the line, which is the rest of the row. Best-first (the default) orders rows by falling score, equal scores in input order; otherwise rows keep the input order. Lines that do not match are left out. A redesign of CyberChef's Fuzzy Match, which highlights the text in HTML." doc
  "Analysis" category
  data delimiter util:delimiter split
  query str>codes [ util:cp>str case-sensitive _fold ] map
  case-sensitive _fuzzy-rows best-first _arrange
  delimiter util:delimiter join ;

\ ---- offsets ----

: _escape-run ( s:str -- str )
  s "\\" split "\\\\" join "\n" split "\\n" join "\r" split "\\r" join "\t" split "\\t" join ;

: _eq-flags ( a:list b:list -- list )
  a b zip [ dup 0 nth swap 1 nth = ] map ;

: _both ( a:list b:list -- list )
  a b zip [ dup 0 nth swap 1 nth and ] map ;

: _fold-and ( fl:list -- list )
  fl 1 fl len slice fl 0 nth [ _both ] reduce ;

\ Per position, whether every sample has the same code point as the first one (up to the shortest sample).
: _all-equal ( codes:list -- list )
  codes 1 codes len slice [ codes 0 nth swap _eq-flags ] map _fold-and ;

: _row ( r:record s0:str -- str )
  r "start" get int>str " " cat
  r "end" get r "start" get - int>str cat " " cat
  s0 r "start" get r "end" get slice _escape-run cat ;

: _run-rows ( s0:str runs:list min-run:int -- str )
  runs [ dup "end" get swap "start" get - min-run >= ] filter
  [ s0 _row ] map "\n" join ;

: offsets ( data:str delimiter:str[1..]="\n\n" min-run:int[1..]=1 -- str )
  "Compare two or more samples (the input cut at the delimiter, a blank line by default) and list where they agree: the stretches of consecutive offsets at which every sample has the same character (code point). Only offsets that every sample has are looked at, so nothing is reported beyond the shortest sample. Each stretch is one line of three columns separated by single spaces: the offset of its first character (from 0), its length in characters, and the shared text (the rest of the line), with the backslash, line feed, carriage return and tab written as \\\\ \\n \\r \\t. min-run drops the stretches shorter than that. No stretch gives empty output; fewer than two samples is E_COERCE. A redesign of CyberChef's Offset checker, which highlights the common characters in the output." doc
  "Analysis" category
  data delimiter split
  dup len 2 < [ "at least two samples are needed" raise:coerce ] when
  dup 0 nth swap [ str>codes ] map _all-equal
  [ [ "1" ] [ "0" ] if ] map "" join "1+" "" regex:find-all
  min-run _run-rows ;

META: count
  param pattern "The text to count, or a regular expression in regex mode." ;
  param mode "string counts exact text, regex counts matches of an ECMAScript regular expression." ;
  param ignore-case "Treat upper and lower case as the same." ;
  see-also regex:find-all text:split ;
;

META: fuzzy
  param query "The characters to look for, in order." ;
  param case-sensitive "Match upper and lower case as different characters." ;
  param best-first "Order the rows by falling score instead of keeping the input order." ;
  param delimiter "What separates the lines of the input, and the rows of the output." ;
  see-also search:count ;
;

META: offsets
  param delimiter "What separates the samples. It is text, not a pattern; the default is a blank line (two line feeds)." ;
  param min-run "The shortest stretch to report, in characters." ;
  see-also distance:hamming ;
;
