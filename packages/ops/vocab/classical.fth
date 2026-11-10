\ classical: classical ciphers. They work on bytes and touch ASCII letters only.
IN: classical

: _rot-code ( code:int amount:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;

\ ---------------------------------------------------------------------------------------------
\ Shared helpers (private)
\ ---------------------------------------------------------------------------------------------

: _is-letter ( code:int -- bool )
  code 32 bor 97 >= code 32 bor 122 <= and ;

: _is-space ( code:int -- bool )
  code 32 = code 9 >= code 13 <= and or ;

\ ---------------------------------------------------------------------------------------------
\ rot47, atbash
\ ---------------------------------------------------------------------------------------------

: rot47 ( bytes -- bytes )
  "Rotate the printable ASCII bytes 33 ('!') to 126 ('~') by 47 places; all other bytes pass through. Applying it twice gives the original." doc
  "Classical ciphers" category
  [ dup 33 >= over 126 <= and [ 33 - 47 + 94 mod 33 + ] when ] map ;

META: rot47
  see-also classical:rot ;
;

: _atbash-code ( code:int -- int )
  code 65 >= code 90 <= and
  [ 155 code - ]
  [ code 97 >= code 122 <= and
    [ 219 code - ]
    [ code ]
    if ]
  if ;

: atbash ( bytes -- bytes )
  "Reverse the ASCII alphabet (A becomes Z, B becomes Y, and so on), keeping case; other bytes pass through. It is its own inverse." doc
  "Classical ciphers" category
  [ _atbash-code ] map ;

META: atbash
  see-also classical:rot classical:substitute ;
;

\ ---------------------------------------------------------------------------------------------
\ Affine
\ ---------------------------------------------------------------------------------------------

: _affine-code ( code:int a:int b:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - a * b + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
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
  param a "Multiplier; must be coprime to 26 (1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23 or 25)." ;
  param b "Shift, 0 to 25." ;
  see-also classical:affine-decrypt classical:rot ;
;

: affine-decrypt ( bytes a:int[1|3|5|7|9|11|15|17|19|21|23|25]=5 b:int[0..25]=8 -- bytes )
  "Undo the affine cipher: each ASCII letter y becomes a^-1 * (y - b) mod 26. Case is kept; other bytes pass through." doc
  "Classical ciphers" category
  a 26 invmod dup b * neg _affine ;

META: affine-decrypt
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
  param key "Key letters A to Z (either case), 1 to 256 of them." ;
  see-also classical:vigenere-decrypt classical:rot ;
;

: vigenere-decrypt ( bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Undo the Vigenere cipher with the same key. Key letters are case-insensitive; non-letters pass through and do not use up a key letter." doc
  "Classical ciphers" category
  key str>bytes -1 _vigenere ;

META: vigenere-decrypt
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
  param alphabet "classic: 24 letters (I=J, U=V). complete: 26 letters." ;
  see-also classical:bacon-decode ;
;

: _bacon-lookup ( t:bytes table:bytes -- str )
  0 t len 5 div range
  [ 5 * dup 5 + t -rot slice
    0 [ 98 = [ 1 ] [ 0 ] if swap 2 * + ] reduce
    dup table len >=
    [ "bacon-decode: a group does not code a letter of this alphabet" fail ] when
    table swap nth ]
  map
  list>bytes bytes>str ;

: _bacon-groups ( t:bytes classic:bool -- str )
  t [ dup 97 = swap 98 = or ] filter len t len <>
  [ "bacon-decode: only the symbols A and B (any case) and white space are allowed" fail ] when
  t len 5 mod 0 <>
  [ "bacon-decode: the number of A/B symbols must be a multiple of five" fail ] when
  t
  classic
  [ "ABCDEFGHIKLMNOPQRSTUWXYZ" ]
  [ "ABCDEFGHIJKLMNOPQRSTUVWXYZ" ]
  if str>bytes
  _bacon-lookup ;

: bacon-decode ( str alphabet:choice{classic|complete}=classic -- str )
  "Decode Bacon's cipher: read the A/B symbols (any case, white space ignored) in groups of five and give upper-case letters. With classic, I/J decode as I and U/V as U. Other symbols, a symbol count that is not a multiple of five, or a group outside the alphabet are errors (E_USER)." doc
  "Classical ciphers" category
  str>bytes [ _is-space not ] filter [ 32 bor ] map
  alphabet "classic" = _bacon-groups ;

META: bacon-decode
  param alphabet "classic: 24 letters (I=J, U=V). complete: 26 letters." ;
  see-also classical:bacon-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ Bifid
\ ---------------------------------------------------------------------------------------------

\ Upper-case a letter and merge J into I.
: _bifid-norm ( code:int -- int )
  code 223 band dup 74 = [ drop 73 ] when ;

: _bifid-letters ( data:bytes -- bytes )
  data [ _is-letter ] filter [ _bifid-norm ] map ;

: _add-unique ( acc:bytes c:int -- bytes )
  acc [ c = ] filter len 0 >
  [ acc ]
  [ acc { c } list>bytes cat ]
  if ;

\ The 25 letters of the square in reading order: the key first, then the rest of the alphabet.
: _bifid-grid ( key:str -- bytes )
  key str>bytes [ _bifid-norm ] map
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
  param key "Keyword of letters (J counts as I); empty for the plain alphabet square." ;
  see-also classical:bifid-decrypt ;
;

: bifid-decrypt ( bytes key:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Undo the bifid cipher with the same key. Only the letters of the data are used, taken as upper case (J as I); every other byte is dropped, so the output is upper-case letters only." doc
  "Classical ciphers" category
  _bifid-letters key _bifid-grid dup _bifid-table
  core:rot swap translate swap _bifid-dec ;

META: bifid-decrypt
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
  param rails "Number of rails, 2 to 1000." ;
  param offset "Steps into the zigzag at which the first byte sits." ;
  see-also classical:rail-fence-decrypt ;
;

: rail-fence-decrypt ( bytes rails:int[2..1000]=3 offset:int[0..1000]=0 -- bytes )
  "Undo the rail fence transposition (same rails and offset as for encryption)." doc
  "Classical ciphers" category
  rails offset _rf-decrypt ;

META: rail-fence-decrypt
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
  param delimiter "Put this between the numbers: space, comma or dash." ;
  see-also classical:a1z26-decode ;
;

: a1z26-decode ( str -- str )
  "Replace each number 1 to 26 by the matching upper-case letter. Any run of characters that are not digits separates numbers (spaces, commas, dashes, newlines). A number outside 1 to 26 is an error (E_USER)." doc
  "Classical ciphers" category
  str>bytes [ dup 48 >= over 57 <= and not [ drop 32 ] when ] map bytes>str
  " " split [ len 0 > ] filter
  [ str>int dup 1 < over 26 > or
    [ "a1z26-decode: numbers must be between 1 and 26" fail ] when
    64 + ]
  map list>bytes bytes>str ;

META: a1z26-decode
  see-also classical:a1z26-encode ;
;

\ ---------------------------------------------------------------------------------------------
\ Substitution
\ ---------------------------------------------------------------------------------------------

: _printable ( code:int -- bool )
  code 32 >= code 126 <= and ;

: _sub-byte ( v:int pb:bytes cb:bytes -- int )
  0 pb len range v
  [ dup pb swap nth v = [ cb swap nth nip ] [ drop ] if ]
  reduce ;

: _sub-table ( pb:bytes cb:bytes -- bytes )
  0 256 range [ pb cb _sub-byte ] map list>bytes ;

: _substitute ( data:bytes pb:bytes cb:bytes -- bytes )
  pb [ _printable ] filter len pb len <>
  cb [ _printable ] filter len cb len <> or
  [ "substitute: plaintext and ciphertext must be printable ASCII" fail ] when
  pb len cb len <>
  [ "substitute: plaintext and ciphertext must have the same length" fail ] when
  data pb cb _sub-table translate ;

: substitute ( bytes plaintext:charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ" ciphertext:charset="ZYXWVUTSRQPONMLKJIHGFEDCBA" -- bytes )
  "Monoalphabetic substitution: every byte equal to the n-th character of plaintext is replaced by the n-th character of ciphertext (case-sensitive); other bytes pass through. Both must be printable ASCII and of equal length, else it fails (E_USER). A repeated character in either is E_PARAM_INVALID." doc
  "Classical ciphers" category
  plaintext str>bytes ciphertext str>bytes _substitute ;

META: substitute
  param plaintext "The characters to replace (printable ASCII, none repeated)." ;
  param ciphertext "Their replacements, in the same order and of the same length." ;
  see-also classical:atbash classical:rot ;
;
