\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hassh: HASSH Client Fingerprint and HASSH Server Fingerprint (Salesforce), the CyberChef operations of the same
\ names. The input is the SSH binary packet that carries SSH_MSG_KEXINIT (RFC 4253 sections 6 and 7.1): packet length,
\ padding length, message 20, the 16-byte cookie, ten name-lists, first_kex_packet_follows, a reserved word and the
\ padding. HASSH is the MD5 of "kex;encryption;mac;compression" where the three lists after the key exchange list
\ are the client-to-server ones for the client and the server-to-client ones for the server. FL only: the packet has
\ ten fields, and the MD5 is the md5 word.
IN: hassh

USING: md5 hex base64 ;

\ Four bytes at p as a big-endian unsigned integer (the caller has checked that they are there).
: _u32 ( d:bytes p:int -- int )
  d p nth 24 shl d p 1 + nth 16 shl bor d p 2 + nth 8 shl bor d p 3 + nth bor ;

\ ---- the packet ----

\ E_COERCE unless the data is exactly one SSH binary packet (no MAC, as KEXINIT is sent in the clear) of a KEXINIT
\ message: the length field, the padding of at least 4 bytes, message code 20 and room for the fixed fields.
: _check-packet ( d:bytes -- )
  d len 6 < [ "SSH packet is cut short: " d len int>str cat " bytes, at least 6 are needed for the length, the padding length and the message code" cat raise:coerce ] when
  d 0 _u32 d len 4 - <> [
    "SSH packet length is " d 0 _u32 int>str cat " but " cat d len 4 - int>str cat
    " bytes follow the length field (exactly one packet is expected, without a MAC)" cat raise:coerce ] when
  d 5 nth 20 <> [ "not an SSH_MSG_KEXINIT: the message code is " d 5 nth int>str cat " (expected 20)" cat raise:coerce ] when
  d 4 nth 4 < [ "SSH padding length is " d 4 nth int>str cat ", below the minimum of 4" cat raise:coerce ] when
  d 0 _u32 d 4 nth - 1 - 62 < [
    "SSH_MSG_KEXINIT is too short: the payload of " d 0 _u32 d 4 nth - 1 - int>str cat
    " bytes cannot hold the cookie, ten name-lists and the final fields (62 bytes)" cat raise:coerce ] when ;

\ The end of the payload, where the padding starts.
: _end ( d:bytes -- int )
  d len d 4 nth - ;

\ The text of a name-list: US-ASCII, no control characters or spaces (RFC 4251 section 5).
: _ascii ( b:bytes p:int -- str )
  b bytes>list [ 33 126 util:between? not ] filter len 0 > [
    "a name-list contains a byte that is not printable US-ASCII, at offset " p int>str cat raise:coerce ] when
  b bytes>latin1 ;

: _nl3 ( st:record s:str q:int -- record )
  st "p" q put "names" st "names" get s append put ;

: _nl2 ( st:record d:bytes end:int n:int -- record )
  st "p" get 4 + n + end > [
    "the name-list at offset " st "p" get int>str cat " declares " cat n int>str cat " bytes but only "
    cat end st "p" get - 4 - 0 max int>str cat " are left before the padding" cat raise:coerce ] when
  st d st "p" get 4 + dup n + slice st "p" get _ascii st "p" get 4 + n + _nl3 ;

\ One name-list at the position kept in the state record { p names }.
: _nl ( st:record d:bytes end:int -- record )
  st "p" get 4 + end > [
    "SSH_MSG_KEXINIT is cut short: a name-list length is missing at offset " st "p" get int>str cat raise:coerce ] when
  st d end d st "p" get _u32 _nl2 ;

\ After the last name-list come first_kex_packet_follows (1 byte) and the reserved word (4 bytes), then the padding.
: _finish ( st:record d:bytes -- list )
  st "p" get 5 + d _end > [
    "SSH_MSG_KEXINIT is cut short: the 5 bytes of first_kex_packet_follows and the reserved word do not fit after offset "
    st "p" get int>str cat raise:coerce ] when
  st "p" get 5 + d _end < [
    "after the name-lists the payload has " d _end st "p" get - 5 - int>str cat
    " more bytes than the 5 of first_kex_packet_follows and the reserved word" cat raise:coerce ] when
  st "names" get ;

\ The ten name-lists of the packet, as a list of strings.
: _lists ( d:bytes -- list )
  d _check-packet
  0 10 range { { "p" 22 } { "names" { } } } >record [ drop d d _end _nl ] reduce
  d _finish ;

\ ---- the outputs ----

\ The four fields of the HASSH string: the key exchange list and the three lists of one direction (c2s: 2, 4, 6; s2c: 3, 5, 7).
: _fields ( names:list a:int b:int c:int -- list )
  { names 0 nth names a nth names b nth names c nth } ;

: _out ( f:list s:str fmt:str dir:str -- str )
  fmt "string" = [ s ] [
    fmt "full" =
    [ "Hash digest:\n" s util:md5-hex cat "\n\nFull HASSH algorithms string:\n" cat s cat
      "\n\nKey Exchange Algorithms:\n" cat f 0 nth cat
      "\nEncryption Algorithms " cat dir cat ":\n" cat f 1 nth cat
      "\nMAC Algorithms " cat dir cat ":\n" cat f 2 nth cat
      "\nCompression Algorithms " cat dir cat ":\n" cat f 3 nth cat ]
    [ s util:md5-hex ] if ] if ;

: client ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{hash|string|full}="hash" -- str )
  "The HASSH fingerprint (Salesforce) of an SSH client, from the SSH_MSG_KEXINIT packet it sends, as CyberChef's HASSH Client Fingerprint. The input is the SSH binary packet (hex text, Base64 text or raw bytes): the 4-byte packet length, the padding length, the message code 20, the 16-byte cookie, the ten name-lists (key exchange, server host key, encryption, MAC, compression and language, each client to server and then server to client), first_kex_packet_follows, 4 reserved bytes and the padding; exactly one packet, with nothing before or after it (the identification string and a MAC are not part of it). The HASSH string joins four lists with semicolons: the key exchange algorithms, the encryption, MAC and compression algorithms from client to server, each list as the client wrote it (commas inside). The fingerprint is the MD5 of that string as 32 lower-case hex digits. output-format: hash, string or full (CyberChef's layout: the hash, the string and the four lists under their headings). A length that does not match the data, a message code other than 20, padding under 4 bytes, a name-list that runs past the payload, a name-list with a byte that is not printable ASCII, and bytes in the payload after the last field are E_COERCE with the offset (CyberChef checks only the length and the message code, and takes text without looking at it)." doc
  "Networking" category
  data input-format util:wire-input _lists 2 4 6 _fields
  dup ";" join output-format "Client to Server" _out ;

META: client
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "The MD5 hash of the HASSH string, the HASSH string, or both with the four lists." ;
  see-also hassh:server ;
;

: server ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{hash|string|full}="hash" -- str )
  "The HASSHServer fingerprint (Salesforce) of an SSH server, from the SSH_MSG_KEXINIT packet it sends, as CyberChef's HASSH Server Fingerprint. The input is the same binary packet as for HASSH Client Fingerprint (hex text, Base64 text or raw bytes), sent by the server. The HASSH string joins four lists with semicolons: the key exchange algorithms, the encryption, MAC and compression algorithms from server to client, each as the server wrote it. The fingerprint is the MD5 of that string as 32 lower-case hex digits. output-format: hash, string or full (the hash, the string and the four lists under their headings, as CyberChef). Malformed packets are E_COERCE, as for the client." doc
  "Networking" category
  data input-format util:wire-input _lists 3 5 7 _fields
  dup ";" join output-format "Server to Client" _out ;

META: server
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "The MD5 hash of the HASSH string, the HASSH string, or both with the four lists." ;
  see-also hassh:client ;
;
