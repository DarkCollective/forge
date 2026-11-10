\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ fractionating: ciphers that first turn each letter into digits (a Polybius square) and then combine them.
\ Only ASCII letters take part: other bytes are dropped, and letters are upper case with J merged into I.
IN: fractionating

\ ---------------------------------------------------------------------------------------------
\ Letters and grids (private helpers)
\ ---------------------------------------------------------------------------------------------

\ The 25 letters of the Polybius square: the alphabet without J.
: _fr-alpha ( -- bytes )
  "ABCDEFGHIKLMNOPQRSTUVWXYZ" str>bytes ;

\ The two-digit coordinate (row 1 to 5, column 1 to 5) of the letter c in the square.
: _fr-coord ( c:int pos:bytes -- int )
  pos c nth 5 div 1 + 10 * pos c nth 5 mod 1 + + ;

\ A two-digit coordinate as its two digit characters.
: _fr-pair ( coord:int -- bytes )
  { coord 10 div 48 + coord 10 mod 48 + } list>bytes ;

\ ---------------------------------------------------------------------------------------------
\ Polybius
\ ---------------------------------------------------------------------------------------------

: _fr-digits ( letters:list pos:bytes -- bytes )
  letters [ pos _fr-coord _fr-pair ] map #[ ] bjoin ;

\ The i-th pair of digit values (1 to 5 each) as a letter of the grid.
: _fr-cell ( i:int vals:list grid:bytes -- int )
  grid vals i 2 * nth 1 - 5 * vals i 2 * 1 + nth 1 - + nth ;

\ The letters of all digit pairs.
: _fr-decode ( vals:list grid:bytes -- bytes )
  0 vals len 2 div range [ vals grid _fr-cell ] map list>bytes ;

: polybius-encrypt ( data:bytes key:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Polybius square: each letter of the data (upper case, J as I) becomes its row and column numbers (1 to 5) as two digits. The square is keyed by the key (keyword letters without repeats, then the rest of the alphabet without J). Other bytes are dropped; the output is digits only." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ util:upper-merge-i ] map bytes>list
  key str>bytes [ util:upper-merge-i ] map _fr-alpha util:keyed-alphabet util:square-positions _fr-digits ;

META: polybius-encrypt
  param key "Keyword of letters (either case; repeats dropped); empty for the plain square." ;
  see-also fractionating:polybius-decrypt ;
;

: polybius-decrypt ( data:bytes key:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Undo the Polybius encoding with the same key: digit pairs (1 to 5 each; other bytes dropped) become letters. An odd number of digits, or a digit outside 1 to 5, is E_COERCE." doc
  "Classical ciphers" category
  data [ util:dec-digit? ] filter dup len 2 mod 0 =
  [ ] [ drop "polybius-decrypt: an odd number of digits" raise:coerce ] if
  bytes>list [ 48 - ] map
  dup [ dup 1 < over 5 > or [ "polybius-decrypt: digits must be 1 to 5" raise:coerce ] when drop ] each
  key str>bytes [ util:upper-merge-i ] map _fr-alpha util:keyed-alphabet _fr-decode ;

META: polybius-decrypt
  param key "Keyword used to encrypt; empty for the plain square." ;
  see-also fractionating:polybius-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Nihilist: each letter and each key letter become their square coordinates (row * 10 + column);
\ the two are added as ordinary integers and the key repeats over the letters.
\ ---------------------------------------------------------------------------------------------

\ The coordinates of the key letters in the square.
: _nh-key-coords ( pos:bytes key:str -- list )
  key str>bytes bytes>list [ util:upper-merge-i pos _fr-coord ] map ;

\ The sum of each letter's coordinate and the key coordinate that repeats over the letters.
: _nh-sums ( letters:bytes pos:bytes keyc:list -- list )
  0 letters len range [ dup letters swap nth pos _fr-coord swap keyc swap keyc len mod nth + ] map ;

\ The letter of the square cell that the sum v, less the key coordinate k, names; E_COERCE when that is not a cell.
: _nh-cell ( v:int k:int grid:bytes -- int )
  v k - dup 11 < over 55 > or over 10 mod 1 < or over 10 mod 5 > or
  [ "nihilist: a number is not a sum of two coordinates" raise:coerce ] when
  dup 10 div 1 - 5 * swap 10 mod 1 - + grid swap nth ;

: _nh-decrypt ( grid:bytes keyc:list nums:list -- bytes )
  0 nums len range [ dup nums swap nth swap keyc swap keyc len mod nth grid _nh-cell ] map list>bytes ;

: nihilist-encrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] square:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Nihilist cipher: each letter of the data (upper case, J as I) becomes the number of its square cell (row * 10 + column, 1 to 5 each) and each key letter the same; the key repeats over the letters and the two numbers are added as ordinary integers. The sums are written as decimal numbers separated by spaces. The square is keyed by square (keyword letters without repeats, then the rest of the alphabet without J). Other bytes are dropped." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ util:upper-merge-i ] map
  square str>bytes [ util:upper-merge-i ] map _fr-alpha util:keyed-alphabet util:square-positions
  dup key _nh-key-coords
  _nh-sums [ int>str ] map " " join str>bytes ;

META: nihilist-encrypt
  param key "Nihilist key: letters (either case), repeated over the data." ;
  param square "Keyword of the Polybius square (letters, either case; repeats dropped); empty for the plain square." ;
  see-also fractionating:nihilist-decrypt ;
;

: nihilist-decrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] square:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Undo the Nihilist cipher with the same key and square: the numbers (separated by white space or commas) have the key coordinate taken off and are read as square cells. A number that is not a sum of two cell coordinates is E_COERCE." doc
  "Classical ciphers" category
  square str>bytes [ util:upper-merge-i ] map _fr-alpha util:keyed-alphabet
  dup util:square-positions dup key _nh-key-coords swap drop
  data bytes>latin1 util:number-tokens [ str>int ] map
  _nh-decrypt ;

META: nihilist-decrypt
  param key "Nihilist key used to encrypt (letters, either case)." ;
  param square "Keyword of the Polybius square used to encrypt; empty for the plain square." ;
  see-also fractionating:nihilist-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ ADFGX and ADFGVX: a keyed square turns each character into two labels (its row and column),
\ then a columnar transposition (transposition:columnar-encrypt) reorders the labels.
\ ---------------------------------------------------------------------------------------------

\ The row and column labels: ADFGX (5 by 5) or ADFGVX (6 by 6).
\ Not polygraphic:_pl-alpha: both pick one of two literals by a name, but the two literals are unrelated data.
: _adf-labels ( variant:str -- bytes )
  variant "adfgx" = [ "ADFGX" ] [ "ADFGVX" ] if str>bytes ;

\ The width of the square: 5 for adfgx, 6 for adfgvx.
: _adf-width ( variant:str -- int )
  variant "adfgx" = [ 5 ] [ 6 ] if ;

\ The keyed square: the 25 letters of ADFGX (J as I), or the 36 letters and digits of ADFGVX.
: _adf-grid ( key:str variant:str -- bytes )
  variant "adfgx" = [ key str>bytes [ util:upper-merge-i ] map _fr-alpha util:keyed-alphabet ]
  [ key upper str>bytes "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" str>bytes util:keyed-alphabet ] if ;

\ The text put into the square: ADFGX takes the letters (J as I); ADFGVX takes letters and digits. Letters are upper case.
: _adf-data ( data:bytes variant:str -- bytes )
  variant "adfgx" = [ data [ util:letter? ] filter [ util:upper-merge-i ] map ]
  [ data [ dup util:letter? swap util:dec-digit? or ] filter [ dup util:letter? [ 223 band ] when ] map ] if ;

\ The two label bytes (row, then column) of the square position p in a w-wide square.
: _adf-pair ( p:int w:int labels:bytes -- bytes )
  { labels p w div nth labels p w mod nth } list>bytes ;

: _adf-pairs ( positions:bytes w:int labels:bytes -- bytes )
  positions bytes>list [ w labels _adf-pair ] map #[ ] bjoin ;

\ The letter of the cell of pair i: the row label index times w, plus the column label index.
: _adf-cell ( i:int idx:bytes w:int grid:bytes -- int )
  grid idx i 2 * nth w * idx i 2 * 1 + nth + nth ;

: _adf-letters ( idx:bytes w:int grid:bytes -- bytes )
  0 idx len 2 div range [ idx w grid _adf-cell ] map list>bytes ;

\ The letters of the square for the label text cipher (after the transposition is undone).
: _adf-decode ( cipher:bytes key:str variant:str -- bytes )
  cipher len 2 mod 0 = not [ "adfgx: the labels come in pairs, and the text has an odd number of them" raise:coerce ] when
  cipher variant _adf-labels bytes>str 255 255 util:decode-table util:check-symbols
  variant _adf-width key variant _adf-grid _adf-letters ;

: adfgx-encrypt ( data:bytes key:str[1..36,/[A-Za-z0-9]+/] trkey:str[1..256,/[A-Za-z]+/] variant:choice{adfgx|adfgvx}="adfgx" -- bytes )
  "ADFGX and ADFGVX ciphers: each letter (ADFGVX also each digit) of the data becomes the labels of its cell in a keyed square (ADFGX: 5 by 5 square of the 25 letters, J as I; ADFGVX: 6 by 6 square of letters and digits; the square is filled by its key, then the rest of the alphabet). The label pairs (row, then column) are then written under the transposition key trkey and read out by columnar transposition (transposition:columnar-encrypt, no pad). Other bytes are dropped." doc
  "Classical ciphers" category
  data variant _adf-data
  key variant _adf-grid util:square-positions translate
  variant _adf-width variant _adf-labels _adf-pairs
  trkey "" transposition:columnar-encrypt ;

META: adfgx-encrypt
  param key "Keyword of the square (letters, or letters and digits for adfgvx, repeats dropped); it fills the square first." ;
  param trkey "Keyword of the transposition: its letters give the column order." ;
  param variant "adfgx (5 by 5, letters) or adfgvx (6 by 6, letters and digits)." ;
  see-also fractionating:adfgx-decrypt ;
;

: adfgx-decrypt ( data:bytes key:str[1..36,/[A-Za-z0-9]+/] trkey:str[1..256,/[A-Za-z]+/] variant:choice{adfgx|adfgvx}="adfgx" -- bytes )
  "Undo the ADFGX or ADFGVX cipher with the same keys and variant: the columnar transposition is undone (transposition:columnar-decrypt), then each label pair names a cell of the square. Letters only are read (case is ignored); a label pair that is not a label, or an odd count of labels, is E_COERCE." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ 223 band ] map
  trkey transposition:columnar-decrypt
  key variant _adf-decode ;

META: adfgx-decrypt
  param key "Keyword of the square used to encrypt (same as adfgx-encrypt)." ;
  param trkey "Keyword of the transposition used to encrypt." ;
  param variant "adfgx or adfgvx, as used to encrypt." ;
  see-also fractionating:adfgx-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Trifid: a 27-symbol cube (A to Z and +, keyed by key), three layers of 3 by 3. Each letter becomes
\ its layer, row and column; within each block of period letters the layers, then the rows, then the
\ columns are read as one stream and split into new triples, which give the cipher letters.
\ ---------------------------------------------------------------------------------------------

\ The keyed cube: the keyword letters without repeats, then the rest of A to Z and +.
: _tr-grid ( key:str -- bytes )
  key upper str>bytes "ABCDEFGHIJKLMNOPQRSTUVWXYZ+" str>bytes util:keyed-alphabet ;

\ The coordinate kind (0 layer, 1 row, 2 column; each 0 to 2) of the cell at position p (0 to 26).
: _tr-coord ( p:int kind:int -- int )
  kind 0 = [ p 9 div ] [ kind 1 = [ p 3 div 3 mod ] [ p 3 mod ] if ] if ;

\ Encryption: the digit at stream position q of a block of m letters (positions pb), which holds kind q div m of letter q mod m.
: _tr-enc-digit ( pb:bytes m:int q:int -- int )
  pb q m mod nth q m div _tr-coord ;

\ Decryption: the digit at stream position q of a block of cipher positions pb, which holds kind q mod 3 of letter q div 3.
: _tr-dec-digit ( pb:bytes q:int -- int )
  pb q 3 div nth q 3 mod _tr-coord ;

\ The cipher letter (grid position) of encryption output t of the block pb.
: _tr-enc-out ( t:int pb:bytes grid:bytes -- int )
  grid
  pb pb len 3 t * _tr-enc-digit 9 *
  pb pb len 3 t * 1 + _tr-enc-digit 3 * +
  pb pb len 3 t * 2 + _tr-enc-digit +
  nth ;

\ The plain letter (grid position) of decryption output j of the block pb.
: _tr-dec-out ( j:int pb:bytes grid:bytes -- int )
  grid
  pb j _tr-dec-digit 9 *
  pb pb len j + _tr-dec-digit 3 * +
  pb pb len 2 * j + _tr-dec-digit +
  nth ;

: _tr-enc-block ( pb:bytes grid:bytes -- bytes )
  0 pb len range [ pb grid _tr-enc-out ] map list>bytes ;

: _tr-dec-block ( pb:bytes grid:bytes -- bytes )
  0 pb len range [ pb grid _tr-dec-out ] map list>bytes ;

\ Block b: the positions of the letters from b * period on, up to period of them (fewer at the end).
: _tr-chunk ( b:int ps:bytes period:int -- bytes )
  ps b period * dup period + ps len min slice ;

\ The blocks of ps, each turned by blk ( block grid -- bytes ), and joined.
: _tr-blocks ( ps:bytes grid:bytes period:int blk:quot -- bytes )
  0 ps len period + 1 - period div range
  [ ps period _tr-chunk grid blk call ] map #[ ] bjoin ;

: trifid-encrypt ( data:bytes key:str[0..256,/[A-Za-z]*/]="" period:int[1..1000]=5 -- bytes )
  "Trifid cipher: the letters of the data (upper case; other bytes dropped) are written by the 27-symbol cube keyed by key (keyword letters without repeats, then A to Z and + ). Each letter gives its layer, row and column (1 to 3 each). In each block of period letters, the layers, then the rows, then the columns are read as one stream and split into triples, and each triple names a cube cell, giving the cipher letters." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ 223 band ] map
  key _tr-grid swap over util:square-positions translate swap
  period [ _tr-enc-block ] _tr-blocks ;

META: trifid-encrypt
  param key "Keyword of the cube (letters, either case; repeats dropped); empty for the plain cube." ;
  param period "The block size: the number of letters whose coordinates are read together." ;
  see-also fractionating:trifid-decrypt ;
;

: trifid-decrypt ( data:bytes key:str[0..256,/[A-Za-z]*/]="" period:int[1..1000]=5 -- bytes )
  "Undo the Trifid cipher with the same cube and period: the cipher symbols (letters, and + for the 27th) give their coordinates, which are written as the stream of each block (layers, then rows, then columns) and split back into the plain symbols. Other bytes are dropped; the output may contain + (the 27th symbol)." doc
  "Classical ciphers" category
  data [ dup util:letter? swap 43 = or ] filter [ dup util:letter? [ 223 band ] when ] map
  key _tr-grid swap over util:square-positions translate swap
  period [ _tr-dec-block ] _tr-blocks ;

META: trifid-decrypt
  param key "Keyword of the cube used to encrypt (letters, either case); empty for the plain cube." ;
  param period "The block size used to encrypt." ;
  see-also fractionating:trifid-encrypt ;
;

