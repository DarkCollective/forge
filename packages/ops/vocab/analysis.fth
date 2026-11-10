\ analysis: statistics of the bytes of an input. Written in FL over the core words, except
\ _log2, a private primitive (src/prims/analysis.ts): the core has no logarithm.
IN: analysis

\ Occurrences of byte b in the latin-1 text (one code point per byte): pieces minus one.
: _count ( text:str b:int -- int )
  { b } codes>str text swap split len 1 - ;

\ Count of every byte value 0..255, as a list of 256 ints.
: _counts ( text:str -- list )
  0 256 range [ text swap _count ] map ;

\ One term of the entropy sum: p * -log2 p with p = count / total (0 when count is 0).
: _term ( count:int total:int -- num )
  count 0 =
  [ 0.0 ]
  [ count total / dup _log2 0.0 swap - * ]
  if ;

\ Sum of the terms. An empty input has no non-zero count, so the sum is 0.0 (never -0.0).
: _entropy ( counts:list total:int -- num )
  counts [ total _term ] map 0.0 [ + ] reduce ;

\ Smallest element of a non-empty list of ints.
: _min ( keys:list -- int )
  keys keys 0 nth [ min ] reduce ;

\ The list without the (unique) element key.
: _without ( keys:list key:int -- list )
  keys [ key <> ] filter ;

\ One selection-sort step on (remaining, sorted): move the smallest remaining key to the end.
: _step ( rem:list out:list -- rem out )
  rem rem _min _without
  out rem _min append ;

\ Ascending sort of a list of distinct ints (selection sort; the lists here have at most 256).
: _sort-keys ( keys:list -- list )
  keys { } over len [ _step ] times nip ;

\ The byte count encoded in a key: keys are b - 256 * count, so count = (b - key) div 256.
: _cnt ( key:int -- int )
  key 256 mod key - 256 div ;

\ One frequency record for a key, with the total number of bytes.
: _row ( key:int total:int -- record )
  { { "byte" key 256 mod }
    { "count" key _cnt }
    { "percent" key _cnt 100 * total / } }
  >record ;

\ The records for sorted keys.
: _rows ( keys:list total:int -- list )
  keys [ total _row ] map ;

: entropy ( data:bytes -- num )
  "Shannon entropy of the bytes, in bits per byte (0 to 8). Empty input gives 0." doc
  "Analysis" category
  data bytes>latin1 _counts data len _entropy ;

: frequency ( data:bytes -- list )
  "One record per byte value present: byte, count and percent of the input, sorted by count (descending) then byte." doc
  "Analysis" category
  data bytes>latin1 _counts 0 256 range swap zip
  [ 1 nth 0 > ] filter
  [ dup 1 nth 256 * swap 0 nth swap - ] map
  _sort-keys
  data len _rows ;
