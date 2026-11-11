\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ clock: the shared source of the current time (+time) for every vocabulary, and the Get Time operation. The one
\ primitive (src/prims/clock.ts) reads the host clock; every other word is FL over it.
\
\   clock:now-ms ( -- int )   milliseconds since the Unix epoch
\   clock:now-s ( -- int )    whole seconds since the Unix epoch (the milliseconds divided, rounded down)
\
\ Both have no input, so they are never catalogue ops; clock:get-time is the op. A word that calls one carries the
\ +time effect, which the compiler infers. A test that needs a fixed time fakes the clock (vi.useFakeTimers with
\ vi.setSystemTime), see src/clock.test.ts.
IN: clock

: now-s ( -- int )
  "The current time as whole seconds since the Unix epoch (the millisecond clock divided by 1000, rounded down). Shared word: call it qualified from any vocabulary." doc
  now-ms 1000 div ;

: get-time ( bytes unit:choice{seconds|milliseconds|microseconds|nanoseconds}="milliseconds" -- str )
  "The current time since the Unix epoch (1970-01-01T00:00:00Z) in the chosen unit, as decimal text. The input is ignored. The host clock counts milliseconds, so microseconds and nanoseconds are that count times 1,000 and 1,000,000 (the finer digits are zero). The output differs on every call (the word carries the +time effect)." doc
  "Date/Time" category
  drop
  now-ms
  unit "seconds" = [ 1000 div ] [
  unit "microseconds" = [ 1000 * ] [
  unit "nanoseconds" = [ 1000000 * ] [ ] if ] if ] if
  int>str ;

META: get-time
  param unit "The unit to count the time since the Unix epoch in." ;
;
