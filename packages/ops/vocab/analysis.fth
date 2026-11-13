\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ analysis: statistics of the bytes of an input. Written in FL over the core words, except
\ _log2, a private primitive (src/prims/analysis.ts): the core has no logarithm.
IN: analysis

\ Occurrences of byte b in the latin-1 text (one code point per byte): pieces minus one.
: _count ( text:str b:int -- int )
  b util:cp>str text swap split len 1 - ;

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

META: entropy
  use-when "You have a block of bytes, such as a file or a packed blob, and want to know how random it looks, from 0 for one repeated byte to 8 for fully random." ;
  link "https://en.wikipedia.org/wiki/Entropy_(information_theory)" "Entropy (information theory) on Wikipedia" ;
;

: frequency ( data:bytes -- list )
  "One record per byte value present: byte, count and percent of the input, sorted by count (descending) then byte." doc
  "Analysis" category
  data bytes>latin1 _counts 0 256 range swap zip
  [ 1 nth 0 > ] filter
  [ dup 1 nth 256 * swap 0 nth swap - ] map
  _sort-keys
  data len _rows ;

META: frequency
  use-when "You have bytes or text of unknown origin and want to see which byte values occur most often, for example to find the common letters of a substitution cipher." ;
  link "https://en.wikipedia.org/wiki/Frequency_analysis" "Frequency analysis on Wikipedia" ;
;

\ ---------------------------------------------------------------------------------------------
\ Index of coincidence and chi-squared
\ ---------------------------------------------------------------------------------------------

\ The counts of the 26 letters A to Z (upper and lower case together) from the 256 byte counts.
: _letters ( counts:list -- list )
  0 26 range [ dup counts swap 65 + nth swap counts swap 97 + nth + ] map ;

\ The counts to analyse: the 26 letters, or all 256 byte values.
: _scope ( counts:list letters:bool -- list )
  letters [ counts _letters ] [ counts ] if ;

\ A ratio of two integers as a float; 0.0 when the denominator is 0.
: _ratio ( num:int den:int -- num )
  den 0 = [ 0.0 ] [ num den / ] if ;

: _total ( counts:list -- int )
  counts util:sum ;

\ The index of coincidence of counts: the sum of n (n - 1) over the symbols divided by N (N - 1),
\ where N is the sum of the counts; times the number of symbols when normalised.
: _ioc ( counts:list normalise:bool -- num )
  counts 0 [ dup 1 - * + ] reduce
  normalise [ counts len * ] when
  counts _total dup 1 - * _ratio ;

: index-of-coincidence ( data:bytes scope:choice{letters|bytes}=letters normalise:bool=false -- num )
  "Index of coincidence: the chance that two symbols taken from the data without replacement are equal, that is the sum of n(n-1) over the symbols divided by N(N-1), N being the number of symbols. With scope letters only the ASCII letters A to Z count, upper and lower case together (26 symbols); with bytes every byte counts (256 symbols). Fewer than two symbols give 0. With normalise the result is multiplied by the number of symbols (26 or 256), so that uniform random text gives about 1 and English about 1.73 for letters. English text gives about 0.0667 and random letters about 0.0385 unnormalised." doc
  "Analysis" category
  data bytes>latin1 _counts scope "letters" = _scope normalise _ioc ;

META: index-of-coincidence
  use-when "You have a text in letters, often a ciphertext, and want its index of coincidence, to tell English-like letters from random ones or from a repeating-key cipher." ;
  link "https://en.wikipedia.org/wiki/Index_of_coincidence" "Index of coincidence on Wikipedia" ;
  param scope "letters: only A to Z, either case (26 symbols). bytes: all 256 byte values." ;
  param normalise "Multiply by the number of symbols, so that 1 is the value for uniform random symbols." ;
  see-also analysis:chi-squared analysis:entropy analysis:frequency ;
;

\ English letter frequencies A to Z in units of 1/100000 (the table of Wikipedia, "Letter
\ frequency", from a large corpus of English text); rounding makes them add up to 99999, the
\ total used as the denominator of the proportions.
: _english ( -- list )
  { 8167 1492 2782 4253 12702 2228 2015 6094 6966 153 772 4025 2406
    6749 7507 1929 95 5987 6327 9056 2758 978 2360 150 1974 74 } ;

\ One term of the statistic: (O - E)^2 / E for observed count o and expected count
\ E = n * w / total (a float, rounded once). A weight w of 0 is never given.
: _chi-term ( o:int w:int n:int total:int -- num )
  n w * total / dup o swap - dup * swap / ;

: _chi-uniform ( counts:list n:int -- num )
  counts 0 [ 256 * n - dup * + ] reduce
  n 256 * _ratio ;

: _chi-english ( counts:list n:int -- num )
  n 0 =
  [ 0.0 ]
  [ counts _english zip 0.0
    [ dup 0 nth swap 1 nth n 99999 _chi-term + ] reduce ]
  if ;

: chi-squared ( data:bytes reference:choice{uniform|english}=uniform -- num )
  "Pearson's chi-squared statistic, the sum of (observed - expected)^2 / expected, for the bytes. With reference uniform every one of the 256 byte values is expected N/256 times (a large value means the bytes are not uniform, as in text; random data gives about 255). With reference english only the ASCII letters count (either case): the 26 letters are expected in the proportions of English text (e is 12.7%, z is 0.07%), and a small value means English-like letter frequencies (25 degrees of freedom). Empty input, or no letters for english, gives 0." doc
  "Analysis" category
  data bytes>latin1 _counts
  reference "english" =
  [ _letters dup _total _chi-english ]
  [ data len _chi-uniform ]
  if ;

META: chi-squared
  use-when "You have a candidate decryption or any text and want to score how far its letter frequencies are from English, where a small score means English-like." ;
  link "https://en.wikipedia.org/wiki/Chi-squared_test" "Chi-squared test on Wikipedia" ;
  param reference "uniform: all 256 byte values equally likely. english: the 26 letters at English frequencies (other bytes ignored)." ;
  see-also analysis:index-of-coincidence analysis:entropy analysis:frequency ;
;
