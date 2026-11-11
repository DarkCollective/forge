\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ list: the shared list words that FL lacks (the core has no sort, and shuffling in FL is quadratic). This vocabulary
\ is internal (it is in INTERNAL_VOCABS): its words are callable from every vocabulary (list:sort, or USING: list)
\ and are never listed in the catalogue. All three are primitives (src/prims/list.ts); nothing here is FL.
\
\   list:sort ( items:list -- list )              stable ascending sort of numbers or of strings
\   list:sort-by ( items:list keys:list -- list ) items in the stable ascending order of parallel keys
\   list:shuffle ( items:list -- list )           uniform random permutation (+random)
\
\ Order: numbers (int and num mixed) numerically, big integers included; strings by code point. A list that mixes
\ numbers and strings, or holds other values, is E_COERCE. To sort by something else, compute a key per item
\ with map and use sort-by: [ lower ] map for case-insensitive, [ len ] map for length, and so on.
IN: list
