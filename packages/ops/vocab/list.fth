\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ list: the shared list words that FL lacks (the core has no sort, and shuffling in FL is quadratic). This vocabulary
\ is internal (it is in INTERNAL_VOCABS): its words are callable from every vocabulary (list:sort, or USING: list)
\ and are never listed in the catalogue. The first three are primitives (src/prims/list.ts); unique is FL.
\
\   list:sort ( items:list -- list )              stable ascending sort of numbers or of strings
\   list:sort-by ( items:list keys:list -- list ) items in the stable ascending order of parallel keys
\   list:shuffle ( items:list -- list )           uniform random permutation (+random)
\   list:unique ( items:list -- list )            each string once, in the order of first appearance (FL, below)
\
\ Order: numbers (int and num mixed) numerically, big integers included; strings by code point. A list that mixes
\ numbers and strings, or holds other values, is E_COERCE. To sort by something else, compute a key per item
\ with map and use sort-by: [ lower ] map for case-insensitive, [ len ] map for length, and so on.
IN: list

: unique ( items:list -- list )
  "The items of a list of strings with repeats dropped, each kept at its first position (a record keeps the first position of a key, and looks it up in constant time, so this is linear). A list holding anything but strings is an error. Shared word: call it qualified from any vocabulary." doc
  items items zip >record keys ;
