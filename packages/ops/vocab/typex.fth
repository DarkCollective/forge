\ typex: a Typex-style five-rotor machine. One word, typex:encrypt (alias decrypt), because the
\ machine is reciprocal. Written for Forge from the public descriptions of the architecture
\ (Wikipedia, "Typex"; Crypto Museum's Typex pages); no code, table or description of any other
\ tool was used.
\
\ The rotor wirings of the real Typex were never published, so this vocabulary has none. The wiring
\ of all five rotors and of the reflector are PARAMETERS (each a permutation of A to Z, checked), and
\ the defaults are EXAMPLE rotors drawn at random for this project: they are NOT historical Typex
\ wirings and must not be taken for them. Enter your own wirings to model a particular machine.
\
\ Architecture modelled: the keyboard feeds an entry plugboard (letter pairs, so the machine stays
\ reciprocal), then five rotors in signal order, then the reflector. The first two rotors are
\ stators (they never move); rotor 3 is the fast one, rotor 4 the middle one and rotor 5 the slow one.
\ The current goes through the plugboard, rotors 1 to 5, the reflector, rotors 5 to 1 and the
\ plugboard. Every rotor has a ring setting and a start position (a shift of position minus ring).
\ A rotor can be fitted back to front: it is then modelled by the inverse permutation of its wiring.
\ Stepping: rotor 3 steps at every key press; rotor 4 steps when rotor 3 stands at one of its notches
\ (window letters) and rotor 5 when rotor 4 does, the notches being tested before any rotor moves. A
\ rotor may have any number of notches, as the real rotors had several; there is no double step.
\ This stepping and the reverse-fitting model are simplifications chosen for Forge, not a claim
\ about any particular Typex mark.
\
\ How it is computed: the plugboard and the two stators are fixed, so they are one 26-byte table
\ (and its inverse); the slow rotor, the reflector and the slow rotor back depend only on the slow
\ rotor's shift, so they form one 26 x 26 table. The per-letter work is a few lookups, which keeps
\ 64 KiB of text far inside the step budget without a primitive.
IN: typex

0 VARIABLE _b1
0 VARIABLE _b2
0 VARIABLE _b3
#[ ] VARIABLE _E
#[ ] VARIABLE _EI
#[ ] VARIABLE _FR
#[ ] VARIABLE _IR
#[ ] VARIABLE _FM
#[ ] VARIABLE _IM
#[ ] VARIABLE _CL
#[ ] VARIABLE _NR
#[ ] VARIABLE _NM
#[ ] VARIABLE _LT

\ ---- small helpers ----

\ util-candidate: letter-indices
: _idx ( s:str -- bytes )
  s upper str>bytes [ 65 - ] map ;

\ util-candidate: letter?
: _alpha? ( c:int -- bool )
  c 32 bor 97 - dup 0 >= swap 25 <= and ;

\ util-candidate: letters?
: _all-alpha? ( t:str -- bool )
  t str>bytes [ _alpha? not ] filter len 0 = t len 0 > and ;

\ util-candidate: digits?
: _digits? ( t:str -- bool )
  t str>bytes [ util:dec-digit? not ] filter len 0 = t len 0 > and ;


\ util-candidate: bytes-count
: _count-in ( d:bytes v:int -- int )
  d [ v = ] filter len ;

\ util-candidate: perm-where
: _where ( p:bytes i:int -- int )
  0 p len range [ p swap nth i = ] filter 0 nth ;

\ util-candidate: perm-invert
: _invert ( p:bytes -- bytes )
  0 p len range [ p swap _where ] map list>bytes ;

\ util-candidate: rotor-shift-table
: _shift-table ( w:bytes -- bytes )
  0 676 range [ dup 26 div swap 26 mod over + 26 mod w swap nth swap - 26 mod ] map list>bytes ;

\ util-candidate: rotor-shifted
: _shifted ( w:bytes s:int -- bytes )
  0 26 range [ s + 26 mod w swap nth s - 26 mod ] map list>bytes ;

\ util-candidate: rotor-notch-flags
: _notch-flags ( turn:bytes ring:int -- bytes )
  0 676 range
  [ dup 26 mod 0 =
    [ 26 div ring + 26 mod turn swap _count-in 0 > [ 1 ] [ 0 ] if ]
    [ drop 0 ] if ]
  map list>bytes ;

\ ---- reading the settings ----

\ The value 0 to 25 of one setting token: a number 1 to 26 or a single letter.
\ util-candidate: setting-token-value
: _token-value ( t:str what:str -- int )
  t _digits?
  [ t len 3 < [ t str>int 1 - ] [ -1 ] if
    dup 0 < over 25 > or [ what ": a number must be 1 to 26" cat raise:range ] when ]
  [ t len 1 = t _all-alpha? and
    [ t str>bytes 0 nth 32 bor 97 - ]
    [ what ": write letters (BUL), letters apart (B U L) or numbers 1 to 26 (2 21 12)" cat raise:range 0 ] if ]
  if ;

\ n settings, each 0 to 25: one word of n letters, or n tokens (letters or numbers).
\ util-candidate: letter-settings
: _settings ( s:str n:int what:str -- bytes )
  s util:number-tokens
  dup len 0 = [ what ": the setting is empty" cat raise:range ] when
  dup len 1 = over 0 nth _all-alpha? and
  [ 0 nth str>bytes [ 32 bor 97 - ] map ]
  [ [ what _token-value ] map list>bytes ] if
  dup len n <>
  [ what ": " cat n int>str cat " settings are needed" cat raise:range ] when ;

\ The plugboard as a 26-byte permutation: pairs of two different letters, each letter once.
\ util-candidate: plug-partner
: _partner ( i:int fl:bytes -- int )
  0 fl len range [ fl swap nth i = ] filter
  dup len 0 = [ drop i ] [ 0 nth 1 bxor fl swap nth ] if ;

\ util-candidate: plug-pair
: _plug-pair ( t:str -- bytes )
  t len 2 = t _all-alpha? and not
  [ "plugboard: each pair is two letters, like AB" raise:range ] when
  t _idx ;

\ util-candidate: plugboard-table
: _plugboard ( s:str -- bytes )
  s util:number-tokens [ _plug-pair ] map #[ ] [ cat ] reduce
  0 26 range [ over swap _count-in 1 > ] filter len 0 >
  [ "plugboard: a letter may be in one pair only" raise:range ] when
  0 26 range [ over _partner ] map list>bytes nip ;

\ Byte to letter number 0 to 25 (either case), 255 for any other byte; a table for translate.
\ util-candidate: letter-table
: _letter-table ( -- bytes )
  0 256 range [ dup 32 bor 97 - dup 0 >= over 25 <= and [ nip ] [ drop drop 255 ] if ] map list>bytes ;

\ Left rotor forward, the fixed reflector, left rotor back: one table per left shift.
\ util-candidate: rotor-reflect-table
: _left-table ( r:bytes fl:bytes il:bytes -- bytes )
  0 676 range [ dup dup 26 mod - swap fl swap nth r swap nth + il swap nth ] map list>bytes ;

\ ---- checking the parameters ----

\ A wiring as a permutation 0 to 25: 26 distinct letters.
: _wiring ( s:str what:str -- bytes )
  s _all-alpha? s len 26 = and not
  [ what ": the wiring must be the 26 letters A to Z in some order" cat raise:range ] when
  s _idx
  0 26 range [ over swap _count-in 1 <> ] filter len 0 >
  [ what ": the wiring uses a letter twice, so it is not a permutation" cat raise:range ] when ;

: _bad-reflector? ( i:int r:bytes -- bool )
  r i nth i = r r i nth nth i <> or ;

: _reflector ( s:str -- bytes )
  s "reflector" _wiring
  0 26 range [ over _bad-reflector? ] filter len 0 >
  [ "reflector: it must pair the letters up (A to B means B to A) with no letter left alone" raise:range ] when ;

\ The notch letters of a rotor as numbers 0 to 25 (none is allowed), spaces and commas ignored.
: _notches ( s:str what:str -- bytes )
  s util:number-tokens "" join
  dup len 0 > over _all-alpha? not and
  [ what ": notches are letters, like EJR" cat raise:range ] when
  _idx ;

\ The numbers of the rotors fitted back to front: tokens 1 to 5.
: _reversed ( s:str -- bytes )
  s util:number-tokens
  [ dup _digits? [ str>int ] [ drop 0 ] if
    dup 1 < over 5 > or [ "reversed: rotor numbers are 1 to 5, like 2 4" raise:range ] when ]
  map list>bytes ;

\ ---- the tables ----

#[ ] VARIABLE _rv
#[ ] VARIABLE _rg
#[ ] VARIABLE _ps
#[ ] VARIABLE _w1
#[ ] VARIABLE _w2
#[ ] VARIABLE _w3
#[ ] VARIABLE _w4
#[ ] VARIABLE _w5

\ A rotor wiring as fitted: a rotor fitted back to front uses the inverse permutation.
: _fit ( w:bytes n:int -- bytes )
  _rv n _count-in 0 > [ w _invert ] [ w ] if ;

: _shift-of ( i:int -- int )
  _ps i nth _rg i nth - 26 mod ;

\ util-candidate: table-compose3
: _compose3 ( p:bytes f1:bytes f2:bytes -- bytes )
  0 26 range [ p swap nth f1 swap nth f2 swap nth ] map list>bytes ;

: _setup ( r1:str r2:str r3:str r4:str r5:str refl:str n3:str n4:str rv:str rings:str pos:str plugs:str -- )
  rv _reversed _rv!
  rings 5 "rings" _settings _rg!
  pos 5 "positions" _settings _ps!
  r1 "rotor-1" _wiring 1 _fit _w1!
  r2 "rotor-2" _wiring 2 _fit _w2!
  r3 "rotor-3" _wiring 3 _fit _w3!
  r4 "rotor-4" _wiring 4 _fit _w4!
  r5 "rotor-5" _wiring 5 _fit _w5!
  plugs _plugboard _w1 0 _shift-of _shifted _w2 1 _shift-of _shifted _compose3 _E!
  _E _invert _EI!
  _w3 _shift-table _FR!
  _w3 _invert _shift-table _IR!
  _w4 _shift-table _FM!
  _w4 _invert _shift-table _IM!
  refl _reflector _w5 _shift-table _w5 _invert _shift-table _left-table _CL!
  n3 "notches-3" _notches _rg 2 nth _notch-flags _NR!
  n4 "notches-4" _notches _rg 3 nth _notch-flags _NM!
  2 _shift-of 26 * _b1!
  3 _shift-of 26 * _b2!
  4 _shift-of 26 * _b3!
  _letter-table _LT! ;

\ ---- encrypting ----

\ Advance the rotors before a letter: each steps if the rotor before it stands at a notch.
: _step ( -- )
  _NM _b2 nth 1 = [ _b3 26 + 676 mod _b3! ] when
  _NR _b1 nth 1 = [ _b2 26 + 676 mod _b2! ] when
  _b1 26 + 676 mod _b1! ;

\ One letter 0 to 25 through the machine.
: _press ( int -- int )
  _step
  _E swap nth
  _b1 + _FR swap nth
  _b2 + _FM swap nth
  _b3 + _CL swap nth
  _b2 + _IM swap nth
  _b1 + _IR swap nth
  _EI swap nth ;

\ One byte: a letter is enciphered (as an upper-case letter), anything else is left alone.
: _byte ( int -- int )
  dup _LT swap nth
  dup 255 =
  [ drop ]
  [ nip _press 65 + ] if ;

: encrypt ( bytes rotor-1:str[26,/[A-Za-z]+/]="BAZQDEVNCYGOIWMHTRXKLPSFUJ" rotor-2:str[26,/[A-Za-z]+/]="NQJYLKMDXWOAHTBCIUZEGRPVSF" rotor-3:str[26,/[A-Za-z]+/]="FSMHZXQKOJVDBURPGWLIYAETCN" rotor-4:str[26,/[A-Za-z]+/]="BNJDZKRLPCSXEVQIATGWFMOUHY" rotor-5:str[26,/[A-Za-z]+/]="PJRGUSXFOWDLITKBMZQHAVYNCE" reflector:str[26,/[A-Za-z]+/]="TPZRFEOWNXUQVIGBLDYAKMHJSC" notches-3:str[0..26]="EJR" notches-4:str[0..26]="CHP" reversed:str[0..20]="" rings:str[5..40]="AAAAA" positions:str[5..40]="AAAAA" plugboard:str[0..128]="" others:choice{keep|remove}=keep -- bytes )
  "Typex-style five-rotor machine with parameters for every wiring. The real Typex wirings were never published: the defaults are EXAMPLE rotors made up for Forge, not historical ones. The current goes through the plugboard, two fixed stators (rotors 1 and 2), the moving rotors 3 (fast), 4 and 5 (slow), the reflector, and back. Each letter A to Z, in either case, is enciphered and written in upper case; the same word deciphers. Rotor wirings and the reflector are permutations of A to Z (the reflector pairs letters). Rings and positions are five letters (or numbers 1 to 26) in rotor order 1 to 5. Other bytes are kept or dropped with others=remove. A wiring that is not a permutation or other bad settings are E_RANGE." doc
  "Cipher machines" category
  rotor-1 rotor-2 rotor-3 rotor-4 rotor-5 reflector notches-3 notches-4 reversed rings positions plugboard _setup
  others "remove" =
  [ _LT translate [ 255 <> ] filter [ _press 65 + ] map ]
  [ [ _byte ] map ] if ;

META: encrypt
  param rotor-1 "Wiring of stator 1, the first rotor the current meets: 26 letters, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-2 "Wiring of stator 2 (fixed), a permutation of A to Z. The default is an example, not historical." ;
  param rotor-3 "Wiring of the fast moving rotor, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-4 "Wiring of the middle moving rotor, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-5 "Wiring of the slow moving rotor, a permutation of A to Z. The default is an example, not historical." ;
  param reflector "Reflector wiring: 26 letters pairing the alphabet up (if A maps to B then B maps to A, no letter to itself). Example, not historical." ;
  param notches-3 "Window letters at which rotor 3 carries rotor 4 along, any number of them (EJR). Empty for none." ;
  param notches-4 "Window letters at which rotor 4 carries rotor 5 along, any number of them (CHP). Empty for none." ;
  param reversed "Rotors fitted back to front, by number 1 to 5, like 2 4. A reversed rotor uses the inverse of its wiring. Empty for none." ;
  param rings "Ring settings of rotors 1 to 5: five letters (ABCDE) or numbers 1 to 26." ;
  param positions "Start positions of rotors 1 to 5: five letters or numbers 1 to 26. For the stators only position minus ring matters." ;
  param plugboard "Entry plugboard pairs, like AB CD EF; no letter twice. Empty for none." ;
  param others "keep: bytes that are not letters pass through unchanged. remove: they are dropped." ;
  alias decrypt ;
;
