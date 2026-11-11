\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ recipe: the words that compiled recipes call. Internal: never listed in the catalogue.
\ Container steps work on bytes; every word here that takes data takes bytes, so a str is
\ UTF-8 encoded at the boundary.
IN: recipe

: as-bytes ( bytes -- bytes )
  "Normalise the data to bytes. A str becomes its UTF-8 bytes; other types are a type error." doc ;

: latin1 ( str -- bytes )
  "Literal helper: a string whose code points are byte values 0 to 255." doc
  latin1>bytes ;

: base64 ( str -- bytes )
  "Literal helper: a string in standard base64." doc
  str>bytes "standard" base64:decode ;

: matches ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" -- bool )
  "True when the pattern matches somewhere in the data, which is read as utf8 or latin1." doc
  encoding "latin1" = [ bytes>latin1 ] [ bytes>str ] if
  pattern flags regex:test ;

: section ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" body:quot -- bytes )
  "Run body on every non-empty match; the bytes between matches are untouched." doc
  pattern flags encoding _split-matches
  [ 2 mod 1 = [ body call as-bytes ] when ] mapi
  #[ ] bjoin ;

: branch ( bytes test:quot then:quot else:quot -- any )
  "Run test on a copy of the data; then run then or else on the data." doc
  dup test call [ then call ] [ else call ] if ;

: repeat ( bytes n:int[1..1000] body:quot -- bytes )
  "Run body n times, feeding each result to the next." doc
  n [ body call as-bytes ] times ;

: settle ( bytes cap:int[1..1000] body:quot -- bytes )
  "Run body until its result equals its input, at most cap times." doc
  dup body call as-bytes
  dup2 = cap 1 = or
  [ nip ] [ nip cap 1 - body recurse ] if ;
