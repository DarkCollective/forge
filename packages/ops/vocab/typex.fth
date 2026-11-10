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

\ ---- checking the parameters ----

\ A wiring as a permutation 0 to 25: 26 distinct letters.
: _wiring ( s:str what:str -- bytes )
  s util:letters? s len 26 = and not
  [ what ": the wiring must be the 26 letters A to Z in some order" cat raise:range ] when
  s util:letter-indices
  0 26 range [ over swap util:count-of 1 <> ] filter len 0 >
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
  dup len 0 > over util:letters? not and
  [ what ": notches are letters, like EJR" cat raise:range ] when
  util:letter-indices ;

\ The numbers of the rotors fitted back to front: tokens 1 to 5.
: _reversed ( s:str -- bytes )
  s util:number-tokens
  [ dup util:digits? [ str>int ] [ drop 0 ] if
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
  _rv n util:count-of 0 > [ w util:perm-invert ] [ w ] if ;

: _shift-of ( i:int -- int )
  _ps i nth _rg i nth - 26 mod ;

: _setup ( r1:str r2:str r3:str r4:str r5:str refl:str n3:str n4:str rv:str rings:str pos:str plugs:str -- )
  rv _reversed _rv!
  rings 5 "rings" util:letter-settings _rg!
  pos 5 "positions" util:letter-settings _ps!
  r1 "rotor-1" _wiring 1 _fit _w1!
  r2 "rotor-2" _wiring 2 _fit _w2!
  r3 "rotor-3" _wiring 3 _fit _w3!
  r4 "rotor-4" _wiring 4 _fit _w4!
  r5 "rotor-5" _wiring 5 _fit _w5!
  plugs util:plugboard-table _w1 0 _shift-of util:rotor-shifted _w2 1 _shift-of util:rotor-shifted util:table-compose3 _E!
  _E util:perm-invert _EI!
  _w3 util:rotor-shift-table _FR!
  _w3 util:perm-invert util:rotor-shift-table _IR!
  _w4 util:rotor-shift-table _FM!
  _w4 util:perm-invert util:rotor-shift-table _IM!
  refl _reflector _w5 util:rotor-shift-table _w5 util:perm-invert util:rotor-shift-table util:rotor-reflect-table _CL!
  n3 "notches-3" _notches _rg 2 nth util:rotor-notch-flags _NR!
  n4 "notches-4" _notches _rg 3 nth util:rotor-notch-flags _NM!
  2 _shift-of 26 * _b1!
  3 _shift-of 26 * _b2!
  4 _shift-of 26 * _b3!
  util:letter-table _LT! ;

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
