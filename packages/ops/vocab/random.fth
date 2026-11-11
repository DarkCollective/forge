\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ random: the shared source of randomness (+random) for every vocabulary. This vocabulary is internal (it is in
\ INTERNAL_VOCABS): its words are callable from every vocabulary (random:below, or USING: random) and are never
\ listed in the catalogue; the CyberChef operations built on it are in `prng`. The primitives (src/prims/random.ts)
\ read the host CSPRNG, crypto.getRandomValues, never Math.random; a host without it is E_PRIMITIVE.
\
\   random:bytes-of ( n:int -- bytes )   n random bytes (n >= 0; E_RANGE below 0; E_LIMIT_VALUE above the value limit)
\   random:below ( n:int -- int )        uniform in [0, n), n >= 1 (E_RANGE otherwise), big integers allowed
\   random:between ( lo:int hi:int -- int )  uniform in [lo, hi], both ends included (E_RANGE when lo > hi)
\
\ Any word that calls one of them carries the +random effect, which the compiler infers. A test that needs a
\ fixed result stubs crypto.getRandomValues (see src/random.test.ts), or uses a range of size one.
IN: random

: between ( lo:int hi:int -- int )
  "A uniform random integer in [lo, hi], both ends included, from the host CSPRNG (no modulo bias; lo and hi may be big integers). lo above hi is E_RANGE. Shared word: call it qualified from any vocabulary." doc
  hi lo < [ "the lower bound of a random integer is above the upper bound" raise:range ] when
  hi lo - 1 + below lo + ;
