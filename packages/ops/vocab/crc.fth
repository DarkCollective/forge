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
  data util:crc-presets "\n" algorithm cat " " cat split 1 nth "\n" split 0 nth " " split
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
