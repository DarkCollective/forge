\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ raise: the standard way for FL ops to raise typed errors. FL itself has only `fail` (E_USER).
\ Use raise:coerce for data that cannot be decoded (E_COERCE) and raise:range for a bad argument
\ (E_RANGE), via USING: raise or the qualified names. The words are TypeScript primitives
\ (src/prims/raise.ts); they have no outputs, so they are not catalogue operations.
IN: raise
