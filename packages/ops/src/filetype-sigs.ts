/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * The table of file signatures ("magic bytes") behind Detect File Type, Scan for Embedded Files and
 * Extract Files (`filetype:` primitives, src/prims/filetype.ts). Data only; it lives here and not in
 * prims/ because every file in prims/ is loaded as a vocabulary's primitive module (the precedent is
 * src/asn1-oids.ts). FL has no per-vocabulary constants, so a table of this size in FL would be rebuilt
 * on every call.
 *
 * One row per file type: category, name, extensions (the first is used to name a carved file), MIME
 * type, a description, the magic bytes, and optionally an `end` (the name of an end finder in
 * prims/filetype.ts, which gives the length of the file for Extract Files), a `verify` (a name of a
 * check on the data that the magic alone cannot do) and `weak` (a signature short enough to occur by
 * chance in any data: Scan for Embedded Files ignores these when "ignore common byte sequences" is on).
 *
 * The magic is written as text: tokens separated by spaces. `@N` (decimal) sets the offset, from the
 * start of the file, of the bytes that follow; at the start the offset is 0. `XX` is a byte in hex, `??`
 * any byte, `X?` and `?X` a byte with one nibble free, `XX&MM` a byte compared under a mask (the data
 * byte and MM must equal XX and MM), and `'text'` is the ASCII bytes of the text. All the parts must
 * match. The signatures are from each format's specification and the usual magic lists (file(1)); none
 * is copied from CyberChef's table.
 */

export type Category =
  "Images" | "Video" | "Audio" | "Documents" | "Applications" | "Archives" | "Miscellaneous";

/** The categories in CyberChef's option order. */
export const CATEGORIES: readonly Category[] = [
  "Images",
  "Video",
  "Audio",
  "Documents",
  "Applications",
  "Archives",
  "Miscellaneous",
];

/** One compiled part of a magic: `value` and `mask` are as long as the part, at `offset`. */
export interface MagicPart {
  readonly offset: number;
  readonly value: Uint8Array;
  readonly mask: Uint8Array;
}

export interface FileSig {
  readonly category: Category;
  readonly name: string;
  readonly extensions: string;
  readonly mime: string;
  readonly description: string;
  readonly parts: readonly MagicPart[];
  readonly end?: string;
  readonly verify?: string;
  readonly weak: boolean;
  /** The longest run of exactly known bytes: where it is in the file and what it is. */
  readonly anchor: { readonly offset: number; readonly bytes: Uint8Array };
}

interface Options {
  end?: string;
  verify?: string;
  weak?: boolean;
}

type Row = readonly [
  category: Category,
  name: string,
  extensions: string,
  mime: string,
  description: string,
  magic: string,
  options?: Options,
];

const I: Category = "Images";
const V: Category = "Video";
const A: Category = "Audio";
const D: Category = "Documents";
const P: Category = "Applications";
const Z: Category = "Archives";
const M: Category = "Miscellaneous";

const ROWS: readonly Row[] = [
  // ---- Images ----
  [
    I,
    "Portable Network Graphics image",
    "png",
    "image/png",
    "PNG image",
    "89 50 4E 47 0D 0A 1A 0A",
    { end: "png" },
  ],
  [
    I,
    "JPEG image",
    "jpg,jpeg,jpe,jfif",
    "image/jpeg",
    "JPEG image (JFIF, Exif or raw)",
    "FF D8 FF",
    { end: "jpeg" },
  ],
  [
    I,
    "Graphics Interchange Format (87a)",
    "gif",
    "image/gif",
    "GIF image, version 87a",
    "'GIF87a'",
    { end: "gif" },
  ],
  [
    I,
    "Graphics Interchange Format (89a)",
    "gif",
    "image/gif",
    "GIF image, version 89a",
    "'GIF89a'",
    { end: "gif" },
  ],
  [
    I,
    "Windows Bitmap",
    "bmp,dib",
    "image/bmp",
    "BMP image with a Windows DIB header",
    "'BM' @6 00 00 00 00 @14 ?? 00 00 00",
    { end: "bmp" },
  ],
  [
    I,
    "Tagged Image File Format (little endian)",
    "tif,tiff",
    "image/tiff",
    "TIFF image, Intel byte order",
    "49 49 2A 00",
  ],
  [
    I,
    "Tagged Image File Format (big endian)",
    "tif,tiff",
    "image/tiff",
    "TIFF image, Motorola byte order",
    "4D 4D 00 2A",
  ],
  [
    I,
    "BigTIFF (little endian)",
    "tif,tiff",
    "image/tiff",
    "BigTIFF image, Intel byte order",
    "49 49 2B 00 08 00 00 00",
  ],
  [
    I,
    "BigTIFF (big endian)",
    "tif,tiff",
    "image/tiff",
    "BigTIFF image, Motorola byte order",
    "4D 4D 00 2B 00 08 00 00",
  ],
  [
    I,
    "WebP image",
    "webp",
    "image/webp",
    "WebP image in a RIFF container",
    "'RIFF' @8 'WEBP'",
    { end: "riff" },
  ],
  [
    I,
    "Windows icon",
    "ico",
    "image/vnd.microsoft.icon",
    "ICO icon file",
    "00 00 01 00 ?? 00 @9 00 @10 0? 00",
    { end: "ico", weak: true },
  ],
  [
    I,
    "Windows cursor",
    "cur",
    "image/x-icon",
    "CUR cursor file",
    "00 00 02 00 ?? 00 @9 00",
    { weak: true },
  ],
  [
    I,
    "Adobe Photoshop document",
    "psd",
    "image/vnd.adobe.photoshop",
    "Photoshop image, version 1",
    "'8BPS' 00 01",
  ],
  [
    I,
    "Adobe Photoshop large document",
    "psb",
    "image/vnd.adobe.photoshop",
    "Photoshop large document, version 2",
    "'8BPS' 00 02",
  ],
  [I, "JPEG 2000", "jp2", "image/jp2", "JPEG 2000 image", "00 00 00 0C 6A 50 20 20 0D 0A 87 0A"],
  [
    I,
    "JPEG XL (codestream)",
    "jxl",
    "image/jxl",
    "JPEG XL image without a container",
    "FF 0A",
    { weak: true },
  ],
  [
    I,
    "JPEG XL (container)",
    "jxl",
    "image/jxl",
    "JPEG XL image in an ISO BMFF container",
    "00 00 00 0C 4A 58 4C 20 0D 0A 87 0A",
  ],
  [
    I,
    "High Efficiency Image File",
    "heic,heif",
    "image/heic",
    "HEIC image (ISO base media)",
    "@4 'ftypheic'",
  ],
  [
    I,
    "High Efficiency Image File (extended)",
    "heic,heif",
    "image/heic",
    "HEIC image, brand heix",
    "@4 'ftypheix'",
  ],
  [
    I,
    "High Efficiency Image File (HEVC)",
    "heic,heif",
    "image/heic",
    "HEIC image, brand hevc",
    "@4 'ftyphevc'",
  ],
  [
    I,
    "High Efficiency Image File (mif1)",
    "heif,heic",
    "image/heif",
    "HEIF image, brand mif1",
    "@4 'ftypmif1'",
  ],
  [
    I,
    "AV1 Image File Format",
    "avif",
    "image/avif",
    "AVIF image (ISO base media)",
    "@4 'ftypavif'",
  ],
  [I, "DirectDraw Surface", "dds", "image/vnd.ms-dds", "DDS texture", "'DDS ' 7C 00 00 00"],
  [I, "GIMP image", "xcf", "image/x-xcf", "GIMP XCF image", "'gimp xcf '"],
  [I, "Apple icon image", "icns", "image/icns", "macOS icon", "'icns'", { weak: true }],
  [I, "Windows Metafile", "wmf", "image/wmf", "Placeable WMF", "D7 CD C6 9A"],
  [I, "Enhanced Metafile", "emf", "image/emf", "EMF vector image", "01 00 00 00 @40 20 45 4D 46"],
  [I, "OpenEXR image", "exr", "image/x-exr", "OpenEXR image", "76 2F 31 01"],
  [I, "Radiance HDR image", "hdr", "image/vnd.radiance", "Radiance RGBE image", "'#?RADIANCE'"],
  [I, "Flexible Image Transport System", "fits", "image/fits", "FITS image", "'SIMPLE  ='"],
  [
    I,
    "DjVu document",
    "djvu,djv",
    "image/vnd.djvu",
    "DjVu scanned document",
    "'AT&TFORM' @12 'DJV'",
  ],

  // ---- Video ----
  [
    V,
    "MP4 video (ISO base media)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand isom",
    "@4 'ftypisom'",
    { end: "mp4" },
  ],
  [
    V,
    "MP4 video (ISO base media 2)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand iso2",
    "@4 'ftypiso2'",
    { end: "mp4" },
  ],
  [
    V,
    "MP4 video (version 1)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand mp41",
    "@4 'ftypmp41'",
    { end: "mp4" },
  ],
  [
    V,
    "MP4 video (version 2)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand mp42",
    "@4 'ftypmp42'",
    { end: "mp4" },
  ],
  [
    V,
    "MP4 video (AVC)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand avc1",
    "@4 'ftypavc1'",
    { end: "mp4" },
  ],
  [
    V,
    "MP4 video (DASH)",
    "mp4",
    "video/mp4",
    "MPEG-4 file, brand dash",
    "@4 'ftypdash'",
    { end: "mp4" },
  ],
  [
    V,
    "iTunes video",
    "m4v",
    "video/x-m4v",
    "MPEG-4 file, brand M4V",
    "@4 'ftypM4V'",
    { end: "mp4" },
  ],
  [
    V,
    "Apple QuickTime movie",
    "mov,qt",
    "video/quicktime",
    "QuickTime movie, brand qt",
    "@4 'ftypqt  '",
    { end: "mp4" },
  ],
  [V, "3GPP multimedia", "3gp", "video/3gpp", "3GPP file", "@4 'ftyp3gp'", { end: "mp4" }],
  [V, "3GPP2 multimedia", "3g2", "video/3gpp2", "3GPP2 file", "@4 'ftyp3g2'", { end: "mp4" }],
  [
    V,
    "Adobe Flash video (MP4)",
    "f4v",
    "video/x-f4v",
    "Flash video in MPEG-4, brand F4V",
    "@4 'ftypF4V'",
    { end: "mp4" },
  ],
  [
    V,
    "Audio Video Interleave",
    "avi",
    "video/x-msvideo",
    "AVI video in a RIFF container",
    "'RIFF' @8 'AVI '",
    { end: "riff" },
  ],
  [
    V,
    "Matroska / WebM (EBML)",
    "mkv,webm,mka",
    "video/x-matroska",
    "EBML container of Matroska or WebM",
    "1A 45 DF A3",
    { end: "ebml" },
  ],
  [V, "Flash Video", "flv", "video/x-flv", "FLV video", "'FLV' 01 @5 00 00 00 09"],
  [
    V,
    "Windows Media (ASF)",
    "wmv,wma,asf",
    "video/x-ms-asf",
    "Advanced Systems Format container",
    "30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C",
  ],
  [V, "MPEG program stream", "mpg,mpeg", "video/mpeg", "MPEG-PS, pack header", "00 00 01 BA"],
  [
    V,
    "MPEG video elementary stream",
    "mpg,mpeg",
    "video/mpeg",
    "MPEG video, sequence header",
    "00 00 01 B3",
    { weak: true },
  ],
  [
    V,
    "MPEG transport stream",
    "ts,m2ts",
    "video/mp2t",
    "MPEG-TS, three sync bytes 188 apart",
    "47 @188 47 @376 47",
    { weak: true },
  ],
  [
    V,
    "Shockwave Flash",
    "swf",
    "application/x-shockwave-flash",
    "SWF, uncompressed",
    "'FWS' ??",
    { weak: true },
  ],
  [
    V,
    "Shockwave Flash (zlib)",
    "swf",
    "application/x-shockwave-flash",
    "SWF, zlib-compressed",
    "'CWS' ??",
    { weak: true },
  ],
  [
    V,
    "Shockwave Flash (LZMA)",
    "swf",
    "application/x-shockwave-flash",
    "SWF, LZMA-compressed",
    "'ZWS' ??",
    { weak: true },
  ],
  [V, "RealMedia", "rm,rmvb", "application/vnd.rn-realmedia", "RealMedia", "'.RMF'"],

  // ---- Audio ----
  [
    A,
    "MP3 audio with an ID3v2 tag",
    "mp3",
    "audio/mpeg",
    "MPEG audio layer 3 with an ID3v2 tag",
    "'ID3' ?? ?? ?? @6 00&80 00&80 00&80 00&80",
  ],
  [
    A,
    "MP3 audio (MPEG-1 layer 3 frame)",
    "mp3",
    "audio/mpeg",
    "MPEG audio layer 3, frame sync",
    "FF FA&FE",
    { weak: true },
  ],
  [
    A,
    "MP3 audio (MPEG-2 layer 3 frame)",
    "mp3",
    "audio/mpeg",
    "MPEG audio layer 3, frame sync",
    "FF F2&FE",
    { weak: true },
  ],
  [A, "AAC audio (ADTS)", "aac", "audio/aac", "AAC audio in ADTS frames", "FF F1", { weak: true }],
  [
    A,
    "AAC audio (ADTS, MPEG-2)",
    "aac",
    "audio/aac",
    "AAC audio in ADTS frames, MPEG-2",
    "FF F9",
    { weak: true },
  ],
  [A, "Free Lossless Audio Codec", "flac", "audio/flac", "FLAC audio", "'fLaC'"],
  [
    A,
    "Ogg container",
    "ogg,oga,ogv,opus,spx",
    "audio/ogg",
    "Ogg bitstream (Vorbis, Opus, FLAC, Theora, Speex)",
    "'OggS' 00",
    { end: "ogg" },
  ],
  [
    A,
    "Waveform Audio",
    "wav",
    "audio/wav",
    "WAV audio in a RIFF container",
    "'RIFF' @8 'WAVE'",
    { end: "riff" },
  ],
  [A, "Audio Interchange File Format", "aiff,aif", "audio/aiff", "AIFF audio", "'FORM' @8 'AIFF'"],
  [
    A,
    "Audio Interchange File Format (compressed)",
    "aifc",
    "audio/aiff",
    "AIFF-C audio",
    "'FORM' @8 'AIFC'",
  ],
  [A, "Standard MIDI file", "mid,midi", "audio/midi", "MIDI file", "'MThd' 00 00 00 06"],
  [A, "Adaptive Multi-Rate audio", "amr", "audio/amr", "AMR narrow-band audio", "'#!AMR' 0A"],
  [
    A,
    "Apple MPEG-4 audio",
    "m4a",
    "audio/mp4",
    "MPEG-4 audio, brand M4A",
    "@4 'ftypM4A '",
    { end: "mp4" },
  ],
  [A, "Monkey's Audio", "ape", "audio/x-ape", "Monkey's Audio", "'MAC '"],
  [A, "WavPack", "wv", "audio/x-wavpack", "WavPack audio", "'wvpk'"],
  [A, "Musepack", "mpc", "audio/x-musepack", "Musepack SV8", "'MPCK'"],
  [A, "Core Audio Format", "caf", "audio/x-caf", "Apple CAF audio", "'caff' 00 01"],
  [A, "Sun / NeXT audio", "au,snd", "audio/basic", "AU audio", "'.snd'"],
  [A, "Dolby Digital (AC-3)", "ac3", "audio/ac3", "AC-3 audio", "0B 77", { weak: true }],
  [A, "DSD Stream File", "dsf", "audio/x-dsf", "DSF audio", "'DSD ' 1C 00 00 00"],

  // ---- Documents ----
  [
    D,
    "Portable Document Format",
    "pdf",
    "application/pdf",
    "PDF document",
    "'%PDF-'",
    { end: "pdf" },
  ],
  [D, "PostScript", "ps,eps", "application/postscript", "PostScript document", "'%!PS'"],
  [D, "DOS EPS binary", "eps", "application/postscript", "EPS with a binary header", "C5 D0 D3 C6"],
  [D, "Rich Text Format", "rtf", "application/rtf", "RTF document", "'{\\rtf'", { end: "rtf" }],
  [
    D,
    "Microsoft Office document (OLE2)",
    "doc,xls,ppt,msi,msg",
    "application/x-ole-storage",
    "Compound File Binary (Word, Excel, PowerPoint, MSI, Outlook)",
    "D0 CF 11 E0 A1 B1 1A E1",
  ],
  [
    D,
    "Office Open XML document",
    "docx,xlsx,pptx",
    "application/vnd.openxmlformats-officedocument",
    "Office Open XML (a ZIP whose first entry is [Content_Types].xml)",
    "'PK' 03 04 @30 '[Content_Types].xml'",
    { end: "zip" },
  ],
  [
    D,
    "OpenDocument text",
    "odt",
    "application/vnd.oasis.opendocument.text",
    "ODT document",
    "'PK' 03 04 @30 'mimetypeapplication/vnd.oasis.opendocument.text'",
    { end: "zip" },
  ],
  [
    D,
    "OpenDocument spreadsheet",
    "ods",
    "application/vnd.oasis.opendocument.spreadsheet",
    "ODS spreadsheet",
    "'PK' 03 04 @30 'mimetypeapplication/vnd.oasis.opendocument.spreadsheet'",
    { end: "zip" },
  ],
  [
    D,
    "OpenDocument presentation",
    "odp",
    "application/vnd.oasis.opendocument.presentation",
    "ODP presentation",
    "'PK' 03 04 @30 'mimetypeapplication/vnd.oasis.opendocument.presentation'",
    { end: "zip" },
  ],
  [
    D,
    "EPUB e-book",
    "epub",
    "application/epub+zip",
    "EPUB (a ZIP whose first entry is the mimetype)",
    "'PK' 03 04 @30 'mimetypeapplication/epub+zip'",
    { end: "zip" },
  ],
  [D, "XML document", "xml", "application/xml", "XML declaration", "'<?xml '", { weak: true }],
  [D, "Microsoft Word 2.0", "doc", "application/msword", "Word for Windows 2.0", "DB A5 2D 00"],
  [D, "WordPerfect document", "wpd", "application/vnd.wordperfect", "WordPerfect", "FF 'WPC'"],
  [D, "Windows Help", "hlp", "application/winhlp", "WinHelp file", "3F 5F 03 00"],
  [
    D,
    "Compiled HTML Help",
    "chm",
    "application/vnd.ms-htmlhelp",
    "CHM help file",
    "'ITSF' 03 00 00 00",
  ],

  // ---- Applications ----
  [
    P,
    "Executable and Linkable Format",
    "elf,so,o,bin",
    "application/x-executable",
    "ELF executable, object or shared library",
    "7F 'ELF' 01&FC",
    { end: "elf" },
  ],
  [
    P,
    "Windows executable (PE)",
    "exe,dll,sys,scr",
    "application/vnd.microsoft.portable-executable",
    "Portable Executable (MZ header with a PE header)",
    "'MZ'",
    { end: "pe", verify: "pe", weak: true },
  ],
  [
    P,
    "DOS executable (MZ)",
    "exe,com",
    "application/x-dosexec",
    "MZ executable without a PE header",
    "'MZ'",
    { verify: "dos", weak: true },
  ],
  [
    P,
    "Mach-O 32-bit (little endian)",
    "macho,dylib,o",
    "application/x-mach-binary",
    "Mach-O object",
    "CE FA ED FE",
  ],
  [
    P,
    "Mach-O 64-bit (little endian)",
    "macho,dylib,o",
    "application/x-mach-binary",
    "Mach-O 64-bit object",
    "CF FA ED FE",
  ],
  [
    P,
    "Mach-O 32-bit (big endian)",
    "macho,dylib,o",
    "application/x-mach-binary",
    "Mach-O object, big endian",
    "FE ED FA CE",
  ],
  [
    P,
    "Mach-O 64-bit (big endian)",
    "macho,dylib,o",
    "application/x-mach-binary",
    "Mach-O 64-bit object, big endian",
    "FE ED FA CF",
  ],
  [
    P,
    "Mach-O universal binary",
    "macho",
    "application/x-mach-binary",
    "Fat binary of several Mach-O architectures",
    "CA FE BA BE",
    { verify: "fat" },
  ],
  [
    P,
    "Java class file",
    "class",
    "application/java-vm",
    "Compiled Java class",
    "CA FE BA BE",
    { verify: "class" },
  ],
  [
    P,
    "Dalvik executable",
    "dex",
    "application/vnd.android.dex",
    "Android DEX",
    "'dex' 0A ?? ?? ?? 00",
    { end: "dex" },
  ],
  [
    P,
    "Optimized Dalvik executable",
    "odex",
    "application/vnd.android.dex",
    "Android ODEX",
    "'dey' 0A ?? ?? ?? 00",
  ],
  [
    P,
    "WebAssembly module",
    "wasm",
    "application/wasm",
    "WebAssembly binary",
    "00 'asm' 01 00 00 00",
  ],
  [
    P,
    "Script with a shebang",
    "sh",
    "text/x-shellscript",
    "Interpreter line (#!/...)",
    "'#!/'",
    { weak: true },
  ],
  [P, "Lua bytecode", "luac", "application/x-lua-bytecode", "Compiled Lua", "1B 'Lua'"],
  [P, "Windows Minidump", "dmp", "application/x-dmp", "Minidump crash file", "'MDMP' 93 A7"],

  // ---- Archives ----
  [
    Z,
    "ZIP archive",
    "zip",
    "application/zip",
    "ZIP archive (also JAR, APK, OOXML and ODF)",
    "'PK' 03 04",
    { end: "zip" },
  ],
  [
    Z,
    "ZIP archive (empty)",
    "zip",
    "application/zip",
    "ZIP archive with no entries",
    "'PK' 05 06 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    { end: "zip-empty" },
  ],
  [
    Z,
    "Java archive",
    "jar",
    "application/java-archive",
    "JAR (a ZIP that starts with META-INF)",
    "'PK' 03 04 @30 'META-INF/'",
    { end: "zip" },
  ],
  [
    Z,
    "RAR archive (version 1.5 to 4)",
    "rar",
    "application/vnd.rar",
    "RAR 4 archive",
    "'Rar!' 1A 07 00",
  ],
  [
    Z,
    "RAR archive (version 5)",
    "rar",
    "application/vnd.rar",
    "RAR 5 archive",
    "'Rar!' 1A 07 01 00",
  ],
  [
    Z,
    "7-Zip archive",
    "7z",
    "application/x-7z-compressed",
    "7z archive",
    "37 7A BC AF 27 1C",
    { end: "7z" },
  ],
  [
    Z,
    "GZIP compressed file",
    "gz,tgz",
    "application/gzip",
    "gzip stream (deflate)",
    "1F 8B 08",
    { end: "gzip" },
  ],
  [
    Z,
    "bzip2 compressed file",
    "bz2,tbz2",
    "application/x-bzip2",
    "bzip2 stream",
    "'BZh' 3? 31 41 59 26 53 59",
  ],
  [Z, "XZ compressed file", "xz,txz", "application/x-xz", "xz stream", "FD '7zXZ' 00"],
  [
    Z,
    "Zstandard compressed file",
    "zst",
    "application/zstd",
    "Zstandard frame",
    "28 B5 2F FD",
    { end: "zstd" },
  ],
  [Z, "LZ4 frame", "lz4", "application/x-lz4", "LZ4 frame", "04 22 4D 18"],
  [Z, "lzip compressed file", "lz", "application/x-lzip", "lzip", "'LZIP'"],
  [
    Z,
    "tar archive",
    "tar",
    "application/x-tar",
    "tar archive (ustar magic at offset 257)",
    "@257 'ustar'",
    { end: "tar" },
  ],
  [
    Z,
    "UNIX compress",
    "Z",
    "application/x-compress",
    "compress (LZW) file",
    "1F 9D",
    { weak: true },
  ],
  [
    Z,
    "LHA / LZH archive",
    "lzh,lha",
    "application/x-lzh-compressed",
    "LHA archive",
    "@2 '-lh' ?? '-'",
  ],
  [Z, "cpio archive (new ASCII)", "cpio", "application/x-cpio", "cpio, newc format", "'070701'"],
  [Z, "cpio archive (new CRC)", "cpio", "application/x-cpio", "cpio, crc format", "'070702'"],
  [Z, "cpio archive (old ASCII)", "cpio", "application/x-cpio", "cpio, odc format", "'070707'"],
  [
    Z,
    "ar archive",
    "a,deb,lib",
    "application/x-archive",
    "Unix ar (and Debian packages)",
    "'!<arch>' 0A",
  ],
  [Z, "RPM package", "rpm", "application/x-rpm", "RPM", "ED AB EE DB"],
  [
    Z,
    "Microsoft Cabinet",
    "cab",
    "application/vnd.ms-cab-compressed",
    "CAB archive",
    "'MSCF' 00 00 00 00",
    { end: "cab" },
  ],
  [
    Z,
    "ISO 9660 image",
    "iso",
    "application/x-iso9660-image",
    "ISO 9660 volume descriptor at 0x8001",
    "@32769 'CD001'",
  ],
  [Z, "SquashFS", "squashfs,sqfs", "application/x-squashfs", "SquashFS image", "'hsqs'"],
  [Z, "XAR archive", "xar,pkg", "application/x-xar", "eXtensible ARchive", "'xar!'"],
  [Z, "ARJ archive", "arj", "application/x-arj", "ARJ", "60 EA", { weak: true }],
  [Z, "Windows Imaging Format", "wim", "application/x-ms-wim", "WIM image", "'MSWIM' 00 00 00"],
  [
    Z,
    "zlib stream (default compression)",
    "zlib",
    "application/zlib",
    "zlib header 78 9C",
    "78 9C",
    { weak: true },
  ],
  [
    Z,
    "zlib stream (best compression)",
    "zlib",
    "application/zlib",
    "zlib header 78 DA",
    "78 DA",
    { weak: true },
  ],

  // ---- Miscellaneous ----
  [
    M,
    "SQLite 3 database",
    "sqlite,db",
    "application/vnd.sqlite3",
    "SQLite format 3",
    "'SQLite format 3' 00",
    { end: "sqlite" },
  ],
  [
    M,
    "pcap capture (little endian)",
    "pcap",
    "application/vnd.tcpdump.pcap",
    "libpcap, microsecond timestamps",
    "D4 C3 B2 A1",
    { end: "pcap-le" },
  ],
  [
    M,
    "pcap capture (big endian)",
    "pcap",
    "application/vnd.tcpdump.pcap",
    "libpcap, microsecond timestamps, big endian",
    "A1 B2 C3 D4",
    { end: "pcap-be" },
  ],
  [
    M,
    "pcap capture (nanosecond, little endian)",
    "pcap",
    "application/vnd.tcpdump.pcap",
    "libpcap, nanosecond timestamps",
    "4D 3C B2 A1",
    { end: "pcap-le" },
  ],
  [
    M,
    "pcap capture (nanosecond, big endian)",
    "pcap",
    "application/vnd.tcpdump.pcap",
    "libpcap, nanosecond timestamps, big endian",
    "A1 B2 3C 4D",
    { end: "pcap-be" },
  ],
  [
    M,
    "pcapng capture (little endian)",
    "pcapng",
    "application/x-pcapng",
    "pcapng section header",
    "0A 0D 0D 0A ?? ?? ?? ?? 4D 3C 2B 1A",
    { end: "pcapng-le" },
  ],
  [
    M,
    "pcapng capture (big endian)",
    "pcapng",
    "application/x-pcapng",
    "pcapng section header",
    "0A 0D 0D 0A ?? ?? ?? ?? 1A 2B 3C 4D",
    { end: "pcapng-be" },
  ],
  [
    M,
    "Apple binary property list",
    "plist,bplist",
    "application/x-bplist",
    "binary plist, version 00",
    "'bplist00'",
  ],
  [
    M,
    "DER certificate (long lengths)",
    "der,cer,crt",
    "application/x-x509-ca-cert",
    "X.509 certificate in DER",
    "30 82 ?? ?? 30 82 ?? ?? A0 03 02 01 02",
    { end: "der" },
  ],
  [
    M,
    "DER certificate (mixed lengths)",
    "der,cer,crt",
    "application/x-x509-ca-cert",
    "X.509 certificate in DER",
    "30 82 ?? ?? 30 81 ?? A0 03 02 01 02",
    { end: "der" },
  ],
  [
    M,
    "DER certificate (short lengths)",
    "der,cer,crt",
    "application/x-x509-ca-cert",
    "X.509 certificate in DER",
    "30 81 ?? 30 81 ?? A0 03 02 01 02",
    { end: "der" },
  ],
  [
    M,
    "PEM encoded data",
    "pem",
    "application/x-pem-file",
    "PEM block (certificate, key, request, PGP)",
    "'-----BEGIN '",
    { end: "pem" },
  ],
  [
    M,
    "Windows shortcut",
    "lnk",
    "application/x-ms-shortcut",
    "LNK shell link",
    "4C 00 00 00 01 14 02 00 00 00 00 00 C0 00 00 00 00 00 00 46",
  ],
  [
    M,
    "OpenSSH private key",
    "key",
    "application/x-openssh-key",
    "openssh-key-v1",
    "'openssh-key-v1' 00",
  ],
  [M, "Java KeyStore", "jks", "application/x-java-keystore", "JKS", "FE ED FE ED"],
  [
    M,
    "KeePass database (KDBX)",
    "kdbx",
    "application/x-keepass2",
    "KeePass 2.x",
    "03 D9 A2 9A 67 FB 4B B5",
  ],
  [
    M,
    "KeePass database (KDB)",
    "kdb",
    "application/x-keepass",
    "KeePass 1.x",
    "03 D9 A2 9A 65 FB 4B B5",
  ],
  [M, "LUKS encrypted volume", "luks", "application/x-luks", "LUKS header", "'LUKS' BA BE"],
  [M, "Windows registry hive", "dat,hiv", "application/x-ms-registry", "regf hive", "'regf'"],
  [M, "Windows event log (EVTX)", "evtx", "application/x-ms-evtx", "ElfFile", "'ElfFile' 00"],
  [M, "Windows prefetch", "pf", "application/x-ms-prefetch", "SCCA prefetch file", "@4 'SCCA'"],
  [M, "TrueType font", "ttf", "font/ttf", "TrueType font", "00 01 00 00 00", { weak: true }],
  [M, "OpenType font", "otf", "font/otf", "OpenType font with CFF outlines", "'OTTO' 00"],
  [M, "TrueType collection", "ttc", "font/collection", "Font collection", "'ttcf'"],
  [M, "Web Open Font Format", "woff", "font/woff", "WOFF", "'wOFF'"],
  [M, "Web Open Font Format 2", "woff2", "font/woff2", "WOFF2", "'wOF2'"],
  [
    M,
    "Git pack file",
    "pack",
    "application/x-git-pack",
    "Git packfile, version 2",
    "'PACK' 00 00 00 02",
  ],
  [M, "VirtualBox VHD", "vhd", "application/x-vhd", "Hard disk footer cookie", "'conectix'"],
  [M, "VMware disk", "vmdk", "application/x-vmdk", "Sparse extent", "'KDMV'"],
  [M, "QEMU QCOW image", "qcow2,qcow", "application/x-qemu-disk", "QCOW", "'QFI' FB"],
  [
    M,
    "Kerberos credential cache",
    "ccache",
    "application/x-krb5-ccache",
    "ccache v4",
    "05 04",
    { weak: true },
  ],
  [M, "NES ROM", "nes", "application/x-nes-rom", "iNES", "'NES' 1A"],
];

/** Compiles the magic text of a row into parts. Exported for the tests. */
export function compileMagic(text: string): MagicPart[] {
  const parts: MagicPart[] = [];
  let offset = 0;
  let value: number[] = [];
  let mask: number[] = [];
  let start = 0;
  const flush = (): void => {
    if (value.length > 0)
      parts.push({ offset: start, value: Uint8Array.from(value), mask: Uint8Array.from(mask) });
    value = [];
    mask = [];
  };
  const push = (v: number, m: number): void => {
    if (value.length === 0) start = offset;
    value.push(v & m);
    mask.push(m);
    offset++;
  };
  for (const tok of text.match(/'[^']*'|\S+/g) ?? []) {
    if (tok.startsWith("@")) {
      flush();
      offset = Number(tok.slice(1));
    } else if (tok.startsWith("'")) {
      for (const ch of tok.slice(1, -1)) push(ch.charCodeAt(0), 0xff);
    } else if (tok.includes("&")) {
      const [a, b] = tok.split("&") as [string, string];
      push(parseInt(a, 16), parseInt(b, 16));
    } else if (tok === "??") {
      push(0, 0);
    } else if (/^[0-9A-Fa-f]{2}$/.test(tok)) {
      push(parseInt(tok, 16), 0xff);
    } else if (/^[0-9A-Fa-f]\?$/.test(tok)) {
      push(parseInt(tok[0] as string, 16) << 4, 0xf0);
    } else if (/^\?[0-9A-Fa-f]$/.test(tok)) {
      push(parseInt(tok[1] as string, 16), 0x0f);
    } else {
      throw new Error(`bad magic token ${tok}`);
    }
  }
  flush();
  return parts;
}

function anchorOf(parts: readonly MagicPart[]): { offset: number; bytes: Uint8Array } {
  let best = { offset: 0, bytes: new Uint8Array(0) };
  for (const p of parts) {
    let i = 0;
    while (i < p.value.length) {
      if (p.mask[i] !== 0xff) {
        i++;
        continue;
      }
      let j = i;
      while (j < p.value.length && p.mask[j] === 0xff) j++;
      if (j - i > best.bytes.length) best = { offset: p.offset + i, bytes: p.value.slice(i, j) };
      i = j;
    }
  }
  return best;
}

/** The compiled table, in the order of the rows. */
export const FILE_SIGNATURES: readonly FileSig[] = ROWS.map((row) => {
  const [category, name, extensions, mime, description, magic, options] = row;
  const parts = compileMagic(magic);
  const anchor = anchorOf(parts);
  if (anchor.bytes.length === 0) throw new Error(`file signature ${name} has no exact byte`);
  return {
    category,
    name,
    extensions,
    mime,
    description,
    parts,
    ...(options?.end !== undefined ? { end: options.end } : {}),
    ...(options?.verify !== undefined ? { verify: options.verify } : {}),
    weak: options?.weak === true,
    anchor,
  };
});
