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
 * gost3410 primitives: the GOST R 34.10-2012 signature (RFC 7091) over `@noble/curves`' generic short Weierstrass
 * curve, for vocab/gost3410.fth. The algorithm is not ECDSA (s = r*d + k*e, and the verifier's v = e^-1), so it is
 * written here on the library's points: the scalar multiplications of a 512-bit curve are far beyond the FL step
 * budget. The hash (Streebog, the `streebog` words), the choice of k (`random:bytes-of`) and the retry loop are FL;
 * this file never reads the host's generator, and the curves are built with a `randomBytes` that throws, so the
 * library does not blind and does not read it (see "Wave 7 conventions" > Libraries).
 *
 * Byte order. A private key d, a public point (x || y), r and s are big-endian numbers of `size` bytes (32 or 64),
 * as RFC 7091 writes them; the signature is r || s. The digest is the Streebog digest bytes as the `streebog` words
 * give them, which are the little-endian bytes of the number RFC 6986 prints, so e is that number: alpha is the
 * digest read little-endian, and e = alpha mod q, or 1 when that is 0 (RFC 7091 section 6.1).
 *
 * The curves: the two test curves of RFC 7091 section 7 (`test-256`, `test-512`), the three 256-bit parameter sets
 * id-GostR3410-2001-CryptoPro-A, -B and -C (RFC 4357 section 11.4) and the 512-bit id-tc26-gost-3410-12-512-paramSetA
 * (RFC 7836). The cofactor of every one is 1. Their numbers were typed from the published tables; the test
 * (src/prims/gost3410.test.ts) checks for each that the generator is on the curve and that q times it is the point
 * at infinity, which any wrong digit would break, and for the test curves that the RFC 7091 signatures reproduce.
 */
import { weierstrass } from "@noble/curves/abstract/weierstrass.js";
import type { WeierstrassOpts, WeierstrassPointCons } from "@noble/curves/abstract/weierstrass.js";
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const { normaliseInt } = valueHelpers;

const big = (hex: string): bigint => BigInt(`0x${hex}`);

interface CurveDef {
  readonly size: number;
  readonly params: WeierstrassOpts<bigint>;
}

const P512 = (1n << 512n) - 569n;

export const CURVES: Readonly<Record<string, CurveDef>> = {
  "test-256": {
    size: 32,
    params: {
      p: big("8000000000000000000000000000000000000000000000000000000000000431"),
      n: big("8000000000000000000000000000000150fe8a1892976154c59cfc193accf5b3"),
      h: 1n,
      a: 7n,
      b: big("5fbff498aa938ce739b8e022fbafef40563f6e6a3472fc2a514c0ce9dae23b7e"),
      Gx: 2n,
      Gy: big("08e2a8a0e65147d4bd6316030e16d19c85c97f0a9ca267122b96abbcea7e8fc8"),
    },
  },
  "test-512": {
    size: 64,
    params: {
      p: big(
        "4531acd1fe0023c7550d267b6b2fee80922b14b2ffb90f04d4eb7c09b5d2d15df1d852741af4704a0458047e80e4546d35b8336fac224dd81664bbf528be6373",
      ),
      n: big(
        "4531acd1fe0023c7550d267b6b2fee80922b14b2ffb90f04d4eb7c09b5d2d15da82f2d7ecb1dbac719905c5eecc423f1d86e25edbe23c595d644aaf187e6e6df",
      ),
      h: 1n,
      a: 7n,
      b: big(
        "1cff0806a31116da29d8cfa54e57eb748bc5f377e49400fdd788b649eca1ac4361834013b2ad7322480a89ca58e0cf74bc9e540c2add6897fad0a3084f302adc",
      ),
      Gx: big(
        "24d19cc64572ee30f396bf6ebbfd7a6c5213b3b3d7057cc825f91093a68cd762fd60611262cd838dc6b60aa7eee804e28bc849977fac33b4b530f1b120248a9a",
      ),
      Gy: big(
        "2bb312a43bd2ce6e0d020613c857acddcfbf061e91e5f2c3f32447c259f39b2c83ab156d77f1496bf7eb3351e1ee4e43dc1a18b91b24640b6dbb92cb1add371e",
      ),
    },
  },
  "cryptopro-a": {
    size: 32,
    params: {
      p: big("fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd97"),
      n: big("ffffffffffffffffffffffffffffffff6c611070995ad10045841b09b761b893"),
      h: 1n,
      a: big("fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd94"),
      b: 0xa6n,
      Gx: 1n,
      Gy: big("8d91e471e0989cda27df505a453f2b7635294f2ddf23e3b122acc99c9e9f1e14"),
    },
  },
  "cryptopro-b": {
    size: 32,
    params: {
      p: big("8000000000000000000000000000000000000000000000000000000000000c99"),
      n: big("800000000000000000000000000000015f700cfff1a624e5e497161bcc8a198f"),
      h: 1n,
      a: big("8000000000000000000000000000000000000000000000000000000000000c96"),
      b: big("3e1af419a269a5f866a7d3c25c3df80ae979259373ff2b182f49d4ce7e1bbc8b"),
      Gx: 1n,
      Gy: big("3fa8124359f96680b83d1c3eb2c070e5c545c9858d03ecfb744bf8d717717efc"),
    },
  },
  "cryptopro-c": {
    size: 32,
    params: {
      p: big("9b9f605f5a858107ab1ec85e6b41c8aacf846e86789051d37998f7b9022d759b"),
      n: big("9b9f605f5a858107ab1ec85e6b41c8aa582ca3511eddfb74f02f3a6598980bb9"),
      h: 1n,
      a: big("9b9f605f5a858107ab1ec85e6b41c8aacf846e86789051d37998f7b9022d7598"),
      b: 0x805an,
      Gx: 0n,
      Gy: big("41ece55743711a8c3cbf3783cd08c0ee4d4dc440d4641a8f366e550dfdb3bb67"),
    },
  },
  "tc26-512-a": {
    size: 64,
    params: {
      p: P512,
      n:
        (((1n << 256n) - 1n) << 256n) |
        big("27e69532f48d89116ff22b8d4e0560609b4b38abfad2b85dcacdb1411f10b275"),
      h: 1n,
      a: P512 - 3n,
      b: big(
        "e8c2505dedfc86ddc1bd0b2b6667f1da34b82574761cb0e879bd081cfd0b6265ee3cb090f30d27614cb4574010da90dd862ef9d4ebee4761503190785a71c760",
      ),
      Gx: 3n,
      Gy: big(
        "7503cfe87a836ae3a61b8816e25450e6ce5e1c93acf1abc1778064fdcbefa921df1626be4fd036e93d75e6a50e3a41e98028fe5fc235f5b889a589cb5215f2a4",
      ),
    },
  },
};

function noRandom(): never {
  throw new Error("no host randomness");
}

const cache = new Map<string, WeierstrassPointCons<bigint>>();

function def(curve: string): CurveDef {
  const c = Object.hasOwn(CURVES, curve) ? CURVES[curve] : undefined;
  if (c === undefined)
    throw rangeFailure(`unknown GOST R 34.10 curve '${String(curve).slice(0, 24)}'`);
  return c;
}

function point(curve: string): WeierstrassPointCons<bigint> {
  const c = def(curve);
  let p = cache.get(curve);
  if (p === undefined) {
    p = weierstrass(c.params, { randomBytes: noRandom });
    cache.set(curve, p);
  }
  return p;
}

function toInt(b: Uint8Array, little: boolean): bigint {
  let v = 0n;
  if (little) for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  else for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

function toBytes(v: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}

function bytesArg(v: unknown, what: string, length: number): Uint8Array {
  if (!(v instanceof Uint8Array) || v.length !== length)
    throw rangeFailure(`${what} must be ${length} bytes`, { length });
  return v;
}

function secret(curve: string, d: unknown, what: string): bigint {
  const v = toInt(bytesArg(d, what, def(curve).size), false);
  if (v < 1n || v >= def(curve).params.n)
    throw rangeFailure(`${what} must be a number from 1 to the order of the curve minus 1`);
  return v;
}

/** e = alpha mod q (alpha: the digest read as a little-endian number), or 1 when that is 0. */
function digestNumber(curve: string, digest: unknown): bigint {
  const e = toInt(bytesArg(digest, "the digest", def(curve).size), true) % def(curve).params.n;
  return e === 0n ? 1n : e;
}

function publicPoint(curve: string, pub: unknown) {
  const size = def(curve).size;
  const b = bytesArg(pub, "the public key", 2 * size);
  try {
    const q = point(curve).fromAffine({
      x: toInt(b.subarray(0, size), false),
      y: toInt(b.subarray(size), false),
    });
    q.assertValidity();
    return q;
  } catch {
    throw coerceFailure("bytes", `${curve} public key`, "the point is not on the curve");
  }
}

/** The size in bytes of the numbers of a curve: 32 or 64. */
export function size(curve: string): number {
  return def(curve).size;
}

/** The order q of the curve's base point. */
export function order(curve: string): number | bigint {
  return normaliseInt(def(curve).params.n);
}

/** The public point x || y of a private key d. */
export function publicKey(curve: string, d: Uint8Array): Uint8Array {
  const q = point(curve)
    .BASE.multiply(secret(curve, d, "the private key"))
    .toAffine();
  const size = def(curve).size;
  const out = new Uint8Array(2 * size);
  out.set(toBytes(q.x, size));
  out.set(toBytes(q.y, size), size);
  return out;
}

/**
 * The signature r || s of a digest with the private key d and the nonce k (32 or 64 bytes, 1 to q - 1; RFC 7091
 * section 6.1). Empty when r or s came out 0, which asks for another k.
 */
export function sign(curve: string, d: Uint8Array, digest: Uint8Array, k: Uint8Array): Uint8Array {
  const { size: n, params } = def(curve);
  const dv = secret(curve, d, "the private key");
  const kv = secret(curve, k, "k");
  const e = digestNumber(curve, digest);
  const r = point(curve).BASE.multiply(kv).toAffine().x % params.n;
  if (r === 0n) return new Uint8Array(0);
  const s = (r * dv + kv * e) % params.n;
  if (s === 0n) return new Uint8Array(0);
  const out = new Uint8Array(2 * n);
  out.set(toBytes(r, n));
  out.set(toBytes(s, n), n);
  return out;
}

/** True when sig (r || s) is a signature of the digest by the owner of the public point (RFC 7091 section 6.2). */
export function verify(
  curve: string,
  pub: Uint8Array,
  digest: Uint8Array,
  sig: Uint8Array,
): boolean {
  const { size: n, params } = def(curve);
  const q = publicPoint(curve, pub);
  const e = digestNumber(curve, digest);
  if (!(sig instanceof Uint8Array) || sig.length !== 2 * n) return false;
  const r = toInt(sig.subarray(0, n), false);
  const s = toInt(sig.subarray(n), false);
  if (r < 1n || r >= params.n || s < 1n || s >= params.n) return false;
  const inv = invert(e, params.n);
  const z1 = (s * inv) % params.n;
  const z2 = (params.n - ((r * inv) % params.n)) % params.n;
  const c = point(curve).BASE.multiplyUnsafe(z1).add(q.multiplyUnsafe(z2));
  if (c.is0()) return false;
  return c.toAffine().x % params.n === r;
}

function invert(a: bigint, m: bigint): bigint {
  let [r0, r1] = [m, a % m];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return ((t0 % m) + m) % m;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("gost3410", "_size", "( curve:str -- int )", size, {
    doc: "The size in bytes of the numbers of a GOST R 34.10 curve (private helper of the gost3410 words).",
    category: "Public Key",
  }),
  definePrimitive("gost3410", "_order", "( curve:str -- int )", order, {
    doc: "The order q of a GOST R 34.10 curve (private helper).",
    category: "Public Key",
  }),
  definePrimitive("gost3410", "_public-key", "( curve:str d:bytes -- bytes )", publicKey, {
    doc: "The public point x || y of a private key (private helper).",
    category: "Public Key",
  }),
  definePrimitive(
    "gost3410",
    "_sign",
    "( curve:str d:bytes digest:bytes k:bytes -- bytes )",
    sign,
    {
      doc: "The signature r || s of a digest with the nonce k; empty when k must be replaced (private helper).",
      category: "Public Key",
    },
  ),
  definePrimitive(
    "gost3410",
    "_verify",
    "( curve:str pub:bytes digest:bytes sig:bytes -- bool )",
    verify,
    {
      doc: "True when r || s verifies over the digest (private helper).",
      category: "Public Key",
    },
  ),
];
