\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ prime: a random prime of a given size, over the shared `random` vocabulary (host CSPRNG, crypto.getRandomValues).
\ The prime is drawn uniformly from the primes of exactly that many bits (or decimal digits) by rejection sampling:
\ a random number of the right size is tested and thrown away if it is composite. The test is trial division by the
\ primes below 200 (one gcd against their product), then the Miller-Rabin test with random bases: 40 rounds below
\ 2^256, 8 rounds above, where the sieve has already thrown away nearly every composite and each round costs far
\ more. The word ignores its input (it is a generator) and carries the +random effect, so its output cannot have
\ fixed vectors; the vectors are errors, and the structure is tested in src/prime.test.ts.
IN: prime

USING: random ;

\ The primes below 200, used for trial division and for exact answers on small numbers.
: _small ( -- list )
  { 2 3 5 7 11 13 17 19 23 29 31 37 41 43 47 53 59 61 67 71 73 79 83 89 97 101 103 107 109 113 127 131
    137 139 149 151 157 163 167 173 179 181 191 193 197 199 } ;

\ n - 1 = d * 2^s with d odd: d and s.
: _factor2 ( m:int s:int -- int int )
  m 2 mod 0 = [ m 2 div s 1 + recurse ] [ m s ] if ;

\ True when n - 1 is reached by squaring x at most k times.
: _squarings ( x:int n:int k:int -- bool )
  k 0 <= [ false ]
  [ x x * n mod dup n 1 - = [ drop true ] [ n k 1 - recurse ] if ] if ;

\ One Miller-Rabin round of n = d * 2^s + 1 with the base a: false means n is certainly composite.
: _round ( n:int d:int s:int a:int -- bool )
  a d n powmod
  dup 1 = over n 1 - = or
  [ drop true ] [ n s 1 - _squarings ] if ;

\ k Miller-Rabin rounds with random bases in [2, n - 2], stopping at the first that proves n composite.
: _rounds ( d:int s:int n:int k:int -- bool )
  k 0 = [ true ]
  [ n d s 2 n 2 - random:between _round
    [ d s n k 1 - recurse ] [ false ] if ] if ;

\ True when the odd number n above 3 passes k rounds of the Miller-Rabin test.
: _mr ( n:int k:int -- bool )
  n 1 - 0 _factor2 n k _rounds ;

\ True when n is prime: exact below 40,000 (every composite there has a factor below 200), then trial division by
\ the primes below 200 (their product has a common factor with n), then Miller-Rabin.
: _prime? ( n:int -- bool )
  n 2 < [ false ]
  [ n 200 < [ _small [ n = ] filter len 0 > ]
    [ n _small 1 [ * ] reduce gcd 1 <> [ false ]
      [ n 40000 < [ true ]
        [ n 1 256 shl < [ n 40 _mr ] [ n 8 _mr ] if ] if ] if ] if ] if ;

\ A uniform random prime in [lo, hi] (the range holds one): candidates are drawn and tested until one is prime.
: _draw ( lo:int hi:int -- int )
  0 [ drop lo hi random:between dup _prime? not ] loop ;

\ The range of the numbers of the given size: size bits (top bit set) or size decimal digits (no leading zero).
: _range ( size:int unit:str -- int int )
  unit "bits" =
  [ size 2 < size 2048 > or [ "a prime has 2 to 2048 bits" raise:range ] when
    1 size 1 - shl 1 size shl 1 - ]
  [ size 1 < size 616 > or [ "a prime has 1 to 616 decimal digits" raise:range ] when
    10 size 1 - pow 10 size pow 1 - ] if ;

: _batch ( lo:int hi:int count:int format:str delimiter:str -- str )
  0 count range [ drop lo hi _draw format "hex" = [ 16 int>str-radix "0x" swap cat ] [ int>str ] if ] map
  delimiter util:delimiter join ;

: generate ( bytes size:int[1..2048]=512 unit:choice{bits|digits}="bits" count:int[1..100]=1 format:choice{decimal|hex}="decimal" delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab|none}="newline" -- str )
  "Random primes from the host's cryptographic random generator (never Math.random): count of them, each drawn uniformly from the primes that have exactly size bits (top bit set, 2 to 2048) or exactly size decimal digits (1 to 616), tested by trial division and Miller-Rabin with random bases (40 rounds below 256 bits, 8 above: a composite passes with probability below 4 to the power -8 in the worst case and far below that for a random candidate). A 2048-bit prime takes about 2 seconds, so a large count of large primes can reach the 30 second time limit (E_LIMIT_TIME). Written as decimal text, or as lower-case hex text with a 0x in front (as CyberChef writes it), joined by the delimiter. The input is ignored. A size out of range for its unit is E_RANGE. The output differs on every call (the word carries the +random effect)." doc
  "Generators" category
  drop
  size unit _range count format delimiter _batch ;

META: generate
  use-when "You need a random prime of a given size, for example to test big-number code, drawn from a cryptographic random source." ;
  link "https://en.wikipedia.org/wiki/Prime_number" "Prime number on Wikipedia" ;
  param size "The size of each prime: a number of bits (2 to 2048) or of decimal digits (1 to 616), see unit." ;
  param unit "bits: the prime has exactly that many bits. digits: exactly that many decimal digits." ;
  param count "How many primes (1 to 100)." ;
  param format "decimal, or lower-case hex with a 0x in front." ;
  param delimiter "The text between the primes." ;
  see-also prng:integers ;
;
