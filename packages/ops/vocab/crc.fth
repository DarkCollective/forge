\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ crc: cyclic redundancy checks over the Rocksoft/Williams model (width, poly, init, refin, refout,
\ xorout), written in FL on the core words; there are no primitives. Integers are arbitrary
\ precision, so a 64-bit or 82-bit register needs no special case. The output is the checksum as
\ ceil(width/8) big-endian bytes (CyberChef prints the same value as ceil(width/4) hex digits).
\ Reference: Greg Cook, "Catalogue of parametrised CRC algorithms", reveng.sourceforge.io/crc-catalogue.
\ Cost for 65536 bytes (measured, crc.test.ts): about 0.88 million steps for the reflected path
\ (CRC-32, CRC-64, CRC-82), 1.29 million for the MSB-first path, against a default limit of 10
\ million; the 256-entry table is rebuilt on every call (about 20 thousand steps).
IN: crc

\ The preset parameters, one line per name, led by a line feed so that "\n" name " " finds a line:
\ name width poly init refin refout xorout (hex; T or F for the two reflect flags).
: _presets ( -- str )
  "\nCRC-3/GSM 3 3 0 F F 7\nCRC-3/ROHC 3 3 7 T T 0\nCRC-4/G-704 4 3 0 T T 0\nCRC-4/INTERLAKEN 4 3 F F F F\nCRC-4/ITU 4 3 0 T T 0\nCRC-5/EPC 5 09 09 F F 00\nCRC-5/EPC-C1G2 5 09 09 F F 00\nCRC-5/G-704 5 15 00 T T 00\nCRC-5/ITU 5 15 00 T T 00\nCRC-5/USB 5 05 1F T T 1F\nCRC-6/CDMA2000-A 6 27 3F F F 00\nCRC-6/CDMA2000-B 6 07 3F F F 00\nCRC-6/DARC 6 19 00 T T 00\nCRC-6/G-704 6 03 00 T T 00\nCRC-6/GSM 6 2F 00 F F 3F\nCRC-6/ITU 6 03 00 T T 00\nCRC-7/MMC 7 09 00 F F 00\nCRC-7/ROHC 7 4F 7F T T 00\nCRC-7/UMTS 7 45 00 F F 00\nCRC-8 8 07 00 F F 00\nCRC-8/8H2F 8 2F FF F F FF\nCRC-8/AES 8 1D FF T T 00\nCRC-8/AUTOSAR 8 2F FF F F FF\nCRC-8/BLUETOOTH 8 A7 00 T T 00\nCRC-8/CDMA2000 8 9B FF F F 00\nCRC-8/DARC 8 39 00 T T 00\nCRC-8/DVB-S2 8 D5 00 F F 00\nCRC-8/EBU 8 1D FF T T 00\nCRC-8/GSM-A 8 1D 00 F F 00\nCRC-8/GSM-B 8 49 00 F F FF\nCRC-8/HITAG 8 1D FF F F 00\nCRC-8/I-432-1 8 07 00 F F 55\nCRC-8/I-CODE 8 1D FD F F 00\nCRC-8/ITU 8 07 00 F F 55\nCRC-8/LTE 8 9B 00 F F 00\nCRC-8/MAXIM 8 31 00 T T 00\nCRC-8/MAXIM-DOW 8 31 00 T T 00\nCRC-8/MIFARE-MAD 8 1D C7 F F 00\nCRC-8/NRSC-5 8 31 FF F F 00\nCRC-8/OPENSAFETY 8 2F 00 F F 00\nCRC-8/ROHC 8 07 FF T T 00\nCRC-8/SAE-J1850 8 1D FF F F FF\nCRC-8/SAE-J1850-ZERO 8 1D 00 F F 00\nCRC-8/SMBUS 8 07 00 F F 00\nCRC-8/TECH-3250 8 1D FF T T 00\nCRC-8/WCDMA 8 9B 00 T T 00\nCRC-10/ATM 10 233 000 F F 000\nCRC-10/CDMA2000 10 3D9 3FF F F 000\nCRC-10/GSM 10 175 000 F F 3FF\nCRC-10/I-610 10 233 000 F F 000\nCRC-11/FLEXRAY 11 385 01A F F 000\nCRC-11/UMTS 11 307 000 F F 000\nCRC-12/3GPP 12 80F 000 F T 000\nCRC-12/CDMA2000 12 F13 FFF F F 000\nCRC-12/DECT 12 80F 000 F F 000\nCRC-12/GSM 12 D31 000 F F FFF\nCRC-12/UMTS 12 80F 000 F T 000\nCRC-13/BBC 13 1CF5 0000 F F 0000\nCRC-14/DARC 14 0805 0000 T T 0000\nCRC-14/GSM 14 202D 0000 F F 3FFF\nCRC-15/CAN 15 4599 0000 F F 0000\nCRC-15/MPT1327 15 6815 0000 F F 0001\nCRC-16 16 8005 0000 T T 0000\nCRC-16/A 16 1021 C6C6 T T 0000\nCRC-16/ACORN 16 1021 0000 F F 0000\nCRC-16/ARC 16 8005 0000 T T 0000\nCRC-16/AUG-CCITT 16 1021 1D0F F F 0000\nCRC-16/AUTOSAR 16 1021 FFFF F F 0000\nCRC-16/B 16 1021 FFFF T T FFFF\nCRC-16/BLUETOOTH 16 1021 0000 T T 0000\nCRC-16/BUYPASS 16 8005 0000 F F 0000\nCRC-16/CCITT 16 1021 0000 T T 0000\nCRC-16/CCITT-FALSE 16 1021 FFFF F F 0000\nCRC-16/CCITT-TRUE 16 1021 0000 T T 0000\nCRC-16/CCITT-ZERO 16 1021 0000 F F 0000\nCRC-16/CDMA2000 16 C867 FFFF F F 0000\nCRC-16/CMS 16 8005 FFFF F F 0000\nCRC-16/DARC 16 1021 FFFF F F FFFF\nCRC-16/DDS-110 16 8005 800D F F 0000\nCRC-16/DECT-R 16 0589 0000 F F 0001\nCRC-16/DECT-X 16 0589 0000 F F 0000\nCRC-16/DNP 16 3D65 0000 T T FFFF\nCRC-16/EN-13757 16 3D65 0000 F F FFFF\nCRC-16/EPC 16 1021 FFFF F F FFFF\nCRC-16/EPC-C1G2 16 1021 FFFF F F FFFF\nCRC-16/GENIBUS 16 1021 FFFF F F FFFF\nCRC-16/GSM 16 1021 0000 F F FFFF\nCRC-16/I-CODE 16 1021 FFFF F F FFFF\nCRC-16/IBM 16 8005 0000 T T 0000\nCRC-16/IBM-3740 16 1021 FFFF F F 0000\nCRC-16/IBM-SDLC 16 1021 FFFF T T FFFF\nCRC-16/IEC-61158-2 16 1DCF FFFF F F FFFF\nCRC-16/ISO-HDLC 16 1021 FFFF T T FFFF\nCRC-16/ISO-IEC-14443-3-A 16 1021 C6C6 T T 0000\nCRC-16/ISO-IEC-14443-3-B 16 1021 FFFF T T FFFF\nCRC-16/KERMIT 16 1021 0000 T T 0000\nCRC-16/LHA 16 8005 0000 T T 0000\nCRC-16/LJ1200 16 6F63 0000 F F 0000\nCRC-16/LTE 16 1021 0000 F F 0000\nCRC-16/M17 16 5935 FFFF F F 0000\nCRC-16/MAXIM 16 8005 0000 T T FFFF\nCRC-16/MAXIM-DOW 16 8005 0000 T T FFFF\nCRC-16/MCRF4XX 16 1021 FFFF T T 0000\nCRC-16/MODBUS 16 8005 FFFF T T 0000\nCRC-16/NRSC-5 16 080B FFFF T T 0000\nCRC-16/OPENSAFETY-A 16 5935 0000 F F 0000\nCRC-16/OPENSAFETY-B 16 755B 0000 F F 0000\nCRC-16/PROFIBUS 16 1DCF FFFF F F FFFF\nCRC-16/RIELLO 16 1021 B2AA T T 0000\nCRC-16/SPI-FUJITSU 16 1021 1D0F F F 0000\nCRC-16/T10-DIF 16 8BB7 0000 F F 0000\nCRC-16/TELEDISK 16 A097 0000 F F 0000\nCRC-16/TMS37157 16 1021 89EC T T 0000\nCRC-16/UMTS 16 8005 0000 F F 0000\nCRC-16/USB 16 8005 FFFF T T FFFF\nCRC-16/V-41-LSB 16 1021 0000 T T 0000\nCRC-16/V-41-MSB 16 1021 0000 F F 0000\nCRC-16/VERIFONE 16 8005 0000 F F 0000\nCRC-16/X-25 16 1021 FFFF T T FFFF\nCRC-16/XMODEM 16 1021 0000 F F 0000\nCRC-16/ZMODEM 16 1021 0000 F F 0000\nCRC-17/CAN-FD 17 1685B 00000 F F 00000\nCRC-21/CAN-FD 21 102899 000000 F F 000000\nCRC-24/BLE 24 00065B 555555 T T 000000\nCRC-24/FLEXRAY-A 24 5D6DCB FEDCBA F F 000000\nCRC-24/FLEXRAY-B 24 5D6DCB ABCDEF F F 000000\nCRC-24/INTERLAKEN 24 328B63 FFFFFF F F FFFFFF\nCRC-24/LTE-A 24 864CFB 000000 F F 000000\nCRC-24/LTE-B 24 800063 000000 F F 000000\nCRC-24/OPENPGP 24 864CFB B704CE F F 000000\nCRC-24/OS-9 24 800063 FFFFFF F F FFFFFF\nCRC-30/CDMA 30 2030B9C7 3FFFFFFF F F 3FFFFFFF\nCRC-31/PHILIPS 31 04C11DB7 7FFFFFFF F F 7FFFFFFF\nCRC-32 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/AAL5 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/ADCCP 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/AIXM 32 814141AB 00000000 F F 00000000\nCRC-32/AUTOSAR 32 F4ACFB13 FFFFFFFF T T FFFFFFFF\nCRC-32/BASE91-C 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/BASE91-D 32 A833982B FFFFFFFF T T FFFFFFFF\nCRC-32/BZIP2 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/C 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/CASTAGNOLI 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/CD-ROM-EDC 32 8001801B 00000000 T T 00000000\nCRC-32/CKSUM 32 04C11DB7 00000000 F F FFFFFFFF\nCRC-32/D 32 A833982B FFFFFFFF T T FFFFFFFF\nCRC-32/DECT-B 32 04C11DB7 FFFFFFFF F F FFFFFFFF\nCRC-32/INTERLAKEN 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/ISCSI 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/ISO-HDLC 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/JAMCRC 32 04C11DB7 FFFFFFFF T T 00000000\nCRC-32/MEF 32 741B8CD7 FFFFFFFF T T 00000000\nCRC-32/MPEG-2 32 04C11DB7 FFFFFFFF F F 00000000\nCRC-32/NVME 32 1EDC6F41 FFFFFFFF T T FFFFFFFF\nCRC-32/PKZIP 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/POSIX 32 04C11DB7 00000000 F F FFFFFFFF\nCRC-32/Q 32 814141AB 00000000 F F 00000000\nCRC-32/SATA 32 04C11DB7 52325032 F F 00000000\nCRC-32/V-42 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-32/XFER 32 000000AF 00000000 F F 00000000\nCRC-32/XZ 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nCRC-40/GSM 40 0004820009 0000000000 F F FFFFFFFFFF\nCRC-64/ECMA-182 64 42F0E1EBA9EA3693 0000000000000000 F F 0000000000000000\nCRC-64/GO-ECMA 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/GO-ISO 64 000000000000001B FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/MS 64 259C84CBA6426349 FFFFFFFFFFFFFFFF T T 0000000000000000\nCRC-64/NVME 64 AD93D23594C93659 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-64/REDIS 64 AD93D23594C935A9 0000000000000000 T T 0000000000000000\nCRC-64/WE 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF F F FFFFFFFFFFFFFFFF\nCRC-64/XZ 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF\nCRC-82/DARC 82 0308C0111011401440411 000000000000000000000 T T 000000000000000000000" ;

\ v with its low w bits in reverse order.
: _reflect ( v:int w:int -- int )
  0 w range 0 [ v swap shr 1 band swap 1 shl bor ] reduce ;

\ Byte-at-a-time table entry of the reflected (LSB-first) algorithm: eight shifts of the index.
: _entry-r ( i:int poly:int -- int )
  i 8 [ dup 1 band 0 = [ 1 shr ] [ 1 shr poly bxor ] if ] times ;

: _table-r ( poly:int -- list )
  0 256 range [ poly _entry-r ] map ;

: _fold-r ( data:bytes table:list reg:int -- int )
  data reg [ over bxor 255 band table swap nth swap 8 shr bxor ] reduce ;

\ Register of a reflected CRC: the polynomial and the init value are reflected, the register is
\ shifted right and needs no masking.
: _reflected ( data:bytes w:int poly:int init:int -- int )
  data poly w _reflect _table-r init w _reflect _fold-r ;

\ The register width of the MSB-first algorithm: at least one byte, so that a byte can be xored
\ in at the top (a narrower CRC is computed in a byte-wide register and shifted back).
: _wp ( w:int -- int )
  w 8 max ;

: _entry-n ( i:int wp:int mask:int poly:int -- int )
  i wp 8 - shl 8 [
    dup wp 1 - shr 1 band 0 = [ 1 shl mask band ] [ 1 shl poly bxor mask band ] if
  ] times ;

: _fold-n ( data:bytes table:list wp:int mask:int reg:int -- int )
  data reg [ over wp 8 - shr bxor 255 band table swap nth swap 8 shl mask band bxor ] reduce ;

: _forward ( data:bytes w:int poly:int init:int -- int )
  data
  0 256 range [ w _wp 1 w _wp shl 1 - poly w _wp w - shl _entry-n ] map
  w _wp 1 w _wp shl 1 - init w _wp w - shl _fold-n
  w _wp w - shr ;

\ The CRC register as an integer: xorout is applied after the output reflection.
: _crc ( data:bytes w:int poly:int init:int refin:bool refout:bool xorout:int -- int )
  refin [ data w poly init _reflected ] [ data w poly init _forward ] if
  refin refout <> [ w _reflect ] when
  xorout bxor ;

: _bytes ( v:int w:int -- bytes )
  v w 7 + 8 div util:int>be-bytes ;

: _mask ( v:int w:int -- int )
  v 1 w shl 1 - band ;

: _hex ( b:bytes -- int )
  b 256 util:digits>int ;

: custom ( data:bytes width:int[1..82]=32 poly:toggle{hex}[1..11]="04c11db7" init:toggle{hex}[1..11]="ffffffff" refin:bool=true refout:bool=true xorout:toggle{hex}[1..11]="ffffffff" -- bytes )
  "CRC of any width from 1 to 82 bits, from the Rocksoft model: poly, init and xorout are big-endian hex (the polynomial without its top bit), refin reflects each input byte and refout reflects the register before xorout. Gives ceil(width/8) big-endian bytes. The defaults are CRC-32 (ISO-HDLC, zip)." doc
  "Hashing" category
  data width
  poly _hex width _mask
  init _hex width _mask
  refin refout
  xorout _hex width _mask
  _crc width _bytes ;

: _with ( data:bytes f:list -- bytes )
  data
  f 0 nth str>int
  f 1 nth 16 str>int-radix
  f 2 nth 16 str>int-radix
  f 3 nth "T" =
  f 4 nth "T" =
  f 5 nth 16 str>int-radix
  _crc f 0 nth str>int _bytes ;

: checksum ( data:bytes algorithm:choice{CRC-3/GSM|CRC-3/ROHC|CRC-4/G-704|CRC-4/INTERLAKEN|CRC-4/ITU|CRC-5/EPC|CRC-5/EPC-C1G2|CRC-5/G-704|CRC-5/ITU|CRC-5/USB|CRC-6/CDMA2000-A|CRC-6/CDMA2000-B|CRC-6/DARC|CRC-6/G-704|CRC-6/GSM|CRC-6/ITU|CRC-7/MMC|CRC-7/ROHC|CRC-7/UMTS|CRC-8|CRC-8/8H2F|CRC-8/AES|CRC-8/AUTOSAR|CRC-8/BLUETOOTH|CRC-8/CDMA2000|CRC-8/DARC|CRC-8/DVB-S2|CRC-8/EBU|CRC-8/GSM-A|CRC-8/GSM-B|CRC-8/HITAG|CRC-8/I-432-1|CRC-8/I-CODE|CRC-8/ITU|CRC-8/LTE|CRC-8/MAXIM|CRC-8/MAXIM-DOW|CRC-8/MIFARE-MAD|CRC-8/NRSC-5|CRC-8/OPENSAFETY|CRC-8/ROHC|CRC-8/SAE-J1850|CRC-8/SAE-J1850-ZERO|CRC-8/SMBUS|CRC-8/TECH-3250|CRC-8/WCDMA|CRC-10/ATM|CRC-10/CDMA2000|CRC-10/GSM|CRC-10/I-610|CRC-11/FLEXRAY|CRC-11/UMTS|CRC-12/3GPP|CRC-12/CDMA2000|CRC-12/DECT|CRC-12/GSM|CRC-12/UMTS|CRC-13/BBC|CRC-14/DARC|CRC-14/GSM|CRC-15/CAN|CRC-15/MPT1327|CRC-16|CRC-16/A|CRC-16/ACORN|CRC-16/ARC|CRC-16/AUG-CCITT|CRC-16/AUTOSAR|CRC-16/B|CRC-16/BLUETOOTH|CRC-16/BUYPASS|CRC-16/CCITT|CRC-16/CCITT-FALSE|CRC-16/CCITT-TRUE|CRC-16/CCITT-ZERO|CRC-16/CDMA2000|CRC-16/CMS|CRC-16/DARC|CRC-16/DDS-110|CRC-16/DECT-R|CRC-16/DECT-X|CRC-16/DNP|CRC-16/EN-13757|CRC-16/EPC|CRC-16/EPC-C1G2|CRC-16/GENIBUS|CRC-16/GSM|CRC-16/I-CODE|CRC-16/IBM|CRC-16/IBM-3740|CRC-16/IBM-SDLC|CRC-16/IEC-61158-2|CRC-16/ISO-HDLC|CRC-16/ISO-IEC-14443-3-A|CRC-16/ISO-IEC-14443-3-B|CRC-16/KERMIT|CRC-16/LHA|CRC-16/LJ1200|CRC-16/LTE|CRC-16/M17|CRC-16/MAXIM|CRC-16/MAXIM-DOW|CRC-16/MCRF4XX|CRC-16/MODBUS|CRC-16/NRSC-5|CRC-16/OPENSAFETY-A|CRC-16/OPENSAFETY-B|CRC-16/PROFIBUS|CRC-16/RIELLO|CRC-16/SPI-FUJITSU|CRC-16/T10-DIF|CRC-16/TELEDISK|CRC-16/TMS37157|CRC-16/UMTS|CRC-16/USB|CRC-16/V-41-LSB|CRC-16/V-41-MSB|CRC-16/VERIFONE|CRC-16/X-25|CRC-16/XMODEM|CRC-16/ZMODEM|CRC-17/CAN-FD|CRC-21/CAN-FD|CRC-24/BLE|CRC-24/FLEXRAY-A|CRC-24/FLEXRAY-B|CRC-24/INTERLAKEN|CRC-24/LTE-A|CRC-24/LTE-B|CRC-24/OPENPGP|CRC-24/OS-9|CRC-30/CDMA|CRC-31/PHILIPS|CRC-32|CRC-32/AAL5|CRC-32/ADCCP|CRC-32/AIXM|CRC-32/AUTOSAR|CRC-32/BASE91-C|CRC-32/BASE91-D|CRC-32/BZIP2|CRC-32/C|CRC-32/CASTAGNOLI|CRC-32/CD-ROM-EDC|CRC-32/CKSUM|CRC-32/D|CRC-32/DECT-B|CRC-32/INTERLAKEN|CRC-32/ISCSI|CRC-32/ISO-HDLC|CRC-32/JAMCRC|CRC-32/MEF|CRC-32/MPEG-2|CRC-32/NVME|CRC-32/PKZIP|CRC-32/POSIX|CRC-32/Q|CRC-32/SATA|CRC-32/V-42|CRC-32/XFER|CRC-32/XZ|CRC-40/GSM|CRC-64/ECMA-182|CRC-64/GO-ECMA|CRC-64/GO-ISO|CRC-64/MS|CRC-64/NVME|CRC-64/REDIS|CRC-64/WE|CRC-64/XZ|CRC-82/DARC}=CRC-32 -- bytes )
  "CRC of a named preset, the same names as CyberChef's CRC Checksum (parameters from Greg Cook's CRC catalogue). Gives ceil(width/8) big-endian bytes; CRC-32 of 123456789 is cbf43926." doc
  "Hashing" category
  data _presets "\n" algorithm cat " " cat split 1 nth "\n" split 0 nth " " split
  _with ;

META: custom
  param width "Register width in bits, 1 to 82." ;
  param poly "Generator polynomial without its top bit, big-endian hex (up to 11 bytes)." ;
  param init "Initial register value, hex." ;
  param refin "Reflect each input byte (process the least significant bit first)." ;
  param refout "Reflect the register before xorout." ;
  param xorout "Value xored into the final register, hex." ;
  see-also crc:checksum ;
;

META: checksum
  param algorithm "The preset, named as in CyberChef and the reveng catalogue." ;
  see-also crc:custom ;
;
