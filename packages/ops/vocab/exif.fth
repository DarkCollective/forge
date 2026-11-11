\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ exif: Extract EXIF (CyberChef's op), without decoding any image. The Exif block is found in a JPEG (the
\ APP1 segment that starts with "Exif" and two NULs), a PNG (the eXIf chunk), a WebP (the EXIF chunk) or a
\ bare TIFF file; it is a TIFF structure (byte order mark, magic 42, IFD0 offset), and the tags of IFD0,
\ the Exif IFD (0x8769) with the Interoperability IFD (0xA005) inside it, the GPS IFD (0x8825) and the
\ thumbnail IFD (IFD1) are listed as `Name: value` lines. Tag names are the ones of Pillow's ExifTags
\ (TIFF 6, Exif 2.32 and the GPS tags), as "|hex:Name|" tables looked up with split. All FL: a handful of
\ integer reads for each tag. Every offset and count is compared with the data and never used to allocate;
\ a value that runs past the data, an IFD that does, or a block that is not TIFF is E_COERCE with the
\ offset. The context of the IFD words is the TIFF block itself (t:bytes), so the byte order is read from it.
IN: exif

: _tag-names ( -- str )
  "|1:InteropIndex|2:InteropVersion|b:ProcessingSoftware|fe:NewSubfileType|ff:SubfileType|100:ImageWidth|101:ImageLength|102:BitsPerSample|103:Compression|106:PhotometricInterpretation|107:Thresholding|108:CellWidth|109:CellLength|10a:FillOrder|10d:DocumentName|10e:ImageDescription|10f:Make|110:Model|111:StripOffsets|112:Orientation|115:SamplesPerPixel|116:RowsPerStrip|117:StripByteCounts|118:MinSampleValue|119:MaxSampleValue|11a:XResolution|11b:YResolution|11c:PlanarConfiguration|11d:PageName|120:FreeOffsets|121:FreeByteCounts|122:GrayResponseUnit|123:GrayResponseCurve|124:T4Options|125:T6Options|128:ResolutionUnit|129:PageNumber|12d:TransferFunction|131:Software|132:DateTime|13b:Artist|13c:HostComputer|13d:Predictor|13e:WhitePoint|13f:PrimaryChromaticities|140:ColorMap|141:HalftoneHints|142:TileWidth|143:TileLength|144:TileOffsets|145:TileByteCounts|14a:SubIFDs|14c:InkSet|14d:InkNames|14e:NumberOfInks|150:DotRange|151:TargetPrinter|152:ExtraSamples|153:SampleFormat|154:SMinSampleValue|155:SMaxSampleValue|156:TransferRange|157:ClipPath|158:XClipPathUnits|159:YClipPathUnits|15a:Indexed|15b:JPEGTables|15f:OPIProxy|200:JPEGProc|201:JpegIFOffset|202:JpegIFByteCount|203:JpegRestartInterval|205:JpegLosslessPredictors|206:JpegPointTransforms|207:JpegQTables|208:JpegDCTables|209:JpegACTables|211:YCbCrCoefficients|212:YCbCrSubSampling|213:YCbCrPositioning|214:ReferenceBlackWhite|2bc:XMLPacket|1000:RelatedImageFileFormat|1001:RelatedImageWidth|1002:RelatedImageLength|4746:Rating|4749:RatingPercent|800d:ImageID|828d:CFARepeatPatternDim|828e:CFAPattern|828f:BatteryLevel|8298:Copyright|829a:ExposureTime|829d:FNumber|83bb:IPTCNAA|8649:ImageResources|8773:InterColorProfile|8822:ExposureProgram|8824:SpectralSensitivity|8827:ISOSpeedRatings|8828:OECF|8829:Interlace|882a:TimeZoneOffset|882b:SelfTimerMode|8830:SensitivityType|8831:StandardOutputSensitivity|8832:RecommendedExposureIndex|8833:ISOSpeed|8834:ISOSpeedLatitudeyyy|8835:ISOSpeedLatitudezzz|9000:ExifVersion|9003:DateTimeOriginal|9004:DateTimeDigitized|9010:OffsetTime|9011:OffsetTimeOriginal|9012:OffsetTimeDigitized|9101:ComponentsConfiguration|9102:CompressedBitsPerPixel|9201:ShutterSpeedValue|9202:ApertureValue|9203:BrightnessValue|9204:ExposureBiasValue|9205:MaxApertureValue|9206:SubjectDistance|9207:MeteringMode|9208:LightSource|9209:Flash|920a:FocalLength|920b:FlashEnergy|920c:SpatialFrequencyResponse|920d:Noise|9211:ImageNumber|9212:SecurityClassification|9213:ImageHistory|9214:SubjectLocation|9215:ExposureIndex|9216:TIFF/EPStandardID|927c:MakerNote|9286:UserComment|9290:SubsecTime|9291:SubsecTimeOriginal|9292:SubsecTimeDigitized|9400:AmbientTemperature|9401:Humidity|9402:Pressure|9403:WaterDepth|9404:Acceleration|9405:CameraElevationAngle|9c9b:XPTitle|9c9c:XPComment|9c9d:XPAuthor|9c9e:XPKeywords|9c9f:XPSubject|a000:FlashPixVersion|a001:ColorSpace|a002:ExifImageWidth|a003:ExifImageHeight|a004:RelatedSoundFile|a20b:FlashEnergy|a20c:SpatialFrequencyResponse|a20e:FocalPlaneXResolution|a20f:FocalPlaneYResolution|a210:FocalPlaneResolutionUnit|a214:SubjectLocation|a215:ExposureIndex|a217:SensingMethod|a300:FileSource|a301:SceneType|a302:CFAPattern|a401:CustomRendered|a402:ExposureMode|a403:WhiteBalance|a404:DigitalZoomRatio|a405:FocalLengthIn35mmFilm|a406:SceneCaptureType|a407:GainControl|a408:Contrast|a409:Saturation|a40a:Sharpness|a40b:DeviceSettingDescription|a40c:SubjectDistanceRange|a420:ImageUniqueID|a430:CameraOwnerName|a431:BodySerialNumber|a432:LensSpecification|a433:LensMake|a434:LensModel|a435:LensSerialNumber|a460:CompositeImage|a461:CompositeImageCount|a462:CompositeImageExposureTimes|a500:Gamma|c4a5:PrintImageMatching|c612:DNGVersion|c613:DNGBackwardVersion|c614:UniqueCameraModel|c615:LocalizedCameraModel|c616:CFAPlaneColor|c617:CFALayout|c618:LinearizationTable|c619:BlackLevelRepeatDim|c61a:BlackLevel|c61b:BlackLevelDeltaH|c61c:BlackLevelDeltaV|c61d:WhiteLevel|c61e:DefaultScale|c61f:DefaultCropOrigin|c620:DefaultCropSize|c621:ColorMatrix1|c622:ColorMatrix2|c623:CameraCalibration1|c624:CameraCalibration2|c625:ReductionMatrix1|c626:ReductionMatrix2|c627:AnalogBalance|c628:AsShotNeutral|c629:AsShotWhiteXY|c62a:BaselineExposure|c62b:BaselineNoise|c62c:BaselineSharpness|c62d:BayerGreenSplit|c62e:LinearResponseLimit|c62f:CameraSerialNumber|c630:LensInfo|c631:ChromaBlurRadius|c632:AntiAliasStrength|c633:ShadowScale|c634:DNGPrivateData|c635:MakerNoteSafety|c65a:CalibrationIlluminant1|c65b:CalibrationIlluminant2|c65c:BestQualityScale|c65d:RawDataUniqueID|c68b:OriginalRawFileName|c68c:OriginalRawFileData|c68d:ActiveArea|c68e:MaskedAreas|c68f:AsShotICCProfile|c690:AsShotPreProfileMatrix|c691:CurrentICCProfile|c692:CurrentPreProfileMatrix|c6bf:ColorimetricReference|c6f3:CameraCalibrationSignature|c6f4:ProfileCalibrationSignature|c6f6:AsShotProfileName|c6f7:NoiseReductionApplied|c6f8:ProfileName|c6f9:ProfileHueSatMapDims|c6fa:ProfileHueSatMapData1|c6fb:ProfileHueSatMapData2|c6fc:ProfileToneCurve|c6fd:ProfileEmbedPolicy|c6fe:ProfileCopyright|c714:ForwardMatrix1|c715:ForwardMatrix2|c716:PreviewApplicationName|c717:PreviewApplicationVersion|c718:PreviewSettingsName|c719:PreviewSettingsDigest|c71a:PreviewColorSpace|c71b:PreviewDateTime|c71c:RawImageDigest|c71d:OriginalRawFileDigest|c71e:SubTileBlockSize|c71f:RowInterleaveFactor|c725:ProfileLookTableDims|c726:ProfileLookTableData|c740:OpcodeList1|c741:OpcodeList2|c74e:OpcodeList3|c761:NoiseProfile|c764:FrameRate|" ;

: _gps-names ( -- str )
  "|0:GPSVersionID|1:GPSLatitudeRef|2:GPSLatitude|3:GPSLongitudeRef|4:GPSLongitude|5:GPSAltitudeRef|6:GPSAltitude|7:GPSTimeStamp|8:GPSSatellites|9:GPSStatus|a:GPSMeasureMode|b:GPSDOP|c:GPSSpeedRef|d:GPSSpeed|e:GPSTrackRef|f:GPSTrack|10:GPSImgDirectionRef|11:GPSImgDirection|12:GPSMapDatum|13:GPSDestLatitudeRef|14:GPSDestLatitude|15:GPSDestLongitudeRef|16:GPSDestLongitude|17:GPSDestBearingRef|18:GPSDestBearing|19:GPSDestDistanceRef|1a:GPSDestDistance|1b:GPSProcessingMethod|1c:GPSAreaInformation|1d:GPSDateStamp|1e:GPSDifferential|1f:GPSHPositioningError|" ;

\ util-candidate: name-in-table
: _name-in ( table:str key:int -- str )
  table "|" key 16 int>str-radix cat ":" cat split
  dup len 2 < [ drop "" ] [ 1 nth "|" split 0 nth ] if ;

\ ---- reading integers ----

\ n bytes of d at p as a big-endian integer; E_COERCE when the data ends first.
: _be ( d:bytes p:int n:int -- int )
  d p n "image data" util:need-bytes
  d p p n + slice 256 util:digits>int ;

\ The same, little endian.
: _le ( d:bytes p:int n:int -- int )
  d p n "image data" util:need-bytes
  d p p n + slice rev 256 util:digits>int ;

\ n bytes at p of the TIFF block as an unsigned integer in its byte order ("II" is little endian).
: _u ( t:bytes p:int n:int -- int )
  t p n "Exif data" util:need-bytes
  t p p n + slice
  t 0 nth 73 = [ rev ] [ ] if
  256 util:digits>int ;

\ The same as a signed integer.
: _s ( t:bytes p:int n:int -- int )
  t p n _u dup 1 n 8 * 1 - shl >= [ 1 n 8 * shl - ] when ;

\ util-candidate: starts-with-bytes?
: _starts? ( d:bytes prefix:bytes -- bool )
  d len prefix len >= [ d 0 prefix len slice prefix = ] [ false ] if ;

\ The bytes of d from from up to to, cut at the end of the data; empty when from is past it.
: _clip ( d:bytes from:int to:int -- bytes )
  to d len min dup from < [ drop #[ ] ] [ d from rot slice ] if ;

\ ---- finding the Exif block ----

\ A JPEG segment at p is an APP1 that starts with the Exif header.
: _jpeg-hit? ( d:bytes p:int -- bool )
  p 10 + d len <=
  [ d p nth 255 = d p 1 + nth 225 = and d p 4 + p 10 + slice #[ 45 78 69 66 00 00 ] = and ] [ false ] if ;

: _standalone? ( m:int -- bool )
  m 216 = m 1 = or m 208 >= m 215 <= and or ;

\ Where the segment after the one at p (marker m) starts; -1 at the start of the scan or the end of the image.
: _jpeg-after ( d:bytes p:int m:int -- int )
  m 255 = [ p 1 + ] [
  m _standalone? [ p 2 + ] [
  m 217 = m 218 = or [ -1 ] [
  p 4 + d len > [ -1 ] [
    d p 2 + 2 _be dup 2 < [ drop -1 ] [ p 2 + + ] if ] if ] if ] if ] if ;

: _jpeg-next ( d:bytes p:int -- int )
  p 2 + d len > [ -1 ] [
    d p nth 255 = [ d p d p 1 + nth _jpeg-after ] [ -1 ] if ] if ;

\ The offset of the APP1 segment with the Exif header, or -1. The Exif segment follows the first
\ one or two (SOI, APP0), so at most this many segments (or fill bytes) are looked at: a bound on the
\ steps that a file of nothing but 0xFF bytes would cost (5.4 million steps at 64 KiB when unbounded).
: _segment-cap ( -- int )
  256 ;

: _jpeg-find ( d:bytes -- int )
  0 _segment-cap range 0 [ drop dup 0 >= [ d over _jpeg-hit? [ ] [ d swap _jpeg-next ] if ] [ ] if ] reduce
  dup 0 >= [ d over _jpeg-hit? not [ drop -1 ] when ] when ;

\ The TIFF block of the segment at p: after the marker, the length and the six bytes of the header.
: _jpeg-payload ( d:bytes p:int -- bytes )
  d p 10 + p 2 + d p 2 + 2 _be + _clip ;

: _jpeg-tiff ( d:bytes -- bytes )
  d _jpeg-find dup 0 < [ drop #[ ] ] [ d swap _jpeg-payload ] if ;

: _chunk-cap ( -- int )
  1024 ;

: _png-hit? ( d:bytes p:int -- bool )
  p 8 + d len <= [ d p 4 + p 8 + slice #[ 65 58 49 66 ] = ] [ false ] if ;

: _png-next ( d:bytes p:int -- int )
  p 8 + d len > [ -1 ] [
    d p 4 + p 8 + slice #[ 49 45 4e 44 ] = [ -1 ] [
      p 12 + d p 4 _be + dup d len > [ drop -1 ] when ] if ] if ;

: _png-find ( d:bytes -- int )
  0 _chunk-cap range 8 [ drop dup 0 >= [ d over _png-hit? [ ] [ d swap _png-next ] if ] [ ] if ] reduce
  dup 0 >= [ d over _png-hit? not [ drop -1 ] when ] when ;

: _png-payload ( d:bytes p:int -- bytes )
  d p 8 + p 8 + d p 4 _be + _clip ;

: _png-tiff ( d:bytes -- bytes )
  d _png-find dup 0 < [ drop #[ ] ] [ d swap _png-payload ] if ;

: _webp-hit? ( d:bytes p:int -- bool )
  p 8 + d len <= [ d p p 4 + slice #[ 45 58 49 46 ] = ] [ false ] if ;

: _webp-next ( d:bytes p:int -- int )
  p 8 + d len > [ -1 ] [
    d p 4 + 4 _le dup 1 band + p 8 + + dup d len > [ drop -1 ] when ] if ;

: _webp-find ( d:bytes -- int )
  0 _chunk-cap range 12 [ drop dup 0 >= [ d over _webp-hit? [ ] [ d swap _webp-next ] if ] [ ] if ] reduce
  dup 0 >= [ d over _webp-hit? not [ drop -1 ] when ] when ;

: _webp-payload ( d:bytes p:int -- bytes )
  d p 8 + p 8 + d p 4 + 4 _le + _clip ;

: _webp-tiff ( d:bytes -- bytes )
  d _webp-find dup 0 < [ drop #[ ] ] [ d swap _webp-payload ] if ;

\ A leading Exif header (PNG and WebP writers differ) is dropped.
: _drop-header ( b:bytes -- bytes )
  b #[ 45 78 69 66 00 00 ] _starts? [ b 6 b len slice ] [ b ] if ;

: _tiff? ( d:bytes -- bool )
  d #[ 49 49 2a 00 ] _starts? d #[ 4d 4d 00 2a ] _starts? or ;

: _webp? ( d:bytes -- bool )
  d #[ 52 49 46 46 ] _starts? d len 12 >= and
  [ d 8 12 slice #[ 57 45 42 50 ] = ] [ false ] if ;

\ The TIFF block of an image of any supported kind; empty when the image has no Exif block.
: _locate ( d:bytes -- bytes )
  d #[ ff d8 ] _starts? [ d _jpeg-tiff ] [
  d #[ 89 50 4e 47 0d 0a 1a 0a ] _starts? [ d _png-tiff _drop-header ] [
  d _webp? [ d _webp-tiff _drop-header ] [
  d _tiff? [ d ] [
    "not a JPEG, PNG, WebP or TIFF image: no Exif block can be read from it" raise:coerce ] if ] if ] if ] if ;

\ ---- the IFDs ----

\ Tags read from one IFD, at most.
: _tag-cap ( -- int )
  1000 ;

: _check-tiff ( t:bytes -- )
  t len 8 < [ "Exif data is cut short: a TIFF header needs 8 bytes" raise:coerce ] when
  t _tiff? not [ "the Exif block is not TIFF data (no II*, 0 or MM, 0, * header)" raise:coerce ] when ;

: _entry ( t:bytes p:int -- record )
  { { "tag" t p 2 _u } { "type" t p 2 + 2 _u } { "count" t p 4 + 4 _u } { "at" p 8 + } } >record ;

: _ifd-entries2 ( t:bytes off:int count:int -- list )
  off 2 + count 12 * + t len > [
    "the IFD at offset " off int>str cat " holds " cat count int>str cat
    " entries and runs past the end of the data (truncated)" cat raise:coerce ] when
  0 count _tag-cap min range [ 12 * off + 2 + t swap _entry ] map ;

\ The entries of the IFD at off (at most _tag-cap).
: _ifd-entries ( t:bytes off:int -- list )
  t off t off 2 _u _ifd-entries2 ;

\ The offset of the next IFD, after the entries of the IFD at off; 0 when there is none.
: _next-ifd ( t:bytes off:int -- int )
  t off 2 + t off 2 _u 12 * + 4 _u ;

\ The value of the tag in the IFD at off, as an offset; -1 when the IFD has no such tag.
: _pointer ( t:bytes off:int tag:int -- int )
  t off _ifd-entries [ "tag" get tag = ] filter
  dup len 0 = [ drop -1 ] [ 0 nth "at" get t swap 4 _u ] if ;

\ ---- values ----

: _tsize ( type:int -- int )
  type 0 > type 13 <= and [ { 0 1 1 2 4 8 1 1 2 4 8 4 8 4 } type nth ] [ 0 ] if ;

\ n/d as a decimal with up to six places (cut, not rounded), without trailing zeros.
: _decimal-abs ( n:int d:int -- str )
  n d div int>str
  n d mod 1000000 * d div
  dup 0 = [ drop ] [ 6 util:zero-pad [ 48 = ] util:trim-end "." swap cat cat ] if ;

: _ratio ( n:int d:int -- str )
  d 0 = [ n int>str "/0" cat ] [
    d 0 < [ n int>str "/" cat d int>str cat ] [
      n 0 < [ "-" 0 n - d _decimal-abs cat ] [ n d _decimal-abs ] if ] if ] if ;

\ Element i of an array of numbers of the type, starting at vstart.
: _item ( i:int t:bytes type:int vstart:int -- str )
  type 1 = [ t vstart i + 1 _u int>str ] [
  type 6 = [ t vstart i + 1 _s int>str ] [
  type 3 = [ t vstart i 2 * + 2 _u int>str ] [
  type 8 = [ t vstart i 2 * + 2 _s int>str ] [
  type 4 = type 13 = or [ t vstart i 4 * + 4 _u int>str ] [
  type 9 = [ t vstart i 4 * + 4 _s int>str ] [
  type 5 = [ t vstart i 8 * + 4 _u t vstart i 8 * + 4 + 4 _u _ratio ] [
  type 10 = [ t vstart i 8 * + 4 _s t vstart i 8 * + 4 + 4 _s _ratio ] [
  type 11 = [ "float:" t vstart i 4 * + 4 _u 8 util:pad-hex cat ] [
  "double:" t vstart i 8 * + 8 _u 16 util:pad-hex cat
  ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ At most this many values of an array are shown.
: _shown ( -- int )
  16 ;

: _numeric ( t:bytes type:int count:int vstart:int -- str )
  0 count _shown min range [ t type vstart _item ] map ", " join
  count _shown > [ ", ... (" cat count int>str cat " values)" cat ] when ;

\ The text of an ASCII value up to its first NUL (at most 1,024 bytes).
: _ascii ( t:bytes count:int vstart:int -- str )
  t vstart vstart count 1024 min + slice bytes>latin1 "\x00" split 0 nth latin1>bytes util:text-lossless ;

\ util-candidate: printable-bytes?
: _printable? ( b:bytes -- bool )
  b len 0 > b [ dup 32 >= swap 126 <= and ] filter len b len = and ;

\ UTF-16 text (BMP only; a surrogate is U+FFFD), up to the first NUL.
: _unit ( b:bytes i:int le:bool -- int )
  le [ b 2 i * nth b 2 i * 1 + nth 256 * + ] [ b 2 i * nth 256 * b 2 i * 1 + nth + ] if ;

: _utf16 ( b:bytes le:bool -- str )
  0 b len 2 div range [ b swap le _unit dup util:surrogate? [ drop 65533 ] when ] map
  codes>str "\x00" split 0 nth ;

: _hex-bytes ( t:bytes count:int vstart:int -- str )
  t vstart vstart count 32 min + slice bytes>hex
  count 32 > [ "... (" count int>str cat " bytes)" cat cat ] when ;

: _comment ( t:bytes count:int vstart:int -- str )
  count 8 < [ t count vstart _hex-bytes ] [
    t vstart vstart 8 + slice
    dup #[ 41 53 43 49 49 00 00 00 ] = [ drop
      t vstart 8 + vstart count 1024 min + slice bytes>latin1 "\x00" split 0 nth ] [
    dup #[ 55 4e 49 43 4f 44 45 00 ] = [ drop
      t vstart 8 + vstart count 1024 min + slice t 0 nth 73 = _utf16 ] [
    #[ 00 00 00 00 00 00 00 00 ] = [
      t vstart 8 + vstart count 1024 min + slice bytes>latin1 "\x00" split 0 nth ] [
      t count vstart _hex-bytes ] if ] if ] if ] if ;

\ UNDEFINED values: the maker note is not decoded, a user comment has a character set prefix, text-like
\ values (ExifVersion, FlashpixVersion) are shown as text and the others as hex.
: _undef ( t:bytes tag:int count:int vstart:int -- str )
  tag 37500 = [ "[" count int>str cat " bytes, not decoded]" cat ] [
  tag 37510 = [ t count vstart _comment ] [
  t vstart vstart count 64 min + slice _printable? count 64 <= and
  [ t vstart vstart count + slice bytes>latin1 ] [ t count vstart _hex-bytes ] if ] if ] if ;

\ The Windows XP tags (XPTitle ... XPSubject) are UTF-16LE text in BYTE values.
: _xp? ( tag:int -- bool )
  tag 40091 >= tag 40095 <= and ;

: _xp-text ( t:bytes count:int vstart:int -- str )
  t vstart vstart count 1024 min + slice true _utf16 ;

: _value4 ( t:bytes e:record size:int vstart:int -- str )
  vstart size + t len > [
    "the value of tag 0x" e "tag" get 4 util:pad-hex cat " (" cat size int>str cat " bytes at offset " cat
    vstart int>str cat ") runs past the end of the data (truncated)" cat raise:coerce ] when
  e "type" get 2 = [ t e "count" get vstart _ascii ] [
  e "type" get 7 = [ t e "tag" get e "count" get vstart _undef ] [
  e "tag" get _xp? e "type" get 1 = and [ t e "count" get vstart _xp-text ] [
  t e "type" get e "count" get vstart _numeric ] if ] if ] if ;

: _value3 ( t:bytes e:record size:int -- str )
  t e size size 4 <= [ e "at" get ] [ t e "at" get 4 _u ] if _value4 ;

: _value2 ( t:bytes e:record tsize:int -- str )
  t e e "count" get tsize * _value3 ;

: _value ( t:bytes e:record -- str )
  e "type" get _tsize
  dup 0 = [ drop "(unsupported type " e "type" get int>str cat ")" cat ] [ t e rot _value2 ] if ;

\ ---- lines ----

: _tag-name ( names:str tag:int -- str )
  names tag _name-in dup len 0 = [ drop "Tag0x" tag 4 util:pad-hex cat ] when ;

: _line ( e:record t:bytes names:str prefix:str -- str )
  prefix names e "tag" get _tag-name cat ": " cat t e _value cat ;

\ The "Name: value" lines of the IFD at off; the pointers to other IFDs are not tags to show.
: _lines-of ( t:bytes off:int names:str prefix:str -- list )
  t off _ifd-entries
  [ "tag" get dup 34665 = over 34853 = or swap 40965 = or not ] filter
  [ t names prefix _line ] map ;

: _sub-lines ( t:bytes ptr:int names:str prefix:str -- list )
  ptr 1 < [ { } ] [ t ptr names prefix _lines-of ] if ;

\ The tags of the Exif IFD (the Interoperability IFD inside it follows).
: _exif-part ( t:bytes ptr:int -- list )
  ptr 1 < [ { } ] [
    t ptr _tag-names "" _lines-of
    t t ptr 40965 _pointer _tag-names "" _sub-lines cat ] if ;

: _all2 ( t:bytes ifd0:int -- list )
  t ifd0 _tag-names "" _lines-of
  t t ifd0 34665 _pointer _exif-part cat
  t t ifd0 34853 _pointer _gps-names "" _sub-lines cat
  t t ifd0 _next-ifd _tag-names "Thumbnail:" _sub-lines cat ;

: _all-lines ( t:bytes -- list )
  t _check-tiff
  t t 4 4 _u _all2 ;

: extract ( data:bytes -- str )
  "Extract EXIF: the Exif metadata of a JPEG, PNG, WebP or TIFF image, read without decoding the image. The result starts with Found N tags. and a blank line, then one Name: value line per tag of IFD0 (camera make and model, orientation, resolution, software, date), of the Exif IFD (exposure time, F number, ISO, lens, original date, user comment), of the Interoperability IFD, of the GPS IFD (references, latitude, longitude and altitude as degrees, minutes and seconds in rational numbers shown as decimals) and of the thumbnail IFD (names start with Thumbnail:). The tag names are those of the Exif and TIFF standards; values are the numbers stored, not translated words (Orientation: 1), rationals are decimals with up to six places, ASCII values are text, the maker note is not decoded, user comments are decoded by their character set prefix, and arrays show their first 16 values. An image with no Exif block gives Found 0 tags.; data that is not one of the four formats, a damaged TIFF structure or a value that runs past the data is E_COERCE with the offset." doc
  "Extractors" category
  data _locate dup len 0 = [ drop "Found 0 tags.\n" ] [
    _all-lines "Found " over len int>str cat " tags.\n\n" cat swap "\n" join cat ] if ;

META: extract
  see-also filetype:detect ;
;
