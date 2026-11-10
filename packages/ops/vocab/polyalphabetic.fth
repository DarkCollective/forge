\ polyalphabetic: polyalphabetic ciphers beyond Vigenere (Beaufort, autokey, Gronsfeld). They work on
\ bytes and touch ASCII letters only; every other byte passes through and uses up no key letter.
IN: polyalphabetic

\ ---------------------------------------------------------------------------------------------
\ Letters (private helpers)
\ ---------------------------------------------------------------------------------------------

\ The index 0 to 25 of an ASCII letter (either case).
: _pa-index ( c:int -- int )
  c 31 band 1 - ;

\ The letter with index i (0 to 25) in the case of the letter c.
: _pa-letter-of ( i:int c:int -- int )
  c 96 > [ i 97 + ] [ i 65 + ] if ;

\ c shifted by k letters (k may be negative), keeping its case.
: _pa-shift ( c:int k:int -- int )
  c util:letter? [ c _pa-index k + 26 mod c _pa-letter-of ] [ c ] if ;

\ k minus c, as a letter, keeping the case of c (Beaufort).
: _pa-reflect ( c:int k:int -- int )
  c util:letter? [ k c _pa-index - 26 mod c _pa-letter-of ] [ c ] if ;

\ ---------------------------------------------------------------------------------------------
\ Key streams: the key values repeat over the letters of the data (a VARIABLE counts them)
\ ---------------------------------------------------------------------------------------------

0 VARIABLE _pa-pos

\ f ( c:int k:int -- int ) combines each letter with the key value of its position.
: _pa-stream ( data:bytes ks:bytes f:quot -- bytes )
  0 _pa-pos!
  data [ dup util:letter?
    [ _pa-pos ks len mod ks swap nth f call _pa-pos 1 + _pa-pos! ]
    [ ]
    if ] map ;

\ ---------------------------------------------------------------------------------------------
\ Autokey: the key is followed by the plaintext, so the key value of a letter is the plaintext
\ letter klen letters earlier. The next key values are kept in a window (a bytes VARIABLE).
\ ---------------------------------------------------------------------------------------------

#[ ] VARIABLE _pa-win

\ Encrypt one letter: the window is the next key values; the plaintext letter enters it.
: _pa-auto-enc ( c:int -- int )
  c _pa-index _pa-win 0 nth + 26 mod c _pa-letter-of
  _pa-win 1 _pa-win len slice c _pa-index 1 util:int>be-bytes cat _pa-win! ;

\ Decrypt one letter: the recovered plaintext letter enters the window.
: _pa-auto-dec ( c:int -- int )
  c _pa-index _pa-win 0 nth - 26 mod dup c _pa-letter-of
  _pa-win 1 _pa-win len slice rot 1 util:int>be-bytes cat _pa-win! ;

: _pa-autokey ( data:bytes kv:bytes dec:bool -- bytes )
  kv _pa-win!
  data [ dup util:letter?
    [ dec [ _pa-auto-dec ] [ _pa-auto-enc ] if ]
    [ ]
    if ] map ;

\ ---------------------------------------------------------------------------------------------
\ Words
\ ---------------------------------------------------------------------------------------------

: beaufort ( data:bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Beaufort cipher: each ASCII letter with index p (A = 0) becomes (k - p) mod 26, where k is the index of the key letter at that letter's position (the key repeats over the letters, case-insensitive). Case is kept; other bytes pass through and use up no key letter. It is its own inverse, so the same word decrypts." doc
  "Classical ciphers" category
  data key str>bytes [ 31 band 1 - ] map [ _pa-reflect ] _pa-stream ;

META: beaufort
  param key "Key letters A to Z (either case), 1 to 256 of them." ;
  see-also polyalphabetic:beaufort ;
;

: vigenere-autokey-encrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Vigenere autokey cipher: the key is followed by the plaintext letters, so the first key values are the key letters and each later one is the plaintext letter klen positions earlier. Case is kept; other bytes pass through and use up no key letter." doc
  "Classical ciphers" category
  data key str>bytes [ 31 band 1 - ] map false _pa-autokey ;

META: vigenere-autokey-encrypt
  param key "Primer: key letters A to Z (either case), 1 to 256 of them." ;
  see-also polyalphabetic:vigenere-autokey-decrypt ;
;

: vigenere-autokey-decrypt ( data:bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Undo the Vigenere autokey cipher with the same primer key: each recovered plaintext letter joins the key stream." doc
  "Classical ciphers" category
  data key str>bytes [ 31 band 1 - ] map true _pa-autokey ;

META: vigenere-autokey-decrypt
  param key "Primer used to encrypt: key letters A to Z (either case), 1 to 256 of them." ;
  see-also polyalphabetic:vigenere-autokey-encrypt ;
;

: gronsfeld-encrypt ( data:bytes key:str[1..256,/[0-9]+/] -- bytes )
  "Gronsfeld cipher: a Vigenere cipher whose key is digits. Each ASCII letter is shifted forward by the digit at its position (the key repeats over the letters). Case is kept; other bytes pass through and use up no key digit." doc
  "Classical ciphers" category
  data key str>bytes [ 48 - ] map [ _pa-shift ] _pa-stream ;

META: gronsfeld-encrypt
  param key "Key digits 0 to 9, 1 to 256 of them." ;
  see-also polyalphabetic:gronsfeld-decrypt ;
;

: gronsfeld-decrypt ( data:bytes key:str[1..256,/[0-9]+/] -- bytes )
  "Undo the Gronsfeld cipher with the same digits: each letter is shifted back by its key digit." doc
  "Classical ciphers" category
  data key str>bytes [ 48 - ] map [ neg _pa-shift ] _pa-stream ;

META: gronsfeld-decrypt
  param key "Key digits used to encrypt, 0 to 9, 1 to 256 of them." ;
  see-also polyalphabetic:gronsfeld-encrypt ;
;

\ ---------------------------------------------------------------------------------------------
\ Porta: thirteen paired alphabets, one per key letter pair AB, CD, ... YZ.
\ ---------------------------------------------------------------------------------------------

\ The index (0 to 25) that letter index i (0 to 25) becomes under the pair index t (0 to 12): A to M
\ go to the N to Z half by (i + t) mod 13, and N to Z go to the A to M half by (i - 13 - t) mod 13.
: _porta-index ( i:int t:int -- int )
  i 13 < [ i t + 13 mod 13 + ] [ i 13 - t - 13 mod ] if ;

\ The Porta letter of the letter c under the key letter index k: the pair index is k div 2.
: _porta-letter ( c:int k:int -- int )
  c _pa-index k 2 div _porta-index c _pa-letter-of ;

: porta ( data:bytes key:str[1..256,/[A-Za-z]+/] -- bytes )
  "Porta cipher (della Porta, 1563): thirteen paired alphabets, one per key letter pair AB, CD, ..., YZ (the pair index is the key letter div 2). A letter in A to M is replaced by a letter of the N to Z half, and a letter in N to Z by a letter of the A to M half, by the rule of the pair. It is reciprocal, so the same word decrypts. Case is kept; other bytes pass through and use up no key letter." doc
  "Classical ciphers" category
  data key str>bytes [ 31 band 1 - ] map [ _porta-letter ] _pa-stream ;

META: porta
  param key "Key letters A to Z (either case), 1 to 256 of them; each pair AB, CD, ... selects one alphabet." ;
;
