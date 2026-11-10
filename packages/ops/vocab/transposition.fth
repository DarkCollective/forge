\ transposition: columnar transposition. Every byte takes part (nothing is dropped); the cipher only moves bytes.
IN: transposition

\ ---------------------------------------------------------------------------------------------
\ Column order (private helpers)
\ ---------------------------------------------------------------------------------------------

\ A unique sort value per key position: letter code * 256 + position.
\ util-candidate: key-values
: _key-values ( codes:list -- list )
  0 codes len range [ dup codes swap nth 256 * + ] map ;

\ How many key values sort strictly before v.
: _rank-of ( vs:list v:int -- int )
  vs [ v < ] filter len ;

\ The rank (0 = first column read) of every column.
: _column-ranks ( vs:list -- list )
  vs [ vs swap _rank-of ] map ;

\ The column that has rank r.
: _pick-column ( ranks:list r:int -- int )
  0 ranks len range [ ranks swap nth r = ] filter 0 nth ;

\ The column read at each step: order[r] is the column with rank r.
: _column-order ( ranks:list -- list )
  0 ranks len range [ ranks swap _pick-column ] map ;

\ How many of the l positions lie in column c (positions c, c + w, c + 2w, ... below l).
: _column-count ( l:int c:int w:int -- int )
  c l < [ l c - 1 - w div 1 + ] [ 0 ] if ;

\ The bytes of column c of t, in order.
: _column-bytes ( t:bytes c:int w:int -- bytes )
  0 t len c w _column-count range [ w * c + t swap nth ] map list>bytes ;

\ The columns of t, read in the order given.
: _columns ( t:bytes order:list w:int -- bytes )
  order [ t swap w _column-bytes ] map #[ ] bjoin ;

\ The start, in the cipher text, of column c: the columns read before it come first.
: _column-start ( c:int ranks:list l:int w:int -- int )
  0 w range 0
  [ dup ranks swap nth ranks c nth <
    [ l swap w _column-count ] [ drop 0 ] if
    + ]
  reduce ;

\ The plain byte at position i of the data: column i mod w, row i div w.
: _decrypt-at ( i:int ct:bytes starts:list w:int -- int )
  starts i w mod nth i w div + ct swap nth ;

: _decrypt-with ( ct:bytes starts:list w:int -- bytes )
  0 ct len range [ ct starts w _decrypt-at ] map list>bytes ;

: _decrypt-bytes ( ct:bytes ranks:list w:int l:int -- bytes )
  ct 0 w range [ ranks l w _column-start ] map w _decrypt-with ;

\ data padded with pad bytes to a multiple of w.
: _pad-to ( data:bytes w:int padb:int -- bytes )
  data len w mod 0 =
  [ data ]
  [ data w data len w mod - w mod 0 swap range [ drop padb ] map list>bytes cat ]
  if ;

\ ---------------------------------------------------------------------------------------------
\ Encrypt and decrypt
\ ---------------------------------------------------------------------------------------------

: transposition-encrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] pad:str[0..1,/[A-Za-z]?/]="" -- bytes )
  "Columnar transposition: the bytes are written in rows under the key (one column per key letter) and the columns are read out in alphabetical order of their key letters (a repeated letter keeps left-to-right order). With pad empty, the last row may be short and is not padded. With a pad letter, the last row is filled with that letter first; decryption does not remove it. Every byte takes part; nothing is dropped." doc
  "Classical ciphers" category
  pad len 0 =
  [ data ]
  [ data key len pad str>bytes 0 nth _pad-to ]
  if
  key upper str>codes _key-values _column-ranks _column-order
  key len _columns ;

META: transposition-encrypt
  param key "Keyword of letters (either case); its letters give the column order." ;
  param pad "A pad letter to fill the last row, or empty for none." ;
  see-also transposition:transposition-decrypt ;
;

: transposition-decrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Undo the columnar transposition with the same key (no pad is removed: a padded cipher text decrypts to the padded text)." doc
  "Classical ciphers" category
  data key upper str>codes _key-values _column-ranks key len data len _decrypt-bytes ;

META: transposition-decrypt
  param key "Keyword used to encrypt (either case)." ;
  see-also transposition:transposition-encrypt ;
;
