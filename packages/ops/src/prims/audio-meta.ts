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
 * Container metadata of audio files (vocab/audio-meta.fth, Extract Audio Metadata). One primitive,
 * `_read ( data -- record )`, returns a record of `info` (a list of [name, value] text pairs), `tags` (a
 * list of text lines) and `id3` (true for MP3: the FL op adds the ID3 tags through id3:extract). The
 * report layout is FL.
 *
 * Why a primitive and not FL (a deviation from "FL first", flagged in the WP report): five binary
 * containers with bit-packed fields (FLAC STREAMINFO), 255-entry Ogg lacing tables whose prefix sums mark
 * the packet ends, nested MP4 boxes with 32 and 64 bit sizes and MPEG frame headers with four lookup
 * tables are walks over many small fields. The FL implementation of the ID3 tags next to it costs
 * 1,000 to 2,000 VM steps for each frame and 80 for each UTF-16 unit; these walks have the same cost per
 * field and several times the nesting. The FL prototype of the Ogg and MP4 walks was not written; the
 * orchestrator can ask for one.
 *
 * Bounds. Every length, count and offset is compared with the bytes that exist and never allocates; each
 * walk has a count limit (64 FLAC blocks, 1,000 Ogg pages, 1,000 RIFF chunks, 1,000 boxes a level, 2,000
 * comments); a structure that runs past the data is `E_COERCE` with the offset. No audio is decoded.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef, Value } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

const { str, bool, list } = valueHelpers;

type Pair = [string, string];

export interface AudioInfo {
  readonly info: Pair[];
  readonly tags: string[];
  readonly id3: boolean;
}

const fail = (what: string): never => {
  throw coerceFailure("audio data", "metadata", what);
};

/** A bounds-checked reader. */
class Reader {
  constructor(readonly d: Uint8Array) {}
  need(p: number, n: number, what: string): void {
    if (!Number.isSafeInteger(p) || p < 0 || n < 0 || p + n > this.d.length)
      fail(`${what} at offset ${String(p)} is cut short (truncated)`);
  }
  u8(p: number, what = "a field"): number {
    this.need(p, 1, what);
    return this.d[p] as number;
  }
  be(p: number, n: number, what = "a field"): number {
    this.need(p, n, what);
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + (this.d[p + i] as number);
    return v;
  }
  le(p: number, n: number, what = "a field"): number {
    this.need(p, n, what);
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + (this.d[p + i] as number);
    return v;
  }
  ascii(p: number, n: number): string {
    let s = "";
    for (let i = 0; i < n && p + i < this.d.length; i++)
      s += String.fromCharCode(this.d[p + i] as number);
    return s;
  }
  /** Text of n bytes: UTF-8 when valid, else Latin-1 (cut at the data). */
  text(p: number, n: number): string {
    const end = Math.min(this.d.length, p + n);
    const b = this.d.subarray(Math.min(p, end), end);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      return Array.from(b, (c) => String.fromCharCode(c)).join("");
    }
  }
  get length(): number {
    return this.d.length;
  }
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}

const secs = (n: number, d: number): string => (d > 0 ? `${(n / d).toFixed(3)} s` : "unknown");
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const PICTURE_TYPES = [
  "Other",
  "32x32 pixels file icon",
  "Other file icon",
  "Cover (front)",
  "Cover (back)",
  "Leaflet page",
  "Media",
  "Lead artist",
  "Artist",
  "Conductor",
  "Band",
  "Composer",
  "Lyricist",
  "Recording location",
  "During recording",
  "During performance",
  "Movie/video screen capture",
  "A bright coloured fish",
  "Illustration",
  "Band logotype",
  "Publisher logotype",
];

// ---------------------------------------------------------------------------------------------
// Vorbis comments (FLAC, Ogg)
// ---------------------------------------------------------------------------------------------

function vorbisComments(r: Reader, at: number, end: number): { vendor: string; lines: string[] } {
  const vlen = r.le(at, 4, "the Vorbis comment vendor length");
  if (at + 4 + vlen > end)
    fail(
      `the Vorbis comment vendor string at offset ${at} runs past the end of the data (truncated)`,
    );
  const vendor = r.text(at + 4, vlen);
  let p = at + 4 + vlen;
  if (p + 4 > end) return { vendor, lines: [] };
  const count = Math.min(r.le(p, 4, "the Vorbis comment count"), 2000);
  p += 4;
  const lines: string[] = [];
  for (let i = 0; i < count && p + 4 <= end; i++) {
    const len = r.le(p, 4);
    if (p + 4 + len > end)
      fail(
        `a Vorbis comment at offset ${p} declares ${len} bytes and runs past the end of the data (truncated)`,
      );
    const text = r.text(p + 4, len);
    const eq = text.indexOf("=");
    lines.push(eq < 0 ? text : `${text.slice(0, eq)}: ${text.slice(eq + 1)}`);
    p += 4 + len;
  }
  return { vendor, lines };
}

// ---------------------------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------------------------

function flac(r: Reader): AudioInfo {
  let p = 4;
  const info: Pair[] = [["Container", "FLAC"]];
  const tags: string[] = [];
  let streamInfo = false;
  let vendor = "";
  for (let n = 0; n < 64; n++) {
    const h = r.u8(p, "a FLAC metadata block header");
    const len = r.be(p + 1, 3, "a FLAC metadata block header");
    const at = p + 4;
    if (at + len > r.length)
      fail(`the FLAC metadata block at offset ${p} runs past the end of the data (truncated)`);
    const type = h & 0x7f;
    if (type === 0) {
      if (len < 34) fail(`the FLAC STREAMINFO block at offset ${p} is ${len} bytes, not 34`);
      const b = (i: number) => r.u8(at + i);
      const rate = b(10) * 4096 + b(11) * 16 + (b(12) >> 4);
      const channels = ((b(12) >> 1) & 7) + 1;
      const bits = (((b(12) & 1) << 4) | (b(13) >> 4)) + 1;
      const total = (b(13) & 15) * 4294967296 + r.be(at + 14, 4);
      streamInfo = true;
      info.push(["Duration", total > 0 ? secs(total, rate) : "unknown"]);
      info.push(
        ["Sample rate", `${rate} Hz`],
        ["Channels", String(channels)],
        ["Bits per sample", String(bits)],
      );
      info.push(["Samples", String(total)], ["Audio MD5", hex(r.d.subarray(at + 18, at + 34))]);
    } else if (type === 4) {
      const v = vorbisComments(r, at, at + len);
      vendor = v.vendor;
      tags.push(...v.lines);
    } else if (type === 6 && len >= 32) {
      const ptype = r.be(at, 4);
      const mlen = r.be(at + 4, 4);
      const mime = r.text(at + 8, Math.min(mlen, len));
      const dlen = r.be(at + 8 + mlen, 4);
      const desc = r.text(at + 12 + mlen, Math.min(dlen, len));
      const dataLen = r.be(at + 12 + mlen + dlen + 16, 4);
      tags.push(
        `Picture: ${mime}, ${PICTURE_TYPES[ptype] ?? `type ${ptype}`}, ${dataLen} bytes${desc ? `, "${desc}"` : ""}`,
      );
    }
    p = at + len;
    if (h & 0x80) break;
  }
  if (!streamInfo) fail("the FLAC data has no STREAMINFO block");
  if (vendor) info.push(["Encoder vendor", vendor]);
  return { info, tags, id3: false };
}

// ---------------------------------------------------------------------------------------------
// Ogg
// ---------------------------------------------------------------------------------------------

interface Page {
  at: number;
  lace: Uint8Array;
  body: number;
  bodyLen: number;
}

function oggPage(r: Reader, p: number): Page | null {
  if (p + 27 > r.length || r.ascii(p, 4) !== "OggS" || r.d[p + 4] !== 0) return null;
  const n = r.d[p + 26] as number;
  if (p + 27 + n > r.length) return null;
  const lace = r.d.subarray(p + 27, p + 27 + n);
  let bodyLen = 0;
  for (const l of lace) bodyLen += l;
  if (p + 27 + n + bodyLen > r.length) return null;
  return { at: p, lace, body: p + 27 + n, bodyLen };
}

/** The first two packets of the logical stream that starts the file. */
function oggPackets(r: Reader): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  let p = 0;
  for (let n = 0; n < 1000 && packets.length < 2; n++) {
    const page = oggPage(r, p);
    if (page === null) break;
    let q = page.body;
    for (const l of page.lace) {
      current.push(r.d.subarray(q, q + l));
      q += l;
      if (l < 255) {
        const total = current.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of current) {
          out.set(c, o);
          o += c.length;
        }
        packets.push(out);
        current = [];
        if (packets.length === 2) break;
      }
    }
    p = page.body + page.bodyLen;
  }
  return packets;
}

function oggLastGranule(r: Reader): number {
  const tail = Math.max(0, r.length - 70_000);
  const text = r.ascii(tail, r.length - tail);
  for (let at = text.lastIndexOf("OggS"); at >= 0; at = text.lastIndexOf("OggS", at - 1)) {
    const page = oggPage(r, tail + at);
    if (page === null) continue;
    let allFf = true;
    for (let i = 0; i < 8; i++) if (r.d[tail + at + 6 + i] !== 0xff) allFf = false;
    return allFf ? -1 : r.le(tail + at + 6, 8);
  }
  return -1;
}

function ogg(r: Reader): AudioInfo {
  const packets = oggPackets(r);
  const first = packets[0];
  if (first === undefined) fail("the Ogg data has no complete first packet (truncated)");
  const f = new Reader(first as Uint8Array);
  const info: Pair[] = [["Container", "Ogg"]];
  const tags: string[] = [];
  const granule = oggLastGranule(r);
  const second = packets[1] === undefined ? undefined : new Reader(packets[1]);
  let vendor = "";
  if (f.ascii(0, 7) === "\x01vorbis") {
    const channels = f.u8(11);
    const rate = f.le(12, 4);
    const nominal = f.le(20, 4);
    info.push(["Codec", "Vorbis"]);
    if (granule >= 0) info.push(["Duration", secs(granule, rate)]);
    info.push(["Sample rate", `${rate} Hz`], ["Channels", String(channels)]);
    if (nominal > 0 && nominal < 0x80000000)
      info.push(["Nominal bit rate", `${Math.round(nominal / 1000)} kbit/s`]);
    if (second !== undefined && second.ascii(0, 7) === "\x03vorbis") {
      const v = vorbisComments(second, 7, second.length);
      vendor = v.vendor;
      tags.push(...v.lines);
    }
  } else if (f.ascii(0, 8) === "OpusHead") {
    const channels = f.u8(9);
    const preSkip = f.le(10, 2);
    const inRate = f.le(12, 4);
    info.push(["Codec", "Opus"]);
    if (granule >= 0) info.push(["Duration", secs(Math.max(0, granule - preSkip), 48000)]);
    info.push(
      ["Sample rate", `${inRate} Hz (input; Opus decodes at 48000 Hz)`],
      ["Channels", String(channels)],
    );
    if (second !== undefined && second.ascii(0, 8) === "OpusTags") {
      const v = vorbisComments(second, 8, second.length);
      vendor = v.vendor;
      tags.push(...v.lines);
    }
  } else if (f.ascii(0, 8) === "Speex   ") {
    const rate = f.le(36, 4);
    const channels = f.le(48, 4);
    info.push(["Codec", "Speex"]);
    if (granule >= 0) info.push(["Duration", secs(granule, rate)]);
    info.push(["Sample rate", `${rate} Hz`], ["Channels", String(channels)]);
    if (second !== undefined) {
      const v = vorbisComments(second, 0, second.length);
      vendor = v.vendor;
      tags.push(...v.lines);
    }
  } else if (f.ascii(0, 5) === "\x7fFLAC") info.push(["Codec", "FLAC in Ogg"]);
  else if (f.ascii(0, 7) === "\x80theora") info.push(["Codec", "Theora (video)"]);
  else info.push(["Codec", "unknown"]);
  if (vendor) info.push(["Encoder vendor", vendor]);
  return { info, tags, id3: false };
}

// ---------------------------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------------------------

const WAV_CODECS: Record<number, string> = {
  1: "PCM",
  3: "IEEE float",
  6: "A-law",
  7: "mu-law",
  0x11: "IMA ADPCM",
  0x55: "MPEG Layer 3",
  0xfffe: "Extensible",
};
const WAV_TAGS: Record<string, string> = {
  INAM: "Title",
  IART: "Artist",
  IPRD: "Album",
  ICMT: "Comment",
  ICRD: "Date",
  IGNR: "Genre",
  ITRK: "Track",
  IPRT: "Track",
  ISFT: "Software",
  ICOP: "Copyright",
  IENG: "Engineer",
  ITCH: "Technician",
  ISRC: "Source",
  ICMS: "Commissioned",
  IKEY: "Keywords",
  ISBJ: "Subject",
  ILNG: "Language",
};

function wav(r: Reader): AudioInfo {
  const info: Pair[] = [["Container", "WAV (RIFF)"]];
  const tags: string[] = [];
  let p = 12;
  let byteRate = 0;
  let dataSize = -1;
  let fmt = false;
  for (let n = 0; n < 1000 && p + 8 <= r.length; n++) {
    const id = r.ascii(p, 4);
    const size = r.le(p + 4, 4);
    const at = p + 8;
    if (id === "fmt ") {
      if (size < 16) fail(`the WAV fmt chunk at offset ${p} is ${size} bytes, not 16 or more`);
      const tag = r.le(at, 2);
      const channels = r.le(at + 2, 2);
      const rate = r.le(at + 4, 4);
      byteRate = r.le(at + 8, 4);
      const bits = r.le(at + 14, 2);
      fmt = true;
      info.push(["Codec", WAV_CODECS[tag] ?? `format 0x${tag.toString(16)}`]);
      info.push(
        ["Sample rate", `${rate} Hz`],
        ["Channels", String(channels)],
        ["Bits per sample", String(bits)],
      );
    } else if (id === "data") {
      dataSize = Math.min(size, r.length - at);
    } else if (id === "LIST" && size >= 4 && r.ascii(at, 4) === "INFO") {
      let q = at + 4;
      const end = Math.min(at + size, r.length);
      for (let k = 0; k < 500 && q + 8 <= end; k++) {
        const sid = r.ascii(q, 4);
        const slen = r.le(q + 4, 4);
        if (q + 8 + slen > end)
          fail(
            `the WAV INFO item ${sid} at offset ${q} runs past the end of its chunk (truncated)`,
          );
        const value = r.text(q + 8, slen).split("\0")[0] as string;
        tags.push(`${WAV_TAGS[sid] ?? sid}: ${value}`);
        q += 8 + slen + (slen & 1);
      }
    }
    p = at + size + (size & 1);
  }
  if (!fmt) fail("the WAV data has no fmt chunk");
  if (dataSize >= 0 && byteRate > 0) info.splice(2, 0, ["Duration", secs(dataSize, byteRate)]);
  return { info, tags, id3: false };
}

// ---------------------------------------------------------------------------------------------
// MP4 / M4A
// ---------------------------------------------------------------------------------------------

interface Box {
  type: string;
  at: number; // start of the payload
  end: number;
}

function boxes(r: Reader, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  for (let n = 0; n < 1000 && p + 8 <= end; n++) {
    let size = r.be(p, 4);
    const type = r.ascii(p, 8).slice(4);
    let hdr = 8;
    if (size === 1) {
      const hi = r.be(p + 8, 4);
      if (hi >= 0x200000) fail(`the box ${type} at offset ${p} is larger than 2^53 bytes`);
      size = hi * 4294967296 + r.be(p + 12, 4);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr) break;
    out.push({ type, at: p + hdr, end: Math.min(p + size, end) });
    p += size;
  }
  return out;
}

const find = (bs: Box[], type: string): Box | undefined => bs.find((b) => b.type === type);
const children = (r: Reader, b: Box | undefined, skip = 0): Box[] =>
  b === undefined ? [] : boxes(r, b.at + skip, b.end);

const MP4_TAGS: Record<string, string> = {
  "\xa9nam": "Title",
  "\xa9ART": "Artist",
  aART: "Album artist",
  "\xa9alb": "Album",
  "\xa9day": "Date",
  "\xa9gen": "Genre",
  "\xa9wrt": "Composer",
  "\xa9cmt": "Comment",
  "\xa9too": "Encoder",
  cprt: "Copyright",
  "\xa9grp": "Grouping",
  "\xa9lyr": "Lyrics",
  desc: "Description",
  ldes: "Long description",
};
const MP4_CODECS: Record<string, string> = {
  mp4a: "AAC",
  alac: "Apple Lossless",
  ".mp3": "MP3",
  Opus: "Opus",
  fLaC: "FLAC",
  "ac-3": "AC-3",
  "ec-3": "E-AC-3",
  samr: "AMR",
  sowt: "PCM",
  twos: "PCM",
  lpcm: "PCM",
  in24: "PCM",
};

function mp4Tags(r: Reader, ilst: Box): string[] {
  const out: string[] = [];
  for (const item of boxes(r, ilst.at, ilst.end)) {
    const data = find(boxes(r, item.at, item.end), "data");
    if (data === undefined || data.at + 8 > data.end) continue;
    const kind = r.be(data.at, 4);
    const vat = data.at + 8;
    const vlen = data.end - vat;
    if (item.type === "covr") {
      out.push(
        `Cover art: ${kind === 14 ? "image/png" : kind === 13 ? "image/jpeg" : `type ${kind}`}, ${vlen} bytes`,
      );
    } else if (item.type === "trkn" || item.type === "disk") {
      if (vlen >= 6) {
        const total = r.be(vat + 4, 2);
        out.push(
          `${item.type === "trkn" ? "Track" : "Disc"}: ${r.be(vat + 2, 2)}${total ? `/${total}` : ""}`,
        );
      }
    } else if (item.type === "tmpo" && vlen >= 2) out.push(`Tempo: ${r.be(vat, 2)}`);
    else if (kind === 1 || kind === 0)
      out.push(
        `${MP4_TAGS[item.type] ?? item.type.replace(/[^\x20-\x7e]/g, "")}: ${r.text(vat, vlen)}`,
      );
  }
  return out;
}

function mp4(r: Reader): AudioInfo {
  const top = boxes(r, 0, r.length);
  const ftyp = find(top, "ftyp");
  const brand = ftyp === undefined ? "" : r.ascii(ftyp.at, 4).trim();
  const info: Pair[] = [["Container", `MPEG-4${brand ? ` (brand ${brand})` : ""}`]];
  const tags: string[] = [];
  const moov = find(top, "moov");
  if (moov === undefined)
    fail("the MP4 data has no moov box (the metadata is missing or the data is cut short)");
  const mb = children(r, moov);
  const mvhd = find(mb, "mvhd");
  let duration = "";
  if (mvhd !== undefined) {
    const v1 = r.u8(mvhd.at) === 1;
    const scale = r.be(mvhd.at + (v1 ? 20 : 12), 4);
    const dur = v1
      ? r.be(mvhd.at + 24, 4) * 4294967296 + r.be(mvhd.at + 28, 4)
      : r.be(mvhd.at + 16, 4);
    duration = secs(dur, scale);
  }
  let codec = "";
  let rate = "";
  let channels = "";
  for (const trak of mb.filter((b) => b.type === "trak")) {
    const mdia = find(children(r, trak), "mdia");
    const md = children(r, mdia);
    const hdlr = find(md, "hdlr");
    if (hdlr === undefined || r.ascii(hdlr.at + 8, 4) !== "soun") continue;
    const stbl = find(children(r, find(md, "minf")), "stbl");
    const stsd = find(children(r, stbl), "stsd");
    if (stsd === undefined || stsd.at + 8 + 36 > stsd.end) continue;
    const e = stsd.at + 8;
    const fourcc = r.ascii(e + 4, 4);
    codec = MP4_CODECS[fourcc] ? `${MP4_CODECS[fourcc]} (${fourcc})` : fourcc;
    channels = String(r.be(e + 24, 2));
    rate = `${r.be(e + 32, 2)} Hz`;
    break;
  }
  if (codec) info.push(["Codec", codec]);
  if (duration) info.push(["Duration", duration]);
  if (rate) info.push(["Sample rate", rate]);
  if (channels) info.push(["Channels", channels]);
  const udta = find(mb, "udta");
  const meta = find(children(r, udta), "meta") ?? find(mb, "meta");
  const ilst = find(children(r, meta, 4), "ilst");
  if (ilst !== undefined) tags.push(...mp4Tags(r, ilst));
  return { info, tags, id3: false };
}

// ---------------------------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------------------------

const BR_V1 = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];
const BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = [
  [44100, 48000, 32000],
  [22050, 24000, 16000],
  [11025, 12000, 8000],
];

interface Frame {
  at: number;
  version: 0 | 1 | 2; // MPEG-1, MPEG-2, MPEG-2.5
  layer: 1 | 2 | 3;
  bitrate: number; // kbit/s
  rate: number;
  mode: number;
  length: number;
  samples: number;
}

function mpegFrame(d: Uint8Array, i: number): Frame | null {
  if (i + 4 > d.length || d[i] !== 0xff || ((d[i + 1] as number) & 0xe0) !== 0xe0) return null;
  const vbits = ((d[i + 1] as number) >> 3) & 3;
  const lbits = ((d[i + 1] as number) >> 1) & 3;
  const bidx = (d[i + 2] as number) >> 4;
  const sidx = ((d[i + 2] as number) >> 2) & 3;
  if (vbits === 1 || lbits === 0 || bidx === 0 || bidx === 15 || sidx === 3) return null;
  const version = vbits === 3 ? 0 : vbits === 2 ? 1 : 2;
  const layer = (4 - lbits) as 1 | 2 | 3;
  const bitrate = (
    version === 0 ? (BR_V1[layer - 1] as number[]) : layer === 1 ? BR_V2_L1 : BR_V2_L23
  )[bidx] as number;
  const rate = (SR[version] as number[])[sidx] as number;
  const pad = ((d[i + 2] as number) >> 1) & 1;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate * 1000) / rate) + pad) * 4
      : Math.floor(((layer === 3 && version > 0 ? 72 : 144) * bitrate * 1000) / rate) + pad;
  const samples = layer === 1 ? 384 : layer === 2 || version === 0 ? 1152 : 576;
  return { at: i, version, layer, bitrate, rate, mode: (d[i + 3] as number) >> 6, length, samples };
}

function id3v2End(d: Uint8Array): number {
  if (
    d.length >= 10 &&
    d[0] === 0x49 &&
    d[1] === 0x44 &&
    d[2] === 0x33 &&
    (d[3] as number) >= 2 &&
    (d[3] as number) <= 4
  ) {
    for (let i = 6; i < 10; i++) if ((d[i] as number) >= 0x80) return 0;
    const size =
      ((d[6] as number) << 21) |
      ((d[7] as number) << 14) |
      ((d[8] as number) << 7) |
      (d[9] as number);
    return 10 + size + ((d[5] as number) & 0x10 ? 10 : 0);
  }
  return 0;
}

function mp3(r: Reader, start: number): AudioInfo {
  const d = r.d;
  let frame: Frame | null = null;
  const limit = Math.min(d.length - 4, start + 16384);
  for (let i = start; i < limit && frame === null; i++) {
    if (d[i] !== 0xff) continue;
    const f = mpegFrame(d, i);
    if (f === null) continue;
    const next = i + f.length;
    const n = mpegFrame(d, next);
    if (
      (n !== null && n.version === f.version && n.layer === f.layer && n.rate === f.rate) ||
      next + 4 > d.length
    )
      frame = f;
  }
  if (frame === null) return fail("no MPEG audio frame was found in the data");
  const f: Frame = frame;
  const mono = f.mode === 3;
  const side = f.version === 0 ? (mono ? 17 : 32) : mono ? 9 : 17;
  let frames = -1;
  let bytes = -1;
  const x = f.at + 4 + side;
  const tag = r.ascii(x, 4);
  if (tag === "Xing" || tag === "Info") {
    const flags = r.be(x + 4, 4);
    let q = x + 8;
    if (flags & 1) {
      frames = r.be(q, 4);
      q += 4;
    }
    if (flags & 2) bytes = r.be(q, 4);
  } else if (r.ascii(f.at + 4 + 32, 4) === "VBRI") {
    bytes = r.be(f.at + 4 + 32 + 10, 4);
    frames = r.be(f.at + 4 + 32 + 14, 4);
  }
  const hasV1 = d.length >= start + 128 && r.ascii(d.length - 128, 3) === "TAG";
  const audioBytes = d.length - f.at - (hasV1 ? 128 : 0);
  const info: Pair[] = [
    ["Container", f.layer === 3 ? "MPEG audio (MP3)" : `MPEG audio (layer ${f.layer})`],
  ];
  info.push([
    "Codec",
    `MPEG-${f.version === 0 ? "1" : f.version === 1 ? "2" : "2.5"} Layer ${"I".repeat(f.layer === 3 ? 0 : f.layer) || "III"}`,
  ]);
  if (frames > 0) {
    info.push(["Duration", secs(frames * f.samples, f.rate)]);
    const bits = (bytes > 0 ? bytes : audioBytes) * 8;
    info.push([
      "Bit rate",
      `${Math.round((bits * f.rate) / (frames * f.samples) / 1000)} kbit/s (average, from the ${tag === "Xing" || tag === "Info" ? tag : "VBRI"} header)`,
    ]);
  } else {
    info.push(["Duration", secs(audioBytes * 8, f.bitrate * 1000)]);
    info.push(["Bit rate", `${f.bitrate} kbit/s (constant)`]);
  }
  info.push(["Sample rate", `${f.rate} Hz`]);
  info.push([
    "Channels",
    mono ? "1 (mono)" : `2 (${["stereo", "joint stereo", "dual channel"][f.mode] as string})`,
  ]);
  return { info, tags: [], id3: true };
}

// ---------------------------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------------------------

export function readAudio(d: Uint8Array): AudioInfo {
  const start = id3v2End(d);
  const r = new Reader(start > 0 && start < d.length ? d.subarray(start) : d);
  const body = r.d;
  const magic = (s: string, at = 0) => r.ascii(at, s.length) === s;
  let result: AudioInfo;
  if (magic("fLaC")) result = flac(r);
  else if (magic("OggS")) result = ogg(r);
  else if (magic("RIFF") && magic("WAVE", 8)) result = wav(r);
  else if (magic("ftyp", 4)) result = mp4(r);
  else if (
    d.length >= 4 &&
    (start > 0 || (body[0] === 0xff && ((body[1] as number) & 0xe0) === 0xe0))
  ) {
    result = mp3(new Reader(d), start);
  } else return fail("not a supported audio file (MP3, FLAC, Ogg, WAV or MP4/M4A)");
  return result;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "audio-meta",
    "_read",
    "( data:bytes -- record )",
    (d: Uint8Array) => {
      const a = readAudio(d);
      const val = (s: string): Value => str(s);
      return new Map<string, Value>([
        ["info", list(a.info.map(([k, v]) => list([val(k), val(v)])))],
        ["tags", list(a.tags.map(val))],
        ["id3", bool(a.id3)],
      ]);
    },
    {
      doc: "The container metadata of an audio file as a record of info (a list of name and value pairs), tags (a list of lines) and id3 (true for MP3). MP3, FLAC, Ogg (Vorbis, Opus, Speex), WAV and MP4 or M4A; anything else, and a structure that runs past the data, is E_COERCE (private helper of audio-meta:extract).",
    },
  ),
];
