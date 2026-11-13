\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ objectid: the creation time inside a MongoDB ObjectID. An ObjectID is 12 bytes written as 24 hex
\ digits; the first 4 bytes are the creation time as a big-endian count of seconds since the Unix
\ epoch (the BSON specification). The date is worked out from the day number with util:civil-from-days
\ (Howard Hinnant's algorithm) in whole-number arithmetic, so no date library or host clock is needed.
IN: objectid

: _iso ( secs:int -- str )
  secs 1000 * util:iso-from-ms "Z" cat ;

: timestamp ( data:str -- str )
  "The creation time of a MongoDB ObjectID: its first four bytes (8 hex digits) are the number of seconds since 1970-01-01 UTC. The input is the 24 hex digits of the ObjectID (either case, surrounding white space ignored); the result is the time in ISO 8601 UTC, with a .000 fraction because the field has whole seconds (507f1f77bcf86cd799439011, the example of the MongoDB manual, gives 2012-10-17T21:13:27.000Z). Anything but 24 hex digits is an error." doc
  "Conversions" category
  data [ util:space? ] util:trim-start [ util:space? ] util:trim-end
  dup len 24 = over str>codes [ util:hex-digit? ] filter len 24 = and not
  [ "an ObjectID is 24 hex digits" raise:coerce ] when
  0 8 slice 16 str>int-radix _iso ;

META: timestamp
  use-when "You have a MongoDB ObjectID, 24 hex digits, and want the time the document was created, read from the id itself." ;
  link "https://en.wikipedia.org/wiki/Unix_time" "Unix time on Wikipedia" ;
;
