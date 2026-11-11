\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ objectid: the creation time inside a MongoDB ObjectID. An ObjectID is 12 bytes written as 24 hex
\ digits; the first 4 bytes are the creation time as a big-endian count of seconds since the Unix
\ epoch (the BSON specification). The date is worked out from the day number with Howard Hinnant's
\ civil-from-days algorithm in whole-number arithmetic, so no date library or host clock is needed.
IN: objectid

: _yoe ( doe:int -- int )
  doe doe 1460 div - doe 36524 div + doe 146096 div - 365 div ;

: _doy ( doe:int yoe:int -- int )
  doe 365 yoe * yoe 4 div + yoe 100 div - - ;

: _civil5 ( y:int m:int d:int -- int int int )
  y m 2 <= [ 1 ] [ 0 ] if + m d ;

: _civil4 ( y:int doy:int mp:int -- int int int )
  y mp 10 < [ mp 3 + ] [ mp 9 - ] if doy 153 mp * 2 + 5 div - 1 + _civil5 ;

: _civil2 ( era:int doe:int yoe:int -- int int int )
  yoe era 400 * + doe yoe _doy dup 5 * 2 + 153 div _civil4 ;

\ The year, month (1 to 12) and day of the month of a day number counted from 1970-01-01
\ (proleptic Gregorian calendar).
: _civil-from-days ( days:int -- int int int )
  days 719468 + dup 146097 div swap 146097 mod dup _yoe _civil2 ;

: _pad ( n:int width:int -- str )
  "0" width n int>str len - 0 max util:repeat-str n int>str cat ;

: _iso ( secs:int -- str )
  secs 86400 div _civil-from-days
  rot 4 _pad "-" cat rot 2 _pad cat "-" cat swap 2 _pad cat "T" cat
  secs 86400 mod 3600 div 2 _pad cat ":" cat
  secs 3600 mod 60 div 2 _pad cat ":" cat
  secs 60 mod 2 _pad cat ".000Z" cat ;

: timestamp ( data:str -- str )
  "The creation time of a MongoDB ObjectID: its first four bytes (8 hex digits) are the number of seconds since 1970-01-01 UTC. The input is the 24 hex digits of the ObjectID (either case, surrounding white space ignored); the result is the time in ISO 8601 UTC, with a .000 fraction because the field has whole seconds (507f1f77bcf86cd799439011, the example of the MongoDB manual, gives 2012-10-17T21:13:27.000Z). Anything but 24 hex digits is an error." doc
  "Conversions" category
  data [ util:space? ] util:trim-start [ util:space? ] util:trim-end
  dup len 24 = over str>codes [ util:hex-digit? ] filter len 24 = and not
  [ "an ObjectID is 24 hex digits" raise:coerce ] when
  0 8 slice 16 str>int-radix _iso ;

META: timestamp
;
