\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ list: the shared list words. This vocabulary is internal (it is in INTERNAL_VOCABS): its words are callable
\ from every vocabulary (list:sort, or USING: list) and are never listed in the catalogue. All of them are FL
\ over the core words (sort, sort-by, zip, random:below); there is no TypeScript here.
\
\   list:sort ( items:list -- list )              stable ascending sort of numbers or of strings
\   list:sort-by ( items:list keys:list -- list ) items in the stable ascending order of parallel keys
\   list:shuffle ( items:list -- list )           uniform random permutation (+random, through random:below)
\   list:unique ( items:list -- list )            each string once, in the order of first appearance
\
\ Order: numbers (int and num mixed) numerically, big integers included; strings by code point (the core
\ order); a list of bytes values sorts lexicographically too. A list that mixes numbers and strings, or holds
\ other values, is E_TYPE. To sort by something else, compute a key per item with map and use sort-by:
\ [ lower ] map for case-insensitive, [ len ] map for length, and so on. The words here are named like the
\ core words they use, so the core ones are called as core:sort and core:sort-by.
IN: list

: sort ( items:list -- list )
  "A stable ascending sort of a list of numbers (int and num together, compared as numbers, big integers included) or of strings (by code point). A list that mixes numbers and strings, or holds anything else, is E_TYPE. Shared word: call it qualified from any vocabulary." doc
  items core:sort ;

: sort-by ( items:list keys:list -- list )
  "The items in the order of a stable ascending sort of their keys (all numbers or all strings, by the rules of list:sort; E_TYPE otherwise). The lists must be the same length (E_RANGE). Compute the keys with map. Shared word: call it qualified from any vocabulary." doc
  items len keys len <>
  [ "the items and the keys must be the same length" fail-range ] when
  items keys zip [ 1 nth ] core:sort-by [ 0 nth ] map ;

\ The pairs (item key) in the order of one random 53-bit key per item.
: _draw ( items:list -- list )
  items dup [ drop 9007199254740992 random:below ] map zip [ 1 nth ] core:sort-by ;

\ Whether two neighbouring pairs of a sorted list have the same key.
: _tie? ( pairs:list -- bool )
  pairs len 1 >
  [ pairs 1 pairs len slice pairs 0 pairs len 1 - slice zip
    [ dup 0 nth 1 nth swap 1 nth 1 nth = ] any? ]
  [ false ]
  if ;

: shuffle ( items:list -- list )
  "A uniform random permutation of the list: the items are sorted by independent random 53-bit keys from the host CSPRNG, and the draw is repeated in the (about 2^-22 for 65,536 items) case that two keys are equal, so that every order is exactly as likely as any other. Shared word: call it qualified from any vocabulary." doc
  {
    [ items len 2 < ] [ items ]
    [ items _draw dup _tie? [ drop items recurse ] [ [ 0 nth ] map ] if ]
  } cond ;

: unique ( items:list -- list )
  "The items of a list of strings with repeats dropped, each kept at its first position (a record keeps the first position of a key, and looks it up in constant time, so this is linear). A list holding anything but strings is an error. Shared word: call it qualified from any vocabulary." doc
  items items zip >record keys ;
