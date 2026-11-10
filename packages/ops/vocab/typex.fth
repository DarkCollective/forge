\ typex: a Typex-style five-rotor machine. One word, typex:encrypt (alias decrypt), because the
\ machine is reciprocal. Written for Forge from the public descriptions of the architecture
\ (Wikipedia, "Typex"; Crypto Museum's Typex pages), then aligned for compatibility with the
\ behaviour of CyberChef's Typex operation (described below). No code, table or text of that tool
\ is copied here.
\
\ The rotor wirings of the real Typex were never published, so this vocabulary has none. The wiring
\ of all five rotors and of the reflector are PARAMETERS (each a permutation of A to Z, checked), and
\ the defaults are EXAMPLE rotors drawn at random for this project: they are NOT historical Typex
\ wirings and must not be taken for them. Enter your own wirings to model a particular machine.
\
\ CONVENTIONS FOLLOW CYBERCHEF'S, FOR COMPATIBILITY: given the same wirings and settings, this
\ vocabulary gives the same output as CyberChef. None of these conventions is historically
\ attested, and the real Typex conventions (notch timing, reversed rotors, entry wiring, stepping)
\ are unpublished. They are:
\  - Rotor order: the five rotors are written left to right as on the machine, rotor-1 to rotor-5,
\    and the signal enters at the RIGHTMOST rotor (rotor-5). Rotors 4 and 5 are stators (fixed),
\    rotor-3 is the fast rotor, rotor-2 the middle one and rotor-1 the slow one. The current goes
\    plugboard, 5, 4, 3, 2, 1, reflector, 1, 2, 3, 4, 5, plugboard. Rings and positions are written
\    in the same left to right order; a rotor acts with the shift position minus ring.
\  - Notches: a notch letter N of a moving rotor is tested after the fast rotor has stepped: a
\    rotor carries the next one when it has just stepped onto N (the window then shows N).
\  - Reversed rotors: a rotor fitted back to front is the permutation neg o inverse(w) o neg, where
\    neg(x) = minus x mod 26 (A = 0).
\  - Entry plugboard: a full wiring P of the 26 letters (empty is the identity). A letter c enters
\    as minus P(c) mod 26, and the inverse is applied on the way out. So even an empty plugboard
\    swaps B and Z, C and Y, and so on, with A and N fixed.
\  - Stepping, Enigma-style with the double step. For one key press, with the window letters as
\    they stand before the press: the fast rotor always steps. The middle rotor steps when the
\    fast rotor is about to step onto one of notches-3, or when the middle rotor itself is about to
\    step onto one of notches-2 (the double step). The slow rotor steps if, and only if, the middle
\    rotor steps for that second reason. A rotor may have any number of notches. The slow rotor's
\    own notches never matter, so there is no parameter for them.
\
\ How it is computed: the plugboard and the two stators are fixed, so they are one 26-byte table
\ (and its inverse); the slow rotor, the reflector and the slow rotor back depend only on the slow
\ rotor's shift, so they form one 26 x 26 table. The per-letter work is a few lookups, which keeps
\ 64 KiB of text far inside the step budget without a primitive. Internally the rotors are kept in
\ signal order (the stators first); the parameters are written left to right and turned round on entry.
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

\ The notch letters of a rotor as numbers 0 to 25 (none is allowed), spaces and commas ignored. The
\ notch is tested after the step, so each is moved one back: the letter the window shows before.
: _notches ( s:str what:str -- bytes )
  s util:number-tokens "" join
  dup len 0 > over util:letters? not and
  [ what ": notches are letters, like EJR" cat raise:range ] when
  util:letter-indices [ 25 + 26 mod ] map ;

\ The rotors fitted back to front: tokens 1 to 5, as written (rotor 1 is the leftmost). They are
\ returned in signal order, where the rotor next to the plugboard is 1: the rotor written k is 6 - k.
: _reversed ( s:str -- bytes )
  s util:number-tokens
  [ dup util:digits? [ str>int ] [ drop 0 ] if
    dup 1 < over 5 > or [ "reversed: rotor numbers are 1 to 5, like 2 4" raise:range ] when
    6 swap - ]
  map list>bytes ;

\ The entry plugboard as the table c -> minus P(c) mod 26: empty is the identity wiring P. P must
\ be a permutation of the 26 letters.
: _entry ( s:str -- bytes )
  s util:strip-space dup len 0 =
  [ drop 0 26 range list>bytes ]
  [ "plugboard" _wiring ] if
  [ 26 swap - 26 mod ] map ;

\ ---- the tables ----

#[ ] VARIABLE _rv
#[ ] VARIABLE _rg
#[ ] VARIABLE _ps
#[ ] VARIABLE _w1
#[ ] VARIABLE _w2
#[ ] VARIABLE _w3
#[ ] VARIABLE _w4
#[ ] VARIABLE _w5

\ The permutation neg o inverse(w) o neg of a wiring: a rotor fitted back to front.
: _flip ( w:bytes -- bytes )
  w util:perm-invert
  0 26 range [ 26 swap - 26 mod over swap nth 26 swap - 26 mod ] map list>bytes nip ;

\ A rotor wiring as fitted; n is the signal-order number, the reversed ones are listed in _rv.
: _fit ( w:bytes n:int -- bytes )
  _rv n util:count-of 0 > [ w _flip ] [ w ] if ;

\ The shift of a rotor by signal-order index i (0 for the rotor next to the plugboard).
: _shift-of ( i:int -- int )
  _ps i nth _rg i nth - 26 mod ;

\ The setting letters, written left to right, in signal order.
: _settings ( s:str what:str -- bytes )
  s 5 what util:letter-settings rev ;

: _setup ( r1:str r2:str r3:str r4:str r5:str refl:str n3:str n2:str rv:str rings:str pos:str plugs:str -- )
  rv _reversed _rv!
  rings "rings" _settings _rg!
  pos "positions" _settings _ps!
  r5 "rotor-5" _wiring 1 _fit _w1!
  r4 "rotor-4" _wiring 2 _fit _w2!
  r3 "rotor-3" _wiring 3 _fit _w3!
  r2 "rotor-2" _wiring 4 _fit _w4!
  r1 "rotor-1" _wiring 5 _fit _w5!
  plugs _entry _w1 0 _shift-of util:rotor-shifted _w2 1 _shift-of util:rotor-shifted util:table-compose3 _E!
  _E util:perm-invert _EI!
  _w3 util:rotor-shift-table _FR!
  _w3 util:perm-invert util:rotor-shift-table _IR!
  _w4 util:rotor-shift-table _FM!
  _w4 util:perm-invert util:rotor-shift-table _IM!
  refl _reflector _w5 util:rotor-shift-table _w5 util:perm-invert util:rotor-shift-table util:rotor-reflect-table _CL!
  n3 "notches-3" _notches _rg 2 nth util:rotor-notch-flags _NR!
  n2 "notches-2" _notches _rg 3 nth util:rotor-notch-flags _NM!
  2 _shift-of 26 * _b1!
  3 _shift-of 26 * _b2!
  4 _shift-of 26 * _b3!
  util:letter-table _LT! ;

\ ---- encrypting ----

\ Advance the rotors before a letter: the double step (the middle rotor is about to reach its own
\ notch: it and the slow rotor both step), else the middle rotor steps if the fast rotor is about
\ to reach a notch; the fast rotor always steps.
: _turn ( off:int -- int )
  off 26 + 676 mod ;

: _step ( -- )
  _NM _b2 nth 1 =
  [ _b3 _turn _b3! _b2 _turn _b2! ]
  [ _NR _b1 nth 1 = [ _b2 _turn _b2! ] when ] if
  _b1 _turn _b1! ;

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

: encrypt ( bytes rotor-1:str[26,/[A-Za-z]+/]="PJRGUSXFOWDLITKBMZQHAVYNCE" rotor-2:str[26,/[A-Za-z]+/]="BNJDZKRLPCSXEVQIATGWFMOUHY" rotor-3:str[26,/[A-Za-z]+/]="FSMHZXQKOJVDBURPGWLIYAETCN" rotor-4:str[26,/[A-Za-z]+/]="NQJYLKMDXWOAHTBCIUZEGRPVSF" rotor-5:str[26,/[A-Za-z]+/]="BAZQDEVNCYGOIWMHTRXKLPSFUJ" reflector:str[26,/[A-Za-z]+/]="TPZRFEOWNXUQVIGBLDYAKMHJSC" notches-3:str[0..26]="FKS" notches-2:str[0..26]="DIQ" reversed:str[0..20]="" rings:str[5..40]="AAAAA" positions:str[5..40]="AAAAA" plugboard:str[0..64]="" others:choice{keep|remove}=keep -- bytes )
  "Typex-style five-rotor machine with parameters for every wiring, following CyberChef's conventions for compatibility (the real Typex conventions are unpublished). The real Typex wirings were never published: the defaults are EXAMPLE rotors made up for Forge, not historical ones. Rotors are written left to right; the signal enters at rotor-5, through the fixed stators 5 and 4, the moving rotors 3 (fast), 2 and 1 (slow), the reflector, and back. Each letter A to Z, in either case, is enciphered and written in upper case; the same word deciphers. Rotor wirings and the reflector are permutations of A to Z (the reflector pairs letters). Rings and positions are five letters (or numbers 1 to 26) in left to right order. The entry plugboard is a 26-letter wiring that enters each letter c as minus its wiring, mod 26 (empty: the identity wiring, which swaps B and Z, C and Y and so on). Stepping is Enigma-like with a double step; notch letters are tested after the step. Other bytes are kept or dropped with others=remove. A wiring that is not a permutation or other bad settings are E_RANGE." doc
  "Cipher machines" category
  rotor-1 rotor-2 rotor-3 rotor-4 rotor-5 reflector notches-3 notches-2 reversed rings positions plugboard _setup
  others "remove" =
  [ _LT translate [ 255 <> ] filter [ _press 65 + ] map ]
  [ [ _byte ] map ] if ;

META: encrypt
  param rotor-1 "Wiring of the leftmost rotor, the slow moving one: 26 letters, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-2 "Wiring of the middle moving rotor, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-3 "Wiring of the fast moving rotor, a permutation of A to Z. The default is an example, not historical." ;
  param rotor-4 "Wiring of stator 2 (fixed), a permutation of A to Z. The default is an example, not historical." ;
  param rotor-5 "Wiring of the rightmost rotor, stator 1, where the current enters: a permutation of A to Z. The default is an example, not historical." ;
  param reflector "Reflector wiring: 26 letters pairing the alphabet up (if A maps to B then B maps to A, no letter to itself). Example, not historical." ;
  param notches-3 "Notch letters of the fast rotor 3, any number (FKS): the middle rotor steps when the fast rotor steps onto one (tested after the step, as CyberChef does). Empty for none." ;
  param notches-2 "Notch letters of the middle rotor 2, any number (DIQ): when it steps onto one the slow rotor steps too, and it steps itself (double step). Empty for none." ;
  param reversed "Rotors fitted back to front, by number 1 to 5 from the left, like 2 4. As CyberChef does: neg o inverse(wiring) o neg, neg(x) = minus x mod 26. Empty for none." ;
  param rings "Ring settings of rotors 1 to 5, left to right: five letters (ABCDE) or numbers 1 to 26." ;
  param positions "Start positions of rotors 1 to 5, left to right: five letters or numbers 1 to 26. For the stators (4 and 5) only position minus ring matters." ;
  param plugboard "Entry wiring, as CyberChef takes it: 26 letters, a permutation; a letter c enters as minus its value, mod 26. Empty: the identity wiring, which still swaps B and Z, C and Y and so on." ;
  param others "keep: bytes that are not letters pass through unchanged. remove: they are dropped." ;
  alias decrypt ;
;
