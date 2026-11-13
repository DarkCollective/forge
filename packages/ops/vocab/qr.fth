\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ qr: Generate QR Code, the CyberChef operation of that name (ISO/IEC 18004, QR Code Model 2). The encoder (modes, versions
\ 1 to 40, Reed-Solomon, masks and their penalties) and the SVG, text and scanline writers are private primitives
\ (src/prims/qr.ts; the module loops are far too slow in FL); the PNG file (signature, IHDR, IDAT through the deflate
\ words, IEND, CRC-32 through the crc words) and the parameter checks are FL. There is no image library in scope
\ (images are deferred with Multimedia), so the formats are SVG, text and a 1-bit PNG.
IN: qr

USING: deflate crc ;

: _be32 ( n:int -- bytes )
  n 4 util:int>be-bytes ;

\ A PNG chunk from its length, and its type and body (which the CRC covers).
: _chunk-of ( tb:bytes n:int -- bytes )
  n _be32 tb cat tb "CRC-32" crc:checksum cat ;

: _chunk ( type:str body:bytes -- bytes )
  type str>bytes body cat body len _chunk-of ;

\ A 1-bit greyscale PNG from the unfiltered scanlines.
: _png ( scan:bytes w:int h:int -- bytes )
  #[ 89 50 4e 47 0d 0a 1a 0a ]
  "IHDR" w _be32 h _be32 cat #[ 01 00 00 00 00 ] cat _chunk cat
  "IDAT" scan 9 deflate:zlib-deflate _chunk cat
  "IEND" #[ ] _chunk cat ;

: generate ( data:str format:choice{svg|text|png}=svg module-size:int=5 margin:int=4 error-correction:choice{L|M|Q|H}=M -- bytes )
  "Write the text as a QR Code (ISO/IEC 18004, Model 2), as CyberChef's Generate QR Code does. The text is encoded in one mode, numeric when it is all digits, alphanumeric when it only holds 0-9 A-Z space and $%*+-./:, else byte (UTF-8, no ECI header), in the smallest version from 1 to 40 that holds it at the error correction level (L about 7%, M 15%, Q 25%, H 30% of the codewords restorable); the mask with the lowest penalty is used. The output is the image as bytes: svg is an SVG document (module-size pixels a module, a white background, a black path), text is one line per module row with two characters a module (a full block pair for dark, two spaces for light; module-size is not used) and png is a 1-bit greyscale PNG. margin is the white border in modules (4 is the standard quiet zone). The parameters are in CyberChef's order (format, module size, margin, error correction). CyberChef also writes JPEG, EPS and PDF, which Forge does not (no image library), and its default format is PNG (svg here: the output pane shows no images, but an SVG is text that opens in any browser). Empty text, text too long for version 40, a module size outside 1 to 100, a margin outside 0 to 100 are E_RANGE; an image over the value limit is E_LIMIT_VALUE." doc
  "Data format" category
  module-size 1 100 "the module size" util:check-int-range
  margin 0 100 "the margin" util:check-int-range
  format "svg" = [ data error-correction module-size margin qr:_svg ] [
    format "text" = [ data error-correction module-size margin qr:_text ] [
      data error-correction module-size margin qr:_scanlines _png
    ] if
  ] if ;

META: generate
  use-when "You have text, such as a web address or Wi-Fi details, and want a QR code image to scan with a phone or to print." ;
  param format "svg for an SVG document, text for lines of block characters, png for a 1-bit PNG image." ;
  param module-size "The side of one module in pixels (SVG and PNG)." ;
  param margin "The white border around the code in modules." ;
  param error-correction "The share of the codewords that can be restored: L (7%), M (15%), Q (25%) or H (30%)." ;
  link "https://en.wikipedia.org/wiki/QR_code" "QR code on Wikipedia" ;
;
