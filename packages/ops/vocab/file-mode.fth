\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ file-mode: UNIX file permissions, between octal (755, 4755) and symbolic text (rwxr-xr-x, with the
\ optional file type character of ls -l) and as a plain-text breakdown. Written in FL on the core
\ words; no primitives. The meaning of the bits is POSIX.1 (sys/stat.h): the nine read, write and
\ execute bits and the set-user-ID, set-group-ID and sticky bits.
IN: file-mode

\ ---- symbolic text out ----

: _flag ( mode:int mask:int yes:str -- str )
  mode mask band 0 <> [ yes ] [ "-" ] if ;

\ The execute position of a triplet: x when only the execute bit is set, a lower-case letter (on)
\ when the special bit goes with execute, an upper-case one (off) when it stands alone.
: _x-char ( mode:int x:int special:int on:str off:str -- str )
  mode special band 0 <>
  [ mode x band 0 <> [ on ] [ off ] if ]
  [ mode x "x" _flag ] if ;

\ r is the read bit of the triplet; the write and execute bits are the next two lower ones.
: _triplet ( mode:int r:int special:int on:str off:str -- str )
  mode r "r" _flag mode r 2 div "w" _flag cat
  mode r 4 div special on off _x-char cat ;

: _symbolic ( mode:int -- str )
  mode 256 2048 "s" "S" _triplet
  mode 32 1024 "s" "S" _triplet cat
  mode 4 512 "t" "T" _triplet cat ;

: _octal ( mode:int -- str )
  mode 8 int>str-radix dup len 4 swap - 0 max "0" swap util:repeat-str swap cat ;

\ ---- reading ----

: _sym-bit ( c:str yes:str mask:int -- int )
  c yes = [ mask ]
  [ c "-" = [ 0 ] [ "not a permission character (use r, w, x, s, S, t, T or -)" raise:coerce 0 ] if ] if ;

: _sym-x ( c:str x:int special:int on:str off:str -- int )
  c "x" = [ x ]
  [ c "-" = [ 0 ]
    [ c on = [ x special bor ]
      [ c off = [ special ] [ "not a permission character (use r, w, x, s, S, t, T or -)" raise:coerce 0 ] if ] if ] if ] if ;

: _sym-triplet ( t:str r:int special:int on:str off:str -- int )
  t 0 1 slice "r" r _sym-bit
  t 1 2 slice "w" r 2 div _sym-bit bor
  t 2 3 slice r 4 div special on off _sym-x bor ;

\ The mode bits of nine symbolic characters.
: _sym-mode ( s:str -- int )
  s 0 3 slice 256 2048 "s" "S" _sym-triplet
  s 3 6 slice 32 1024 "s" "S" _sym-triplet bor
  s 6 9 slice 4 512 "t" "T" _sym-triplet bor ;

: _type-name ( c:str -- str )
  c "-" = [ "Regular file" ]
  [ c "d" = [ "Directory" ]
    [ c "l" = [ "Symbolic link" ]
      [ c "b" = [ "Block device" ]
        [ c "c" = [ "Character device" ]
          [ c "p" = [ "Named pipe" ]
            [ c "s" = [ "Socket" ]
              [ c "D" = [ "Door" ]
                [ "not a file type character (use - d l b c p s or D)" raise:coerce "" ] if ] if ] if ] if ] if ] if ] if ] if ;

: _octal-mode ( t:str -- int )
  t len 3 < t len 4 > or
  t str>codes [ 48 55 util:between? ] filter len t len = not or
  [ "an octal mode is 3 or 4 digits, each 0 to 7" raise:coerce ] when
  t 8 str>int-radix ;

\ The mode and the file type character ("" when there is none) of a mode in octal or symbolic text.
: _parse-mode ( data:str -- int str )
  data [ util:space? ] util:trim-start [ util:space? ] util:trim-end
  dup str>codes [ util:dec-digit? ] filter len over len = over len 0 > and
  [ _octal-mode "" ]
  [ dup len 9 = [ _sym-mode "" ]
    [ dup len 10 = [ dup 0 1 slice swap 1 10 slice _sym-mode swap ]
      [ "a mode is 3 or 4 octal digits, or 9 symbolic characters (rwxr-xr-x) with an optional file type character before them" raise:coerce 0 "" ] if ] if ] if ;

\ ---- the breakdown ----
\ The layout is CyberChef's: the textual and octal forms, the file type and the special bits as lines of words, a
\ blank line, and a box of the read, write and execute bits with an X for each one that is set.

: _cell ( mode:int mask:int -- str ) mode mask band 0 <> [ "   X   " ] [ "       " ] if ;

: _row ( label:str mode:int u:int g:int o:int -- str )
  " | " label 7 util:pad-left cat " |" cat
  mode u _cell cat "|" cat mode g _cell cat "|" cat mode o _cell cat "|" cat ;

: _rule ( -- str ) " +---------+-------+-------+-------+" ;

: _report ( mode:int tc:str -- str )
  "Textual representation: " tc len 0 > [ tc ] [ "-" ] if cat mode _symbolic cat
  "\nOctal representation:   " cat mode _octal cat
  tc len 0 > [ "\nFile type: " cat tc _type-name cat ] when
  mode 2048 band 0 <> [ "\nThe setuid flag is set" cat ] when
  mode 1024 band 0 <> [ "\nThe setgid flag is set" cat ] when
  mode 512 band 0 <> [ "\nThe sticky bit is set" cat ] when
  "\n\n" cat _rule cat "\n |         | User  | Group | Other |\n" cat _rule cat "\n" cat
  "Read" mode 256 32 4 _row cat "\n" cat _rule cat "\n" cat
  "Write" mode 128 16 2 _row cat "\n" cat _rule cat "\n" cat
  "Execute" mode 64 8 1 _row cat "\n" cat _rule cat ;

: parse ( data:str -- str )
  "A UNIX file mode explained, in the layout of CyberChef's Parse UNIX file permissions. The input is the mode in octal (755, 0644, 4755) or as symbolic text (rwxr-xr-x), with the file type character of ls -l in front if you like (drwxr-xr-x: - d l b c p s D). The output has the lines Textual representation: (a - is written for the file type when none was given) and Octal representation:, then File type: when one was given, then The setuid flag is set, The setgid flag is set and The sticky bit is set for each of those bits that is on, a blank line, and a box that has an X under User, Group and Other for each read, write and execute bit that is set. s, t and S, T show a special bit together with, or without, the execute bit." doc
  "Conversions" category
  data _parse-mode _report ;

: convert ( data:str to:choice{octal|symbolic}="symbolic" -- str )
  "A UNIX file mode written in the other notation: octal (four digits, 0755) or symbolic (rwxr-xr-x). The input may be either; the file type character of a symbolic input is kept." doc
  "Conversions" category
  data _parse-mode to "octal" = [ drop _octal ] [ swap _symbolic cat ] if ;

META: parse
  use-when "You have a UNIX file mode, such as 755 or drwxr-xr-x from ls -l, and want it explained permission by permission, to check what it allows." ;
  link "https://en.wikipedia.org/wiki/File-system_permissions" "File-system permissions on Wikipedia" ;
  see-also file-mode:convert ;
;

META: convert
  use-when "You have a UNIX file mode in one notation, such as 0755 or rwxr-xr-x from ls -l, and want it written in the other notation." ;
  link "https://en.wikipedia.org/wiki/File-system_permissions" "File-system permissions on Wikipedia" ;
  param to "The notation to write: octal or symbolic." ;
  see-also file-mode:parse ;
;
