\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ prng: the random generators of CyberChef, over the shared `random` vocabulary (host CSPRNG, crypto.getRandomValues).
\ Both words ignore their input: they are generators, and an op needs a data input to sit in a recipe. They carry the
\ +random effect, so their output cannot have fixed vectors; the vectors are errors and ranges of size one, and the
\ structure (length, range, spread) is tested in src/prng.test.ts.
IN: prng

USING: random util ;

: bytes ( bytes length:int[0..1048576]=32 -- bytes )
  "Random bytes from the host's cryptographic random generator (crypto.getRandomValues, never Math.random): length of them, 32 by default, at most 1 MiB. The input is ignored. The output is bytes; chain hex:encode or base64:encode to see them as text. A host with no cryptographic random generator is E_PRIMITIVE. The output differs on every call (the word carries the +random effect)." doc
  "Generators" category
  drop length random:bytes-of ;

: integers ( bytes min:int=0 max:int=99 count:int[1..65536]=1 delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab|none}="space" -- str )
  "Random integers, each uniform in [min, max] with both ends included (rejection sampling on the cryptographic random generator, so there is no modulo bias; the bounds may be big integers). count of them are written as decimal text, joined by the delimiter. The input is ignored. A min above max is E_RANGE. The output differs on every call (the word carries the +random effect)." doc
  "Generators" category
  drop
  max min < [ "the minimum is above the maximum" raise:range ] when
  0 count range [ drop min max random:between int>str ] map delimiter util:delimiter join ;

META: bytes
  param length "How many random bytes (0 to 1,048,576)." ;
  see-also hex:encode base64:encode ;
;

META: integers
  param min "The smallest value that can come out (may be negative)." ;
  param max "The largest value that can come out (included)." ;
  param count "How many integers (1 to 65,536)." ;
  param delimiter "The text between the integers." ;
  see-also prng:bytes ;
;
