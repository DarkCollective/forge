\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ssdeep: context triggered piecewise hashing, also called fuzzy hashing or CTPH (Kornblum, "Identifying
\ almost identical files using context triggered piecewise hashing", DFRWS 2006). The digest is TEXT,
\ blocksize:hash:hash, not bytes: it is a structured string whose parts are compared character by
\ character, and it is never a fixed-size binary value. The scan over the data (the rolling hash and
\ the two piece hashes, with 32-bit wraparound) is _pieces, a private primitive (src/prims/ssdeep.ts);
\ the block size choice, the retry, the text format and the comparison are FL.
IN: ssdeep

\ The smallest block size 3 * 2^k with bs * 64 >= n, starting from bs.
: _guess ( bs:int n:int -- int )
  bs 64 * n < [ bs 2 * n recurse ] [ bs ] if ;

\ The digest for block size bs; when the first hash is shorter than 32 characters and bs is above 3
\ the block size is halved and the pass repeated.
: _hash ( data:bytes bs:int -- str )
  data bs _pieces
  dup 32 < bs 3 > and
  [ drop drop drop data bs 2 div recurse ]
  [ drop ":" swap cat cat bs int>str ":" cat swap cat ]
  if ;

: digest ( data:bytes -- str )
  "The ssdeep fuzzy hash (context triggered piecewise hashing, Kornblum 2006) of the input, as TEXT in the standard form blocksize:hash1:hash2. hash1 uses the block size and hash2 twice it; each part has at most 64 and 32 base-64 characters. Text, not bytes, because the result is a structured string that ssdeep:compare reads piece by piece. Similar inputs give similar hashes; compare them with ssdeep:compare. Not cryptographic." doc
  "Hashing" category
  data 3 data len _guess _hash ;

META: digest
  alias ctph ;
;

\ ---- comparison ----

\ True when the code at index i of codes equals the three before it.
: _run4 ( codes:list i:int -- bool )
  codes i nth codes i 1 - nth =
  codes i nth codes i 2 - nth = and
  codes i nth codes i 3 - nth = and ;

\ The text of the codes with any run of more than three equal characters cut to three.
: _elim-codes ( codes:list -- str )
  0 codes len range [ dup 3 < [ drop true ] [ codes swap _run4 not ] if ] filter
  [ codes swap nth ] map codes>str ;

: _elim ( s:str -- str )
  s str>codes _elim-codes ;

\ { block size, hash1, hash2 } from the text blocksize:hash1:hash2; anything after a comma (the file
\ name of ssdeep's own listing) is ignored.
: _parts ( p:list -- list )
  { p 0 nth str>int p 1 nth _elim p 2 nth "," split 0 nth _elim } ;

: _parse ( hash:str -- list )
  hash ":" split
  dup len 3 <> [ "an ssdeep hash has the form blocksize:hash:hash" raise:coerce ] when
  _parts
  dup 0 nth 1 < [ "the block size must be at least 1" raise:coerce ] when ;

: _unpack ( l:list -- int str str )
  l 0 nth l 1 nth l 2 nth ;

\ True when the strings share a substring of 7 characters.
: _common7? ( a:str b:str -- bool )
  a len 7 <
  [ false ]
  [ 0 a len 6 - range [ a swap dup 7 + slice b swap split len 1 > ] map false [ or ] reduce ]
  if ;

\ The new row of the longest-common-subsequence table after the character ca of the first string.
: _cell ( row:list j:int prev:list ca:int bc:list -- list )
  bc j 1 - nth ca =
  [ row prev j 1 - nth 1 + append ]
  [ row prev j nth row dup len 1 - nth max append ]
  if ;

: _lcs-row ( prev:list ca:int bc:list -- list )
  1 prev len range { 0 } [ prev ca bc _cell ] reduce ;

\ Length of the longest common subsequence of two lists of codes.
: _lcs ( a:list b:list -- int )
  a 0 b len 1 + range [ drop 0 ] map [ b _lcs-row ] reduce
  dup len 1 - nth ;

\ Edit distance with insertion and removal at cost 1 and replacement at cost 2, which is
\ len a + len b - 2 * LCS.
: _dist ( a:str b:str -- int )
  a len b len + 2 a str>codes b str>codes _lcs * - ;

\ The match score 0 to 100 of two hash strings made at block size bs.
: _score ( a:str b:str bs:int -- int )
  a len 64 > b len 64 > or a b _common7? not or
  [ 0 ]
  [ a b _dist 64 * a len b len + div 100 * 64 div
    dup 100 > [ drop 100 ] when
    100 swap -
    bs 34 < [ bs 3 div a len b len min * min ] when ]
  if ;

: _cmp ( xb:int x1:str x2:str yb:int y1:str y2:str -- int )
  xb yb =
  [ x1 y1 = x2 y2 = and
    [ 100 ]
    [ x1 y1 xb _score x2 y2 xb 2 * _score max ]
    if ]
  [ xb yb 2 * =
    [ x1 y2 xb _score ]
    [ xb 2 * yb =
      [ x2 y1 yb _score ]
      [ 0 ]
      if ]
    if ]
  if ;

: compare ( hash:str other:str -- int )
  "The similarity score 0 to 100 of two ssdeep hashes (blocksize:hash:hash text), 100 for identical hashes and 0 when the block sizes differ by more than a factor of two, the hashes share no run of 7 characters, or they are unrelated. It follows the reference ssdeep comparison: runs of more than three equal characters are cut to three, a weighted edit distance (insert and remove 1, replace 2) is scaled to a score, and for small block sizes the score is capped by the length of the shorter hash." doc
  "Hashing" category
  hash _parse _unpack other _parse _unpack _cmp ;

META: compare
  param other "The second ssdeep hash, as blocksize:hash:hash text." ;
  alias compare-ctph ;
  see-also ssdeep:digest ;
;
