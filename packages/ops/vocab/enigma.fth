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
  _wirings name get util:letter-indices ;

: _wire-at ( idx:int -- bytes )
  _names " " split idx nth _wire ;

: _shift-of ( idx:int -- int )
  _pos idx nth _rings idx nth - 26 mod ;

: _flags-at ( idx:int -- bytes )
  _turnovers _names " " split idx nth get util:letter-indices _rings idx nth util:rotor-notch-flags ;

\ The Greek rotor, the reflector and the Greek rotor back: one fixed permutation.
: _greek-wrap ( r:bytes g:bytes s:int -- bytes )
  g s util:rotor-shifted r g util:perm-invert s util:rotor-shifted util:table-compose3 ;

: _static-reflector ( refl:str -- bytes )
  _reflectors refl get util:letter-indices
  _n 4 = [ _names " " split 0 nth _wire 0 _shift-of _greek-wrap ] when ;

: _tables ( refl:str -- )
  _n 1 - _wire-at dup util:rotor-shift-table _FR! util:perm-invert util:rotor-shift-table _IR!
  _n 2 - _wire-at dup util:rotor-shift-table _FM! util:perm-invert util:rotor-shift-table _IM!
  _n 1 - _flags-at _NR!
  _n 2 - _flags-at _NM!
  _n 1 - _shift-of 26 * _b1!
  _n 2 - _shift-of 26 * _b2!
  _n 3 - _shift-of 26 * _b3!
  refl _static-reflector
  _n 3 - _wire-at dup util:rotor-shift-table swap util:perm-invert util:rotor-shift-table util:rotor-reflect-table _CL! ;

: _setup ( model:str rotors:str refl:str rings:str pos:str plugs:str -- )
  model "M4" = [ 4 ] [ 3 ] if _n!
  refl model _check-reflector
  rotors upper util:number-tokens dup " " join _names!
  len _n <>
  [ "rotors: " _n int>str cat " rotors are needed for model " cat model cat raise:range ] when
  _names " " split 0 [ over model swap _check-rotor 1 + ] reduce drop
  rings _n "rings" util:letter-settings _rings!
  pos _n "positions" util:letter-settings _pos!
  plugs util:plugboard-table _P!
  refl _tables
  util:letter-table _LT! ;

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
