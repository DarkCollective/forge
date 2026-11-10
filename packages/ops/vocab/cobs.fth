\ cobs: Consistent Overhead Byte Stuffing, Cheshire and Baker, "Consistent Overhead Byte Stuffing",
\ IEEE/ACM Transactions on Networking 7(2), 1999. Encoded data has no zero byte. The frame delimiter
\ (a zero byte after the encoded data) is not added or expected. Written in FL, except _starts, a
\ private primitive (src/prims/cobs.ts) that walks the blocks of the data to decode.
IN: cobs

\ ---- encode ----

\ The k-th full block of the run p: code 255 and 254 data bytes, with no implied zero.
: _full ( p:bytes k:int -- bytes )
  #[ ff ] p k 254 * k 254 * 254 + slice cat ;

: _fulls ( p:bytes -- bytes )
  0 p len 254 div range [ p swap _full ] map #[ ] bjoin ;

\ The block of the bytes of p after its full blocks: code remainder+1.
: _tail ( p:bytes -- bytes )
  { p len 254 mod 1 + } list>bytes p p len 254 div 254 * p len slice cat ;

\ The blocks of one run of non-zero bytes. Unless the run is the last one and ends exactly on a full
\ block, it ends in a remainder block (which stands for the zero that follows it).
: _run ( p:bytes last:bool -- bytes )
  p len 0 > p len 254 mod 0 = and last and
  [ p _fulls ]
  [ p _fulls p _tail cat ]
  if ;

\ The runs of non-zero bytes, as Latin-1 text pieces: k zeros give k+1 runs.
: _runs ( ps:list -- bytes )
  ps [ swap latin1>bytes swap ps len 1 - = _run ] mapi #[ ] bjoin ;

: encode ( bytes -- bytes )
  "Encode with COBS (Cheshire and Baker, 1999): the result has no zero byte and is at most one byte longer per 254 input bytes, plus one. No trailing zero delimiter is added. Empty input gives the single byte 01." doc
  "Encodings" category
  bytes>latin1 0 util:cp>str split _runs ;

\ ---- decode ----

\ One block at pos: its data, plus the zero it stands for unless its code is 255 or it is the last.
: _piece ( data:bytes pos:int last:bool -- bytes )
  data pos 1 + pos data pos nth + slice
  data pos nth 255 < last not and
  [ #[ 00 ] cat ] when ;

\ The decoded blocks, joined. ps is the list of block offsets, already checked by _starts.
: _decode ( data:bytes ps:list -- bytes )
  ps [ ps len 1 - = data -rot _piece ] mapi #[ ] bjoin ;

: decode ( bytes -- bytes )
  "Decode COBS data. A zero byte, or a block that runs past the end of the data, raises E_COERCE. A trailing zero delimiter is not accepted. Empty input gives empty output." doc
  "Encodings" category
  dup _starts _decode ;

META: decode
  see-also cobs:encode ;
;
