\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ classical: classical ciphers. They work on bytes and touch ASCII letters only.
IN: classical

: _rot-code ( code:int amount:int -- int )
  code 65 90 util:between?
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 122 util:between?
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  use-when "You have a text that looks like scrambled letters, such as a spoiler or a puzzle, and want to try a fixed shift of its letters. ROT13 is the default shift." ;
  link "https://en.wikipedia.org/wiki/ROT13" "ROT13 on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/Caesar_cipher" "Caesar cipher on Wikipedia" ;
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;

\ ---------------------------------------------------------------------------------------------
\ Shared helpers (private)
\ ---------------------------------------------------------------------------------------------

: _is-letter ( code:int -- bool )
  code 32 bor 97 >= code 32 bor 122 <= and ;

\ ---------------------------------------------------------------------------------------------
\ rot47, atbash
\ ---------------------------------------------------------------------------------------------

: _rot47-code ( code:int amount:int -- int )
  code 33 126 util:between? [ code 33 - amount + 94 mod 33 + ] [ code ] if ;

: rot47 ( bytes -- bytes )
  "Rotate the printable ASCII bytes 33 ('!') to 126 ('~') by 47 places; all other bytes pass through. Applying it twice gives the original." doc
  "Classical ciphers" category
  [ 47 _rot47-code ] map ;

META: rot47
  use-when "You have printable text that looks like a row of symbols and may be ROT47 scrambled, as in a puzzle, and want it read. Applying it twice gives the text back." ;
  see-also classical:rot ;
;

\ Not morse:_upper-cp: this reflects a letter within its case, it does not change the case.
: _atbash-code ( code:int -- int )
  code 65 90 util:between?
  [ 155 code - ]
  [ code 97 122 util:between?
    [ 219 code - ]
    [ code ]
    if ]
  if ;

: atbash ( bytes -- bytes )
  "Reverse the ASCII alphabet (A becomes Z, B becomes Y, and so on), keeping case; other bytes pass through. It is its own inverse." doc
  "Classical ciphers" category
  [ _atbash-code ] map ;

META: atbash
  use-when "You have a puzzle text whose alphabet runs backwards, with A written for Z and B for Y, and want it read. Applying it twice gives the text back." ;
  link "https://en.wikipedia.org/wiki/Atbash" "Atbash on Wikipedia" ;
  see-also classical:rot classical:substitute ;
;

\ ---------------------------------------------------------------------------------------------
\ Affine
\ ---------------------------------------------------------------------------------------------

: _affine-code ( code:int a:int b:int -- int )
  code 65 90 util:between?
  [ code 65 - a * b + 26 mod 65 + ]
  [ code 97 122 util:between?
    [ code 97 - a * b + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: _affine ( data:bytes a:int b:int -- bytes )
  data [ a b _affine-code ] map ;

: affine-encrypt ( bytes a:int[1|3|5|7|9|11|15|17|19|21|23|25]=5 b:int[0..25]=8 -- bytes )
  "Affine cipher: each ASCII letter with alphabet position x (A = 0) becomes (a*x + b) mod 26. Case is kept; other bytes pass through. a must be coprime to 26." doc
  "Classical ciphers" category
  a b _affine ;

META: affine-encrypt
  use-when "You have a puzzle message and the multiplier a and shift b of an affine cipher, and want it enciphered for a CTF challenge or a lesson." ;
  inverse affine-decrypt ;
  link "https://en.wikipedia.org/wiki/Affine_cipher" "Affine cipher on Wikipedia" ;
  param a "Multiplier; must be coprime to 26 (1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23 or 25)." ;
  param b "Shift, 0 to 25." ;
  see-also classical:affine-decrypt classical:rot ;
;

: affine-decrypt ( bytes a:int[1|3|5|7|9|11|15|17|19|21|23|25]=5 b:int[0..25]=8 -- bytes )
  "Undo the affine cipher: each ASCII letter y becomes a^-1 * (y - b) mod 26. Case is kept; other bytes pass through." doc
  "Classical ciphers" category
  a 26 invmod dup b * neg _affine ;

META: affine-decrypt
  use-when "You have affine ciphertext and the multiplier a and shift b that made it, and want the plaintext back, as in a puzzle or a lesson." ;
  inverse affine-encrypt ;
  link "https://en.wikipedia.org/wiki/Affine_cipher" "Affine cipher on Wikipedia" ;
  param a "Multiplier used to encrypt; must be coprime to 26." ;
  param b "Shift used to encrypt, 0 to 25." ;
  see-also classical:affine-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Vigenere
\ ---------------------------------------------------------------------------------------------

0 VARIABLE _vpos

: _vigenere ( data:bytes kb:bytes sign:int -- bytes )
  0 _vpos!
  data
  [ dup _is-letter
    [ _vpos kb len mod kb swap nth 31 band 1 - sign * _rot-code
      _vpos 1 + _vpos! ]
    when ]
  map ;

: vigenere-encrypt ( bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Vigenere cipher: each ASCII letter is shifted by the matching letter of the key (A = 0). The key is case-insensitive and repeats; case of the data is kept. Other bytes pass through and do not use up a key letter." doc
  "Classical ciphers" category
  key str>bytes 1 _vigenere ;

META: vigenere-encrypt
  use-when "You have a message and a keyword and want it enciphered with the Vigenere cipher, for a puzzle or a CTF challenge. The keyword repeats over the letters." ;
  inverse vigenere-decrypt ;
  link "https://en.wikipedia.org/wiki/Vigen%C3%A8re_cipher" "Vigenere cipher on Wikipedia" ;
  param key "Key letters A to Z (either case), 1 to 256 of them." ;
  see-also classical:vigenere-decrypt classical:rot ;
;

: vigenere-decrypt ( bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Undo the Vigenere cipher with the same key. Key letters are case-insensitive; non-letters pass through and do not use up a key letter." doc
  "Classical ciphers" category
  key str>bytes -1 _vigenere ;

META: vigenere-decrypt
  use-when "You have Vigenere ciphertext and its keyword, as in a puzzle or a lesson, and want the plaintext back. The keyword is case-insensitive." ;
  inverse vigenere-encrypt ;
  link "https://en.wikipedia.org/wiki/Vigen%C3%A8re_cipher" "Vigenere cipher on Wikipedia" ;
  param key "Key letters A to Z (either case), 1 to 256 of them." ;
  see-also classical:vigenere-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Bacon
\ ---------------------------------------------------------------------------------------------

: _bits5 ( n:int -- str )
  { n 4 shr 1 band 65 + n 3 shr 1 band 65 + n 2 shr 1 band 65 + n 1 shr 1 band 65 + n 1 band 65 + }
  list>bytes bytes>str ;

: _bacon-index ( l:int classic:bool -- int )
  classic
  [ l l 9 >= [ 1 ] [ 0 ] if - l 21 >= [ 1 ] [ 0 ] if - ]
  [ l ]
  if ;

: _bacon-encode ( s:str classic:bool -- str )
  s str>bytes [ _is-letter ] filter bytes>list
  [ 223 band 65 - classic _bacon-index _bits5 ] map
  " " join ;

: bacon-encode ( str alphabet:choice{classic|complete}=classic -- str )
  "Bacon's cipher: each letter A to Z (either case) becomes five symbols A/B, its 5-bit position written with A = 0 and B = 1; groups are separated by single spaces. Other characters are dropped. classic uses the 24-letter alphabet (I and J share a code, U and V share a code); complete gives all 26 letters their own code." doc
  "Classical ciphers" category
  alphabet "classic" = _bacon-encode ;

META: bacon-encode
  use-when "You want to write a message as groups of five A and B symbols, one group for each letter, as in a puzzle or an old hiding method." ;
  inverse bacon-decode ;
  link "https://en.wikipedia.org/wiki/Bacon's_cipher" "Bacon's cipher on Wikipedia" ;
  param alphabet "classic: 24 letters (I=J, U=V). complete: 26 letters." ;
  see-also classical:bacon-decode ;
;

: _bacon-lookup ( t:bytes table:bytes -- str )
  0 t len 5 div range
  [ 5 * dup 5 + t -rot slice
    0 [ 98 = [ 1 ] [ 0 ] if swap 2 * + ] reduce
    dup table len >=
    [ "bacon-decode: a group does not code a letter of this alphabet" raise:coerce ] when
    table swap nth ]
  map
  list>bytes bytes>str ;

: _bacon-groups ( t:bytes classic:bool -- str )
  t [ dup 97 = swap 98 = or ] filter len t len <>
  [ "bacon-decode: only the symbols A and B (any case) and white space are allowed" raise:coerce ] when
  t len 5 mod 0 <>
  [ "bacon-decode: the number of A/B symbols must be a multiple of five" raise:coerce ] when
  t
  classic
  [ "ABCDEFGHIKLMNOPQRSTUWXYZ" ]
  [ "ABCDEFGHIJKLMNOPQRSTUVWXYZ" ]
  if str>bytes
  _bacon-lookup ;

: bacon-decode ( str alphabet:choice{classic|complete}=classic -- str )
  "Decode Bacon's cipher: read the A/B symbols (any case, white space ignored) in groups of five and give upper-case letters. With classic, I/J decode as I and U/V as U. Other symbols, a symbol count that is not a multiple of five, or a group outside the alphabet are errors (E_COERCE)." doc
  "Classical ciphers" category
  str>bytes [ util:space? not ] filter [ 32 bor ] map
  alphabet "classic" = _bacon-groups ;

META: bacon-decode
  use-when "You have a text of A and B symbols in groups of five, as Bacon's cipher writes letters, and want the message that it hides." ;
  inverse bacon-encode ;
  link "https://en.wikipedia.org/wiki/Bacon's_cipher" "Bacon's cipher on Wikipedia" ;
  param alphabet "classic: 24 letters (I=J, U=V). complete: 26 letters." ;
  see-also classical:bacon-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ Bifid
\ ---------------------------------------------------------------------------------------------

: _bifid-letters ( data:bytes -- bytes )
  data [ _is-letter ] filter [ util:upper-merge-i ] map ;

: _add-unique ( acc:bytes c:int -- bytes )
  acc [ c = ] filter len 0 >
  [ acc ]
  [ acc { c } list>bytes cat ]
  if ;

\ The 25 letters of the square in reading order: the key first, then the rest of the alphabet.
: _bifid-grid ( key:str -- bytes )
  key str>bytes [ util:upper-merge-i ] map
  "ABCDEFGHIKLMNOPQRSTUVWXYZ" str>bytes cat
  #[ ] [ _add-unique ] reduce ;

: _bifid-idx ( v:int grid:bytes -- int )
  0 25 range 0 [ dup grid swap nth v = [ + ] [ drop ] if ] reduce ;

\ A 256-byte table for translate: letter byte -> its position 0..24 in the square.
: _bifid-table ( grid:bytes -- bytes )
  0 256 range [ grid _bifid-idx ] map list>bytes ;

: _bifid-pairs ( seq:bytes grid:bytes -- bytes )
  0 seq len 2 div range
  [ 2 * dup seq swap nth 5 * swap 1 + seq swap nth + grid swap nth ]
  map list>bytes ;

: _bifid-unpair ( seq:bytes grid:bytes -- bytes )
  0 seq len 2 div range
  [ dup seq swap nth 5 * swap seq len 2 div + seq swap nth + grid swap nth ]
  map list>bytes ;

: _bifid-enc ( idx:bytes grid:bytes -- bytes )
  idx [ 5 div ] map idx [ 5 mod ] map cat grid _bifid-pairs ;

: _bifid-dec ( idx:bytes grid:bytes -- bytes )
  0 idx len 2 * range
  [ dup 2 div idx swap nth swap 2 mod 0 = [ 5 div ] [ 5 mod ] if ]
  map list>bytes
  grid _bifid-unpair ;

: bifid-encrypt ( bytes key:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Bifid cipher on a 5x5 Polybius square built from the key and then the rest of the alphabet (J is merged into I). Only the letters of the data are used, taken as upper case (J as I); every other byte is dropped, so the output is upper-case letters only. The whole message is one block (no period)." doc
  "Classical ciphers" category
  _bifid-letters key _bifid-grid dup _bifid-table
  core:rot swap translate swap _bifid-enc ;

META: bifid-encrypt
  use-when "You have a message and a keyword and want Bifid ciphertext, made with a 5 by 5 square, for a puzzle or a CTF challenge. The output is capital letters only." ;
  inverse bifid-decrypt ;
  link "https://en.wikipedia.org/wiki/Bifid_cipher" "Bifid cipher on Wikipedia" ;
  param key "Keyword of letters (J counts as I); empty for the plain alphabet square." ;
  see-also classical:bifid-decrypt ;
;

: bifid-decrypt ( bytes key:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Undo the bifid cipher with the same key. Only the letters of the data are used, taken as upper case (J as I); every other byte is dropped, so the output is upper-case letters only." doc
  "Classical ciphers" category
  _bifid-letters key _bifid-grid dup _bifid-table
  core:rot swap translate swap _bifid-dec ;

META: bifid-decrypt
  use-when "You have Bifid ciphertext from a puzzle and its keyword, and want the message back in capital letters. Spaces and punctuation are not restored." ;
  inverse bifid-encrypt ;
  link "https://en.wikipedia.org/wiki/Bifid_cipher" "Bifid cipher on Wikipedia" ;
  param key "Keyword used to encrypt (J counts as I); empty for the plain alphabet square." ;
  see-also classical:bifid-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Rail fence
\ ---------------------------------------------------------------------------------------------
\ With n rails the zigzag has period p = 2(n-1). Byte i sits on the rail of (i + offset) mod p
\ (k when k < n, else p - k). The cipher text is rail 0, then rail 1, ... each in byte order.

\ How many of the first len bytes have (i + off) mod p equal to c.
: _rf-count ( c:int total:int off:int p:int -- int )
  c off - p mod
  dup total <
  [ total 1 - swap - p div 1 + ]
  [ drop 0 ]
  if ;

\ How many of the first len bytes lie on rail r.
: _rf-size ( r:int total:int off:int n:int -- int )
  r total off n 1 - 2 * _rf-count
  r 0 > r n 1 - < and
  [ n 1 - 2 * r - total off n 1 - 2 * _rf-count + ]
  when ;

: _rf-rail ( i:int off:int n:int -- int )
  i off + n 1 - 2 * mod
  dup n >= [ n 1 - 2 * swap - ] when ;

\ The m-th byte index on a rail whose zigzag residues are d1 and d2 (equal on the outer rails).
: _rf-pos ( m:int d1:int d2:int p:int -- int )
  d1 d2 =
  [ d1 m p * + ]
  [ m 2 mod 0 = [ d1 d2 min ] [ d1 d2 max ] if m 2 div p * + ]
  if ;

: _rf-collect ( data:bytes d1:int d2:int p:int size:int -- bytes )
  0 size range [ d1 d2 p _rf-pos data swap nth ] map list>bytes ;

: _rf-piece ( r:int data:bytes off:int n:int -- bytes )
  data
  r off - n 1 - 2 * mod
  n 1 - 2 * r - off - n 1 - 2 * mod
  n 1 - 2 *
  r data len off n _rf-size
  _rf-collect ;

: _rf-encrypt ( data:bytes rails:int off:int -- bytes )
  0 rails range [ data off rails _rf-piece ] map
  #[ ] bjoin ;

\ Start index of every rail in the cipher text (rails + 1 entries).
: _rf-starts ( data:bytes rails:int off:int -- list )
  0 rails range [ data len off rails _rf-size ] map
  { 0 } [ over dup len 1 - nth + append ] reduce ;

: _rf-gather ( data:bytes starts:list off:int rails:int -- bytes )
  0 data len range
  [ dup off rails _rf-rail
    dup starts swap nth
    -rot swap off rails _rf-size
    + data swap nth ]
  map list>bytes ;

: _rf-decrypt ( data:bytes rails:int off:int -- bytes )
  data data rails off _rf-starts off rails _rf-gather ;

: rail-fence-encrypt ( bytes rails:int[2..1000]=3 offset:int[0..1000]=0 -- bytes )
  "Rail fence (zigzag) transposition over all bytes: write the bytes diagonally down and up across the rails, then read the rails one after another. offset starts the zigzag that many steps along." doc
  "Classical ciphers" category
  rails offset _rf-encrypt ;

META: rail-fence-encrypt
  use-when "You have a message and a number of rails, and want it scrambled in a zigzag across the rails, as in a puzzle or a school cipher lesson." ;
  inverse rail-fence-decrypt ;
  link "https://en.wikipedia.org/wiki/Rail_fence_cipher" "Rail fence cipher on Wikipedia" ;
  param rails "Number of rails, 2 to 1000." ;
  param offset "Steps into the zigzag at which the first byte sits." ;
  see-also classical:rail-fence-decrypt ;
;

: rail-fence-decrypt ( bytes rails:int[2..1000]=3 offset:int[0..1000]=0 -- bytes )
  "Undo the rail fence transposition (same rails and offset as for encryption)." doc
  "Classical ciphers" category
  rails offset _rf-decrypt ;

META: rail-fence-decrypt
  use-when "You have rail fence ciphertext, with the number of rails and offset that made it, and want the plaintext back, as in a puzzle or a lesson." ;
  inverse rail-fence-encrypt ;
  link "https://en.wikipedia.org/wiki/Rail_fence_cipher" "Rail fence cipher on Wikipedia" ;
  param rails "Number of rails, 2 to 1000." ;
  param offset "Steps into the zigzag at which the first byte sits." ;
  see-also classical:rail-fence-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ A1Z26
\ ---------------------------------------------------------------------------------------------

: a1z26-encode ( str delimiter:choice{space|comma|dash}=space -- str )
  "Replace each letter A to Z (either case) by its position 1 to 26, joined by the delimiter (space, comma or dash). Every other character is dropped." doc
  "Classical ciphers" category
  str>bytes [ _is-letter ] filter bytes>list
  [ 223 band 64 - int>str ] map
  delimiter "space" = [ " " ] [ delimiter "comma" = [ "," ] [ "-" ] if ] if
  join ;

META: a1z26-encode
  use-when "You have plain letters, such as a word in a puzzle, and want each one written as its place in the alphabet, from 1 for A to 26 for Z." ;
  inverse a1z26-decode ;
  param delimiter "Put this between the numbers: space, comma or dash." ;
  see-also classical:a1z26-decode ;
;

: a1z26-decode ( str -- str )
  "Replace each number 1 to 26 by the matching upper-case letter. Any run of characters that are not digits separates numbers (spaces, commas, dashes, newlines). A number outside 1 to 26 is an error (E_COERCE)." doc
  "Classical ciphers" category
  str>bytes [ dup 48 >= over 57 <= and not [ drop 32 ] when ] map bytes>str
  " " split [ len 0 > ] filter
  [ str>int dup 1 < over 26 > or
    [ "a1z26-decode: numbers must be between 1 and 26" raise:coerce ] when
    64 + ]
  map list>bytes bytes>str ;

META: a1z26-decode
  use-when "You have numbers from 1 to 26, separated by spaces, commas or dashes, and want the letters they stand for, as in an alphabet puzzle." ;
  inverse a1z26-encode ;
  see-also classical:a1z26-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ Substitution
\ ---------------------------------------------------------------------------------------------

: _printable ( code:int -- bool )
  code 32 126 util:between? ;

: _sub-byte ( v:int pb:bytes cb:bytes -- int )
  0 pb len range v
  [ dup pb swap nth v = [ cb swap nth nip ] [ drop ] if ]
  reduce ;

: _sub-table ( pb:bytes cb:bytes -- bytes )
  0 256 range [ pb cb _sub-byte ] map list>bytes ;

: _substitute ( data:bytes pb:bytes cb:bytes -- bytes )
  pb [ _printable ] filter len pb len <>
  cb [ _printable ] filter len cb len <> or
  [ "substitute: plaintext and ciphertext must be printable ASCII" raise:range ] when
  pb len cb len <>
  [ "substitute: plaintext and ciphertext must have the same length" raise:range ] when
  data pb cb _sub-table translate ;

: substitute ( bytes plaintext:charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ" ciphertext:charset="ZYXWVUTSRQPONMLKJIHGFEDCBA" -- bytes )
  "Monoalphabetic substitution: every byte equal to the n-th character of plaintext is replaced by the n-th character of ciphertext (case-sensitive); other bytes pass through. Both must be printable ASCII and of equal length, else it fails (E_RANGE). A repeated character in either is rejected as an invalid charset." doc
  "Classical ciphers" category
  plaintext str>bytes ciphertext str>bytes _substitute ;

META: substitute
  use-when "You know the two alphabets of a substitution puzzle, with each letter swapped for another, and want the swaps made throughout a text." ;
  link "https://en.wikipedia.org/wiki/Substitution_cipher" "Substitution cipher on Wikipedia" ;
  param plaintext "The characters to replace (printable ASCII, none repeated)." ;
  param ciphertext "Their replacements, in the same order and of the same length." ;
  see-also classical:atbash classical:rot ;
;

\ ---------------------------------------------------------------------------------------------
\ Brute force for rot and rot47
\ ---------------------------------------------------------------------------------------------

\ Printable ASCII, plus tab, line feed and carriage return.
\ Not url:_unreserved?: a different set of bytes (printable text, with tab, line feed and carriage return).
: _text-printable? ( code:int -- bool )
  code 32 126 util:between? code 9 = or code 10 = or code 13 = or ;

\ A 256-byte table for translate that applies rot (or rot47) with the shift to every byte.
: _rot-table ( shift:int v47:bool -- bytes )
  0 256 range
  v47 [ [ shift _rot47-code ] map ] [ [ shift _rot-code ] map ] if
  list>bytes ;

: _brute-record ( shift:int out:bytes -- record )
  { { "shift" shift } { "output" out } } >record ;

: _rot-brute ( d:bytes v47:bool crib:str -- list )
  1 v47 [ 94 ] [ 26 ] if range
  [ dup d swap v47 _rot-table translate _brute-record ] map
  [ "output" get crib str>bytes util:contains-bytes? ] filter ;

: rot-brute ( data:bytes variant:choice{rot|rot47}=rot crib:str="" printable-only:bool=false -- list )
  "Try every shift of rot (shifts 1 to 25) or of rot47 (shifts 1 to 93) and list the candidates as records with shift (int) and output (bytes), in order of shift. With a crib, keep only candidates whose output contains the crib's UTF-8 bytes. With printable-only, first drop every byte that is not printable ASCII (32 to 126, tab, line feed, carriage return): rot and rot47 pass such bytes through unchanged, so every shift would otherwise carry them." doc
  "Classical ciphers" category
  printable-only [ data [ _text-printable? ] filter ] [ data ] if
  variant "rot47" = crib _rot-brute ;

META: rot-brute
  use-when "You have a text in a shifted alphabet and do not know the shift, so you want every candidate. Pick the line that reads as English, or give a crib." ;
  param variant "rot: letters (shifts 1 to 25). rot47: printable ASCII (shifts 1 to 93)." ;
  param crib "Text expected in the output (matched as UTF-8 bytes). Empty keeps every candidate." ;
  param printable-only "Drop bytes that are not printable ASCII (tab, line feed and carriage return are kept) before shifting." ;
  see-also classical:rot classical:rot47 bits:xor-brute ;
;

\ ---------------------------------------------------------------------------------------------
\ ROT8000
\ ---------------------------------------------------------------------------------------------
\ The valid characters are the BMP code points in nine ranges (the C0 and C1 controls, space and
\ the no-break and other Unicode white space, surrogates and the private use area are left
\ out): 33-126, 161-5759, 5761-8191, 8203-8231, 8234-8238, 8240-8286, 8288-12287, 12289-55295
\ and 57344-65535. They number 63404; a character moves 31702 places along that list, which
\ wraps around, so the cipher is its own inverse. Code points outside the BMP pass through.

\ The position of a code point in the list of valid characters, or -1 when it is not one.
: _r8-index ( cp:int -- int )
  cp 33 126 util:between? [ cp 33 - ]
  [ cp 12289 55295 util:between? [ cp 12289 - 12205 + ]
    [ cp 161 5759 util:between? [ cp 161 - 94 + ]
      [ cp 5761 8191 util:between? [ cp 5761 - 5693 + ]
        [ cp 8288 12287 util:between? [ cp 8288 - 8205 + ]
          [ cp 57344 65535 util:between? [ cp 57344 - 55212 + ]
            [ cp 8203 8231 util:between? [ cp 8203 - 8124 + ]
              [ cp 8234 8238 util:between? [ cp 8234 - 8153 + ]
                [ cp 8240 8286 util:between? [ cp 8240 - 8158 + ] [ -1 ] if ]
                if ]
              if ]
            if ]
          if ]
        if ]
      if ]
    if ]
  if ;

\ The code point at a position of the list of valid characters.
: _r8-cp ( j:int -- int )
  j 12205 <
  [ j 94 < [ j 33 + ]
    [ j 5693 < [ j 94 - 161 + ]
      [ j 8124 < [ j 5693 - 5761 + ]
        [ j 8153 < [ j 8124 - 8203 + ]
          [ j 8158 < [ j 8153 - 8234 + ]
            [ j 8205 < [ j 8158 - 8240 + ] [ j 8205 - 8288 + ] if ]
            if ]
          if ]
        if ]
      if ]
    if ]
  [ j 55212 < [ j 12205 - 12289 + ] [ j 55212 - 57344 + ] if ]
  if ;

: _r8-char ( cp:int -- int )
  cp _r8-index
  dup 0 < [ drop cp ] [ 31702 + 63404 mod _r8-cp ] if ;

: rot8000 ( str -- str )
  "ROT8000: rotate every character of the Basic Multilingual Plane (as published at rot8000.com) half way round the list of its 63,404 valid characters. Control characters, white space of every kind, surrogates and the private use area are not valid and pass through, as does everything outside the BMP, so spaces and line breaks survive and the text stays text. It is its own inverse." doc
  "Classical ciphers" category
  str>codes [ _r8-char ] map codes>str ;

META: rot8000
  use-when "You want to turn text into a row of rare CJK characters for a puzzle or a joke, or read such a row. Applying it twice gives the text back." ;
  see-also classical:rot classical:rot47 ;
;

\ ---------------------------------------------------------------------------------------------
\ Caesar box
\ ---------------------------------------------------------------------------------------------
\ The n bytes are written along the rows of a box of height rows and w = ceil(n / height) columns
\ (the last row may be short) and read down the columns. Short columns are not padded, so the
\ cipher text has as many bytes as the plain text and the box can be undone without a marker.
\ Column c holds the bytes c, c + w, c + 2w, ...

: _cb-col ( data:bytes c:int w:int -- bytes )
  0 data len c - w + 1 - w div range [ w * c + data swap nth ] map list>bytes ;

\ Not base32:_ungroups: both map a helper over an index range and join, but over different per-group words, so there is no shared body.
: _cb-enc ( data:bytes w:int -- bytes )
  0 w range [ data swap w _cb-col ] map #[ ] bjoin ;

: _cb-encrypt ( data:bytes height:int -- bytes )
  data data len height util:ceil-div _cb-enc ;

\ rho is the number of rows that hold bytes and last the length of the last of them.
: _cb-shape ( n:int w:int -- rho:int last:int )
  n w + 1 - w div dup 1 - w * n swap - ;

\ Column cc starts at cc * (rho - 1) + min(cc, last) in the cipher text.
: _cb-unpack ( data:bytes w:int rho:int last:int -- bytes )
  0 data len range
  [ dup w div swap w mod
    dup rho 1 - * swap last min + +
    data swap nth ]
  map list>bytes ;

: _cb-dec ( data:bytes w:int -- bytes )
  data w data len w _cb-shape _cb-unpack ;

: _cb-decrypt ( data:bytes height:int -- bytes )
  data len 0 =
  [ data ]
  [ data data len height util:ceil-div _cb-dec ]
  if ;

: caesar-box-encrypt ( bytes height:int[1..65536]=2 -- bytes )
  "Caesar box (columnar transposition): write the bytes along the rows of a box of the given height, with as many columns as needed, and read the columns from top to bottom, left to right. The last row may be short; short columns are not padded. A height of 1 changes nothing." doc
  "Classical ciphers" category
  height _cb-encrypt ;

META: caesar-box-encrypt
  use-when "You have a message and a box height, and want it scrambled as a Caesar box, a column transposition written in rows and read in columns, for a puzzle." ;
  inverse caesar-box-decrypt ;
  link "https://en.wikipedia.org/wiki/Transposition_cipher" "Transposition cipher on Wikipedia" ;
  param height "Number of rows of the box, 1 to 65536." ;
  see-also classical:caesar-box-decrypt classical:rail-fence-encrypt ;
;

: caesar-box-decrypt ( bytes height:int[1..65536]=2 -- bytes )
  "Undo the Caesar box with the same height: the bytes are read down the columns of the box and written back along its rows." doc
  "Classical ciphers" category
  height _cb-decrypt ;

META: caesar-box-decrypt
  use-when "You have text written in a Caesar box and know its height, and want the original order of its letters back, as in a puzzle." ;
  inverse caesar-box-encrypt ;
  link "https://en.wikipedia.org/wiki/Transposition_cipher" "Transposition cipher on Wikipedia" ;
  param height "Number of rows of the box used to encrypt, 1 to 65536." ;
  see-also classical:caesar-box-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ UTF-16 helpers (private). Both ciphers below work on the 16-bit code units of the text.
\ ---------------------------------------------------------------------------------------------

: _be-unit ( u:int -- bytes )
  { u 8 shr u 255 band } list>bytes ;

\ A code point as the big-endian bytes of one or two UTF-16 code units.
: _cp>be ( cp:int -- bytes )
  cp 65535 >
  [ cp 65536 - 10 shr 55296 + _be-unit cp 65536 - 1023 band 56320 + _be-unit cat ]
  [ cp _be-unit ]
  if ;

: _text>be ( s:str -- bytes )
  s str>codes [ _cp>be ] map #[ ] bjoin ;

\ Swap the two bytes of every pair: big-endian becomes little-endian and the other way round.
: _swap16 ( b:bytes -- bytes )
  0 b len range [ 1 bxor b swap nth ] map list>bytes ;

: _lone ( -- )
  "a lone UTF-16 surrogate cannot be decoded" raise:coerce ;

\ The code point that starts at unit i: -1 for the low half of a pair.
: _unit>cp ( units:list i:int -- int )
  units i nth
  dup 55296 56319 util:between?
  [ i 1 + units len <
    [ units i 1 + nth ] [ _lone 0 ] if
    dup 56320 57343 util:between? not [ _lone ] when
    56320 - swap 55296 - 10 shl + 65536 + ]
  [ dup 56320 57343 util:between?
    [ drop i 0 > [ units i 1 - nth 55296 56319 util:between? not ] [ true ] if
      [ _lone ] when -1 ]
    when ]
  if ;

\ Code units as text. Without surrogates the units are the code points.
: _units>str ( units:list -- str )
  units [ 55296 57343 util:between? ] filter len 0 =
  [ units codes>str ]
  [ units [ nip units swap _unit>cp ] mapi [ -1 <> ] filter codes>str ]
  if ;

\ UTF-16 bytes (an even number of them), little-endian or big-endian, as text.
: _utf16>str ( b:bytes le:bool -- str )
  0 b len 2 div range
  [ 2 * dup b swap nth swap 1 + b swap nth le [ swap ] when swap 8 shl bor ] map
  _units>str ;

\ ---------------------------------------------------------------------------------------------
\ Cetacean cipher
\ ---------------------------------------------------------------------------------------------
\ Each UTF-16 code unit of the text becomes 16 symbols, most significant bit first: E for a 0 bit
\ and e for a 1 bit. Everything else is white space or an error when decoding.

: _cet-bits ( b:int -- str )
  0 8 range [ 7 swap - b swap shr 1 band 5 shl 69 + ] map list>bytes bytes>str ;

: _cet-encode ( be:bytes table:list -- str )
  be bytes>list [ table swap nth ] map "" join ;

: cetacean-encode ( str -- str )
  "Cetacean cipher: write each UTF-16 code unit of the text as 16 symbols, most significant bit first, E for 0 and e for 1. The output has no separators." doc
  "Classical ciphers" category
  _text>be 0 256 range [ _cet-bits ] map _cet-encode ;

META: cetacean-encode
  use-when "You want text written as a row of E and e symbols, for a puzzle or a CTF challenge, with each UTF-16 code unit written as sixteen symbols." ;
  inverse cetacean-decode ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  see-also classical:cetacean-decode ;
;

\ The 0 and 1 characters of a chunk of bits as hex digits.
: _cet-chunk ( s:str -- str )
  s 2 str>int-radix s len 4 div util:pad-hex ;

\ Text of 0 and 1 characters as hex, 4096 bits at a time.
: _cet-hex ( s:str -- str )
  s 4096 util:str-chunks [ _cet-chunk ] map "" join ;

\ The bits (a byte each, 0 or 1) as big-endian bytes; their number must be a multiple of 16.
: _cet-pack ( bits:bytes -- bytes )
  bits len 16 mod 0 <>
  [ "cetacean-decode: the number of E and e symbols must be a multiple of 16" raise:coerce ] when
  bits 0 256 range [ 48 + 255 band ] map list>bytes translate bytes>latin1
  _cet-hex hex>bytes ;

: cetacean-decode ( str -- str )
  "Undo the Cetacean cipher: read the symbols E (0) and e (1) in groups of 16 as UTF-16 code units. White space is ignored; any other character, a symbol count that is not a multiple of 16, or a lone surrogate is an error (E_COERCE)." doc
  "Classical ciphers" category
  str>bytes "Ee" 254 255 util:decode-table util:check-symbols
  254 util:drop-byte
  _cet-pack false _utf16>str ;

META: cetacean-decode
  use-when "You have a long run of E and e symbols, sixteen for each character, and want the text they stand for, as in a puzzle." ;
  inverse cetacean-encode ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  see-also classical:cetacean-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ Citrix CTX1
\ ---------------------------------------------------------------------------------------------
\ The text is taken as UTF-16 little-endian bytes p0, p1, ... Each byte is chained to the previous
\ cipher byte: c(i) = p(i) xor 0xA5 xor c(i-1), with c(-1) = 0. Every cipher byte is written as
\ two letters, the high nibble first, nibble value n being the letter A + n (so A to P).

0 VARIABLE _ctx-prev

: _ctx-chain ( p:bytes -- bytes )
  0 _ctx-prev! p [ 165 bxor _ctx-prev bxor dup _ctx-prev! ] map ;

\ Hex digit code (0-9, a-f) to its letter A-P; other codes stay as they are.
: _ctx-letter ( code:int -- int )
  code 57 <= [ code 48 - 65 + ] [ code 97 - 75 + ] if ;

: _ctx-table ( -- bytes )
  0 256 range
  [ dup 48 57 util:between? over 97 102 util:between? or [ _ctx-letter ] when ]
  map list>bytes ;

: ctx1-encode ( str -- str )
  "Citrix CTX1 password obfuscation: the text as UTF-16 little-endian bytes, each xor 0xA5 and the previous output byte, written as two letters A to P per byte (high nibble first). It is reversible obfuscation, not encryption." doc
  "Classical ciphers" category
  _text>be _swap16 _ctx-chain bytes>hex str>bytes _ctx-table translate bytes>str ;

META: ctx1-encode
  use-when "You want the Citrix CTX1 obfuscated form of a password, for example to check a stored value in a CTF challenge. It is obfuscation, not encryption." ;
  inverse ctx1-decode ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  see-also classical:ctx1-decode ;
;

\ Undo the chain: p(i) = c(i) xor 0xA5 xor c(i-1).
: _ctx-unchain ( c:bytes -- bytes )
  c len 0 =
  [ c ]
  [ c #[ a5 ] bxor #[ 00 ] c 0 c len 1 - slice cat bxor ]
  if ;

\ Index (0 to 15) to the hex digit of that value.
: _ctx-hex-table ( -- bytes )
  0 256 range [ dup 16 < [ dup 10 < [ 48 + ] [ 87 + ] if ] [ drop 0 ] if ] map list>bytes ;

\ The letter indexes (two per byte) as bytes, through hex text.
: _ctx-unpair ( nibs:bytes -- bytes )
  nibs len 4 mod 0 <>
  [ "ctx1-decode: the number of letters must be a multiple of four" raise:coerce ] when
  nibs _ctx-hex-table translate bytes>latin1 hex>bytes ;

: ctx1-decode ( str -- str )
  "Undo the Citrix CTX1 obfuscation. The letters A to P (upper case; white space ignored) give the cipher bytes, two letters per byte; undoing the chain gives UTF-16 little-endian text. Any other character, a letter count that is not a multiple of four, or a lone surrogate is an error (E_COERCE)." doc
  "Classical ciphers" category
  str>bytes "ABCDEFGHIJKLMNOP" 254 255 util:decode-table util:check-symbols
  254 util:drop-byte
  _ctx-unpair _ctx-unchain true _utf16>str ;

META: ctx1-decode
  use-when "You have a string of letters from A to P, such as an obfuscated password from a Citrix setting, and want the text that it hides." ;
  inverse ctx1-encode ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  see-also classical:ctx1-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ LS47
\ ---------------------------------------------------------------------------------------------
\ Mirek Kratochvil's LS47 (public domain reference implementation ls47.py, and the README of
\ github.com/exaexa/ls47), a hand cipher on a 7x7 board of 49 tiles that improves Alan Kaminsky's
\ ElsieFour. The 49 letters of the board, in standard order, are
\   _abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()
\ and a tile has the offset (row, column) of its place on the standard board. The key is the
\ initial arrangement of the board; here it is made from a password. State: the board (the
\ bytes of its 49 tiles, row by row) and the marker (row, column), starting at (0, 0).
\ Encrypting a letter P: its place in the board is (pr, pc); the tile under the marker has the
\ offset (ar, ac); the cipher letter is the tile at (pr + ar, pc + ac), all mod 7. Then the row of
\ P rotates one place right, the column of the cipher letter (found again after that rotation)
\ rotates one place down, and the marker moves by the offset of the cipher letter. Decrypting
\ is the same with P = C - M.
\ Nothing here is random: the optional leading nonce letters and trailing signature of the
\ README are given by the caller.

: _ls-alpha ( -- str )
  "_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()" ;

\ Place of a letter on the standard board (0 to 48).
: _ls-std ( ch:int -- int )
  _ls-alpha ch util:cp>str split 0 nth len ;

\ Rotate the row starting at byte s by m places left (mid[m:] + mid[:m]).
: _ls-rr ( k:bytes s:int m:int -- bytes )
  k 0 s slice
  k s m + s 7 + slice cat
  k s s m + slice cat
  k s 7 + 49 slice cat ;

\ Rotate column col so that new[i] = old[(i + m) mod 7].
: _ls-rd ( k:bytes col:int m:int -- bytes )
  0 49 range
  [ dup 7 mod col = [ 7 div m + 7 mod 7 * col + ] when k swap nth ]
  map list>bytes ;

\ Rotate a row right by n places / a column down by n places (n >= 0).
: _ls-right ( k:bytes row:int n:int -- bytes )
  k row 7 * 7 n 7 mod - 7 mod _ls-rr ;

: _ls-down ( k:bytes col:int n:int -- bytes )
  k col 7 n 7 mod - 7 mod _ls-rd ;

\ ---- key from a password ----

0 VARIABLE _ls-i

: _ls-dstep ( k:bytes i:int row:int col:int -- bytes )
  k i col _ls-right i row _ls-down ;

: _ls-derive-char ( k:bytes ch:int -- bytes )
  k _ls-i ch _ls-std dup 7 div swap 7 mod _ls-dstep
  _ls-i 1 + 7 mod _ls-i! ;

: _ls-derive ( password:bytes -- bytes )
  0 _ls-i!
  password _ls-alpha str>bytes [ _ls-derive-char ] reduce ;

\ ---- the cipher ----

\ The letter-by-letter cipher is the private primitive _ls47 (src/prims/classical.ts).
: _ls-run ( text:bytes key:bytes dec:bool -- str )
  text key dec _ls47 bytes>str ;

\ Raise E_COERCE unless every byte is a letter of the board.
: _ls-check ( data:bytes what:str -- bytes )
  data _ls-alpha 255 255 util:decode-table translate
  [ 255 = ] filter len 0 <>
  [ what raise:coerce ] when
  data ;

: _ls-text ( s:str what:str -- bytes )
  s str>bytes what _ls-check ;

: _ls-key-of ( password:str -- bytes )
  password "ls47: the password may only use the letters of the LS47 board (_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'())" _ls-text _ls-derive ;

: ls47-encrypt ( text:str password:str[1..4096] nonce:str[0..1000]="" signature:str[0..1000]="" -- str )
  "LS47 hand cipher (Mirek Kratochvil, after Alan Kaminsky's ElsieFour). Text and password may only use the 49 letters _abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'() (lower case: otherwise E_COERCE). The board is made from the password. The message sent is nonce + text, followed by --- and the signature when one is given; the nonce and signature are chosen by the caller (nothing here is random). Use a different nonce for each message under one password." doc
  "Classical ciphers" category
  nonce text cat
  signature len 0 = [ "" ] [ "---" signature cat ] if cat
  "ls47: the text, nonce and signature may only use the letters of the LS47 board (_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'())" _ls-text
  password _ls-key-of false _ls-run ;

META: ls47-encrypt
  use-when "You want to encipher a message with the LS47 hand cipher, using a password, a nonce and an optional signature, for a puzzle or an exercise." ;
  inverse ls47-decrypt ;
  param password "Makes the board: letters of the LS47 alphabet, 1 to 4096 of them." ;
  param nonce "Letters put in front of the text, so the same text encrypts differently. Empty for none." ;
  param signature "Appended as --- plus these letters, so a changed message can be noticed. Empty for none." ;
  see-also classical:ls47-decrypt ;
;

\ The plain text with nonce-length letters removed from the front and, when a signature is
\ given, the --- and signature checked and removed from the end.
: _ls-strip ( plain:str n:int sig:str -- str )
  plain len n <
  [ "ls47-decrypt: the message is shorter than the nonce" raise:coerce ] when
  plain n plain len slice
  sig len 0 =
  [ ]
  [ dup "---" sig cat util:ends-with? not
    [ "ls47-decrypt: the signature does not match" raise:coerce ] when
    dup 0 over len "---" sig cat len - slice nip ]
  if ;

: ls47-decrypt ( text:str password:str[1..4096] nonce-length:int[0..1000]=0 signature:str[0..1000]="" -- str )
  "Undo LS47 with the same password. The first nonce-length letters of the result are the nonce and are removed. When a signature is given, the result must end with --- and the signature, which are checked and removed (a mismatch is E_COERCE). Letters outside the LS47 alphabet are E_COERCE." doc
  "Classical ciphers" category
  text "ls47: the text may only use the letters of the LS47 board (_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'())" _ls-text
  password _ls-key-of true _ls-run
  nonce-length signature _ls-strip ;

META: ls47-decrypt
  use-when "You have an LS47 message, with the password, nonce length and any signature used to make it, and want the plaintext back, as in a puzzle." ;
  inverse ls47-encrypt ;
  param password "The password used to encrypt." ;
  param nonce-length "How many nonce letters were put in front of the text." ;
  param signature "The signature used to encrypt (checked and removed). Empty for none." ;
  see-also classical:ls47-encrypt ;
;
