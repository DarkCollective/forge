\ enigma: the German Enigma rotor machines of the Wehrmacht and Kriegsmarine: Enigma I (Heer and
\ Luftwaffe), M3 and M4 (Kriegsmarine). One word, enigma:encrypt (alias decrypt), because the
\ machine is reciprocal. Written for Forge from the public descriptions of the machines; no code,
\ table or description of any other tool was used.
\
\ Sources of the wirings (all public, historical): Crypto Museum, "Enigma wiring" and "Enigma rotor
\ details" (cryptomuseum.com), and Wikipedia, "Enigma rotor details". Rotors I to VIII, Beta and
\ Gamma, and reflectors A, B, C, B-thin and C-thin are the historical wirings. The turnover letters
\ below are the letters showing in the window when the rotor carries the next one along (I Q,
\ II E, III V, IV J, V Z, VI to VIII Z and M); Crypto Museum's "notch" letter is the letter at the
\ other end of the same notch, which is not what this vocabulary uses.
\
\ Model of the machine: the key press first steps the rotors (right rotor always; when the middle
\ rotor is at its turnover it and the left rotor both step, the "double step"; else when the right
\ rotor is at its turnover the middle rotor steps), then the current goes through the plugboard, the
\ rotors right to left (the 4th, Greek rotor of the M4 never moves), the reflector, back through the
\ rotors and the plugboard. Rotors, ring settings and start positions are written left to right as
\ on the machine. A rotor with ring setting r and window letter p acts with the shift p - r.
\
\ How it is computed: the permutation of the Greek rotor, the reflector and the Greek rotor again is
\ fixed, so it is one 26-byte table; the left rotor, that table and the left rotor back depend only
\ on the left rotor's shift, so they form one 26 x 26 table. Every table is built once per call
\ and the per-letter work is a handful of lookups, which keeps 64 KiB of text far inside the step
\ budget without a primitive. Rotor state is the row offset (shift x 26) of each moving rotor.
IN: enigma

0 VARIABLE _n
"" VARIABLE _names
#[ ] VARIABLE _rings
#[ ] VARIABLE _pos
#[ ] VARIABLE _P
#[ ] VARIABLE _FR
#[ ] VARIABLE _IR
#[ ] VARIABLE _FM
#[ ] VARIABLE _IM
#[ ] VARIABLE _CL
#[ ] VARIABLE _NR
#[ ] VARIABLE _NM
0 VARIABLE _b1
0 VARIABLE _b2
0 VARIABLE _b3
#[ ] VARIABLE _LT

\ ---- historical data ----

: _wirings ( -- record )
  { { "I" "EKMFLGDQVZNTOWYHXUSPAIBRCJ" } { "II" "AJDKSIRUXBLHWTMCQGZNPYFVOE" }
    { "III" "BDFHJLCPRTXVZNYEIWGAKMUSQO" } { "IV" "ESOVPZJAYQUIRHXLNFTGKDCMWB" }
    { "V" "VZBRGITYUPSDNHLXAWMJQOFECK" } { "VI" "JPGVOUMFYQBENHZRDKASXLICTW" }
    { "VII" "NZJHGRCXMYSWBOUFAIVLPEKQDT" } { "VIII" "FKQHTLXOCBJSPDZRAMEWNIUYGV" }
    { "BETA" "LEYJVCNIXWPBQMDRTAKZGFUHOS" } { "GAMMA" "FSOKANUERHMBTIYCWLQPZXVGJD" } } >record ;

: _turnovers ( -- record )
  { { "I" "Q" } { "II" "E" } { "III" "V" } { "IV" "J" } { "V" "Z" } { "VI" "ZM" }
    { "VII" "ZM" } { "VIII" "ZM" } { "BETA" "" } { "GAMMA" "" } } >record ;

: _reflectors ( -- record )
  { { "A" "EJMZALYXVBWFCRQUONTSPIKHGD" } { "B" "YRUHQSLDPXNGOKMIEBFZCWVJAT" }
    { "C" "FVPJIAOYEDRZXWGCTKUQSBNMHL" } { "B-thin" "ENKQAUYWJICOPBLMDXZVFTHRGS" }
    { "C-thin" "RDOBJNTKVEHMLFCWZAXGYIPSUQ" } } >record ;

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

\ ---- model checks ----

: _names-for ( model:str first:bool -- list )
  model "I" = [ { "I" "II" "III" "IV" "V" } ]
  [ model "M3" = [ { "I" "II" "III" "IV" "V" "VI" "VII" "VIII" } ]
    [ first [ { "BETA" "GAMMA" } ] [ { "I" "II" "III" "IV" "V" "VI" "VII" "VIII" } ] if ] if ] if ;

: _check-rotor ( name:str model:str idx:int -- )
  model idx 0 = model "M4" = and _names-for [ name = ] filter len 0 =
  [ "rotors: " name cat " is not available as rotor " cat idx 1 + int>str cat " of model " cat model cat raise:range ] when ;

: _check-reflector ( refl:str model:str -- )
  model "I" = [ { "A" "B" "C" } ] [ model "M3" = [ { "B" "C" } ] [ { "B-thin" "C-thin" } ] if ] if
  [ refl = ] filter len 0 =
  [ "reflector " refl cat " does not fit model " cat model cat raise:range ] when ;

\ ---- the tables ----

: _wire ( name:str -- bytes )
  _wirings name get _idx ;

: _wire-at ( idx:int -- bytes )
  _names " " split idx nth _wire ;

: _shift-of ( idx:int -- int )
  _pos idx nth _rings idx nth - 26 mod ;

: _flags-at ( idx:int -- bytes )
  _turnovers _names " " split idx nth get _idx _rings idx nth _notch-flags ;

\ util-candidate: table-compose3
: _compose3 ( p:bytes f1:bytes f2:bytes -- bytes )
  0 26 range [ p swap nth f1 swap nth f2 swap nth ] map list>bytes ;

\ The Greek rotor, the reflector and the Greek rotor back: one fixed permutation.
: _greek-wrap ( r:bytes g:bytes s:int -- bytes )
  g s _shifted r g _invert s _shifted _compose3 ;

: _static-reflector ( refl:str -- bytes )
  _reflectors refl get _idx
  _n 4 = [ _names " " split 0 nth _wire 0 _shift-of _greek-wrap ] when ;

\ Left rotor forward, the fixed reflector, left rotor back: one table per left shift.
\ util-candidate: rotor-reflect-table
: _left-table ( r:bytes fl:bytes il:bytes -- bytes )
  0 676 range [ dup dup 26 mod - swap fl swap nth r swap nth + il swap nth ] map list>bytes ;

: _tables ( refl:str -- )
  _n 1 - _wire-at dup _shift-table _FR! _invert _shift-table _IR!
  _n 2 - _wire-at dup _shift-table _FM! _invert _shift-table _IM!
  _n 1 - _flags-at _NR!
  _n 2 - _flags-at _NM!
  _n 1 - _shift-of 26 * _b1!
  _n 2 - _shift-of 26 * _b2!
  _n 3 - _shift-of 26 * _b3!
  refl _static-reflector
  _n 3 - _wire-at dup _shift-table swap _invert _shift-table _left-table _CL! ;

: _setup ( model:str rotors:str refl:str rings:str pos:str plugs:str -- )
  model "M4" = [ 4 ] [ 3 ] if _n!
  refl model _check-reflector
  rotors upper util:number-tokens dup " " join _names!
  len _n <>
  [ "rotors: " _n int>str cat " rotors are needed for model " cat model cat raise:range ] when
  _names " " split 0 [ over model swap _check-rotor 1 + ] reduce drop
  rings _n "rings" _settings _rings!
  pos _n "positions" _settings _pos!
  plugs _plugboard _P!
  refl _tables
  _letter-table _LT! ;

\ ---- encrypting ----

\ Advance the moving rotors before a letter, with the double step.
: _step ( -- )
  _NM _b2 nth 1 =
  [ _b3 26 + 676 mod _b3! _b2 26 + 676 mod _b2! ]
  [ _NR _b1 nth 1 = [ _b2 26 + 676 mod _b2! ] when ] if
  _b1 26 + 676 mod _b1! ;

\ One letter 0 to 25 through the machine.
: _press ( int -- int )
  _step
  _P swap nth
  _b1 + _FR swap nth
  _b2 + _FM swap nth
  _b3 + _CL swap nth
  _b2 + _IM swap nth
  _b1 + _IR swap nth
  _P swap nth ;

\ One byte: a letter is enciphered (as an upper-case letter), anything else is left alone.
: _byte ( int -- int )
  dup _LT swap nth
  dup 255 =
  [ drop ]
  [ nip _press 65 + ] if ;

: encrypt ( bytes model:choice{I|M3|M4}=I rotors:str[1..64]="I II III" reflector:choice{A|B|C|B-thin|C-thin}=B rings:str[1..32]="AAA" positions:str[1..32]="AAA" plugboard:str[0..128]="" others:choice{keep|remove}=keep -- bytes )
  "Enigma rotor machine (Enigma I, M3 or M4). Each letter A to Z, in either case, is enciphered and written as an upper-case letter; the machine is reciprocal, so the same word deciphers with the same settings. Rotors, rings and positions go left to right as on the machine: three rotors (I, M3) or four (M4: Beta or Gamma first). Rings and positions are letters (BUL, B U L) or numbers 1 to 26 (2 21 12). The plugboard is pairs of letters (AB CD EF). Other bytes are kept as they are, or dropped with others=remove. Settings that do not fit the model are E_RANGE." doc
  "Cipher machines" category
  model rotors reflector rings positions plugboard _setup
  others "remove" =
  [ _LT translate [ 255 <> ] filter [ _press 65 + ] map ]
  [ [ _byte ] map ] if ;

META: encrypt
  param model "I: Enigma I (rotors I to V, reflectors A, B, C). M3: Kriegsmarine, rotors I to VIII, reflectors B, C. M4: four rotors, Beta or Gamma first, rotors I to VIII, thin reflectors." ;
  param rotors "Rotor names, left to right, separated by spaces: I to VIII, and Beta or Gamma as the first rotor of the M4. Three names, four for the M4." ;
  param reflector "Reflector (Umkehrwalze): A, B or C for Enigma I, B or C for M3, B-thin or C-thin for M4." ;
  param rings "Ring settings (Ringstellung), left to right: letters (BUL or B U L) or numbers 1 to 26 (2 21 12)." ;
  param positions "Start positions (Grundstellung), left to right, letters or numbers 1 to 26." ;
  param plugboard "Plugboard (Steckerbrett) pairs, like AB CD EF; no letter twice. Empty for none." ;
  param others "keep: bytes that are not letters pass through unchanged. remove: they are dropped." ;
  alias decrypt ;
  see-also typex:encrypt ;
;
