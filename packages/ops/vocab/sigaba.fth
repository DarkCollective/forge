\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sigaba: the SIGABA cipher machine (ECM Mark II, CSP-889, Converter M-134-C). Fifteen rotors in three
\ banks: 5 cipher rotors (26 contacts) that permute the letters, 5 control rotors (26 contacts) and
\ 5 index rotors (10 contacts) that decide which cipher rotors step after each letter. The machine
\ is not reciprocal, so one op takes a mode (encrypt or decrypt).
\
\ Sources (the architecture is from the published descriptions; the sources do not give a wiring
\ convention, so the rotor model below is this implementation's own, derived from the physical rotor):
\   M. Stamp and W. O. Chan, "SIGABA: Cryptanalysis of the Full Keyspace", Cryptologia 31(3), 2007,
\     pp. 201-222. Section 2: the rotor banks, the signals F G H I, the control-to-index grouping,
\     the index-to-cipher stepping, the odometer of the middle three control rotors (which turns over
\     when the faster rotor leaves the letter O), reversed rotors (letter steps O to N forward and O
\     to P reversed), signal direction (control rotors right to left, cipher rotors left to right when
\     encrypting, the inverse permutations when decrypting) and the Z / space rule.
\   H. Kwong, "Cryptanalysis of the SIGABA Cipher", San Jose State University MS thesis, 2008,
\     section 3.3 and 3.4: the same equations, and the names fast (C2), medium (C3), slow (C1).
\   J. Savard and R. Pekelney, "The ECM Mark II: Design, History and Cryptology", Cryptologia 23(3),
\     1999 (the reference for the machine; cited by the two above, not read for the wirings).
\   Crypto Museum, "SIGABA", cryptomuseum.com/crypto/usa/sigaba (physical description).
\ No CyberChef source, table or text was copied. One convention follows CyberChef's behaviour, for
\ compatibility: the index rotor offset +d for the digit d (see below); the sources do not fix it.
\
\ Per letter: (1) the letter goes through the cipher rotors, (2) F G H I go through the control rotors,
\ right to left (C4 first), (3) the control outputs A to Z are grouped onto index inputs
\   B:1 C:2 DE:3 FGH:4 IJK:5 LMNO:6 PQRST:7 UVWXYZ:8 A:9   (input 0 is never active)
\ (4) the active inputs go through the index bank (a fixed permutation of 0 to 9, as the index rotors
\ never step), (5) an active index output steps a cipher rotor: 0 or 9 the leftmost, 7 or 8 the second,
\ 5 or 6 the third, 3 or 4 the fourth, 1 or 2 the rightmost, so 1 to 4 cipher rotors step, (6) the
\ control rotors step: C2 every letter, C3 when C2 leaves O, C1 when C3 steps from O; C0 and C4 never
\ step. Order inside one letter (a choice, the sources do not fix it): encipher, then step the cipher
\ rotors with the stepping maze as it is, then step the control rotors.
\ Rotor model: wiring W maps contact m of face A to W[m] of face B; the window letter p is the
\ rotor's offset. Forward, left to right: c -> W[(c+p) mod 26] - p, and the letter steps p-1.
\ Reversed (the rotor turned over, which mirrors the contacts), left to right: c -> p - Winv[(p-c) mod 26]
\ and the letter steps p+1. Right to left uses the inverse of the same permutation. Index rotors
\ (10 contacts, never reversed here) use offset +d for the digit d, like the others: v -> W[(v+d) mod 10] - d.
\ This sign is the convention CyberChef uses, adopted for compatibility (the sources do not fix it).
\ The letter Z is enciphered as X and a space as Z; a deciphered Z is a space (so X and Z both come
\ back as X). Letters are case-insensitive; the output is upper case.
\
\ Wirings: the historical rotor wirings are not used (none is cited here). The defaults are
\ Forge's own, NOT historical and not secret: 10 large rotors and 5 index rotors made by one
\ xorshift32 stream (Marsaglia, x ^= x << 13; x ^= x >> 17; x ^= x << 5; seed 2463534242) driving a
\ Fisher-Yates shuffle (for i from n-1 down to 1, swap i with state mod (i+1)): rotors 0 to 9 of 26
\ letters, then index rotors 0 to 4 of 10 digits. Any other set can be given as a parameter.
\
\ Written in FL, except _run (src/prims/sigaba.ts), the per-letter machine loop: in FL it costs
\ several hundred VM steps a letter, over the 10 million step budget at 64 KiB.
IN: sigaba

\ ---- default wirings (Forge's own, see the header comment) ----

: _default-wirings ( -- str )
  "ELXDHPWCMTZKSAVNBUQORJYIGF PGNSLOEKRQVBDXUCTZFWIMJAHY EIMQKGZWUFDTRXYNSBLHPVAJOC CMFBKQRXTWJAPVZENLUHOIYSDG TZDVCLMHWUBRNSKEPYXAGIQOJF OTDSUXYLEZHPNBWJVRAIQMFGCK VYGUFJKOLPQBCTDNRXEZHWSIMA GFDCJQBPMKXUIYEVOZAHRWNSLT RSZOUXYDVEQJAMCKTBPNLGFIWH JAYFMSHDEBOTWKCIUPRXVGNZQL" ;

: _default-index-wirings ( -- str )
  "3574629108 7108596432 1365290487 5930867241 6703954281" ;

\ ---- checks ----

\ ids must use each of 0 to n-1 once; otherwise E_RANGE with msg.
: _check-ids ( ids:list n:int msg:str -- )
  ids n util:perm? not [ msg raise:range ] when ;

\ ---- reading the parameters ----

\ The tokens of a rotor list like "0 1R 2 3 4R": the digit of each, and 1 for a trailing R.
: _rotor-ids ( str -- list )
  util:number-tokens [ 0 1 slice str>int ] map ;

: _rotor-orient ( str -- bytes )
  util:number-tokens [ len 1 > [ 1 ] [ 0 ] if ] map list>bytes ;

\ The wirings of a list of words of letters or digits, each a permutation of n values; E_RANGE otherwise.
: _checked ( ws:list n:int msg:str -- list )
  ws [ n util:perm? not [ msg raise:range ] when ] each ws ;

\ The ten 26-letter wirings: the default when w is empty.
: _wiring-list ( w:str -- list )
  w len 0 = [ _default-wirings ] [ w ] if
  util:number-tokens [ util:letter-indices ] map
  dup len 10 <> [ "wirings must be ten words of 26 letters" raise:range ] when
  26 "each wiring must use the 26 letters once" _checked ;

\ The five 10-digit index wirings: the default when w is empty.
: _index-wiring-list ( w:str -- list )
  w len 0 = [ _default-index-wirings ] [ w ] if
  util:number-tokens [ util:digit-values ] map
  dup len 5 <> [ "index wirings must be five words of 10 digits" raise:range ] when
  10 "each index wiring must use the digits 0 to 9 once" _checked ;

\ The wirings of a bank in slot order, 26 bytes each.
: _bank-wiring ( ids:list ws:list -- bytes )
  ids [ ws swap nth ] map #[ ] bjoin ;

\ ---- the index bank ----

\ One index rotor with wiring w at digit d: a digit v goes to w[v+d] - d (offset +d, CyberChef's).
: _index-rotor ( v:int w:bytes d:int -- int )
  w v d + 10 mod nth 10 + d - 10 mod ;

\ Rotor j (left to right) of the bank for the digit v.
: _index-step ( v:int j:int ids:list iw:list pos:bytes -- int )
  v iw ids j nth nth pos j nth _index-rotor ;

\ The permutation of 0 to 9 the whole index bank makes.
: _index-bank ( ids:list iw:list pos:bytes -- bytes )
  0 10 range [ 0 5 range swap [ ids iw pos _index-step ] reduce ] map list>bytes ;

\ ---- letters in and out ----

\ The table entry of byte b: 0 to 25 for a letter (encrypting turns Z into X), a space is Z when
\ encrypting, 254 for white space that is skipped when decrypting and 255 for anything else.
: _in-code ( b:int decrypt:bool -- int )
  b 32 bor 97 122 util:between?
  [ b 32 bor 97 - dup 25 = decrypt not and [ drop 23 ] when ]
  [ b 32 = decrypt not and
    [ 25 ]
    [ decrypt b util:space? and [ 254 ] [ 255 ] if ]
    if ]
  if ;

: _in-table ( decrypt:bool -- bytes )
  0 256 range [ decrypt _in-code ] map list>bytes ;

\ The output letter of 0 to 25; a deciphered Z (25) is a space.
: _out-table ( decrypt:bool -- bytes )
  0 256 range [ dup 25 = decrypt and [ drop 32 ] [ 65 + 255 band ] if ] map list>bytes ;

\ The data as letters 0 to 25: other bytes are dropped, or E_COERCE when other is error.
: _letters-in ( data:bytes decrypt:bool other:str -- bytes )
  data decrypt _in-table translate
  dup [ 255 = ] filter len 0 > other "error" = and
  [ "a byte is neither a letter nor a space" raise:coerce ] when
  [ 254 < ] filter ;

\ ---- the machine ----

: _machine ( data:bytes decrypt:bool cr:str kr:str ir:str cp:str kp:str ip:str w:str iw:str other:str -- bytes )
  cr _rotor-ids kr _rotor-ids cat 10 "the cipher and control rotors must be the ten rotors 0 to 9, each once" _check-ids
  ir _rotor-ids 5 "the index rotors must be 0 to 4, each once" _check-ids
  data decrypt other _letters-in
  cr _rotor-ids w _wiring-list _bank-wiring
  kr _rotor-ids w _wiring-list _bank-wiring
  cr _rotor-orient kr _rotor-orient cat cp util:letter-indices cat kp util:letter-indices cat
  ir _rotor-ids iw _index-wiring-list ip util:digit-values _index-bank
  decrypt _run
  decrypt _out-table translate ;

: crypt ( bytes mode:choice{encrypt|decrypt}=encrypt cipher-rotors:str[/[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?/]="0 1 2 3 4" control-rotors:str[/[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?\s[0-9][Rr]?/]="5 6 7 8 9" index-rotors:str[/[0-9]\s[0-9]\s[0-9]\s[0-9]\s[0-9]/]="0 1 2 3 4" cipher-positions:str[5,/[A-Za-z]*/]="OOOOO" control-positions:str[5,/[A-Za-z]*/]="OOOOO" index-positions:str[5,/[0-9]*/]="00000" wirings:str="" index-wirings:str="" other:choice{drop|error}=drop -- bytes )
  "SIGABA (ECM Mark II). Encrypt or decrypt letters (case-insensitive, output upper case): a space is enciphered as Z and Z as X, and a deciphered Z is a space. Rotors are the digits 0 to 9 for the cipher and control banks (ten rotors, each once, either bank; a trailing R inserts one reversed) and 0 to 4 for the index bank; positions are the window letters (cipher and control) and digits (index). The defaults are the zeroized machine (all O, index 0) with Forge's own wirings, which are not the historical ones: give wirings (ten words of 26 letters) and index-wirings (five of 10 digits) for your own. Bytes that are not letters or spaces are dropped, or E_COERCE with other = error." doc
  "Cipher machines" category
  mode "decrypt" = cipher-rotors control-rotors index-rotors cipher-positions control-positions index-positions wirings index-wirings other _machine ;

META: crypt
  use-when "You have a SIGABA (ECM Mark II) message and its cipher, control and index rotor banks, and you want to encipher or decipher it. It is a historical study cipher." ;
  param mode "encrypt, or decrypt (the machine is not reciprocal: decryption runs the cipher rotors backwards)." ;
  param cipher-rotors "Five rotors 0 to 9, left to right, e.g. 0 1R 2 3 4R (R: inserted reversed). Together with control-rotors they use 0 to 9 once each." ;
  param control-rotors "Five rotors 0 to 9, left to right, e.g. 5 6 7R 8 9. Only the middle three step: C2 fast, C3 medium, C1 slow; the end rotors never step." ;
  param index-rotors "The index rotors 0 to 4 in left to right order, each once, e.g. 0 1 2 3 4." ;
  param cipher-positions "Window letters of the five cipher rotors, left to right (O is zeroized). A forward rotor steps O to N, a reversed one O to P." ;
  param control-positions "Window letters of the five control rotors, left to right (O is zeroized)." ;
  param index-positions "Digits 0 to 9 of the five index rotors, left to right (0 is zeroized). The index rotors never step. A rotor at digit d is offset by +d, as in CyberChef." ;
  param wirings "Ten rotor wirings of 26 letters each, separated by spaces: rotor k maps contact A to the first letter, B to the second, and so on. Empty: Forge's default set (not historical)." ;
  param index-wirings "Five index wirings of 10 digits each, separated by spaces: contact 0 maps to the first digit. Empty: Forge's default set (not historical)." ;
  param other "drop: ignore bytes that are not letters or spaces. error: raise E_COERCE. Decrypting always skips white space." ;
  see-also classical:vigenere-encrypt ;
  link "https://en.wikipedia.org/wiki/SIGABA" "SIGABA on Wikipedia" ;
;
