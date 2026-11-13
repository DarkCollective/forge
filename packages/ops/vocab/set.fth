\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ set: set operations on text. The input holds two or more sets, cut at the sample delimiter (a blank line by default);
\ each set is a list of items cut at the item delimiter (a comma by default). Items are text, taken exactly as written
\ (no trimming, so a line break at the end of the input is part of the last item), and a set has each item once, in the
\ order of its first appearance. An empty set is empty text. All FL: a record is the lookup table (its keys are the
\ items), so no operation is quadratic.
IN: set

: _parse-set ( text:str delim:str -- list )
  text "" = [ { } ] [ text delim split list:unique ] if ;

\ The sets of the input, at least `least` of them (exactly that many when exact is true; the messages say 2, the only count used).
: _sets ( data:str sample:str item:str least:int exact:bool -- list )
  data sample split [ item _parse-set ] map
  dup len least < [ "the input needs at least 2 sets, cut by the sample delimiter" raise:range ] when
  exact [ dup len least <> [ "the input needs exactly 2 sets, cut by the sample delimiter" raise:range ] when ] when ;

: _lookup ( items:list -- record )
  items items zip >record ;

: _has? ( rec:record key:str -- bool )
  [ rec key get drop true ] [ drop false ] try ;

\ The items of a that are in (want true) or not in (want false) the record.
: _keep ( a:list rec:record want:bool -- list )
  a [ rec swap _has? want = ] filter ;

: _common ( a:list b:list -- list )
  a b _lookup true _keep ;

: _minus ( a:list b:list -- list )
  a b _lookup false _keep ;

: _either ( a:list b:list -- list )
  a b _minus b a _minus cat ;

: _union-all ( sets:list -- list )
  sets util:list-flatten list:unique ;

\ The first set and the union of all the others: ( sets -- first others ).
: _rest-union ( sets:list -- list list )
  sets 0 nth sets 1 sets len slice _union-all ;

: union ( data:str sample-delimiter:str[1..]="\n\n" item-delimiter:str[1..]="," -- str )
  "The union of the sets: every item that is in at least one of them, once, in the order of first appearance. The input is two or more sets cut at the sample delimiter, each set a list of items cut at the item delimiter; items are exact text (nothing is trimmed). The result is one set, its items joined by the item delimiter. Fewer than two sets is E_RANGE." doc
  "Arithmetic" category
  data sample-delimiter item-delimiter 2 false _sets _union-all item-delimiter join ;

: intersection ( data:str sample-delimiter:str[1..]="\n\n" item-delimiter:str[1..]="," -- str )
  "The intersection of the sets: the items that are in every one of them, in the order of the first set. Same input and output shape as union. Fewer than two sets is E_RANGE." doc
  "Arithmetic" category
  data sample-delimiter item-delimiter 2 false _sets dup 0 nth [ _common ] reduce item-delimiter join ;

: difference ( data:str sample-delimiter:str[1..]="\n\n" item-delimiter:str[1..]="," -- str )
  "The difference of the sets: the items of the first set that are in none of the others (A minus B, minus C ...), in the order of the first set. Same input and output shape as union. Fewer than two sets is E_RANGE." doc
  "Arithmetic" category
  data sample-delimiter item-delimiter 2 false _sets _rest-union _minus item-delimiter join ;

: symmetric-difference ( data:str sample-delimiter:str[1..]="\n\n" item-delimiter:str[1..]="," -- str )
  "The symmetric difference of the sets: the items that are in exactly one of two sets, the ones of the first set first. With more than two sets it is applied from left to right, so an item stays when it is in an odd number of the sets. Same input and output shape as union. Fewer than two sets is E_RANGE." doc
  "Arithmetic" category
  data sample-delimiter item-delimiter 2 false _sets dup 1 over len slice swap 0 nth [ _either ] reduce item-delimiter join ;

: _pairs ( x:str b:list -- list )
  b [ "(" x cat "," cat swap cat ")" cat ] map ;

: cartesian-product ( data:str sample-delimiter:str[1..]="\n\n" item-delimiter:str[1..]="," -- str )
  "The Cartesian product of two sets A and B: every pair (a,b) with a from A and b from B, written (a,b), the pairs of the first item of A first, joined by the item delimiter. The input must be exactly two sets cut at the sample delimiter (anything else is E_RANGE); an empty set gives an empty result." doc
  "Arithmetic" category
  data sample-delimiter item-delimiter 2 true _sets
  dup 1 nth swap 0 nth [ over _pairs ] map nip { } [ cat ] reduce item-delimiter join ;

: _grow ( acc:list item:str -- list )
  acc acc [ { item } swap cat ] map cat ;

\ The subsets in CyberChef's order: counting in binary with the first item as the most significant bit (items added
\ last to first, each in front of the subsets so far), then a stable sort by the length of the written subset.
: power-set ( data:str item-delimiter:str[1..]="," subset-delimiter:str[1..]="\n" -- str )
  "The power set of one set: all its subsets, 2 to the power n of them, each written as its items joined by the item delimiter and each followed by the subset delimiter, as CyberChef writes them (the result ends with the subset delimiter). The order is CyberChef's: the subsets in binary counting order with the first item as the most significant bit (for a,b,c: empty, c, b, b+c, a, a+c, a+b, a+b+c), then stably sorted by the length of the written subset, so a longer item can come after a subset of more items. The set is cut at the item delimiter; empty items and duplicates are removed (CyberChef keeps duplicates); it may have at most 16 items (E_RANGE beyond that) because the output doubles with every item. An empty set gives an empty result." doc
  "Arithmetic" category
  data item-delimiter _parse-set [ len 0 > ] filter
  dup len 0 =
  [ drop "" ]
  [ dup len 16 > [ "the power set is limited to 16 items" raise:range ] when
    rev { { } } [ _grow ] reduce
    [ item-delimiter join ] map
    dup [ len ] map list:sort-by
    [ subset-delimiter cat ] map "" join ]
  if ;

META: union
  use-when "You have two or more lists of items, separated by a blank line, and want one list of every item they contain, each item once." ;
  link "https://en.wikipedia.org/wiki/Union_(set_theory)" "Union (set theory) on Wikipedia" ;
  param sample-delimiter "The text between the sets." ;
  param item-delimiter "The text between the items of a set." ;
  see-also set:intersection ;
;

META: intersection
  use-when "You have two or more lists of items and want only the items that appear in every one of them." ;
  link "https://en.wikipedia.org/wiki/Intersection_(set_theory)" "Intersection (set theory) on Wikipedia" ;
  param sample-delimiter "The text between the sets." ;
  param item-delimiter "The text between the items of a set." ;
  see-also set:union ;
;

META: difference
  use-when "You have two or more lists of items and want the items of the first that are missing from all the others, for example words in one list that the rest lack." ;
  param sample-delimiter "The text between the sets." ;
  param item-delimiter "The text between the items of a set." ;
  see-also set:symmetric-difference ;
;

META: symmetric-difference
  use-when "You have two or more lists of items and want the items that are in only one of them, the ones that differ, for example between two versions of a list." ;
  link "https://en.wikipedia.org/wiki/Symmetric_difference" "Symmetric difference on Wikipedia" ;
  param sample-delimiter "The text between the sets." ;
  param item-delimiter "The text between the items of a set." ;
  see-also set:difference ;
;

META: cartesian-product
  use-when "You have two lists of items and want every pair with one item from each, for example every combination of a size and a colour to try." ;
  link "https://en.wikipedia.org/wiki/Cartesian_product" "Cartesian product on Wikipedia" ;
  param sample-delimiter "The text between the two sets." ;
  param item-delimiter "The text between the items of a set and between the pairs of the result." ;
  see-also set:power-set ;
;

META: power-set
  use-when "You have a list of items and want every subset of it, for example every combination of options to try, including the empty one." ;
  link "https://en.wikipedia.org/wiki/Power_set" "Power set on Wikipedia" ;
  param item-delimiter "The text between the items of the set and inside a subset." ;
  param subset-delimiter "The text between the subsets of the result." ;
  see-also set:cartesian-product ;
;
