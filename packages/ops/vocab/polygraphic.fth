\ polygraphic: ciphers that work on letter pairs (Playfair, four-square) and on letter blocks (Hill).
\ Only ASCII letters take part: other bytes are dropped, and letters come out upper case (J is merged
\ into I, or I into J, as the omit choice says).
IN: polygraphic

\ ---------------------------------------------------------------------------------------------
\ Letters and grids (private helpers)
\ ---------------------------------------------------------------------------------------------

\ The upper-case code of a letter, with J merged into I (omit j) or I into J (omit i).
: _pl-norm ( c:int omit:str -- int )
  c 223 band
  omit "j" = [ dup 74 = [ drop 73 ] when ] [ dup 73 = [ drop 74 ] when ] if ;

\ The 25 letters of the square in order: the alphabet without the omitted letter.
\ Not fractionating:_adf-labels: both pick one of two literals by a name, but the two literals are unrelated data.
: _pl-alpha ( omit:str -- bytes )
  omit "j" = [ "ABCDEFGHIKLMNOPQRSTUVWXYZ" ] [ "ABCDEFGHJKLMNOPQRSTUVWXYZ" ] if str>bytes ;

\ ---------------------------------------------------------------------------------------------
\ Digraphs (Playfair and four-square): doubled letters are split with the filler, an odd last letter
\ takes the filler. A VARIABLE holds the letter waiting for its partner (-1 for none).
\ ---------------------------------------------------------------------------------------------

-1 VARIABLE _pl-pend

\ c ( int ) is the next letter: it either completes the pending pair or starts a new one.
: _pl-step ( c:int filler:int -- bytes )
  _pl-pend 0 <
  [ c _pl-pend! #[ ] ]
  [ _pl-pend c =
    [ { _pl-pend filler } list>bytes c _pl-pend! ]
    [ { _pl-pend c } list>bytes -1 _pl-pend! ]
    if ]
  if ;

\ The letters (upper case, merged) as digraphs: a bytes of even length.
: _pl-digraphs ( letters:bytes filler:int -- bytes )
  -1 _pl-pend!
  letters bytes>list [ filler _pl-step ] map #[ ] bjoin
  _pl-pend 0 >= [ { _pl-pend filler } list>bytes cat ] when ;

\ ---------------------------------------------------------------------------------------------
\ Playfair geometry: a cell is an index 0 to 24 in the square (row = i div 5, column = i mod 5).
\ ---------------------------------------------------------------------------------------------

\ The cell in the same row as i and the column of i moved by mode (+1 encrypt, -1 decrypt).
: _pl-row ( i:int mode:int -- int )
  i 5 div 5 * i 5 mod mode + 5 mod + ;

\ The cell in the same column as i and the row of i moved by mode.
: _pl-col ( i:int mode:int -- int )
  i 5 mod i 5 div mode + 5 mod 5 * + ;

\ The row of i with the column of j: the corner of the rectangle.
: _pl-cross ( i:int j:int -- int )
  i 5 div 5 * j 5 mod + ;

\ The two letters of a Playfair pair (ia, ib are cells of the pair's letters).
: _pl-out ( ia:int ib:int grid:bytes mode:int -- bytes )
  ia 5 div ib 5 div =
  [ { grid ia mode _pl-row nth grid ib mode _pl-row nth } list>bytes ]
  [ ia 5 mod ib 5 mod =
    [ { grid ia mode _pl-col nth grid ib mode _pl-col nth } list>bytes ]
    [ { grid ia ib _pl-cross nth grid ib ia _pl-cross nth } list>bytes ]
    if ]
  if ;

\ The pair i of pairs (bytes, two letters each) as Playfair output.
: _pl-pair ( i:int pairs:bytes grid:bytes pos:bytes mode:int -- bytes )
  pos pairs i 2 * nth nth
  pos pairs i 2 * 1 + nth nth
  grid mode _pl-out ;

\ All pairs of the digraph text, with the position table of the grid already built.
: _pl-pairs-with ( pairs:bytes grid:bytes pos:bytes mode:int -- bytes )
  0 pairs len 2 div range [ pairs grid pos mode _pl-pair ] map #[ ] bjoin ;

: _pl-pairs ( pairs:bytes grid:bytes mode:int -- bytes )
  pairs grid grid util:square-positions mode _pl-pairs-with ;

\ ---------------------------------------------------------------------------------------------
\ Playfair
\ ---------------------------------------------------------------------------------------------

: playfair-encrypt ( data:bytes key:str[0..25,/[A-Za-z]*/]="" omit:choice{j|i}="j" filler:str[1..1,/[A-Za-z]/]="X" -- bytes )
  "Playfair cipher on a 5x5 square built from the keyword (without repeats) and then the rest of the alphabet, with one letter omitted (j: J is merged into I; i: I is merged into J). Only letters take part, taken as upper case with the merge applied; other bytes are dropped. Doubled letters get the filler between them (a pair of the filler itself stays as it is), and an odd last letter gets the filler. Pairs in the same row or column move one step along it; other pairs swap columns. The output is upper-case letters." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ omit _pl-norm ] map filler str>bytes 0 nth 223 band _pl-digraphs
  key str>bytes [ omit _pl-norm ] map omit _pl-alpha util:keyed-alphabet 1 _pl-pairs ;

META: playfair-encrypt
  param key "Keyword of letters (either case; repeats are dropped); empty for the plain square." ;
  param omit "j: J is merged into I (the usual rule). i: I is merged into J." ;
  param filler "The letter put between doubled letters and after an odd last letter." ;
  see-also classical:bifid-encrypt polygraphic:playfair-decrypt ;
;

: playfair-decrypt ( data:bytes key:str[0..25,/[A-Za-z]*/]="" omit:choice{j|i}="j" -- bytes )
  "Undo Playfair with the same key and omit choice. The input is read as digraphs of letters (other bytes are dropped; an odd count of letters is E_COERCE). No filler is removed: the output is the digraphs' letters as they were encrypted, filler letters included." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ omit _pl-norm ] map dup len 2 mod 0 =
  [ ] [ drop "playfair-decrypt: the letters must come in pairs" raise:coerce ] if
  key str>bytes [ omit _pl-norm ] map omit _pl-alpha util:keyed-alphabet -1 _pl-pairs ;

META: playfair-decrypt
  param key "Keyword used to encrypt; empty for the plain square." ;
  param omit "Must match the choice used to encrypt." ;
  see-also polygraphic:playfair-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Four-square: plain square (top left, bottom right) and two keyed squares (top right from key1,
\ bottom left from key2). Pair (a, b) becomes (TR[row a, column b], BL[row b, column a]).
\ ---------------------------------------------------------------------------------------------

\ The two output letters of a four-square pair, given the cells of its letters in the two squares.
: _fs-out ( ia:int ib:int g1:bytes g2:bytes -- bytes )
  { g1 ia ib _pl-cross nth g2 ib ia _pl-cross nth } list>bytes ;

\ Pair i of pairs: ia is the cell of the first letter in pos-a, ib the cell of the second in pos-b.
: _fs-pair ( i:int pairs:bytes pos-a:bytes pos-b:bytes g1:bytes g2:bytes -- bytes )
  pos-a pairs i 2 * nth nth
  pos-b pairs i 2 * 1 + nth nth
  g1 g2 _fs-out ;

: _fs-pairs ( pairs:bytes pos-a:bytes pos-b:bytes g1:bytes g2:bytes -- bytes )
  0 pairs len 2 div range [ pairs pos-a pos-b g1 g2 _fs-pair ] map #[ ] bjoin ;

: four-square-encrypt ( data:bytes key1:str[0..25,/[A-Za-z]*/]="" key2:str[0..25,/[A-Za-z]*/]="" filler:str[1..1,/[A-Za-z]/]="X" -- bytes )
  "Four-square cipher: two 5x5 squares are used with the plain alphabet (I and J share a cell). The top left and bottom right squares are plain; the top right square is keyed by key1 and the bottom left by key2 (keyword letters first, repeats dropped). A pair (a, b) becomes the letter of the top right square in a's row and b's column, then the letter of the bottom left square in b's row and a's column. Only letters take part (J is read as I); doubled letters and an odd last letter take the filler as in Playfair." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ "j" _pl-norm ] map filler str>bytes 0 nth 223 band _pl-digraphs
  "j" _pl-alpha util:square-positions dup
  key1 str>bytes [ "j" _pl-norm ] map "j" _pl-alpha util:keyed-alphabet
  key2 str>bytes [ "j" _pl-norm ] map "j" _pl-alpha util:keyed-alphabet
  _fs-pairs ;

META: four-square-encrypt
  param key1 "Keyword for the top right square (either case); empty for the plain alphabet." ;
  param key2 "Keyword for the bottom left square; empty for the plain alphabet." ;
  param filler "The letter put between doubled letters and after an odd last letter." ;
  see-also polygraphic:four-square-decrypt ;
;

: four-square-decrypt ( data:bytes key1:str[0..25,/[A-Za-z]*/]="" key2:str[0..25,/[A-Za-z]*/]="" -- bytes )
  "Undo four-square with the same keys: each pair (a', b') is read back through the top right and bottom left squares to the plain letters. The input is read as letters in pairs (other bytes dropped; an odd count is E_COERCE). No filler is removed." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ "j" _pl-norm ] map dup len 2 mod 0 =
  [ ] [ drop "four-square-decrypt: the letters must come in pairs" raise:coerce ] if
  key1 str>bytes [ "j" _pl-norm ] map "j" _pl-alpha util:keyed-alphabet util:square-positions
  key2 str>bytes [ "j" _pl-norm ] map "j" _pl-alpha util:keyed-alphabet util:square-positions
  "j" _pl-alpha dup
  _fs-pairs ;

META: four-square-decrypt
  param key1 "Keyword used to encrypt (top right square)." ;
  param key2 "Keyword used to encrypt (bottom left square)." ;
  see-also polygraphic:four-square-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Hill: the key is a 2x2 or 3x3 matrix mod 26 (letters A = 0 .. Z = 25, or numbers 0 to 25).
\ ---------------------------------------------------------------------------------------------

\ Entry k of a matrix given as bytes.
: _hget ( m:bytes k:int -- int )
  m k nth ;

\ The determinant mod 26 of an n x n matrix (n is 2 or 3).
: _hill-det ( m:bytes n:int -- int )
  n 2 =
  [ m 0 _hget m 3 _hget * m 1 _hget m 2 _hget * - 26 mod ]
  [ m 0 _hget m 4 _hget m 8 _hget * m 5 _hget m 7 _hget * - *
    m 1 _hget m 3 _hget m 8 _hget * m 5 _hget m 6 _hget * - * -
    m 2 _hget m 3 _hget m 7 _hget * m 4 _hget m 6 _hget * - * +
    26 mod ]
  if ;

\ The key must be invertible mod 26 (its determinant coprime to 26), else E_RANGE.
: _hill-check ( k:bytes n:int -- )
  k n _hill-det 26 gcd 1 =
  [ ] [ "hill: the key matrix is not invertible mod 26" raise:range ] if ;

\ Scales a list of entries by s mod 26, as bytes.
: _hill-scale ( vals:list s:int -- bytes )
  vals [ s * 26 mod ] map list>bytes ;

\ The inverse matrix mod 26 (adjugate times the inverse of the determinant).
: _hill-inverse ( m:bytes n:int -- bytes )
  m n _hill-det 26 invmod
  n 2 =
  [ { m 3 _hget m 1 _hget neg m 2 _hget neg m 0 _hget } ]
  [ { m 4 _hget m 8 _hget * m 5 _hget m 7 _hget * -
      m 2 _hget m 7 _hget * m 1 _hget m 8 _hget * -
      m 1 _hget m 5 _hget * m 2 _hget m 4 _hget * -
      m 5 _hget m 6 _hget * m 3 _hget m 8 _hget * -
      m 0 _hget m 8 _hget * m 2 _hget m 6 _hget * -
      m 2 _hget m 3 _hget * m 0 _hget m 5 _hget * -
      m 3 _hget m 7 _hget * m 4 _hget m 6 _hget * -
      m 1 _hget m 6 _hget * m 0 _hget m 7 _hget * -
      m 0 _hget m 4 _hget * m 1 _hget m 3 _hget * - } ]
  if
  swap _hill-scale ;

\ Row r of m times block b of vals (n values per block), reduced mod 26.
: _hill-row ( r:int vals:bytes m:bytes n:int b:int -- int )
  0 n range 0
  [ dup r n * + m swap nth swap b n * + vals swap nth * + ]
  reduce 26 mod ;

\ The n outputs of block b.
: _hill-block ( b:int vals:bytes m:bytes n:int -- list )
  0 n range [ vals m n b _hill-row ] map ;

\ vals multiplied by the matrix m, block by block.
: _hill-apply ( vals:bytes m:bytes n:int -- bytes )
  0 vals len n div range [ vals m n _hill-block list>bytes ] map #[ ] bjoin ;

\ Pads v with the value p to a whole number of blocks of n.
: _hill-pad ( n:int v:bytes p:int -- bytes )
  v len n mod 0 =
  [ v ]
  [ v n v len n mod - n mod 0 swap range [ drop p ] map list>bytes cat ]
  if ;

\ The key values from its text: letters (A to Z, either case) or numbers.
: _hill-vals ( key:str format:str -- list )
  format "letters" =
  [ key str>codes [ 223 band 65 - ] map ]
  [ key util:number-tokens [ str>int ] map ]
  if ;

\ A key of 4 values (2x2) or 9 values (3x3), each 0 to 25, as bytes.
: _hill-key ( key:str format:str -- bytes )
  key format _hill-vals
  dup len 4 = [ ] [ dup len 9 = [ ] [ drop "hill: the key must have 4 values (2x2) or 9 values (3x3)" raise:range ] if ] if
  dup [ dup 0 < over 25 > or [ "hill: key values must be between 0 and 25" raise:range ] when drop ] each
  list>bytes ;

: _hill-size ( k:bytes -- int )
  k len 4 = [ 2 ] [ 3 ] if ;

: _hill-encrypt-with ( v:bytes k:bytes n:int p:int -- bytes )
  k n _hill-check
  n v p _hill-pad k n _hill-apply [ 65 + ] map ;

\ v must be whole blocks (E_COERCE otherwise); it is returned unchanged.
: _hill-pad-check ( v:bytes n:int -- bytes )
  v len n mod 0 = [ v ] [ "hill-decrypt: the letters must make whole blocks" raise:coerce ] if ;

: _hill-decrypt-with ( v:bytes k:bytes n:int -- bytes )
  k n _hill-check
  v n _hill-pad-check k n _hill-inverse n _hill-apply [ 65 + ] map ;

: hill-encrypt ( data:bytes key:str[1..200] format:choice{letters|numbers}="letters" pad:str[1..1,/[A-Za-z]/]="X" -- bytes )
  "Hill cipher: the key is a 2x2 (4 values) or 3x3 (9 values) matrix mod 26, given as letters (A = 0 to Z = 25) or as numbers 0 to 25 separated by white space or commas. The key must be invertible mod 26 (E_RANGE otherwise). The letters of the data (other bytes dropped, taken as upper case) are cut into blocks of 2 or 3 and multiplied by the matrix; the last block is padded with the pad letter. The output is upper-case letters." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ 223 band 65 - ] map
  key format _hill-key dup _hill-size
  pad str>bytes 0 nth 223 band 65 -
  _hill-encrypt-with ;

META: hill-encrypt
  param key "The matrix: 4 or 9 values, as letters or numbers 0 to 25." ;
  param format "letters: A = 0 to Z = 25. numbers: decimal values 0 to 25." ;
  param pad "The letter that pads the last block." ;
  see-also polygraphic:hill-decrypt ;
;

: hill-decrypt ( data:bytes key:str[1..200] format:choice{letters|numbers}="letters" -- bytes )
  "Undo the Hill cipher with the same matrix: the letters are cut into blocks and multiplied by the inverse matrix mod 26. The letters must make whole blocks (E_COERCE otherwise). No padding is removed." doc
  "Classical ciphers" category
  data [ util:letter? ] filter [ 223 band 65 - ] map
  key format _hill-key dup _hill-size
  _hill-decrypt-with ;

META: hill-decrypt
  param key "The matrix used to encrypt." ;
  param format "letters or numbers, as for hill-encrypt." ;
  see-also polygraphic:hill-encrypt ;
;
