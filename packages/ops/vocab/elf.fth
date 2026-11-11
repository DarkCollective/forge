\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ elf: ELF Info (CyberChef's op). A report in the layout of `readelf -W -h -l -S -s` for ELF32 and ELF64,
\ little and big endian: the ELF header, the program headers, the section headers with their names, and
\ the symbol tables (.symtab and .dynsym) with the names of their symbols. All FL: a header is a handful
\ of integer reads and the tables are bounded by the input (a count or an offset is only compared with the
\ bytes that exist, never used to allocate). The printed rows are capped (2,000 a table). The names of
\ machines, OS/ABIs, section types, segment types and symbol fields are tables of "|hex:name|" in this
\ file, read from readelf itself (every e_machine, OS/ABI, section type and segment type was fed to
\ `readelf` in a header crafted for the purpose and its answer kept), looked up with split, which runs in
\ the host. The "context" of every word is the data itself (e:bytes): the byte order and the class are read from
\ its identification bytes. Passing the bytes, not a record that holds them, keeps the allocation meter low
\ (every `get` of a 64 KiB value counts 64 KiB against maxTotalBytes).
IN: elf

\ ---- tables ----

: _machines ( -- str )
  "|0:None|1:WE32100|2:Sparc|3:Intel 80386|4:MC68000|5:MC88000|6:Intel MCU|7:Intel 80860|8:MIPS R3000|9:IBM System/370|a:MIPS R4000 big-endian|b:Sparc v9 (old)|f:HPPA|11:Fujitsu VPP500|12:Sparc v8+|13:Intel 80960|14:PowerPC|15:PowerPC64|16:IBM S/390|17:SPU|24:Renesas V850 (using RH850 ABI)|25:Fujitsu FR20|26:TRW RH32|27:MCORE|28:ARM|29:Digital Alpha (old)|2a:Renesas / SuperH SH|2b:Sparc v9|2c:Siemens Tricore|2d:ARC|2e:Renesas H8/300|2f:Renesas H8/300H|30:Renesas H8S|31:Renesas H8/500|32:Intel IA-64|33:Stanford MIPS-X|34:Motorola Coldfire|35:Motorola MC68HC12 Microcontroller|36:Fujitsu Multimedia Accelerator|37:Siemens PCP|38:Sony nCPU embedded RISC processor|39:Denso NDR1 microprocessor|3a:Motorola Star*Core processor|3b:Toyota ME16 processor|3c:STMicroelectronics ST100 processor|3d:Advanced Logic Corp. TinyJ embedded processor|3e:Advanced Micro Devices X86-64|3f:Sony DSP processor|40:Digital Equipment Corp. PDP-10|41:Digital Equipment Corp. PDP-11|42:Siemens FX66 microcontroller|43:STMicroelectronics ST9+ 8/16 bit microcontroller|44:STMicroelectronics ST7 8-bit microcontroller|45:Motorola MC68HC16 Microcontroller|46:Motorola MC68HC11 Microcontroller|47:Motorola MC68HC08 Microcontroller|48:Motorola MC68HC05 Microcontroller|49:Silicon Graphics SVx|4a:STMicroelectronics ST19 8-bit microcontroller|4b:Digital VAX|4c:Axis Communications 32-bit embedded processor|4d:Infineon Technologies 32-bit embedded cpu|4e:Element 14 64-bit DSP processor|4f:LSI Logic's 16-bit DSP processor|50:Donald Knuth's educational 64-bit processor|51:Harvard Universitys's machine-independent object format|52:Vitesse Prism|53:Atmel AVR 8-bit microcontroller|54:Fujitsu FR30|55:d10v|56:d30v|57:Renesas V850|58:Renesas M32R (formerly Mitsubishi M32r)|59:mn10300|5a:mn10200|5b:picoJava|5c:OpenRISC 1000|5d:ARCompact|5e:Tensilica Xtensa Processor|5f:Alphamosaic VideoCore processor|60:Thompson Multimedia General Purpose Processor|61:National Semiconductor 32000 series|62:Tenor Network TPC processor|63:Trebia SNP 1000 processor|64:STMicroelectronics ST200 microcontroller|65:Ubicom IP2xxx 8-bit microcontrollers|66:MAX Processor|67:National Semiconductor CompactRISC|68:Fujitsu F2MC16|69:Texas Instruments msp430 microcontroller|6a:Analog Devices Blackfin|6b:S1C33 Family of Seiko Epson processors|6c:Sharp embedded microprocessor|6d:Arca RISC microprocessor|6e:Unicore|6f:eXcess 16/32/64-bit configurable embedded CPU|70:Icera Semiconductor Inc. Deep Execution Processor|71:Altera Nios II|72:National Semiconductor CRX microprocessor|73:Motorola XGATE embedded processor|74:Infineon Technologies xc16x|75:Renesas M16C series microprocessors|76:Microchip Technology dsPIC30F Digital Signal Controller|77:Freescale Communication Engine RISC core|78:Renesas M32c|83:Altium TSK3000 core|84:Freescale RS08 embedded processor|86:Cyan Technology eCOG2 microprocessor|87:SUNPLUS S+Core|88:New Japan Radio (NJR) 24-bit DSP Processor|89:Broadcom VideoCore III processor|8a:Lattice Mico32|8b:Seiko Epson C17 family|8c:Texas Instruments TMS320C6000 DSP family|8d:Texas Instruments TMS320C2000 DSP family|8e:Texas Instruments TMS320C55x DSP family|90:TI PRU I/O processor|a0:STMicroelectronics 64bit VLIW Data Signal Processor|a1:Cypress M8C microprocessor|a2:Renesas R32C series microprocessors|a3:NXP Semiconductors TriMedia architecture family|a4:QUALCOMM DSP6 Processor|a5:Intel 8051 and variants|a6:STMicroelectronics STxP7x family|a7:Andes Technology compact code size embedded RISC processor family|a8:Cyan Technology eCOG1X family|a9:Dallas Semiconductor MAXQ30 Core microcontrollers|aa:New Japan Radio (NJR) 16-bit DSP Processor|ab:M2000 Reconfigurable RISC Microprocessor|ac:Cray Inc. NV2 vector architecture|ad:Renesas RX|ae:Imagination Technologies Meta processor architecture|af:MCST Elbrus general purpose hardware architecture|b0:Cyan Technology eCOG16 family|b1:Xilinx MicroBlaze|b2:Freescale Extended Time Processing Unit|b3:Infineon Technologies SLE9X core|b4:Intel L1OM|b5:Intel K1OM|b6:Intel (reserved)|b7:AArch64|b8:ARM (reserved)|b9:Atmel Corporation 32-bit microprocessor|ba:STMicroeletronics STM8 8-bit microcontroller|bb:Tilera TILE64 multicore architecture family|bc:Tilera TILEPro multicore architecture family|bd:Xilinx MicroBlaze|be:NVIDIA CUDA architecture|bf:Tilera TILE-Gx multicore architecture family|c0:CloudShield architecture family|c1:KIPO-KAIST Core-A 1st generation processor family|c2:KIPO-KAIST Core-A 2nd generation processor family|c3:ARCv2|c4:Open8 8-bit RISC soft processor core|c5:Renesas RL78|c6:Broadcom VideoCore V processor|c7:Renesas 78K0R|c8:Freescale 56800EX Digital Signal Controller (DSC)|c9:Beyond BA1 CPU architecture|ca:Beyond BA2 CPU architecture|cb:XMOS xCORE processor family|cc:Microchip 8-bit PIC(r) family|cd:Intel Graphics Technology|d2:KM211 KM32 32-bit processor|d3:KM211 KMX32 32-bit processor|d4:KM211 KMX16 16-bit processor|d5:KM211 KMX8 8-bit processor|d6:KM211 KVARC processor|d7:Paneve CDP architecture family|d8:Cognitive Smart Memory Processor|d9:Bluechip Systems CoolEngine|da:Nanoradio Optimized RISC|db:CSR Kalimba architecture family|dc:Zilog Z80|dd:CDS VISIUMcore processor|de:FTDI Chip FT32|df:Moxie|e0:AMD GPU|f3:RISC-V|f4:Lanai 32-bit processor|f5:CEVA Processor Architecture Family|f6:CEVA X2 Processor Family|f7:Linux BPF|f8:Graphcore Intelligent Processing Unit|f9:Imagination Technologies|fa:Netronome Flow Processor|fb:NEC Vector Engine|fc:C-SKY|fd:Synopsys ARCv3 64-bit processor|fe:MOS Technology MCS 6502 processor|ff:Synopsys ARCv3 32-bit processor|100:Kalray VLIW core of the MPPA processor family|101:WDC 65816/65C816|102:LoongArch|103:ChipON KungFu32|1057:Atmel AVR 8-bit microcontroller|1223:Adapteva EPIPHANY|2530:Morpho Techologies MT processor|3330:Fujitsu FR30|4157:Web Assembly|4688:Infineon Technologies xc16x|5441:Fujitsu FR-V|5aa5:OpenDLX|7650:d10v|9026:Alpha|a390:IBM S/390|abc7:Tensilica Xtensa Processor|ad45:Sanyo XStormy16 CPU core|baab:Xilinx MicroBlaze|beef:mn10300|dead:mn10200|feba:Vitesse IQ2000|febb:Altera Nios|" ;

: _abis ( -- str )
  "|0:UNIX - System V|1:UNIX - HP-UX|2:UNIX - NetBSD|3:UNIX - GNU|6:UNIX - Solaris|7:UNIX - AIX|8:UNIX - IRIX|9:UNIX - FreeBSD|a:UNIX - TRU64|b:Novell - Modesto|c:UNIX - OpenBSD|d:VMS - OpenVMS|e:HP - Non-Stop Kernel|f:AROS|10:FenixOS|11:Nuxi CloudABI|12:Stratus Technologies OpenVOS|" ;

: _section-types ( -- str )
  "|0:NULL|1:PROGBITS|2:SYMTAB|3:STRTAB|4:RELA|5:HASH|6:DYNAMIC|7:NOTE|8:NOBITS|9:REL|a:SHLIB|b:DYNSYM|e:INIT_ARRAY|f:FINI_ARRAY|10:PREINIT_ARRAY|11:GROUP|12:SYMTAB SECTION INDICES|13:RELR|6ffffff5:GNU_ATTRIBUTES|6ffffff6:GNU_HASH|6ffffff7:GNU_LIBLIST|6ffffffd:VERDEF|6ffffffe:VERNEED|6fffffff:VERSYM|" ;

: _segment-types ( -- str )
  "|0:NULL|1:LOAD|2:DYNAMIC|3:INTERP|4:NOTE|5:SHLIB|6:PHDR|7:TLS|6474e550:GNU_EH_FRAME|6474e551:GNU_STACK|6474e552:GNU_RELRO|6474e553:GNU_PROPERTY|6474e554:GNU_SFRAME|" ;

: _file-types ( -- str )
  "|0:NONE (None)|1:REL (Relocatable file)|2:EXEC (Executable file)|3:DYN (Shared object file)|4:CORE (Core file)|" ;

\ ---- text helpers ----

\ Lower-case hex of v, zero-padded to w digits.
: _hex ( v:int w:int -- str )
  v w util:pad-hex ;

\ ---- reading ----

\ n bytes at p as an unsigned integer in the byte order of the file; E_COERCE when the data ends first.
: _u ( e:bytes p:int n:int -- int )
  e p n "ELF data" util:need-bytes
  e p p n + slice
  e 5 nth 2 = [ ] [ rev ] if
  256 util:digits>int ;

\ The class decides: a64 for ELF64, a32 for ELF32.
: _o ( e:bytes a64:int a32:int -- int )
  e 4 nth 2 = [ a64 ] [ a32 ] if ;

\ A native word (4 bytes for ELF32, 8 for ELF64) at p.
: _w ( e:bytes p:int -- int )
  e p e 4 nth 2 = [ 8 ] [ 4 ] if _u ;

\ Field readers by the offset in ELF64 and in ELF32.
: _nat ( e:bytes a64:int a32:int -- int )
  e e a64 a32 _o _w ;

: _h16 ( e:bytes a64:int a32:int -- int )
  e e a64 a32 _o 2 _u ;

: _h32 ( e:bytes a64:int a32:int -- int )
  e e a64 a32 _o 4 _u ;

\ The text up to the first NUL of data[from, to).
: _cut ( data:bytes from:int to:int -- str )
  from to >= [ "" ] [
    data from to slice bytes>latin1 "\x00" split 0 nth latin1>bytes util:text-lossless ] if ;

\ The string at offset off of the string table that is the span [tbl, tbl + tsize) of the data
\ (at most 1,024 bytes of it).
: _str-at ( e:bytes tbl:int tsize:int off:int -- str )
  off tsize >= [ "<corrupt>" ] [
    e tbl off +
    tbl tsize + e len min  tbl off + 1024 + min
    _cut ] if ;

\ ---- the identification and the header ----

: _check-ident ( data:bytes -- )
  data len 16 < [ "not an ELF file: the data is shorter than the 16-byte identification" raise:coerce ] when
  data 0 4 slice #[ 7f 45 4c 46 ] = not [ "not an ELF file: the magic bytes 7f 45 4c 46 are missing" raise:coerce ] when
  data 4 nth dup 1 = swap 2 = or not [
    "unsupported ELF class " data 4 nth int>str cat " (1 is ELF32, 2 is ELF64)" cat raise:coerce ] when
  data 5 nth dup 1 = swap 2 = or not [
    "unsupported ELF data encoding " data 5 nth int>str cat " (1 is little endian, 2 is big endian)" cat raise:coerce ] when
  data len data 4 nth 2 = [ 64 ] [ 52 ] if < [ "the ELF header is cut short" raise:coerce ] when ;

: _context ( data:bytes -- bytes )
  data _check-ident data ;

: _file-type-name ( t:int -- str )
  _file-types t 16 int>str-radix util:name-in-table dup len 0 = [ drop
    t 65024 >= t 65279 <= and [ "OS Specific: (" t 16 int>str-radix cat ")" cat ] [
    t 65280 >= [ "Processor Specific: (" t 16 int>str-radix cat ")" cat ] [
    "<unknown>: " t 16 int>str-radix cat ] if ] if ] when ;

: _machine-name ( m:int -- str )
  _machines m 16 int>str-radix util:name-in-table dup len 0 = [ drop "<unknown>: 0x" m 16 int>str-radix cat ] when ;

: _abi-name ( a:int -- str )
  _abis a 16 int>str-radix util:name-in-table dup len 0 = [ drop "<unknown: " a 16 int>str-radix cat ">" cat ] when ;

: _version-text ( v:int -- str )
  v 1 = [ "1 (current)" ] [ v int>str ] if ;

: _line ( label:str value:str -- str )
  "  " label cat ":" cat 37 util:pad-right value cat "\n" cat ;

: _magic-line ( data:bytes -- str )
  "  Magic:   " data 0 16 slice bytes>list [ 256 + 16 int>str-radix 1 3 slice " " cat ] map "" join cat "\n" cat ;

: _bytes-text ( n:int -- str )
  n int>str " (bytes)" cat ;

\ ---- a table of fixed-size entries inside the data ----

\ E_COERCE unless count entries of size esize fit in the data from off; what names the table.
: _check-table ( e:bytes off:int count:int esize:int what:str -- )
  off count esize * + e len > [
    what " at offset " cat off int>str cat " holds " cat count int>str cat " entries of " cat esize int>str cat
    " bytes and runs past the end of the data (truncated)" cat raise:coerce ] when ;

: _cap ( -- int )
  2000 ;

: _more-line ( total:int -- str )
  total _cap > [ "  (" total _cap - int>str cat " more not shown)\n" cat ] [ "" ] if ;

\ ---- program headers ----

: _p-flags ( f:int -- str )
  f 4 band 0 <> [ "R" ] [ " " ] if
  f 2 band 0 <> [ "W" ] [ " " ] if cat
  f 1 band 0 <> [ "E" ] [ " " ] if cat ;

: _segment-name ( t:int -- str )
  _segment-types t 16 int>str-radix util:name-in-table dup len 0 = [ drop
    t 1610612736 >= t 1879048191 <= and [ "LOOS+0x" t 1610612736 - 16 int>str-radix cat ] [
    t 1879048192 >= [ "LOPROC+0x" t 1879048192 - 16 int>str-radix cat ] [
    "<unknown>: " t 16 int>str-radix cat ] if ] if ] when
  dup len 14 min 0 swap slice ;

\ ---- the segments, as the header and the program table need them ----

: _p-offset ( e:bytes base:int -- int )
  e base e 4 nth 2 = [ 8 ] [ 4 ] if + _w ;

: _p-filesz ( e:bytes base:int -- int )
  e base e 4 nth 2 = [ 32 ] [ 16 ] if + _w ;

\ The text up to the first NUL of n bytes of the data at off (cut at the end of the data).
: _cut-n ( e:bytes off:int n:int -- str )
  e off off n + e len min _cut ;

: _interp-line ( e:bytes base:int -- str )
  e base 4 _u 3 = [
    "      [Requesting program interpreter: " e e base _p-offset e base _p-filesz _cut-n cat "]\n" cat
  ] [ "" ] if ;

\ DT_FLAGS_1 (0x6ffffffb) with DF_1_PIE (0x08000000) in the dynamic section marks a position-independent
\ executable, which readelf shows as DYN (Position-Independent Executable file).
: _dyn-count ( e:bytes off:int size:int -- int )
  e len off - 0 max size min e 4 nth 2 = [ 16 ] [ 8 ] if div 1000 min ;

: _dyn-pie-at ( i:int e:bytes off:int -- bool )
  e off i e 4 nth 2 = [ 16 ] [ 8 ] if * + _w 1879048187 =
  e off i e 4 nth 2 = [ 16 ] [ 8 ] if * + e 4 nth 2 = [ 8 ] [ 4 ] if + _w 134217728 band 0 <> and ;

: _pie-in ( e:bytes off:int size:int -- bool )
  0 e off size _dyn-count range [ e off _dyn-pie-at ] filter len 0 > ;

: _pie-base ( e:bytes base:int -- bool )
  e e base _p-offset e base _p-filesz _pie-in ;

: _phdr-ok? ( e:bytes -- bool )
  e 56 44 _h16 0 >
  e 54 42 _h16 e 4 nth 2 = [ 56 ] [ 32 ] if >= and
  e 32 28 _nat e 56 44 _h16 e 54 42 _h16 * + e len <= and ;

: _dyn-bases ( e:bytes -- list )
  0 e 56 44 _h16 _cap min range [ e 32 28 _nat swap e 54 42 _h16 * + ] map
  [ e swap 4 _u 2 = ] filter ;

: _pie? ( e:bytes -- bool )
  e _phdr-ok? not [ false ] [
    e _dyn-bases dup len 0 = [ drop false ] [ 0 nth e swap _pie-base ] if ] if ;

: _type-text ( e:bytes -- str )
  e 16 16 _h16 dup 3 = [ drop
    e _pie? [ "DYN (Position-Independent Executable file)" ] [ "DYN (Shared object file)" ] if
  ] [ _file-type-name ] if ;

\ One row of the program header table; base is the offset of the entry.
: _p-row ( e:bytes base:int -- str )
  e 4 nth 2 = [
    "  " e base 4 _u _segment-name 14 util:pad-right cat
    " 0x" cat e base 8 + _w 6 _hex cat
    " 0x" cat e base 16 + _w 16 _hex cat
    " 0x" cat e base 24 + _w 16 _hex cat
    " 0x" cat e base 32 + _w 6 _hex cat
    " 0x" cat e base 40 + _w 6 _hex cat
    " " cat e base 4 + 4 _u _p-flags cat
    " 0x" cat e base 48 + _w 16 int>str-radix cat
    "\n" cat e base _interp-line cat
  ] [
    "  " e base 4 _u _segment-name 14 util:pad-right cat
    " 0x" cat e base 4 + _w 6 _hex cat
    " 0x" cat e base 8 + _w 8 _hex cat
    " 0x" cat e base 12 + _w 8 _hex cat
    " 0x" cat e base 16 + _w 5 _hex cat
    " 0x" cat e base 20 + _w 5 _hex cat
    " " cat e base 24 + 4 _u _p-flags cat
    " 0x" cat e base 28 + _w 16 int>str-radix cat
    "\n" cat e base _interp-line cat
  ] if ;

: _p-title ( e:bytes -- str )
  e 4 nth 2 =
  [ "Program Headers:\n  Type           Offset   VirtAddr           PhysAddr           FileSiz  MemSiz   Flg Align\n" ]
  [ "Program Headers:\n  Type           Offset   VirtAddr   PhysAddr   FileSiz MemSiz  Flg Align\n" ] if ;

: _program-table ( e:bytes off:int count:int esize:int -- str )
  e off count esize "the program header table" _check-table
  e _p-title
  0 count _cap min range [ esize * off + e swap _p-row ] map "" join cat
  count _more-line cat ;

: _program-headers ( e:bytes -- str )
  e 56 44 _h16 0 = [ "There are no program headers in this file.\n" ] [
    e 54 42 _h16 e 4 nth 2 = [ 56 ] [ 32 ] if < [
      "the program header entries are " e 54 42 _h16 int>str cat " bytes, too small for an ELF program header" cat raise:coerce ] when
    e e 32 28 _nat e 56 44 _h16 e 54 42 _h16 _program-table ] if ;

: _header-text ( e:bytes -- str )
  "ELF Header:\n" e _magic-line cat
  "Class" e 4 nth 2 = [ "ELF64" ] [ "ELF32" ] if _line cat
  "Data" e 5 nth 2 = [ "2's complement, big endian" ] [ "2's complement, little endian" ] if _line cat
  "Version" e 6 nth _version-text _line cat
  "OS/ABI" e 7 nth _abi-name _line cat
  "ABI Version" e 8 nth int>str _line cat
  "Type" e _type-text _line cat
  "Machine" e 18 18 _h16 _machine-name _line cat
  "Version" "0x" e 20 20 _h32 16 int>str-radix cat _line cat
  "Entry point address" "0x" e 24 24 _nat 16 int>str-radix cat _line cat
  "Start of program headers" e 32 28 _nat int>str " (bytes into file)" cat _line cat
  "Start of section headers" e 40 32 _nat int>str " (bytes into file)" cat _line cat
  "Flags" "0x" e 48 36 _h32 16 int>str-radix cat _line cat
  "Size of this header" e 52 40 _h16 _bytes-text _line cat
  "Size of program headers" e 54 42 _h16 _bytes-text _line cat
  "Number of program headers" e 56 44 _h16 int>str _line cat
  "Size of section headers" e 58 46 _h16 _bytes-text _line cat
  "Number of section headers" e 60 48 _h16 int>str _line cat
  "Section header string table index" e 62 50 _h16 int>str _line cat ;

\ ---- section headers ----

\ One section as a record; base is the offset of its header.
: _section ( e:bytes base:int -- record )
  e 4 nth 2 = [
    { { "name" e base 4 _u } { "type" e base 4 + 4 _u } { "flags" e base 8 + 8 _u }
      { "addr" e base 16 + 8 _u } { "offset" e base 24 + 8 _u } { "size" e base 32 + 8 _u }
      { "link" e base 40 + 4 _u } { "info" e base 44 + 4 _u } { "align" e base 48 + 8 _u }
      { "entsize" e base 56 + 8 _u } } >record
  ] [
    { { "name" e base 4 _u } { "type" e base 4 + 4 _u } { "flags" e base 8 + 4 _u }
      { "addr" e base 12 + 4 _u } { "offset" e base 16 + 4 _u } { "size" e base 20 + 4 _u }
      { "link" e base 24 + 4 _u } { "info" e base 28 + 4 _u } { "align" e base 32 + 4 _u }
      { "entsize" e base 36 + 4 _u } } >record
  ] if ;

: _shnum ( e:bytes -- int )
  e 60 48 _h16 ;

: _shoff ( e:bytes -- int )
  e 40 32 _nat ;

: _shentsize ( e:bytes -- int )
  e 58 46 _h16 ;

\ Section number idx, which must be below the section count.
: _section-at ( e:bytes idx:int -- record )
  e e _shoff idx e _shentsize * + _section ;

\ The sections (at most _cap of them) after the checks of the table.
: _sections ( e:bytes -- list )
  e _shnum 0 = [ { } ] [
    e _shentsize e 4 nth 2 = [ 64 ] [ 40 ] if < [
      "the section header entries are " e _shentsize int>str cat " bytes, too small for an ELF section header" cat raise:coerce ] when
    e e _shoff e _shnum e _shentsize "the section header table" _check-table
    0 e _shnum _cap min range [ e swap _section-at ] map ] if ;

\ Where the strings of a string table section are: a record of off, size and ok.
: _names-of ( e:bytes sec:record -- record )
  { { "off" sec "offset" get } { "size" sec "size" get }
    { "ok" sec "offset" get sec "size" get + e len <= sec "size" get 0 > and } } >record ;

\ The names of the section name table (e_shstrndx), when there is one.
: _shstr ( e:bytes -- record )
  e 62 50 _h16 dup e _shnum < over 0 > and
  [ e swap _section-at e swap _names-of ]
  [ drop { { "off" 0 } { "size" 0 } { "ok" false } } >record ] if ;

: _name ( e:bytes names:record off:int -- str )
  names "ok" get [ e names "off" get names "size" get off _str-at ] [ "<no-strings>" ] if ;

: _sec-type-name ( t:int -- str )
  _section-types t 16 int>str-radix util:name-in-table dup len 0 = [ drop
    t 2147483648 >= [ "LOUSER+0x" t 2147483648 - 16 int>str-radix cat ] [
    t 1879048192 >= [ "LOPROC+0x" t 1879048192 - 16 int>str-radix cat ] [
    t 1610612736 >= [ "LOOS+0x" t 1610612736 - 16 int>str-radix cat ] [
    t 8 _hex ": <unknown>" cat ] if ] if ] if ] when ;

: _flags-text ( f:int -- str )
  ""
  f 1 band 0 <> [ "W" cat ] when
  f 2 band 0 <> [ "A" cat ] when
  f 4 band 0 <> [ "X" cat ] when
  f 16 band 0 <> [ "M" cat ] when
  f 32 band 0 <> [ "S" cat ] when
  f 64 band 0 <> [ "I" cat ] when
  f 128 band 0 <> [ "L" cat ] when
  f 256 band 0 <> [ "O" cat ] when
  f 512 band 0 <> [ "G" cat ] when
  f 1024 band 0 <> [ "T" cat ] when
  f 2048 band 0 <> [ "C" cat ] when
  f 2147483648 band 0 <> [ "E" cat ] when
  f 4087 2147483648 + band f = [ ] [ "x" cat ] if ;

: _s-row ( e:bytes names:record i:int sec:record -- str )
  "  [" i int>str 2 util:pad-left cat "] " cat
  e names sec "name" get _name 17 util:pad-right cat " " cat
  sec "type" get _sec-type-name 15 util:pad-right cat " " cat
  sec "addr" get e 4 nth 2 = [ 16 ] [ 8 ] if _hex cat " " cat
  sec "offset" get 6 _hex cat " " cat
  sec "size" get 6 _hex cat " " cat
  sec "entsize" get 2 _hex cat " " cat
  sec "flags" get _flags-text 3 util:pad-left cat " " cat
  sec "link" get int>str 2 util:pad-left cat " " cat
  sec "info" get int>str 3 util:pad-left cat " " cat
  sec "align" get int>str 2 util:pad-left cat "\n" cat ;

: _s-title ( e:bytes -- str )
  e 4 nth 2 =
  [ "Section Headers:\n  [Nr] Name              Type            Address          Off    Size   ES Flg Lk Inf Al\n" ]
  [ "Section Headers:\n  [Nr] Name              Type            Addr     Off    Size   ES Flg Lk Inf Al\n" ] if ;

: _section-table ( e:bytes secs:list names:record -- str )
  e _s-title
  0 secs len range [ e names rot dup secs swap nth _s-row ] map "" join cat
  e _shnum _more-line cat ;

\ ---- symbol tables ----

\ The name of v in a "|hex:name|" table, else the readelf wording for the ranges.
: _sym-field ( table:str v:int -- str )
  table v 16 int>str-radix util:name-in-table dup len 0 = [ drop
    v 13 >= [ "<processor specific>: " v int>str cat ] [
    v 10 >= [ "<OS specific>: " v int>str cat ] [
    "<unknown>: " v int>str cat ] if ] if ] when ;

\ GNU_IFUNC and GNU_UNIQUE have a name under the GNU and FreeBSD OS/ABIs only.
: _gnu? ( osabi:int -- bool )
  osabi 3 = osabi 9 = or ;

: _type-table ( osabi:int -- str )
  osabi _gnu? [ "|0:NOTYPE|1:OBJECT|2:FUNC|3:SECTION|4:FILE|5:COMMON|6:TLS|8:RELC|9:SRELC|a:IFUNC|" ]
              [ "|0:NOTYPE|1:OBJECT|2:FUNC|3:SECTION|4:FILE|5:COMMON|6:TLS|8:RELC|9:SRELC|" ] if ;

: _bind-table ( osabi:int -- str )
  osabi _gnu? [ "|0:LOCAL|1:GLOBAL|2:WEAK|a:UNIQUE|" ] [ "|0:LOCAL|1:GLOBAL|2:WEAK|" ] if ;

: _vis-name ( other:int -- str )
  "|0:DEFAULT|1:INTERNAL|2:HIDDEN|3:PROTECTED|" other 3 band 16 int>str-radix util:name-in-table ;

: _ndx-text ( ndx:int shnum:int -- str )
  ndx 0 = [ "UND" ] [ ndx 65521 = [ "ABS" ] [ ndx 65522 = [ "COM" ] [
  ndx 65280 >= [
    ndx 65311 <= [ "PRC[0x" ndx 4 _hex cat "]" cat ] [
    ndx 65343 <= [ "OS [0x" ndx 4 _hex cat "]" cat ] [
    "RSV[0x" ndx 4 _hex cat "]" cat ] if ] if ] [
    ndx shnum < [ ndx int>str ] [ "BAD[0x" ndx 16 int>str-radix cat "]" cat ] if ] if ] if ] if ] if ;

\ One symbol as a record; base is the offset of the entry.
: _sym ( e:bytes base:int -- record )
  e 4 nth 2 = [
    { { "name" e base 4 _u } { "info" e base 4 + 1 _u } { "other" e base 5 + 1 _u }
      { "shndx" e base 6 + 2 _u } { "value" e base 8 + 8 _u } { "size" e base 16 + 8 _u } } >record
  ] [
    { { "name" e base 4 _u } { "value" e base 4 + 4 _u } { "size" e base 8 + 4 _u }
      { "info" e base 12 + 1 _u } { "other" e base 13 + 1 _u } { "shndx" e base 14 + 2 _u } } >record
  ] if ;

: _sym-row ( e:bytes sym:record i:int names:record -- str )
  i int>str 6 util:pad-left ": " cat
  sym "value" get e 4 nth 2 = [ 16 ] [ 8 ] if _hex cat " " cat
  sym "size" get dup 99999 > [ 16 int>str-radix "0x" swap cat ] [ int>str 5 util:pad-left ] if cat " " cat
  e 7 nth _type-table sym "info" get 15 band _sym-field 7 util:pad-right cat " " cat
  e 7 nth _bind-table sym "info" get 4 shr _sym-field 6 util:pad-right cat " " cat
  sym "other" get _vis-name 7 util:pad-right cat " " cat
  sym "shndx" get e _shnum _ndx-text 4 util:pad-left cat " " cat
  e names sym "name" get _name cat
  "\n" cat ;

: _sym-title ( e:bytes -- str )
  e 4 nth 2 =
  [ "   Num:    Value          Size Type    Bind   Vis      Ndx Name\n" ]
  [ "   Num:    Value  Size Type    Bind   Vis      Ndx Name\n" ] if ;

: _no-names ( -- record )
  { { "off" 0 } { "size" 0 } { "ok" false } } >record ;

\ The names of the symbols of a symbol table section: the string table its sh_link names.
: _sym-names ( e:bytes sec:record -- record )
  sec "link" get e _shnum < [ e e sec "link" get _section-at _names-of ] [ _no-names ] if ;

: _sym-line ( i:int e:bytes sec:record esize:int names:record -- str )
  e e sec "offset" get i esize * + _sym i names _sym-row ;

: _symtab-rows ( e:bytes sec:record esize:int count:int names:record -- str )
  e sec "offset" get count _cap min esize "the symbol table" _check-table
  0 count _cap min range [ e sec esize names _sym-line ] map "" join
  count _more-line cat ;

: _symtab-block3 ( e:bytes sec:record snames:record esize:int count:int -- str )
  "Symbol table '" e snames sec "name" get _name cat "' contains " cat count int>str cat
  count 1 = [ " entry:\n" ] [ " entries:\n" ] if cat
  e _sym-title cat
  e sec esize count e sec _sym-names _symtab-rows cat ;

: _symtab-block2 ( e:bytes sec:record snames:record esize:int -- str )
  esize e 4 nth 2 = [ 24 ] [ 16 ] if < [
    "the symbol table entries are " esize int>str cat " bytes, too small for an ELF symbol" cat raise:coerce ] when
  e sec snames esize sec "size" get esize div _symtab-block3 ;

: _symtab-block ( e:bytes sec:record snames:record -- str )
  e sec snames sec "entsize" get dup 0 = [ drop e 4 nth 2 = [ 24 ] [ 16 ] if ] when _symtab-block2 ;

\ ---- the report ----

: _section-blocks2 ( e:bytes secs:list names:record -- list )
  { e secs names _section-table }
  secs [ "type" get dup 2 = swap 11 = or ] filter
  [ e swap names _symtab-block ] map cat ;

: _section-blocks ( e:bytes -- list )
  e _shnum 0 = [ { "There are no sections in this file.\n" } ] [
    e e _sections e _shstr _section-blocks2 ] if ;

: _report ( e:bytes -- str )
  { e _header-text e _program-headers } e _section-blocks cat "\n" join ;

: info ( data:bytes -- str )
  "ELF Info: a report on an ELF executable, object file or shared library (32 and 64 bit, little and big endian) in the layout of readelf -W -h -l -S -s: the ELF header (class, byte order, OS/ABI, type, machine, entry point, table offsets and counts), the program headers (segments with offsets, addresses, sizes, flags R W E and alignment), the section headers with their names, types, addresses, offsets, sizes, flags and links, and the symbol tables .symtab and .dynsym with value, size, type, bind, visibility, section index and name. At most 2,000 rows are shown for each table, with a line telling how many more there are. Names for machines, OS/ABIs, section types and segment types are those of readelf; the Flags field of the header is shown as a hex number only, without the machine-specific words readelf adds, symbol versions (@GLIBC_2.2.5) and the dynamic section are not shown. Data that is not ELF, or a table that runs past the end of the data, is E_COERCE with the offset." doc
  "Forensics" category
  data _context _report ;

META: info
  see-also filetype:detect filetype:scan ;
;
