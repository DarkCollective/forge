\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bcrypt: the bcrypt password hash (Provos and Mazieres, USENIX 1999) on EksBlowfish, with CyberChef's
\ "Bcrypt" (hash with a random salt and a number of rounds), "Bcrypt compare" and "Bcrypt parse". The
\ password is the input. The hash is the 60-character string $2b$10$<22 salt><31 hash> as ASCII bytes
\ (bcrypt's own base64 alphabet). Three words build it: hash draws a random salt (so it has the +random
\ effect, inferred from random:bytes-of) and hash-salted takes the salt, which makes it reproducible. The
\ work is _hash, _verify and _parse, private primitives (src/prims/bcrypt.ts) over the
\ Blowfish state of blowfish.ts: bcrypt is memory- and time-hard, far beyond the FL step budget.
IN: bcrypt

USING: random ;

: hash ( password:bytes cost:int=10 version:choice{2b|2a|2y}="2b" -- bytes )
  "The bcrypt hash of the input password with a fresh random 16-byte salt: the string $2b$10$ + 22 characters of salt + 31 of hash, as ASCII bytes. cost is the log2 of the number of rounds, 4 to 16 (E_RANGE otherwise; CyberChef's default of 10 takes about a tenth of a second). The version prefix is 2b, 2a or 2y; the three give the same hash. Only the first 72 bytes of the password count. The word is not deterministic; use bcrypt:hash-salted to fix the salt, and bcrypt:compare to check a password." doc
  "Key derivation" category
  password 16 random:bytes-of cost version _hash ;

: hash-salted ( password:bytes salt:key{hex|utf8|latin1|base64} cost:int=10 version:choice{2b|2a|2y}="2b" -- bytes )
  "The bcrypt hash of the input password with the given salt, which must be 16 bytes (E_RANGE otherwise). Deterministic; see bcrypt:hash for the string format, the cost (4 to 16) and the version. Reusing a salt defeats its purpose: use it to reproduce a known hash." doc
  "Key derivation" category
  password salt cost version _hash ;

: compare ( password:bytes encoded:str -- bool )
  "True when the input password gives the bcrypt string (2a, 2b or 2y). The hash is recomputed with the cost and salt in the string and compared in constant time. A string that is not a well-formed bcrypt hash is E_COERCE; a cost in it above 16 is E_RANGE. Where CyberChef returns the text Match or No match, this is a bool." doc
  "Key derivation" category
  password encoded _verify ;

: parse ( text:str -- str )
  "A text report of a bcrypt hash, as CyberChef's Bcrypt parse: the lines Rounds (the cost), Salt (the prefix, cost and 22 salt characters), Password hash (the last 31 characters) and Full hash. A string that is not a well-formed bcrypt hash is E_COERCE." doc
  "Key derivation" category
  text _parse ;

META: hash
  use-when "You want a bcrypt hash of a password, for example for a user table or an .htpasswd file, and a fresh random salt is what you want." ;
  param cost "The cost: the number of rounds is 2^cost, 4 to 16 (CyberChef's default is 10)." ;
  param version "The version prefix written into the string: 2b (default), 2a or 2y. The hash is the same." ;
  see-also bcrypt:hash-salted bcrypt:compare bcrypt:parse argon2:derive ;
  link "https://en.wikipedia.org/wiki/Bcrypt" "bcrypt on Wikipedia" ;
;

META: hash-salted
  use-when "You need the same bcrypt hash every time, for example to reproduce a known hash or to test code, and you can supply the 16-byte salt." ;
  param salt "The 16-byte salt." ;
  param cost "The cost: the number of rounds is 2^cost, 4 to 16." ;
  param version "The version prefix written into the string: 2b (default), 2a or 2y." ;
  see-also bcrypt:hash ;
  link "https://en.wikipedia.org/wiki/Bcrypt" "bcrypt on Wikipedia" ;
;

META: compare
  use-when "You have a stored bcrypt hash (it starts with $2a$, $2b$ or $2y$) and a password guess, and want to know whether they match." ;
  param encoded "The bcrypt string, as bcrypt:hash writes it." ;
  see-also bcrypt:hash bcrypt:parse ;
  link "https://en.wikipedia.org/wiki/Bcrypt" "bcrypt on Wikipedia" ;
;

META: parse
  use-when "You have a bcrypt hash and want to read off its cost, its salt and the hash part, without checking a password." ;
  see-also bcrypt:hash bcrypt:compare ;
  link "https://en.wikipedia.org/wiki/Bcrypt" "bcrypt on Wikipedia" ;
;
