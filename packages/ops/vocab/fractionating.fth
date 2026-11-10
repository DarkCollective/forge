\ fractionating: ciphers that first turn each letter into digits (a Polybius square) and then combine them.
\ Only ASCII letters take part: other bytes are dropped, and letters are upper case with J merged into I.
IN: fractionating

\ ---------------------------------------------------------------------------------------------
\ Letters and grids (private helpers)
\ ---------------------------------------------------------------------------------------------

\ util-candidate: is-letter
: _fr-letter ( c:int -- bool )
  c 32 bor 97 122 util:between? ;

\ The upper-case code of a letter, with J merged into I.
\ util-candidate: upper-merge-i
: _fr-norm ( c:int -- int )
  c 223 band dup 74 = [ drop 73 ] when ;

\ acc with c appended, when c is in alpha and not yet in acc.
\ util-candidate: keyed-alphabet-step
: _kg-step ( acc:bytes alpha:bytes c:int -- bytes )
  alpha [ c = ] filter len 0 >
  acc [ c = ] filter len 0 =
  and
  [ acc c 1 util:int>be-bytes cat ] [ acc ] if ;

\ The keyword letters (without repeats) followed by the rest of alpha: the square's order.
\ util-candidate: keyed-alphabet
: _keyed-alphabet ( key:bytes alpha:bytes -- bytes )
  key alpha cat #[ ] [ alpha swap _kg-step ] reduce ;

\ The 25 letters of the Polybius square: the alphabet without J.
: _fr-alpha ( -- bytes )
  "ABCDEFGHIKLMNOPQRSTUVWXYZ" str>bytes ;

\ The position (0 to 24) of each letter in the square grid; 255 for other bytes.
\ util-candidate: square-positions
: _fr-pos ( grid:bytes -- bytes )
  grid bytes>str 255 255 util:decode-table ;

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
  data [ _fr-letter ] filter [ _fr-norm ] map bytes>list
  key str>bytes [ _fr-norm ] map _fr-alpha _keyed-alphabet _fr-pos _fr-digits ;

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
  key str>bytes [ _fr-norm ] map _fr-alpha _keyed-alphabet _fr-decode ;

META: polybius-decrypt
  param key "Keyword used to encrypt; empty for the plain square." ;
  see-also fractionating:polybius-encrypt ;
;

