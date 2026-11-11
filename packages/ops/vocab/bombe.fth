\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bombe: a Turing-Welchman Bombe for the Enigma I and M3. Given a ciphertext and a crib (a guess of
\ the plaintext at a known place) it searches the 17,576 start positions of each rotor order for
\ "stops": positions at which the plugboard that the crib implies is consistent. One word, bombe:search.
\ Written for Forge from the published descriptions of the machine (Wikipedia, "Bombe"; Crypto Museum,
\ "Bombe", cryptomuseum.com); no code, table, test or description of any other tool was used. The
\ rotor and reflector wirings are the historical Enigma ones, read from vocab/enigma.fth
\ (enigma:rotor-wirings, rotor-turnovers, rotor-reflectors); everything else is written here.
\
\ The model of the Enigma is the one of enigma.fth: the machine steps before every letter (with the
\ double step of the middle rotor), the signal goes through the plugboard, the rotors, the reflector
\ and back, and a letter never encrypts to itself. A rotor with ring setting r and window letter p
\ acts with the shift p - r. Positions are the window letters at the START OF THE MESSAGE (before the
\ first key press), left to right, as enigma:encrypt takes them, so a stop can be tried at once.
\ Only the M3 and Enigma I are supported (three moving rotors): the M4 has a fourth rotor that does
\ not move but whose setting is a further unknown of 26 values, which this search does not try.
\
\ The menu. The crib letter j (0 first) is at ciphertext letter offset + j. With Pl the plugboard and
\ E_j the machine in the state of that key press (without the plugboard), plain letter p and cipher
\ letter c obey Pl(c) = E_j(Pl(p)): an edge of a graph whose nodes are letters. The edges are
\ grouped in connected components, and the search uses the component with the most edges (as the
\ real Bombe used the largest connected piece of the menu). Its closures, edges - letters + 1, are
\ the independent loops; a menu with no closure cannot rule out much and gives a stop at nearly
\ every position, so such a crib needs a bigger limit or a longer crib. The test letter is the letter
\ of that component with the most edges (the lowest letter on a tie).
\
\ The search (the primitive bombe:_search, src/prims/bombe.ts). A wire (u, a) is the hypothesis
\ Pl(u) = a. Each edge joins (p, a) with (c, E_j(a)) for all a; the diagonal board joins (u, a) with
\ (a, u). For each start position, and each hypothesis h for the test letter, the wires reached
\ from (T, h) are the lit ones; it is a stop when exactly one wire of T's bundle (the "test
\ register") is lit, because a false hypothesis lights all 26 of them. The lit wires are the steckers
\ deduced; a letter with two lit wires is a contradiction (it can only be a letter outside the menu
\ that two menu letters both claim). Rotor stepping is exact: the rotors move across the whole
\ ciphertext as in the machine, double step included, so the middle rotor stepping within the crib is
\ no problem here (the real Bombe assumed it did not).
\
\ The check step (check = on) keeps a stop only when it has no contradiction and the ciphertext,
\ deciphered by enigma:encrypt with the position and the steckers deduced, gives the crib again at
\ every crib letter of the menu component (the primitive already leaves out the stops with a
\ contradiction when the check is on, so they do not use up the limit). Letters outside the menu
\ component are shown in lower case in the preview, as their steckers are not deduced; the preview of
\ a stop with a contradiction (check off) may be wrong even in upper case. The ring settings are a parameter (default AAA, as
\ the real Bombe assumed); the stops then give the window letters for those rings.
\
\ Where the work is done. The primitive does the loop over positions. Here, in FL: the parameters,
\ the menu (letter sets as bit masks), the rotor tables (built once per rotor, not once per rotor
\ order) and the text. A rotor set of more than three rotors is searched in every order of three of
\ them, left to right.
IN: bombe

"" VARIABLE _model
"" VARIABLE _reflector
"" VARIABLE _rings-str
#[ ] VARIABLE _rings
#[ ] VARIABLE _refl
#[ ] VARIABLE _prefix
#[ ] VARIABLE _crib
#[ ] VARIABLE _inmenu
#[ ] VARIABLE _menu
#[ ] VARIABLE _steps
"" VARIABLE _lines
#[ ] VARIABLE _f
#[ ] VARIABLE _i
#[ ] VARIABLE _partner
#[ ] VARIABLE _dec
"" VARIABLE _plugs
"" VARIABLE _pos
"" VARIABLE _conf
"" VARIABLE _head
0 VARIABLE _offset
0 VARIABLE _m
0 VARIABLE _test
0 VARIABLE _limit
0 VARIABLE _found
0 VARIABLE _trunc
true VARIABLE _check

\ The most rotor orders in one call, and the most (rotor orders x menu edges): the search costs up to
\ 2.6 ms per pair when every edge is on a cycle (measured; 1200 pairs take about 3 s, a bake has 10 s).
60 CONSTANT _max-orders
1200 CONSTANT _max-work

\ ---- historical data (enigma:rotor-wirings, rotor-turnovers and rotor-reflectors) ----

: _turn ( name:str -- bytes )
  enigma:rotor-turnovers name get util:letter-indices ;

\ ---- checking the parameters ----

: _names-for ( model:str -- list )
  model "I" = [ { "I" "II" "III" "IV" "V" } ] [ { "I" "II" "III" "IV" "V" "VI" "VII" "VIII" } ] if ;

: _check-reflector ( refl:str model:str -- )
  model "I" = [ { "A" "B" "C" } ] [ { "B" "C" } ] if refl util:count-of 0 =
  [ "reflector " refl cat " does not fit model " cat model cat raise:range ] when ;

: _check-rotors ( names:list model:str -- )
  names len 3 <
  [ "rotors: give three rotors, or more to search every order of three of them" raise:range ] when
  names [ model _names-for swap util:count-of 0 = ] filter
  dup len 0 >
  [ 0 nth "rotors: " swap cat " is not available in model " cat model cat raise:range ]
  [ drop ] if
  names [ names swap util:count-of 1 > ] filter len 0 >
  [ "rotors: a rotor may be named only once" raise:range ] when ;

\ ---- the orders of the rotors ----

: _triples-ab ( names:list a:int b:int -- list )
  0 names len range [ dup a <> swap b <> and ] filter
  [ names swap nth { names a nth names b nth } swap append ] map ;

: _triples-a ( names:list a:int -- list )
  0 names len range [ a <> ] filter
  [ names a rot _triples-ab ] map util:list-flatten ;

\ Every ordered choice of three of the names, left rotor first.
: _orders ( names:list -- list )
  names len 3 =
  [ { names } ]
  [ 0 names len range [ names swap _triples-a ] map util:list-flatten ] if ;

\ ---- the menu ----

: _letter-str ( n:int -- str )
  { n 65 + } codes>str ;

: _self-msg ( p:bytes j:int -- str )
  "crib letter " j 1 + int>str cat " (" cat
  p j nth _letter-str cat
  ") lines up with the same letter in the ciphertext, which an Enigma never produces" cat ;

\ A crib letter at the same place as itself in the cipher text is impossible for an Enigma.
: _check-crib ( p:bytes c:bytes -- )
  0 p len range [ dup p swap nth swap c swap nth = ] filter
  dup len 0 >
  [ 0 nth p swap _self-msg raise:range ]
  [ drop ] if ;

\ Bit mask of the letters joined to u by an edge, for the crib p and the cipher text c.
: _adj-step ( acc:int j:int p:bytes c:bytes u:int -- int )
  acc p j nth u = [ 1 c j nth shl ] [ 0 ] if bor
  c j nth u = [ 1 p j nth shl ] [ 0 ] if bor ;

: _adj-of ( p:bytes c:bytes u:int -- int )
  0 p len range 0 [ p c u _adj-step ] reduce ;

: _adj ( p:bytes c:bytes -- list )
  0 26 range [ p c rot _adj-of ] map ;

\ The letters of mask together with those joined to them by an edge.
: _grow ( mask:int adj:list -- int )
  0 26 range mask [ dup mask swap shr 1 band 1 = [ adj swap nth bor ] [ drop ] if ] reduce ;

: _reach ( adj:list start:int -- int )
  1 start shl [ dup adj _grow over <> ] [ adj _grow ] while ;

\ How many edges have their plain letter in the set mask.
: _edges-in ( p:bytes mask:int -- int )
  p [ mask swap shr 1 band ] map 0 [ + ] reduce ;

: _main-step ( best:int m:int p:bytes -- int )
  p m _edges-in p best _edges-in > [ m ] [ best ] if ;

\ The component (as a mask) with the most edges; the first one on a tie.
: _main-mask ( p:bytes adj:list -- int )
  0 26 range [ adj swap nth 0 <> ] filter [ adj swap _reach ] map
  0 [ p _main-step ] reduce ;

: _degree ( p:bytes c:bytes u:int -- int )
  p [ u = ] filter len c [ u = ] filter len + ;

: _pick-step ( best:int u:int p:bytes c:bytes mask:int -- int )
  mask u shr 1 band 1 <> [ best ]
  [ best 0 <
    [ u ]
    [ p c u _degree p c best _degree > [ u ] [ best ] if ] if ] if ;

\ The letter of the component with the most edges (the lowest on a tie).
: _pick-test ( p:bytes c:bytes mask:int -- int )
  0 26 range -1 [ p c mask _pick-step ] reduce ;

: _edge ( p:bytes c:bytes j:int -- list )
  { j p j nth c j nth } ;

: _menu-of ( p:bytes c:bytes mask:int -- bytes )
  0 p len range [ p swap nth mask swap shr 1 band 1 = ] filter
  [ p c rot _edge ] map util:list-flatten list>bytes ;

: _head-text ( edges:int letters:int test:int -- str )
  "# menu: " edges int>str cat " edges between " cat letters int>str cat " letters, " cat
  edges letters - 1 + int>str cat " closures, test letter " cat test _letter-str cat ;

\ Store the menu of the component mask: the primitive's menu, which crib steps it has, the test letter.
: _prepare-menu ( p:bytes c:bytes mask:int -- )
  p mask _edges-in mask util:popcount-26 p c mask _pick-test dup _test! _head-text _head!
  p c mask _menu-of _menu!
  p len _m!
  0 p len range [ p swap nth mask swap shr 1 band ] map list>bytes _inmenu!
  0 p len range [ _inmenu swap nth 1 = ] filter list>bytes _steps! ;

\ The cipher text letters (0 to 25) under the crib p.
: _cipher-part ( p:bytes -- bytes )
  _prefix _offset _offset p len + slice [ 65 - ] map ;

: _prepare-letters ( p:bytes ct:bytes -- )
  p len 0 = [ "crib: write at least one letter" raise:range ] when
  _offset p len + ct len >
  [ "crib: it runs past the end of the ciphertext, which has " ct len int>str cat " letters" cat raise:range ] when
  ct 0 _offset p len + slice [ 65 + ] map _prefix!
  p [ 65 + ] map _crib!
  p p _cipher-part _check-crib
  p p _cipher-part p p p _cipher-part _adj _main-mask _prepare-menu ;

\ ---- the tables of the rotors (built once for each rotor) ----

: _entry ( name:str rm:int rr:int -- record )
  enigma:rotor-wirings name get util:letter-indices dup util:rotor-shift-table _f!
  util:perm-invert util:rotor-shift-table _i!
  { { "fwd" _f } { "inv" _i }
    { "cl" _refl _f _i util:rotor-reflect-table }
    { "fm" name _turn rm util:rotor-notch-flags }
    { "fr" name _turn rr util:rotor-notch-flags } } >record ;

: _pair ( name:str entry:record -- list )
  { name entry } ;

: _cache-of ( names:list -- record )
  names [ dup _rings 1 nth _rings 2 nth _entry _pair ] map >record ;

: _part ( cache:record name:str key:str -- bytes )
  cache name get key get ;

\ The five rotor tables of an order (left, middle, right names): right, middle, left-with-reflector, and the
\ middle and right going back.
: _tabs ( cache:record order:list -- bytes )
  cache order 2 nth "fwd" _part cache order 1 nth "fwd" _part cat
  cache order 0 nth "cl" _part cat
  cache order 1 nth "inv" _part cat cache order 2 nth "inv" _part cat ;

: _flags ( cache:record order:list -- bytes )
  cache order 2 nth "fr" _part cache order 1 nth "fm" _part cat ;

\ ---- the stops ----

\ The window letters of the start of a stop (30 bytes): its three shifts plus the ring settings.
: _positions ( st:bytes -- str )
  { st 0 nth _rings 0 nth + 26 mod 65 +
    st 1 nth _rings 1 nth + 26 mod 65 +
    st 2 nth _rings 2 nth + 26 mod 65 + } codes>str ;

\ The pair of letters u and its partner, written once (u before its partner); "" when none.
: _pair-of ( partner:bytes u:int -- str )
  partner u nth dup 26 < over u > and
  [ dup partner swap nth u =
    [ 65 + { u 65 + } swap append codes>str ] [ drop "" ] if ]
  [ drop "" ] if ;

: _plug-text ( partner:bytes -- str )
  0 26 range [ partner swap _pair-of ] map [ len 0 > ] filter " " join ;

: _conflict-text ( partner:bytes -- str )
  0 26 range [ partner swap nth 254 = ] filter [ 65 + ] map codes>str ;

\ How many of the crib letters of the menu component the deciphered text gets wrong.
: _wrong ( dec:bytes crib:bytes js:bytes -- int )
  js [ dup dec swap nth swap crib swap nth <> ] filter len ;

: _preview ( dec:bytes -- str )
  dec [ _inmenu swap nth 0 = [ 32 + ] when ] mapi bytes>latin1 ;

: _line ( order:list -- str )
  order " " join "rotors " swap cat "  positions " cat _pos cat
  "  steckers " cat _plugs len 0 = [ "none" ] [ _plugs ] if cat
  _conf len 0 > [ "  contradiction at " _conf cat ] [ "" ] if cat
  "  crib " cat _dec _preview cat ;

\ Decipher the text up to the crib with the stop and its steckers, with the enigma model; the crib region.
: _run-enigma ( order:list -- )
  _prefix _model order " " join _reflector _rings-str _pos _plugs "keep" enigma:encrypt
  _offset _offset _m + slice _dec! ;

: _accept ( order:list st:bytes -- )
  _found _limit <
  [ st 4 30 slice _partner!
    _partner _plug-text _plugs!
    st _positions _pos!
    _partner _conflict-text _conf!
    _check _conf len 0 > and not
    [ order _run-enigma
      _check _dec _crib _steps _wrong 0 > and not
      [ _lines order _line "\n" cat cat _lines! _found 1 + _found! ] when ] when ]
  when ;

: _stop-at ( b:bytes i:int -- bytes )
  b i 30 * dup 30 + slice ;

: _take-all ( order:list b:bytes -- )
  b len 30 div _limit = [ 1 _trunc! ] when
  0 b len 30 div range [ b swap _stop-at ] map [ order swap _accept ] each ;

\ Search one order of rotors, unless enough stops are found already.
: _run-order ( cache:record order:list -- )
  _found _limit <
  [ cache order _tabs cache order _flags _menu _offset _test _limit _check bombe:_search
    order swap _take-all ]
  when ;

: _search-all ( cache:record orders:list -- )
  orders [ cache swap _run-order ] each ;

\ ---- the report ----

\ How many orders there are of n rotors taken three at a time.
: _count ( n:int -- int )
  n 3 = [ 1 ] [ n n 1 - * n 2 - * ] if ;

: _header ( -- list )
  { "# bombe: crib " _crib bytes>latin1 cat " at offset " cat _offset int>str cat
    ", model " cat _model cat ", reflector " cat _reflector cat ", rings " cat _rings-str cat
    ", check " cat _check [ "on" ] [ "off" ] if cat
    _head } ;

: _footer ( orders:int -- list )
  { "# rotor orders: " orders int>str cat "# stops: " _found int>str cat }
  _found 0 = [ { "# no stops: no start position fits the crib" } ] [ { } ] if cat
  _trunc 1 = _found _limit >= or
  [ { "# limit reached: more stops may exist, raise the limit to see them" } ] [ { } ] if cat ;

: _check-work ( orders:int -- )
  _menu len 3 div dup orders * _max-work >
  [ "rotors, crib: " orders int>str cat " rotor orders times " cat swap int>str cat
    " menu edges is over the limit of " cat _max-work int>str cat
    " (more would not finish in a bake): use fewer rotors or a shorter crib" cat raise:range ]
  [ drop ] if ;

: _go ( data:bytes crib:str names:list -- bytes )
  crib util:letter-numbers data util:letter-numbers _prepare-letters
  names len _count _check-work
  names _cache-of names _orders _search-all
  _header "\n" join "\n" cat _lines cat names len _count _footer "\n" join cat str>bytes ;


: search ( data:bytes crib:str[1..256] offset:int[0..1000000]=0 model:choice{I|M3}=I rotors:str[1..64]="I II III" reflector:choice{A|B|C}=B rings:str[1..32]="AAA" check:choice{on|off}=on limit:int[1..100]=20 -- bytes )
  "Turing-Welchman Bombe for the Enigma I and M3. Finds the start positions at which the plugboard implied by a crib (a guess of the plaintext, at a known offset in the ciphertext) is consistent, in every order of the rotors given (three rotors: that order; more: every order of three of them), and prints one stop per line: the rotor order, the start positions (the window letters at the start of the message), the steckers deduced and the crib region deciphered with them. Letters outside the menu component are lower case. Only letters count in the ciphertext and the crib. A crib letter that lines up with the same letter in the ciphertext is E_RANGE." doc
  "Cipher machines" category
  rotors upper util:number-tokens
  dup model _check-rotors
  reflector model _check-reflector
  dup len _count _max-orders >
  [ "rotors: at most " _max-orders int>str cat " rotor orders (five rotors) can be searched at once" cat raise:range ] when
  model _model! reflector _reflector! rings _rings-str! offset _offset! limit _limit!
  check "on" = _check!
  0 _found! 0 _trunc! "" _lines!
  rings 3 "rings" util:letter-settings _rings!
  enigma:rotor-reflectors reflector get util:letter-indices _refl!
  data crib rot _go ;

META: search
  param crib "The known plaintext, letters only (other characters are ignored), written as it appears in the message. Each letter must differ from the ciphertext letter at its place." ;
  param offset "Where the crib starts in the ciphertext, counted in letters from 0." ;
  param model "I: Enigma I, rotors I to V, reflectors A, B, C. M3: rotors I to VIII, reflectors B, C. (The M4 is not supported.)" ;
  param rotors "The rotors to try, separated by spaces. Three names: that order only, left to right (I II III). More than three (I II III IV V): every order of three of them, up to 60 orders." ;
  param reflector "The reflector (Umkehrwalze): A, B or C for Enigma I, B or C for M3." ;
  param rings "The ring settings assumed, left to right, letters or numbers 1 to 26. AAA is what the real Bombe assumed; the stops are window letters for these rings." ;
  param check "on: keep a stop only when it has no contradiction and the ciphertext, deciphered with its position and steckers, gives the crib. off: list every stop as the test register shows it." ;
  param limit "The most stops to list. Each costs about 130,000 VM steps (it is deciphered with enigma:encrypt), so more than about 30 need a trusted run. A crib with no loop gives a stop nearly everywhere." ;
  see-also enigma:encrypt ;
;
