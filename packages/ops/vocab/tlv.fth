\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ tlv: Parse TLV, the CyberChef operation of that name. The walk over the elements, the range checks and the JSON
\ text are all FL; the elements are gathered with a collector, so the walk is linear.
IN: tlv

USING: json ;

\ Raises E_COERCE for TLV data that is cut short or cannot be read: why, then the offset.
: _cut ( why:str at:int -- )
  "cannot read TLV data: " why cat " at offset " cat at int>str cat fail-coerce ;

\ The BER/DER length (X.690) whose first byte is at p: the length and the offset after it. A short form is a byte below
\ 0x80; a long form is 0x80 plus n, then n bytes, big-endian, with n up to 6. The indefinite form 0x80 and the
\ reserved byte 0xff are refused.
: _ber-length ( data:bytes p:int -- int int )
  p data len >= [ "the length is missing (truncated)" p _cut ] when
  data p nth :> b
  p 1 + :> q
  b 127 band :> n
  {
    [ b 128 < ] [ b q ]
    [ b 128 = ] [ "the indefinite BER length is not supported" p _cut ]
    [ b 255 = ] [ "the BER length byte 0xff is reserved" p _cut ]
    [ n 6 > ] [ "a BER length of " n int>str cat " bytes is too long" cat p _cut ]
    [ data len q - n < ] [
      "the length needs " n int>str cat " bytes but only " cat data len q - int>str cat " are left (truncated)" cat q _cut
    ]
    [ data q n util:be-int q n + ]
  } cond ;

\ The fixed-width length at p, little-endian as CyberChef reads it: the length and the offset after it.
: _fixed-length ( data:bytes p:int lw:int -- int int )
  data len p - lw < [
    "the length needs " lw int>str cat " bytes but only " cat data len p - int>str cat " are left (truncated)" cat p _cut
  ] when
  lw 1 = [ data p nth ] [ data p lw util:le-int ] if p lw + ;

\ Raises E_COERCE for a field that runs past the end: the field ("the length needs"), how many bytes it asks for,
\ how many are left, and the offset to report.
: _short ( what:str count:int left:int at:int -- )
  what " " cat count int>str cat " bytes but only " cat left int>str cat " are left (truncated)" cat at _cut ;

\ The elements of the data as a list of records of key (left out when tw is 0), length and value, as CyberChef's
\ Parse TLV lists them: the tag and value bytes as lists of ints. Both widths 0 is E_RANGE, unless the lengths are
\ BER. The walk is one loop in one quotation, with the offset p of the next element on the stack: a record per
\ element goes straight into the collector, so the cost is linear.
: _parse ( data:bytes tw:int lw:int ber:bool -- list )
  tw 0 = lw 0 = and ber not and [ "the tag width and the length width cannot both be 0 bytes" fail-range ] when
  data len :> n
  tw 0 > :> keyed
  \ A length of one byte, or a short BER length, is read in the loop; the other forms go to a word. (Nested ifs, not
  \ a cond: this is the hot path, and a cond costs more steps per element.)
  ber not lw 1 = and :> fast
  [
    0 [ dup n < ] [
      :> p
      p tw + :> q
      q n > [ "the tag at offset " p int>str cat " needs" cat tw n p - p _short ] when
      ber
      [ q n < [ data q nth 128 < ] [ false ] if [ data q nth q 1 + ] [ data q _ber-length ] if ]
      [ fast q n < and [ data q nth q 1 + ] [ data q lw _fixed-length ] if ] if :> r :> size
      r size + :> next
      next n > [ "the value declares" size n r - r _short ] when
      data r next slice bytes>list :> value
      keyed [ { { "key" data p q slice bytes>list } { "length" size } { "value" value } } ]
      [ { { "length" size } { "value" value } } ] if >record emit
      next
    ] while drop
  ] collect ;

: parse ( data:bytes tag-bytes:int=1 length-bytes:int=1 ber:bool=false indent:int=4 -- str )
  "Read a run of tag-length-value elements and write them as JSON text, as CyberChef's Parse TLV does: an array with one object per element, with the tag bytes as an array of numbers (key; left out when tag-bytes is 0, for length-value data), the length (a number) and the value bytes as an array of numbers (value). The tag is tag-bytes bytes (0 to 16) and the length length-bytes bytes (0 to 8, little-endian, as CyberChef reads it); with ber on the length is read in the BER/DER form of X.690 instead (a byte below 128, or 128 plus the number of length bytes that follow, big-endian, up to 6; the indefinite form and the reserved byte 255 are E_COERCE) and length-bytes is not used. Both widths 0 is E_RANGE. Elements are not opened: a constructed value stays a list of bytes. Empty input gives []. A header or a value that runs past the end of the data is E_COERCE with the offset (CyberChef silently returns the shorter value). indent is the spaces per level (default 4, as CyberChef writes it; 0 gives compact text; an addition to CyberChef's)" doc
  "Data format" category
  tag-bytes 0 16 "the tag width" check-int-range
  length-bytes 0 8 "the length width" check-int-range
  data tag-bytes length-bytes ber _parse indent json:stringify ;

META: parse
  use-when "You have tag-length-value bytes, such as EMV card data or a binary record, and want each element listed with its tag, length and value." ;
  param tag-bytes "How many bytes the tag of an element has; 0 for length-value data." ;
  param length-bytes "How many bytes the length of an element has (little-endian); not used with BER lengths." ;
  param ber "Read the length in the BER/DER form (short form below 128, long form 128 plus a byte count)." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  link "https://en.wikipedia.org/wiki/Type-length-value" "Type-length-value on Wikipedia" ;
;
