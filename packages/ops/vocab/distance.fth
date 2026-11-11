\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ distance: how far apart two samples are. The two samples are one input cut at a delimiter. hamming is FL over
\ bxor and translate; levenshtein is FL over one private primitive, distance:_levenshtein (src/prims/distance.ts),
\ because the dynamic programme needs a fast mutable array (see the primitive file).
IN: distance

USING: util ;

\ The two samples of the input; anything but exactly two is E_COERCE.
: _two ( data:str delimiter:str -- list )
  data delimiter split dup len 2 <>
  [ "the input needs exactly two samples separated by the delimiter" raise:coerce ] when ;

: _pop ( v:int -- int )
  v 2 int>str-radix "1" split len 1 - ;

\ The number of set bits in each byte, as a lookup table for translate.
: _pop-table ( -- bytes )
  0 256 range [ _pop ] map list>bytes ;

: _nonzero ( x:bytes -- int )
  x len x bytes>latin1 0 util:cp>str split len 1 - - ;

: _bit-count ( x:bytes -- int )
  x _pop-table translate bytes>list util:sum ;

: _bytes-distance ( a:bytes b:bytes unit:str -- int )
  a len b len <> [ "the samples must be of equal length" raise:coerce ] when
  a len 0 =
  [ 0 ]
  [ a b bxor unit "bit" = [ _bit-count ] [ _nonzero ] if ]
  if ;

: _codes-distance ( a:list b:list -- int )
  a len b len <> [ "the samples must be of equal length" raise:coerce ] when
  a b zip [ dup 0 nth swap 1 nth <> ] filter len ;

: _measure ( a:str b:str unit:str format:str -- int )
  format "hex" =
  [ unit "char" = [ "the char unit needs raw input, not hex" raise:range ] when
    a hex>bytes b hex>bytes unit _bytes-distance ]
  [ unit "char" =
    [ a str>codes b str>codes _codes-distance ]
    [ a str>bytes b str>bytes unit _bytes-distance ]
    if ]
  if ;

: hamming ( data:str delimiter:str[1..]="\n\n" unit:choice{byte|char|bit}="byte" format:choice{raw|hex}="raw" -- int )
  "The Hamming distance of two samples of equal length: the number of positions at which they differ. The input holds both samples, cut at the delimiter (a blank line by default); anything but exactly two samples, or samples of different length, is E_COERCE. The unit is the byte (of the UTF-8 text, or of the decoded hex), the char (a code point; raw input only) or the bit (the differing bits of the bytes). With format hex each sample is read as hexadecimal bytes (white space is ignored). CyberChef's options and defaults, except that its Hamming distance counts bytes of the text as UTF-8 and adds the char unit." doc
  "Analysis" category
  data delimiter _two dup 0 nth swap 1 nth unit format _measure ;

: levenshtein ( data:str delimiter:str[1..]="\n" insertion:int[0..1000000]=1 deletion:int[0..1000000]=1 substitution:int[0..1000000]=1 -- int )
  "The Levenshtein (edit) distance from the first sample to the second: the least total cost of inserting, deleting and substituting characters (code points) to turn one into the other. The input holds both samples, cut at the delimiter (a line feed by default); anything but exactly two samples is E_COERCE. Insertion adds a character of the second sample, deletion removes a character of the first, and each costs 1 unless set. The product of the two lengths is limited to 100 million (E_LIMIT_VALUE): about 10,000 characters each." doc
  "Analysis" category
  data delimiter _two dup 0 nth swap 1 nth insertion deletion substitution _levenshtein ;

META: hamming
  param delimiter "What separates the two samples. It is text, not a pattern; the default is a blank line (two line feeds)." ;
  param unit "Count differing bytes, characters (code points) or bits." ;
  param format "raw reads each sample as text, hex as hexadecimal bytes." ;
  see-also distance:levenshtein ;
;

META: levenshtein
  param delimiter "What separates the two samples. It is text, not a pattern; the default is a line feed." ;
  param insertion "The cost of inserting one character." ;
  param deletion "The cost of deleting one character." ;
  param substitution "The cost of replacing one character by another." ;
  see-also distance:hamming ;
;
