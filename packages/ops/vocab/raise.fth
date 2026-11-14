\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ raise: the v0.1 way for FL ops to raise typed errors, kept for the vocabularies that still call it. New code
\ writes the core words instead: fail-coerce for data that cannot be decoded (E_COERCE) and fail-range for a bad
\ argument (E_RANGE), which raise the same error (code, message and detail; only the word that raised it differs).
\ The two words, raise:coerce and raise:range, are TypeScript primitives (src/prims/raise.ts) with no outputs, so
\ they are not catalogue operations and this file defines no FL words.
IN: raise
