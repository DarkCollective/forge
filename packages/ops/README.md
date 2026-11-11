# @forge/ops

The operation vocabularies of Forge: 244 ops in 113 vocabularies, written in FL (the Forth-like Forge language), plus the build-time catalogue and the loaders that make them available in Node and in the browser.

The package holds:

- `vocab/` the FL sources (`.fth`) and their test vectors (`.test.json`);
- `src/prims/` the few TypeScript primitives that FL cannot replace;
- `src/` the loaders (Node fs provider and Vite `import.meta.glob`), the dependency scan, and the catalogue builder;
- `dist/catalogue.json` the catalogue, derived from the vocabularies at build time (`npm run build`). Nothing is registered by hand.

## Layout per vocabulary

For a vocabulary `<v>`:

| File                  | Holds                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| `vocab/<v>.fth`       | the words, with their stack-effect headers and `META:` blocks                  |
| `vocab/<v>.test.json` | the op test vectors (schema: `vocab/vectors.schema.json`, spec: RECIPES.md §9) |
| `src/prims/<v>.ts`    | optional: primitives, only when FL cannot do the job (see below)               |
| `src/<v>.test.ts`     | tests of the FL vocabulary                                                     |

Every `.fth` file starts with the one-line licence comment `\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.` (a comment, so nothing reads it, and no check enforces it).

`src/prims/` holds only primitive modules and their tests (`src/prims/<v>.test.ts`). Tests of FL vocabularies go in `src/<v>.test.ts`. The package tests derive the vocabulary list from disk, so a new vocabulary is picked up without registering it. A qualified `see-also` counts as a load dependency, as does `USING:`.

## FL first

Ops are written in FL wherever feasible. A TypeScript primitive is allowed only when the core cannot express something (the core has no logarithm, so `analysis:_log2` is a primitive) or when FL is too slow on realistic input, measured at 64 KiB. Then the primitive is a minimal private `_helper`, and the op logic and metadata stay in FL.

The private primitives, each in `src/prims/<v>.ts`:

- `analysis:_log2`: the logarithm the core lacks;
- `charset:_decode`: the WHATWG decoder for an encoding label;
- `cobs:_starts`: the offsets of the blocks of COBS data;
- `float:_pack` and `float:_unpack`: decimal text to and from IEEE 754 bytes;
- `unicode:_normalize`: Unicode normalisation (NFC, NFD, NFKC, NFKD);
- `aes:_check-key`, `aes:_block-enc`, `aes:_block-dec`, `aes:_crypt` and `aes:_gcm`: AES over the audited `@noble/ciphers` (the block pair also drives `blockmode` for OFB); `aes-kw:_wrap` and `aes-kw:_unwrap`: RFC 3394 key wrap over noble's `aeskw`; `chacha:_crypt`, `salsa20:_crypt` and `xsalsa20:_crypt`: the stream ciphers over noble;
- the block ciphers without an audited library, each a private single-block pair and a key check, written from the specification: `des`, `triple-des`, `blowfish`, `rc2`, `rc6`, `twofish`, `sm4`, `tea`, `xtea` and `present` have `_check-key`, `_encrypt-block` and `_decrypt-block`; `gost28147` has the same three plus `_crypt-ext` (the whole-message modes with CryptoPro key meshing, which cannot be a block quotation because the key changes between blocks), `_wrap` and `_unwrap` (RFC 4357 key wrap and its IMIT); every mode and the padding come from `blockmode`;
- `rc4:_crypt`, `ciphersaber2:_crypt` and `rabbit:_crypt`: the stream ciphers, whose state loops need a fast mutable array that FL lacks (the same reason as `sigaba:_run`); `xxtea:_encrypt` and `xxtea:_decrypt`: XXTEA, a variable-length block cipher that does not use `blockmode`;
- `cmac:_mac` (the CMAC of SP 800-38B over the AES and Triple DES block functions called from TypeScript, because the block words of those vocabularies are private), `lmhash:_hash` (the DES work of the LM hash over `des.ts`), `ascon:_hash`, `ascon:_mac` and `ascon:_aead` (Ascon-Hash256, the Ascon-Mac of the designers' reference code and Ascon-AEAD128, from the specification), and `bcrypt:_hash`, `bcrypt:_verify`, `bcrypt:_parse` (the Blowfish-based hash is slow by design, far beyond the FL step budget; the cost is capped, see `src/prims/bcrypt.ts`);
- `pbkdf2:_derive`, `scrypt:_derive`, `argon2:_derive` and `argon2:_verify`: the key derivation functions over the audited `@noble/hashes` (they are memory- or time-hard, far beyond the FL step budget; each caps its cost, see the vocabulary's primitive file; the Argon2 primitive also writes and parses the PHC encoded string). HKDF and EVP_BytesToKey are plain FL, over `hmac:digest` and the md5, sha1 and sha2 digest words.
- `fernet:_now`, `fernet:_random-iv`, `flask-session:_now`, `ciphersaber2:_random-iv` and `bcrypt:_random-salt`: the clock (`+time`) and the host CSPRNG (`+random`), which FL cannot read. **The effects pattern:** the wave 4 vocabularies each have their own private `_random-*` or `_now` primitive, labelled with the effect (the compiler infers the effect of the public word from it) and nothing else in it. **New code (wave 5 on) does not add another one: it calls the shared `random:bytes-of`, `random:below`, `random:between`, `clock:now-ms` and `clock:now-s`.** The private primitives listed here stay until the wave 5 close-out moves them onto the shared words; the constructions (`fernet:_seal`, `fernet:_open`, `flask-session:_sign`) take the time and the IV as arguments, so tests pin them, and the public words only supply them. None of them falls back to `Math.random`: a host with no `crypto.getRandomValues` is `E_PRIMITIVE`.
- `random:bytes-of`, `random:below`, `clock:now-ms`, `list:sort`, `list:sort-by` and `list:shuffle`: the **shared** words of wave 5, public (no leading underscore) because other vocabularies call them qualified. `random:bytes-of ( n -- bytes )` and `random:below ( n -- int )` read the host CSPRNG (`+random`); `clock:now-ms ( -- int )` reads the host clock (`+time`); `list:sort ( list -- list )`, `list:sort-by ( items keys -- list )` and `list:shuffle ( list -- list )` are the stable sort and the Fisher-Yates shuffle that the core lacks (sorting 65,536 strings in FL would cost far more than the step budget; the shuffle is `+random`). `random:between` and `clock:now-s` are FL over them. See "Wave 5 conventions".
- `sigaba:_run`: the SIGABA rotor stack over letters 0 to 25 (the loop needs a fast mutable array, which FL lacks);
- `classical:_ls47`: the LS47 letter-by-letter cipher on a given board, for the same reason;
- `bombe:_search`: the Bombe test over the 17,576 start positions of one rotor order;
- the hashing primitives, one per digest vocabulary and always `_hash` (`sha2:_hash`, `md6:_hash`, `snefru:_hash`, and so on; BLAKE2, BLAKE3, Keccak, SHA-3, SHAKE, SHA-1, MD5, RIPEMD-160 over `@noble/hashes`, the others written from their specifications), plus `ssdeep:_pieces` (one pass of the rolling hash) and `generate-all:_crcs` (many CRC presets at once, for speed only; see "Justified exceptions").

The public primitives are the `hex`, `base64` and `regex` words and `raise:coerce` and `raise:range`.

FL's own `fail` raises only `E_USER`. Typed errors come from the internal `raise` vocabulary:

- `raise:coerce ( reason:str -- )` raises `E_COERCE`, for data that cannot be decoded;
- `raise:range ( reason:str -- )` raises `E_RANGE`, for a bad argument.

Use it with `USING: raise` or the qualified names. The words have no outputs, so they are not catalogue ops.

## Vocabularies

113 vocabularies, 244 ops (two ops each unless noted or listed). Vocabulary names are lower-kebab-case.

| Vocabulary         | Ops                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adler32`          | Adler-32 checksum (RFC 1950) (1 op)                                                                                                                                    |
| `aes`              | AES encrypt and decrypt (FIPS 197): ECB, CBC, CFB, OFB, CTR and GCM, 128/192/256-bit keys, PKCS#7 or no padding, GCM additional data                                   |
| `aes-kw`           | AES Key Wrap and Unwrap (RFC 3394), 16/24/32-byte key-encryption key, default IV (2 ops)                                                                               |
| `analysis`         | entropy (bits per byte), byte-frequency distribution, index of coincidence and chi-squared against English (4 ops)                                                     |
| `argon2`           | Argon2d, Argon2i and Argon2id (RFC 9106): derive, as the encoded PHC string or raw, and compare against an encoded hash (2 ops)                                        |
| `ascon`            | Ascon-Hash256, Ascon-Mac and Ascon-AEAD128 (NIST SP 800-232): hash, mac, and authenticated encrypt and decrypt (4 ops)                                                 |
| `base32`           | encode and decode, standard and hex alphabets (RFC 4648)                                                                                                               |
| `base45`           | encode and decode (RFC 9285)                                                                                                                                           |
| `base58`           | encode and decode, bitcoin, flickr and ripple alphabets                                                                                                                |
| `base62`           | encode and decode, standard and inverted alphabets                                                                                                                     |
| `base64`           | encode and decode, standard and URL-safe alphabets                                                                                                                     |
| `base85`           | encode and decode, Ascii85 and Z85                                                                                                                                     |
| `base92`           | encode and decode (thenoviceoof)                                                                                                                                       |
| `bcd`              | binary-coded decimal: 8421, 7421, 4221 and excess-3, packed or unpacked, signed or not                                                                                 |
| `bcrypt`           | bcrypt password hash: hash with a random salt, hash with a given salt, compare, parse (4 ops; cost 4 to 16)                                                            |
| `bech32`           | Bech32 and Bech32m (BIP-173, BIP-350) encode and decode                                                                                                                |
| `bigint`           | big-endian bytes to and from decimal text of an unsigned integer                                                                                                       |
| `binary`           | bytes to and from 8-bit binary text                                                                                                                                    |
| `bits`             | XOR (and brute force), AND, OR, NOT, ADD, SUB, bit shifts and rotates (11 ops)                                                                                         |
| `blake2b`          | BLAKE2b (RFC 7693), sizes 16 to 64 bytes, optional key (1 op)                                                                                                          |
| `blake2s`          | BLAKE2s (RFC 7693), sizes 16 to 32 bytes, optional key (1 op)                                                                                                          |
| `blake3`           | BLAKE3 with a length from 1 to 65536 bytes and an optional 32-byte key (1 op)                                                                                          |
| `blowfish`         | Blowfish encrypt and decrypt (Schneier 1993): ECB, CBC, CFB, OFB, CTR, 4 to 56-byte keys, PKCS#7 or no padding                                                         |
| `bombe`            | Turing-Welchman Bombe for the Enigma I and M3: a crib search for stops, one word for one or many rotor orders (1 op)                                                   |
| `braille`          | bytes as 8-dot Unicode Braille patterns and back                                                                                                                       |
| `caret`            | caret and M- notation as printed by `cat -v`                                                                                                                           |
| `chacha`           | ChaCha stream cipher (RFC 8439 and the original 8-byte nonce), 20, 12 or 8 rounds (1 op)                                                                               |
| `charcode`         | text to and from character codes in a chosen base                                                                                                                      |
| `charset`          | legacy character sets (single-byte, EBCDIC, UTF-16/32, CJK), with brute force (3 ops)                                                                                  |
| `ciphersaber2`     | CipherSaber-2 encrypt (random IV in front) and decrypt (2 ops)                                                                                                         |
| `classical`        | rot (Caesar, ROT13), rot47, rot8000, rot brute force, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, Caesar box, A1Z26, Cetacean, CTX1, LS47, Substitute (26 ops) |
| `clock`            | the current time: Get Time (1 op, `clock:get-time`); the shared words `clock:now-ms` and `clock:now-s` for other vocabularies (`+time`)                                |
| `cmac`             | CMAC (SP 800-38B, RFC 4493) over AES or Triple DES (1 op)                                                                                                              |
| `cobs`             | Consistent Overhead Byte Stuffing encode and decode                                                                                                                    |
| `colossus`         | Colossus-style counting: how often a Boolean condition holds over every start position of two chi wheels, for the Lorenz break-in (1 op)                               |
| `crc`              | CRC checksums: the 171 CyberChef presets and any width from 1 to 82 bits from the Rocksoft model (2 ops)                                                               |
| `decimal`          | bytes to and from decimal numbers                                                                                                                                      |
| `des`              | DES encrypt and decrypt (FIPS 46-3): ECB, CBC, CFB, OFB, CTR, 8-byte key, PKCS#7 or no padding                                                                         |
| `endian`           | swap the byte order of 2, 4 or 8 byte words                                                                                                                            |
| `enigma`           | Enigma I, M3 and M4 rotor machines, one reciprocal word; also the shared historical rotor, turnover and reflector data (1 op)                                          |
| `evp`              | OpenSSL EVP_BytesToKey key derivation in FL over MD5, SHA-1 and SHA-2 (1 op)                                                                                           |
| `fernet`           | Fernet encrypt and decrypt (github.com/fernet/spec) over aes and hmac, with the +random and +time effects (2 ops)                                                      |
| `flask-session`    | Flask session cookies (itsdangerous, HMAC-SHA1/256) decode, sign and verify (3 ops)                                                                                    |
| `fletcher`         | Fletcher-8, -16, -32 and -64 (1 op)                                                                                                                                    |
| `float`            | IEEE 754 binary32 and binary64 numbers to and from bytes                                                                                                               |
| `fractionating`    | ADFGX and ADFGVX, Polybius, Nihilist and Trifid (8 ops)                                                                                                                |
| `generate-all`     | a text report of many hashes or many checksums of the same input, one per line (2 ops)                                                                                 |
| `gost`             | GOST R 34.11-94 with the test or the CryptoPro S-box (1 op)                                                                                                            |
| `gost28147`        | GOST 28147-89 encrypt, decrypt, key wrap and unwrap (RFC 4357): five modes, eight S-boxes, CryptoPro key meshing (4 ops)                                               |
| `has160`           | HAS-160 (1 op)                                                                                                                                                         |
| `hash-analysis`    | guess the hash functions from the length of a digest in hex (1 op)                                                                                                     |
| `hex`              | encode and decode                                                                                                                                                      |
| `hex-content`      | Snort and Suricata rule `content` text, with `                                                                                                                         | 41 42 | ` hex sections |
| `hexdump`          | xxd-style hex dump, encode and decode                                                                                                                                  |
| `hkdf`             | HKDF (RFC 5869) in FL over the HMAC hashes (1 op)                                                                                                                      |
| `hmac`             | HMAC (RFC 2104) over MD5, SHA-1, SHA-2, SHA-3 and RIPEMD-160 (1 op)                                                                                                    |
| `html`             | encode and decode character references (full named-entity table)                                                                                                       |
| `jwt`              | JSON Web Tokens: decode, and HS256/HS384/HS512 sign and verify; never `none` (3 ops)                                                                                   |
| `keccak`           | Keccak with the original padding, 224 to 512 bits (1 op)                                                                                                               |
| `list`             | internal: the shared list words `list:sort`, `list:sort-by` and `list:shuffle` (no ops)                                                                                |
| `lmhash`           | LM hash, the DES of "KGS!@#$%" under the halves of the upper-cased password (1 op)                                                                                     |
| `lorenz`           | Lorenz SZ40/42a/42b with the KH, ZMUG and BREAM patterns and the P5 mode, and a pattern merge helper (2 ops)                                                           |
| `luhn`             | Luhn check digit and validity, any even radix (2 ops)                                                                                                                  |
| `md2`              | MD2 (RFC 1319) (1 op)                                                                                                                                                  |
| `md4`              | MD4 (RFC 1320) (1 op)                                                                                                                                                  |
| `md5`              | MD5 (RFC 1321) (1 op)                                                                                                                                                  |
| `md6`              | MD6, sizes 8 to 512 bits, levels and key (1 op)                                                                                                                        |
| `modhex`           | Yubico ModHex encode and decode                                                                                                                                        |
| `morse`            | encode and decode (ITU-R M.1677-1)                                                                                                                                     |
| `murmur3`          | MurmurHash3 x86_32 with a seed (1 op)                                                                                                                                  |
| `nthash`           | NT hash, the MD4 of UTF-16LE text (1 op)                                                                                                                               |
| `octal`            | bytes to and from octal numbers                                                                                                                                        |
| `parity`           | add or check a parity bit on a string of binary digits (2 ops)                                                                                                         |
| `pbkdf2`           | PBKDF2 with HMAC (RFC 8018) over SHA-1, SHA-2 and MD5 (1 op)                                                                                                           |
| `polyalphabetic`   | Beaufort, Gronsfeld, Porta and autokey Vigenere (6 ops)                                                                                                                |
| `polygraphic`      | Playfair, four-square and Hill (6 ops)                                                                                                                                 |
| `present`          | PRESENT encrypt and decrypt: 80 and 128-bit keys, ECB, CBC, CFB, OFB, CTR (2 ops)                                                                                      |
| `prng`             | the CyberChef random generators: Pseudo-Random Number Generator as `prng:bytes` and Pseudo-Random Integer Generator as `prng:integers` (`+random`)                     |
| `punycode`         | Punycode (RFC 3492), as a label or per domain label with `xn--`                                                                                                        |
| `quoted-printable` | Quoted-Printable (RFC 2045 section 6.7) encode and decode                                                                                                              |
| `rabbit`           | Rabbit stream cipher (RFC 4503), with or without IV, big or little endian (1 op)                                                                                       |
| `radix`            | convert an integer of any size from one base to another                                                                                                                |
| `random`           | internal: the shared host-CSPRNG words `random:bytes-of`, `random:below` and `random:between` (no ops)                                                                 |
| `rc2`              | RC2 encrypt and decrypt (RFC 2268): ECB and CBC, 1 to 128-byte keys, effective key bits, PKCS#7 or no padding                                                          |
| `rc4`              | RC4 and RC4 Drop (one op with a drop param in bytes) (1 op)                                                                                                            |
| `rc6`              | RC6-w/r encrypt and decrypt: ECB, CBC, CFB, OFB, CTR, word size 8 to 256 and rounds as parameters, PKCS#7 or no padding                                                |
| `regex`            | test, find-all, replace, split                                                                                                                                         |
| `ripemd`           | RIPEMD-128, -160, -256 and -320 (1 op)                                                                                                                                 |
| `ripemd160`        | RIPEMD-160 alone, for HMAC (1 op)                                                                                                                                      |
| `ror13`            | ROR13 API-name hash (1 op)                                                                                                                                             |
| `salsa20`          | Salsa20/20 stream cipher (eSTREAM), 16 or 32-byte keys, 8-byte nonce (1 op)                                                                                            |
| `scrypt`           | scrypt (RFC 7914) key derivation (1 op)                                                                                                                                |
| `sha0`             | SHA-0 (1 op)                                                                                                                                                           |
| `sha1`             | SHA-1 (1 op)                                                                                                                                                           |
| `sha2`             | SHA-224, -256, -384, -512, -512/224 and -512/256 (1 op)                                                                                                                |
| `sha3`             | SHA3-224 to SHA3-512 (1 op)                                                                                                                                            |
| `shake`            | SHAKE128 and SHAKE256 with a length in bytes (1 op)                                                                                                                    |
| `sigaba`           | SIGABA (ECM Mark II) rotor machine, one reciprocal word (1 op)                                                                                                         |
| `sm3`              | SM3 (GB/T 32905-2016) (1 op)                                                                                                                                           |
| `sm4`              | SM4 encrypt and decrypt (GB/T 32907-2016): ECB, CBC, CFB, OFB, CTR, 16-byte key, PKCS#7 or no padding                                                                  |
| `snefru`           | Snefru, 128 or 256 bits, 2, 4 or 8 passes (1 op)                                                                                                                       |
| `ssdeep`           | ssdeep context triggered piecewise hash (also ctph) and its comparison (2 ops)                                                                                         |
| `streebog`         | GOST R 34.11-2012, 256 or 512 bits (1 op)                                                                                                                              |
| `tcpip`            | Internet checksum (RFC 1071) (1 op)                                                                                                                                    |
| `tea`              | TEA encrypt and decrypt: ECB, CBC, CFB, OFB, CTR (2 ops)                                                                                                               |
| `text`             | split, join, replace, reverse, upper, lower                                                                                                                            |
| `transposition`    | columnar transposition, encrypt and decrypt                                                                                                                            |
| `triple-des`       | Triple DES encrypt and decrypt (EDE, SP 800-67): ECB, CBC, CFB, OFB, CTR, 16 or 24-byte keys, PKCS#7 or no padding                                                     |
| `twofish`          | Twofish encrypt and decrypt: ECB, CBC, CFB, OFB, CTR, 128/192/256-bit keys, PKCS#7 or no padding                                                                       |
| `typex`            | Typex-style five-rotor machine with the wirings as parameters (1 op)                                                                                                   |
| `unicode`          | escape and unescape code points (`\u`, `U+`, `%u`, `\x{}`, `&#x;`), normalisation, smart quotes to ASCII (4 ops)                                                       |
| `url`              | percent-encode and decode (RFC 3986)                                                                                                                                   |
| `whirlpool`        | Whirlpool (ISO/IEC 10118-3) (1 op)                                                                                                                                     |
| `xor-checksum`     | column-wise XOR of the blocks of the input (1 op)                                                                                                                      |
| `xsalsa20`         | XSalsa20/20 stream cipher, 32-byte key, 24-byte nonce (1 op)                                                                                                           |
| `xtea`             | XTEA encrypt and decrypt with a round count: ECB, CBC, CFB, OFB, CTR (2 ops)                                                                                           |
| `xxtea`            | XXTEA (Corrected Block TEA) encrypt and decrypt (2 ops)                                                                                                                |

Six internal vocabularies are not part of the catalogue as ops: `recipe` (the words recipes compile to), `raise` (typed errors, above), `util` (shared helpers, below), `blockmode` (the shared block cipher modes and PKCS#7 padding; see "Cipher conventions"), `random` (the shared host-CSPRNG words) and `list` (the shared sort and shuffle words); the last two are described in "Wave 5 conventions".

## The `util` vocabulary

`vocab/util.fth` holds FL helpers that more than one op vocabulary needs. A private (`_`) word cannot be called from another vocabulary, so without `util` each author copies the helper. `util` is in `INTERNAL_VOCABS`: its public words are callable from every vocabulary (`util:space?`, or `USING: util`), are never listed in the catalogue, have a doc string and no category, and user units cannot define into it.

| Word                                                          | Meaning                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space? ( b:int -- bool )`                                    | ASCII white space: 9 to 13 and 32                                                                                                                                             |
| `space-or-comma? ( b:int -- bool )`                           | white space or a comma, the separators of numeric text                                                                                                                        |
| `between? ( n:int lo:int hi:int -- bool )`                    | lo <= n <= hi                                                                                                                                                                 |
| `cp>str ( cp:int -- str )`                                    | the one-character string of a code point                                                                                                                                      |
| `separator ( choice:str -- str )`                             | none, space, comma, newline to the delimiter text                                                                                                                             |
| `delimiter ( choice:str -- str )`                             | space, comma, semicolon, colon, newline, crlf, cr, tab or none to the delimiter text; anything else is E_RANGE (the wave 5 list and line ops)                                 |
| `decode-table ( alpha:str ws:int pad:int -- bytes )`          | 256-byte lookup table for `translate`: index in the alphabet, else `ws` for white space, `pad` for `=`, else 255 (pass 255 for a marker you do not need)                      |
| `check-symbols ( data:bytes table:bytes -- bytes )`           | translate data through a decode table; E_COERCE if any byte maps to 255, found in a constant number of VM steps; other markers (white space, padding) are left for the caller |
| `int>be-bytes ( v:int n:int -- bytes )`                       | the low n bytes of v, big-endian                                                                                                                                              |
| `digits>int ( vals:bytes radix:int -- int )`                  | positional fold of digit values, most significant first                                                                                                                       |
| `dec-digit? ( c:int -- bool )`                                | ASCII 0 to 9                                                                                                                                                                  |
| `hex-digit? ( c:int -- bool )`                                | ASCII 0 to 9, A to F, a to f                                                                                                                                                  |
| `byte>hex ( b:int -- str )`                                   | two upper-case hex digits of a byte                                                                                                                                           |
| `pad-hex ( v:int n:int -- str )`                              | lower-case hex of v, zero-padded to at least n digits                                                                                                                         |
| `repeat-str ( s:str n:int -- str )`                           | s repeated n times                                                                                                                                                            |
| `starts-with? ( s:str prefix:str -- bool )`                   | length-guarded: false, not an error, when s is shorter                                                                                                                        |
| `ends-with? ( s:str suffix:str -- bool )`                     | length-guarded                                                                                                                                                                |
| `strip-space ( s:str -- str )`                                | remove every ASCII white space character                                                                                                                                      |
| `count-leading ( items pred:quot -- int )`                    | how many elements at the start (list or bytes) satisfy pred                                                                                                                   |
| `trim-start ( s:str pred:quot -- str )`                       | drop leading characters whose code satisfies pred                                                                                                                             |
| `trim-end ( s:str pred:quot -- str )`                         | drop trailing characters whose code satisfies pred                                                                                                                            |
| `number-tokens ( s:str -- list )`                             | split numeric text at white space and commas, empty pieces dropped                                                                                                            |
| `numbers>bytes ( data:bytes radix:int msg:str -- bytes )`     | decode byte values written in a radix (0 to 255, no sign); E_COERCE with msg if out of range                                                                                  |
| `hex-unescape ( s:str marker:str msg:str -- bytes )`          | text where marker (`%`, `=`) introduces two hex digits for a byte; E_COERCE with msg otherwise                                                                                |
| `zero-bytes ( n:int -- bytes )`                               | n zero bytes                                                                                                                                                                  |
| `byte-at ( d j:int -- int )`                                  | element j of bytes or a list, 0 past the end                                                                                                                                  |
| `bit-field ( d:bytes p:int n:int -- int )`                    | n bits (up to 13) from bit p, zero padded past the end                                                                                                                        |
| `nibbles>byte ( nibs i:int -- int )`                          | byte i from nibbles 2i (high) and 2i + 1 (low)                                                                                                                                |
| `int>bytes ( n:int -- bytes )`                                | big-endian bytes of a non-negative integer, none for 0, linear time                                                                                                           |
| `int>symbols ( n:int alpha:bytes -- bytes )`                  | digits of n written with the bytes of alpha (radix = its length)                                                                                                              |
| `bytes>symbols ( data:bytes alpha:bytes -- bytes )`           | Base58/Base62 style big-integer conversion; each leading zero byte is one first symbol                                                                                        |
| `symbols>bytes ( data:bytes table:bytes radix:int -- bytes )` | the inverse, through a decode table with 254 for white space                                                                                                                  |
| `surrogate? ( cp:int -- bool )`                               | a UTF-16 surrogate, U+D800 to U+DFFF                                                                                                                                          |
| `str-chunks ( s:str n:int -- list )`                          | the pieces of s of n characters, the last one shorter                                                                                                                         |
| `list-flatten ( ll:list -- list )`                            | a list of lists joined one level                                                                                                                                              |
| `contains-bytes? ( data:bytes needle:bytes -- bool )`         | a byte search done on the Latin-1 text, a few steps for any length                                                                                                            |
| `drop-byte ( data:bytes b:int -- bytes )`                     | the bytes without any byte equal to b, a few steps for any length                                                                                                             |
| `popcount-26 ( m:int -- int )`                                | the set bits among the low 26 of a letter-set mask                                                                                                                            |
| `letter-numbers ( s:str -- bytes )`                           | the letters of any text as 0 to 25, other characters dropped                                                                                                                  |
| `iv-or-zeros ( iv:bytes n:int -- bytes )`                     | the IV, or n zero bytes when it is empty (the default of TEA, XTEA, RC6 and GOST 28147-89)                                                                                    |
| `b64url-encode ( data:bytes padding:bool -- bytes )`          | URL-safe Base64 text (RFC 4648 section 5) as bytes, with or without = padding                                                                                                 |
| `b64url-decode ( text:bytes -- bytes )`                       | the bytes of URL-safe Base64 text, padding or not; E_COERCE otherwise                                                                                                         |

The words from the cipher-machine and classical waves, also in `util` (see their doc strings in `vocab/util.fth`):

| Word                                                                                                                                 | Meaning                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `letter? letters? digits?`                                                                                                           | ASCII letter, text of only letters, text of only digits                           |
| `letter-indices ( s:str -- bytes )`, `digit-values ( s:str -- bytes )`, `letter-table ( -- bytes )`                                  | letters as 0 to 25, digits as 0 to 9, and the 256-byte translate table of letters |
| `count-of ( items x -- int )`                                                                                                        | how many elements of a list or bytes equal x                                      |
| `index-of`, `perm-invert`, `perm?`, `table-compose3`                                                                                 | positions and permutations of 0 to 25                                             |
| `rotor-shifted`, `rotor-shift-table`, `rotor-notch-flags`, `rotor-reflect-table`                                                     | rotor tables for every shift, notch flags and the rotor next to the reflector     |
| `letter-settings ( s:str n:int what:str -- bytes )`, `plugboard-table ( s:str -- bytes )`                                            | ring settings and start positions, and a plugboard as a permutation               |
| `cycle-bytes ( pat:bytes start:int n:int -- bytes )`                                                                                 | n bytes of the endless repetition of a pattern, in linear time                    |
| `ita2-alphabet`, `ita2-table`, `ita2-table2`, `ita2-code`, `ita2-entry`, `from-bp`                                                   | teleprinter (ITA2) text in Bletchley Park notation                                |
| `keyed-alphabet ( key:bytes alpha:bytes -- bytes )`, `square-positions ( grid:bytes -- bytes )`, `upper-merge-i ( code:int -- int )` | keyed squares and letter folding                                                  |

**Rule: check `util` before writing a helper. Anything more than one vocabulary needs goes in `util`.**

When work packages run in parallel, an agent cannot edit `util.fth` (the orchestrator owns it), so it may need a private copy of a helper for the length of its package. The rules for that:

1. Keep a **straight copy** of the helper in your own vocabulary, with the body you would have put in `util`. **Never vary the body to avoid the sweep**: do not reorder the words, swap an operand test (`j d len <` for `j d len >=`), change a constant into a computed one or otherwise write the same function differently. A disguised copy is a defect, and the structural check below reports it anyway.
2. Put the comment line `\ util-candidate: <proposed util name>` **immediately before** the definition (no blank line between).
3. List the helper in your report as a **utility candidate**: proposed name, stack effect, why, and the vocabularies that have the same need.
4. The orchestrator promotes every marked helper into `util` at the wave close-out, deletes the copies and the markers, and the final state has no marker left.

Example:

```forth
\ util-candidate: strip-space
: _clean ( s:str -- str )
  s str>codes [ util:space? not ] filter codes>str ;
```

### Finding copies: the dupes test and `npm run dupes`

`src/dupes.ts` (not exported from the package, so not in the browser bundle) reads every `vocab/*.fth`, extracts each colon definition and normalises its body: comments, the `doc` and `category` lines are dropped, input names become positional placeholders (`b 32 =` equals `code 32 =`), and words of the same vocabulary are qualified so two private helpers with the same name are not confused. Four reports:

- **Exact duplicates**: definitions in different vocabularies with the same input and output types and identical normalised bodies. `src/dupes.test.ts` **fails** on any, naming the words; move the helper into `vocab/util.fth`. A group whose copies **all** carry a `util-candidate` marker is not an exact duplicate but a pending promotion (next).
- **Pending util promotion**: exact-duplicate groups where every copy has the marker `\ util-candidate: <name>` right before it, listed by proposed name. Not a failure while a wave is running. One unmarked copy in the group makes the whole group a failure. `src/dupes.test.ts` also checks that **none is left** in the repository, so the close-out cannot forget them.
- **Near duplicates**: pairs in different vocabularies with the same input and output arity and a Jaccard similarity of at least 0.8 over token bigrams. Bodies under 4 tokens are ignored.
- **Likely re-implementations**: private (`_`) helpers in different vocabularies with the **same effect signature** (input and output types) and the **same set of core words** (every word of the body that is not a parameter or defined in its own vocabulary, qualified words included; order and repetition ignored; at least 3 distinct words). This catches the same function written with a different body. Near duplicates and likely re-implementations never fail a test: look at each at the close-out, and either promote the helper or write down why the two are different (for example `classical:_atbash-code` reflects a letter, `morse:_upper-cp` folds case; they only look alike).

`npm run dupes -w @forge/ops` builds the package and prints all four reports (always exits 0). Run it when reviewing a work package. At a wave close-out the target is 0 exact duplicates, 0 pending promotions, and every remaining near duplicate or likely re-implementation resolved or justified.

### Justified exceptions

The sweep reports copies that a promotion would remove. A pair it reports and that stays is written down here, and the private helper carries a one-line comment saying why. Pairs the sweep never sees (an exact copy whose body calls a private helper of its own vocabulary, so the normalised bodies differ) are listed as well.

- `enigma:_step` and `typex:_step` implement the same Enigma-style stepping with the double step, and `typex:_turn` only names the row-offset update. They stay separate: the rotor state is in each vocabulary's `VARIABLE`s (`_b1`, `_b2`, `_b3`, `_NR`, `_NM`), so a shared util word would have to take five values and give back three on every key press. That costs more VM steps on the per-letter path than the inline test and update. The sweep does not report the pair for the reason above.
- `enigma:_byte` and `typex:_byte` have the same core words. Each reads its own `_LT` table and its own `_press` on the per-letter path, so the call cannot be shared.
- `classical:_atbash-code` and `morse:_upper-cp` reflect a letter within its case and fold a lower-case letter to upper case. They only look alike.
- `classical:_text-printable?` and `url:_unreserved?` test two different byte sets.
- `base32:_ungroups` and `classical:_cb-enc` map a helper over an index range and join, over different per-group words.
- `fractionating:_adf-labels` and `polygraphic:_pl-alpha` each pick one of two unrelated literals by a name.
- `luhn:_value` turns the code of a digit or letter into its value in a radix (0 to 9, then a to z, either case), like `classical:_atbash-code` and `morse:_upper-cp` it maps a code through two or three range tests, and only looks alike.
- `blake2b:digest` and `blake2s:digest` (and the other thin hash words, such as `sha3:digest` and `keccak:digest`) have bodies of one call, `size key _hash`, which is under the sweep's four-token threshold, so the sweep never compares them. Judged here: not a duplication worth sharing. The call is to the vocabulary's own private `_hash`, which a private word cannot share across vocabularies; the two primitives (`src/prims/blake2b.ts` and `blake2s.ts`) differ in the library function, the size and key limits (64 and 32 bytes) and the messages, and sharing them would only turn those four things into parameters of a factory. CyberChef also has two operations. The pattern is the `sha2` template of "Hashing conventions".
- `jwt:_need-key` and `flask-session:_need-key` both raise `E_RANGE` for an empty key. They differ in their message (the JWT key, the Flask secret key, which CyberChef words as "Secret key required"), so one util word would need the message as a parameter and every call would pass a literal, which is longer than the three-token body. Kept separate.
- `generate-all:_crcs` is a second implementation of the CRC model, in TypeScript, next to the FL `crc` vocabulary. It is there only for speed: 171 presets over 64 KiB in FL would be about 200 million VM steps against a limit of 10 million (each call rebuilds its table and costs about a million steps), and the primitive does the same work in about 50 ms. `src/generate-all.test.ts` holds it equal to `crc:checksum` for every preset on random inputs, so the two cannot drift. The preset table is shared as `util:crc-presets`.
- Helpers kept private on purpose after the wave 3 review (one user each): `crc:_reflect` (reverse the low bits of a value), `fletcher:_weighted` and the inline weighted sum of `adler32:checksum` (they weigh by `n - i` and by `n - i div s`, so one word would need both forms), and `hmac:_pad`.

## Hashing conventions

The hashing vocabularies (wave 3) follow the `sha2` vocabulary, which is the template.

- **Bytes out.** A digest word returns the raw digest as `bytes`, never hex text. Chain `hex:encode` for text. The category is `Hashing`.
- **Naming.** One vocabulary per family (`sha2`, `sha3`, `blake2`, `md5`, `crc`, ...), lower-kebab-case. The public word of a hash is `digest`, with a parameter for the variants (`sha2:digest` takes `size:choice{"224"|"256"|"384"|"512"|"512/224"|"512/256"}`). Where CyberChef has a variant parameter, use one parameterised word, not one word per variant. Checksums (crc, adler-32, fletcher, ...) are written in FL, not primitives.
- **Library, not WebCrypto.** Hashes that `@noble/hashes` (audited, MIT, pinned to an exact version) covers use it, and all hash primitives are synchronous. Import only the subpath you need (`@noble/hashes/sha2.js`) so the vocabulary's lazy chunk stays small; the chunk is loaded only when the vocabulary is used and does not count against the first-paint budget.
- **Wrapping a noble function.** Follow `src/prims/sha2.ts`: one private primitive `_hash ( data:bytes <variant>:str -- bytes )` that looks the variant up in a table (with `Object.hasOwn`, so `toString` is not a variant) and raises `E_RANGE` through `rangeFailure` for an unknown one. The primitive does nothing else. The public word, its doc string, category, `choice{}` parameter, defaults and `META:` stay in `vocab/<v>.fth`. Own the tests: `src/prims/<v>.test.ts` for the primitive and `src/<v>.test.ts` for the word through the runtime.
- **Vectors.** `vocab/<v>.test.json` takes its vectors from the official specification or an RFC (FIPS 180-4, FIPS 202, RFC 1321, RFC 7693, RFC 2104, ...), and `ref` cites it. CyberChef is only a throwaway cross-check oracle: never copy its tables or outputs into the repository. Include the empty input, the standard short and long messages, and a 64 KiB test inside the default limits (against `node:crypto` where it has the algorithm).
- **HMAC** is its own vocabulary (`hmac`), taking the hash name and the key as parameters, not a parameter of each hash.
- **Defaults follow CyberChef's** where the choice is arbitrary (SHA-2, SHA-3 and Keccak 512, SHAKE256 with 64 bytes, RIPEMD 320, MD6 256 bits with 64 levels, Snefru 128 bits with 8 passes, BLAKE2b 64 and BLAKE2s 32 bytes), so a recipe moved from CyberChef gives the same digest. A default stays Forge's own where the standard names one (BLAKE3 gives 32 bytes, its specification's output size; GOST uses the CryptoPro S-box of the standard, not CyberChef's E-TEST cipher set). Sizes are in bytes (SHAKE length, BLAKE2 size) where CyberChef counts bits; the coverage rows say so.
- **Reports.** `generate-all` builds a text report from the digest and checksum words, one algorithm per line with its hex. It is its own vocabulary because it depends on thirty hash vocabularies and `hash-analysis` must stay light. Its `length` and `names` parameters are CyberChef's.
- **Not here, in wave 4.** CMAC (`cmac`), the LM hash (`lmhash`), bcrypt (`bcrypt`), Argon2 (`argon2`) and Ascon (`ascon`) need AES or DES, or are key derivation functions, so they came with the ciphers: see "Cipher conventions". They follow the digest-word shape (raw bytes out, `key` parameters, `E_RANGE` for a bad key) where they hash or authenticate.

## Cipher conventions

The symmetric cipher vocabularies (wave 4) follow the `aes` vocabulary, which is the template, as the hashing vocabularies follow `sha2`.

- **Data.** Bytes in, bytes out. The ciphertext is raw bytes (chain `hex:encode` or `base64:encode`), and the plaintext of a decryption is raw bytes. CyberChef's Input and Output encoding menus are chain steps here.
- **Key and IV.** `key`-type parameters (`key:key{hex|utf8|latin1|base64}`), so a recipe or the UI gets all four encodings for free, and the word receives bytes. The key has no length constraint in its header, because a header constraint raises `E_PARAM_INVALID`; the word checks the length and raises `E_RANGE` (see "Errors"). The IV (or nonce) is a second `key` parameter, empty by default, which is right for ECB and for the ciphers that take none.
- **Empty IV.** An empty IV is an error for the ciphers that follow the shared convention (E_RANGE), but TEA, XTEA, RC6 and GOST 28147-89 treat it as zero bytes, as CyberChef does; that default is `util:iv-or-zeros ( iv n -- bytes )`.
- **Mode.** A `choice` parameter (`mode:choice{CBC|CFB|OFB|CTR|GCM|ECB}="CBC"`), with CyberChef's names and its default (CBC). A cipher offers the subset it has. A mode that does not use an IV ignores it.
- **Padding is a separate parameter**, `padding:choice{pkcs7|none}="pkcs7"`, not a mode variant. CyberChef's NoPadding variants (CBC/NoPadding, ECB/NoPadding) are the same mode with padding switched off, and folding them into the mode would double the mode list for every cipher and make the shared layer match on mode names. A separate parameter keeps each mode word one thing. Padding is PKCS#7 (RFC 5652 section 6.3): `n` bytes of the value `n`, `n` from 1 to the block size, so whole input gets a full extra block. It applies to ECB and CBC only; CFB, OFB, CTR and GCM keep the length and ignore the parameter. With `none`, ECB and CBC need whole blocks.
- **Errors.** `E_RANGE` is for an argument with a bad value: a key of a length the cipher does not take, an IV of the wrong length (for the modes that use one), an unknown mode. `E_COERCE` is for data that cannot be processed: bad PKCS#7 padding (usually a wrong key or IV), ciphertext that is not whole blocks where the mode needs them (and any input with padding off that is not), and a GCM tag that does not verify or an input shorter than the tag. A decryption that fails returns no plaintext. A key length is checked even for an empty input.
- **GCM.** The 16-byte tag is **appended to the ciphertext** by encryption, and decryption takes the last 16 bytes as the tag and verifies it before it returns anything, raising `E_COERCE` otherwise. There is no tag-length parameter (the tag is the full 128 bits; truncated tags are a known weak spot, and `@noble/ciphers` does not offer them). The additional authenticated data is a `key` parameter `aad`, empty by default, and it must be the same on both sides. The IV is at least 8 bytes (the library's lower limit), 12 recommended. This differs from CyberChef, whose GCM tag is a separate output of encryption and a separate parameter of decryption: a single byte string is what a chain of words can carry, and it is what most libraries produce.
- **CTR and CFB.** NIST SP 800-38A leaves the counter's incrementing function to the application, so the ciphers differ, and each follows CyberChef's convention for its counterpart, found by the cross-check of WP 5.29. AES, DES, Triple DES, Blowfish and SM4 add one to the **last four bytes** of the counter block, modulo 2^32, with no carry into the rest (node-forge's inc32: `blockmode` mode `CTR32`; for AES the primitive does it, cutting the data where the low word wraps); Twofish and RC6 read the whole block as a **little-endian** integer, first byte least significant (mode `CTRLE`); TEA, XTEA and the other users of plain `CTR` increment the whole block as one big-endian integer; GOST 28147-89 uses its own gamma. A counter that does not wrap gives the same key stream under all of them, so the SP 800-38A and OpenSSL vectors agree. A cipher word turns its CTR mode into the right one with `blockmode:ctr-as`. CFB is full-block CFB (CFB-128 for AES). OFB is standard output feedback.
- **Vectors.** From the standard: NIST SP 800-38A appendix F for the modes, FIPS 197 for the block, the GCM specification (McGrew and Viega) or NIST SP 800-38D for GCM, RFCs where there are some (RFC 3602), and `ref` cites the example. Include the empty input, a short input that is not a block multiple, errors for each case of "Errors", and a 64 KiB input in every mode against `node:crypto` (where it has the cipher).

### The block-cipher architecture

AES, ChaCha and the key wraps are covered by the audited `@noble/ciphers` and may use its own modes for speed. DES, Triple DES, Blowfish, RC2, RC6, Twofish, SM4, TEA, XTEA, PRESENT and GOST 28147-89 have no audited library, so they are Forge's own primitives, written from their specifications. Each such cipher is:

- a **private single-block primitive pair**, `_encrypt-block` and `_decrypt-block`, each `( block:bytes key:bytes -- bytes )`, in `src/prims/<v>.ts`, with the key schedule inside (a cipher may cache the schedule of the last key it saw, since the key is the same for every block of a call);
- **no modes of its own.** Every mode and PKCS#7 padding come from the one shared vocabulary `blockmode`, so the modes are written once and cannot drift apart.

`blockmode` (`vocab/blockmode.fth`, internal, in `INTERNAL_VOCABS`) is written in FL and takes the block function as a **quotation** that closes over the key. Its two words:

```
blockmode:encrypt ( data:bytes mode:str iv:bytes bs:int padding:bool enc:quot -- bytes )
blockmode:decrypt ( data:bytes mode:str iv:bytes bs:int padding:bool enc:quot dec:quot -- bytes )
```

`mode` is `ECB`, `CBC`, `CFB`, `OFB` or `CTR` (and the counter variants `CTR32` and `CTRLE`, below); `bs` is the block size in bytes, **any size**: the layer never assumes 8 or 16 (RC6 has 4-byte blocks at word-size 8, `rc6:encrypt` with `word-size` 8, and 32-byte ones at 64); `enc` and `dec` have the effect `( block:bytes -- bytes )` and handle one block. Decryption takes both quotations because ECB and CBC decrypt with `dec` while CFB, OFB and CTR run the cipher forwards with `enc`. `blockmode:pad` and `blockmode:unpad` (`( data:bytes bs:int -- bytes )`) are PKCS#7 on their own. A cipher word for an 8-byte block cipher looks like this (the cipher checks its key length in `_encrypt-block`, or in a `_check-key` of its own; `padding "pkcs7" =` turns the choice into the boolean):

```
: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  mode iv 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;
```

The block function is a quotation, so the key schedule is whatever the primitive does per call; a primitive that expands the key on every call (as `aes:_block-enc` does) is fine for the sizes here, and one that caches the last key is faster. The block quotations are called once per block, and the layer checks the IV length (`E_RANGE`), the mode name (`E_RANGE`), whole blocks and padding (`E_COERCE`).

**Why FL.** FL first applies (see above). The layer was measured driving a block primitive at 64 KiB: a CBC encryption through `blockmode:encrypt` takes about 98,500 VM steps (CBC decryption 103 thousand, ECB 70 thousand, CFB and OFB 98 thousand, CTR 1.07 million for its counter arithmetic), against the default limit of 10 million and the untrusted bake budget of 5 million. The loops use `map` over the list of blocks and one `VARIABLE` for the chaining value, so they are linear in the length. The layer is therefore FL, and only the block primitives are TypeScript. `src/blockmode.test.ts` drives it with a trivial XOR block cipher (known answers by hand) and with raw AES blocks, and holds the result byte-identical to noble's own ECB, CBC, CFB and CTR and to `aes:encrypt`; AES uses the layer itself for OFB, which noble lacks.

A pitfall for FL authors: do not write `USING: raise` in a vocabulary that also uses the core word `range`, because `raise:range` would then hide it. Call the raise words qualified (`raise:range`, `raise:coerce`).

## Wave 5 conventions

Wave 5 (utils, extractors, date and time, arithmetic, generators, language) adds many small ops that read and write text. These rules keep them alike; WP 5.30 built the shared words they use.

- **Line and list ops are `str` in, `str` out.** The data is the text as it is (UTF-8), a list is that text cut at a delimiter, and the result is joined with a delimiter again. Do not return an FL `list` from an op (a list is not a UI type). Splitting is `data delimiter util:delimiter split`, joining is `list delimiter util:delimiter join`. Take care that `split` raises on an empty delimiter: a word that splits must refuse the `none` choice (`E_RANGE`, say "needs a delimiter") or define what splitting at "none" means (every character) and say so in its doc.
- **The delimiter parameter.** Copy this header form exactly, with the choices in this order, so the UI shows one list everywhere; an op may take a subset (say so in its doc) and picks its own default:

  ```forth
  : sort ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab|none}="newline" -- str )
  ```

  `util:delimiter ( choice:str -- str )` turns a choice into its text: `space` is one space, `comma` `,`, `semicolon` `;`, `colon` `:`, `newline` a line feed (U+000A; CyberChef calls it "Line feed"), `crlf` a carriage return and a line feed, `cr` a lone carriage return, `tab` a tab and `none` the empty string. Anything else is `E_RANGE` (a header `choice` already rejects it before the word runs (`E_RECIPE_INVALID` in a recipe, `E_PARAM_INVALID` at a direct call); the check is for words called from FL). The older `util:separator` stays for the vocabularies that use it (it answers space for any unknown choice); new code uses `util:delimiter`.

- **Where the delimiter is a free text** (CyberChef's "Delimiter" boxes that take any string), use a `str` parameter and say so; do not add choices to the list above.
- **Numbers in text.** An integer is written as plain decimal digits with a `-` for negatives and no separators (`int>str`), and read back with `str>int` (an optional sign, digits only; surrounding spaces are trimmed first by the op). Big integers are first class; a result of ops on them must not pass through `num`. An op that reads a list of numbers raises `E_COERCE` on a piece that is not a number, naming the piece; it does not skip it.
- **Using the shared words.** Call them qualified or with `USING:`; they are internal vocabularies, so your vocabulary may use them and nothing else has to register them:

  | Word              | Stack effect                       | Meaning                                                                                                                                              |
  | ----------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `random:bytes-of` | `( n:int -- bytes )`               | n random bytes from the host CSPRNG (`+random`); n below 0 is `E_RANGE`, above the value limit `E_LIMIT_VALUE`                                       |
  | `random:below`    | `( n:int -- int )`                 | uniform in [0, n) by rejection sampling, n of 1 or more (`E_RANGE` otherwise), big integers allowed                                                  |
  | `random:between`  | `( lo:int hi:int -- int )`         | uniform in [lo, hi], both ends included, `E_RANGE` when lo is above hi                                                                               |
  | `clock:now-ms`    | `( -- int )`                       | the Unix time in whole milliseconds (`+time`)                                                                                                        |
  | `clock:now-s`     | `( -- int )`                       | the Unix time in whole seconds, rounded down (`+time`)                                                                                               |
  | `list:sort`       | `( items:list -- list )`           | stable ascending sort of numbers (int and num together, big integers fine) or of strings (by code point); a mix, or any other element, is `E_COERCE` |
  | `list:sort-by`    | `( items:list keys:list -- list )` | the items in the stable ascending order of their keys (the same rules as `sort` apply to the keys); unequal lengths are `E_RANGE`                    |
  | `list:shuffle`    | `( items:list -- list )`           | a uniform random permutation (Fisher-Yates on the CSPRNG, `+random`)                                                                                 |

  To sort by something other than the value, compute a key per item with `map` and use `sort-by` (inside a word with named inputs, the input is a local, so push it again: `items items [ lower ] map list:sort-by` is a case-insensitive sort; `[ len ] map` sorts by length; a key built from `str>int` pieces sorts by IP address or by natural order). Measured with the default limits: sorting or shuffling 65,536 short strings or integers costs two VM steps; measured on one machine, sorting 65,536 short strings took about 70 ms, 65,536 integers about 17 ms and shuffling 65,536 elements about 0.3 s (one CSPRNG call per swap), against the default limit of 30 s.

- **No other source of randomness or time.** Do not add a `_now` or `_random-*` primitive, and never read `Math.random`, `Date` or `crypto` from a new primitive. A word that calls a shared word carries the `+random` or `+time` effect (the compiler infers it).
- **How nondeterministic ops are tested.** An op with `+random` or `+time` cannot have a fixed output vector. Its `.test.json` holds the vectors that are deterministic (a range of size one, an empty count) and the error vectors (`E_RANGE`, `E_PARAM_INVALID`). `src/<vocab>.test.ts` checks the structure: length, alphabet, range, that two calls differ, a chi-squared check of the spread (a loose bound, such as 25 for 5 degrees of freedom, so the test does not flake), and exact values with the source pinned: stub `crypto.getRandomValues` with `vi.stubGlobal("crypto", { getRandomValues })` (see `src/prng.test.ts` and `src/list.test.ts`, which pin the rejection sampling and the Fisher-Yates swaps) and fake the clock with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime` (see `src/clock.test.ts`). `runtime.call` does not fill in header defaults, so pass every argument in a test.
- **Categories.** `category` is free text in the catalogue schema, and the UI groups by it; use these for wave 5 so the groups stay few: `Utils` (line and list ops, diff, tables), `Arithmetic`, `Date/Time`, `Extractors`, `Generators` (the random generators of `prng`, UUID, TOTP, Lorem Ipsum, De Bruijn), `Language` (diacritics, NATO, leet, Unicode text format, HTML to text), `Conversions` (units, co-ordinates), `Text` (the existing group, for string and byte ops), `Analysis` (the existing group). Do not invent others without telling the orchestrator.
- **The shared vocabularies are internal.** `random` and `list` are in `INTERNAL_VOCABS` because a public word with one input and no UI-typed parameter is a catalogue op by the rule of RECIPES.md section 2.2, and `random:below ( n -- int )` would have appeared in the UI. The ops built on them live in `prng`. `clock` is not internal: its shared words have no input, so they are not ops, and `clock:get-time` is the one op. (Any new shared word with no input needs no such care; one with inputs belongs in an internal vocabulary.)

## Running the vectors

Every op has vectors in `vocab/<v>.test.json`, and the catalogue test fails if an op has none. All 2,504 vectors (81 files) run through the in-process baker in Node as part of the worker package's tests:

```sh
npm test -w @forge/worker                              # includes test/vectors.test.ts
npx vitest run packages/worker/test/vectors.test.ts    # the vectors alone
```

The same vectors run in Chromium Web Workers, with and without cross-origin isolation:

```sh
npm run gate4:browser -w @forge/worker
```

Multi-step recipes that cross vocabularies (for example `text:split` into `text:join`) are tested in `packages/worker/test/phase4-recipes.test.ts`, because a single-op vector cannot feed a list into another op.

## The CyberChef coverage table

`docs/COVERAGE.md` is generated: it lists each of CyberChef's 506 operations (names only, in `docs/coverage/cyberchef.json`, grouped by CyberChef category) against the Forge words that cover it, or `redesigned` / `dropped` with a reason, or `not yet`. The data is one JSON file per area, `docs/coverage/<area>.json` (`encodings`, `classical`, `bits`, `text`, `regex`, `analysis`, `flow`, ...), an array of `{ "cyberchef", "status": "covered" | "redesigned" | "dropped", "forge": [...], "note" }` checked by `docs/coverage/coverage.schema.json`. `forge` lists catalogue words (`base64:decode`; an alias is written `classical:rot13`) and, for a structural recipe step that replaces an operation, `step:fork`, `step:subsection`, `step:if`, `step:repeat` or `step:comment`. `forge` is required for covered and redesigned, `note` for redesigned and dropped. Map only what exists; unmapped names show as `not yet`.

```sh
npm run coverage    # validate docs/coverage/*.json, then rewrite docs/COVERAGE.md (do not edit it by hand)
```

The part before the colon of a `forge` word is a lower-kebab-case vocabulary name (`quoted-printable:encode`). It fails if a `cyberchef` name is not in `cyberchef.json`, a name is mapped twice, or a `forge` word is not in the built catalogue. `src/coverage.test.ts` runs the same checks and **fails when `docs/COVERAGE.md` is out of date**. Every op WP adds or updates its own `docs/coverage/<area>.json`, so parallel WPs never edit the same file, and commits the regenerated `docs/COVERAGE.md`. A merge conflict in `docs/COVERAGE.md` is resolved by running `npm run coverage` again.
