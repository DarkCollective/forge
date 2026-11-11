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
 * ecdsa primitives: ECDSA over P-256, P-384, P-521 and secp256k1 on the audited `@noble/curves` (2.4.0), behind
 * the FL words of vocab/ecdsa.fth. The arithmetic is a primitive because the scalar multiplications of a 521-bit
 * curve are far beyond the FL step budget. The rules of "Wave 7 conventions" > Libraries:
 *
 *  - the library is imported from its subpath modules, here only (`abstract/weierstrass.js`); the named-curve
 *    module `nist.js` is not imported, because it builds its curves with the host's random generator and carries
 *    the hash-to-curve, FROST and OPRF code; the four curves are built here from the SEC 2 parameters (checked
 *    against `nist.js` and `secp256k1.js` in src/ecdsa.test.ts);
 *  - the library never reads the host's random generator: every curve is built with a `randomBytes` that
 *    throws, which the library answers by not blinding its scalar multiplications (it falls back to its
 *    constant-time path), and a key generator is given its seed by the FL word (`random:bytes-of`);
 *  - every option the call depends on is stated: the digest is computed by the FL caller and passed in with
 *    `prehash: false`, `lowS: false` (OpenSSL and CyberChef accept and make either half), `format: "compact"`
 *    (`r || s`, each as wide as the curve's order) and `extraEntropy: false` (RFC 6979 deterministic k, whose
 *    HMAC-DRBG uses the same hash as the message digest, as the RFC 6979 appendix A.2 vectors do).
 * The DER form, the PEM, JSON and Base64url forms are FL (the shared `asn1`, `json` and `base64` words).
 */
import { weierstrass, ecdsa } from "@noble/curves/abstract/weierstrass.js";
import type { ECDSA, WeierstrassOpts } from "@noble/curves/abstract/weierstrass.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import type { CHash } from "@noble/hashes/utils.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const big = (hex: string): bigint => BigInt(`0x${hex}`);

interface CurveDef {
  /** The size in bytes of the order (and of a field element). */
  readonly size: number;
  readonly params: WeierstrassOpts<bigint>;
}

/** SEC 2 version 2: secp256r1 (P-256), secp384r1 (P-384), secp521r1 (P-521) and secp256k1. */
export const CURVES: Readonly<Record<string, CurveDef>> = {
  "P-256": {
    size: 32,
    params: {
      p: big("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
      n: big("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
      h: 1n,
      a: big("ffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
      b: big("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
      Gx: big("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
      Gy: big("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"),
    },
  },
  "P-384": {
    size: 48,
    params: {
      p: big(
        "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff",
      ),
      n: big(
        "ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973",
      ),
      h: 1n,
      a: big(
        "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc",
      ),
      b: big(
        "b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef",
      ),
      Gx: big(
        "aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7",
      ),
      Gy: big(
        "3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f",
      ),
    },
  },
  "P-521": {
    size: 66,
    params: {
      p: big(
        "1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
      n: big(
        "01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409",
      ),
      h: 1n,
      a: big(
        "1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc",
      ),
      b: big(
        "0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00",
      ),
      Gx: big(
        "00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66",
      ),
      Gy: big(
        "011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650",
      ),
    },
  },
  secp256k1: {
    size: 32,
    params: {
      p: big("fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
      n: big("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
      h: 1n,
      a: 0n,
      b: 7n,
      Gx: big("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
      Gy: big("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"),
    },
  },
};

const HASHES: Readonly<Record<string, CHash>> = { md5, sha1, sha256, sha384, sha512 };

/** The library's random generator is replaced by one that throws: it then does not blind, and never reads the host. */
function noRandom(): never {
  throw new Error("no host randomness");
}

function curveDef(name: string): CurveDef {
  const c = Object.hasOwn(CURVES, name) ? CURVES[name] : undefined;
  if (c === undefined) throw rangeFailure(`unknown ECDSA curve '${String(name).slice(0, 20)}'`);
  return c;
}

const cache = new Map<string, ECDSA>();

/** The ECDSA instance of a curve whose RFC 6979 generator uses the hash `hash` (also the message digest). */
function instance(curve: string, hash: string): ECDSA {
  const def = curveDef(curve);
  const h = Object.hasOwn(HASHES, hash) ? HASHES[hash] : undefined;
  if (h === undefined) throw rangeFailure(`unknown ECDSA digest '${String(hash).slice(0, 20)}'`);
  const key = `${curve}/${hash}`;
  let ec = cache.get(key);
  if (ec === undefined) {
    const point = weierstrass(def.params, { randomBytes: noRandom });
    ec = ecdsa(point, h, { randomBytes: noRandom, lowS: false });
    cache.set(key, ec);
  }
  return ec;
}

function checkBytes(v: unknown, what: string): Uint8Array {
  if (!(v instanceof Uint8Array)) throw rangeFailure(`${what} must be bytes`);
  return v;
}

/** The size in bytes of the curve's order and field elements: 32, 48 or 66. */
export function size(curve: string): number {
  return curveDef(curve).size;
}

/** The seed length `randomSecretKey` wants: the key size plus half of it (FIPS 186-5 appendix A.2). */
export function seedLength(curve: string): number {
  return instance(curve, "sha256").lengths.seed ?? 0;
}

/** The secret key (a scalar in 1 to n - 1, `size` bytes) that a seed of `seedLength` bytes maps to. */
export function keygen(curve: string, seed: Uint8Array): Uint8Array {
  const ec = instance(curve, "sha256");
  checkBytes(seed, "the seed");
  if (seed.length !== seedLength(curve))
    throw rangeFailure(
      `the seed for ${curve} must be ${seedLength(curve)} bytes, not ${seed.length}`,
    );
  return Uint8Array.from(ec.utils.randomSecretKey(seed));
}

function checkSecret(ec: ECDSA, curve: string, d: Uint8Array): void {
  checkBytes(d, "the private key");
  if (!ec.utils.isValidSecretKey(d))
    throw coerceFailure(
      "bytes",
      `${curve} private key`,
      `the private key must be ${size(curve)} bytes holding a number from 1 to the order minus 1`,
    );
}

/** The public point of a private key, uncompressed (`04 || x || y`). */
export function publicKey(curve: string, d: Uint8Array): Uint8Array {
  const ec = instance(curve, "sha256");
  checkSecret(ec, curve, d);
  return Uint8Array.from(ec.getPublicKey(d, false));
}

/** True when the bytes are an uncompressed or compressed point on the curve (not the point at infinity). */
export function validPoint(curve: string, pub: Uint8Array): boolean {
  const ec = instance(curve, "sha256");
  checkBytes(pub, "the public key");
  return ec.utils.isValidPublicKey(pub, false) || ec.utils.isValidPublicKey(pub, true);
}

/** The public key (`04 || x || y`) of a point given in either form; a point not on the curve is E_COERCE. */
export function uncompressed(curve: string, pub: Uint8Array): Uint8Array {
  const ec = instance(curve, "sha256");
  checkBytes(pub, "the public key");
  try {
    return Uint8Array.from(ec.Point.fromBytes(pub).toBytes(false));
  } catch {
    throw coerceFailure("bytes", `${curve} public key`, "the point is not on the curve");
  }
}

/** ECDSA over a digest the caller computed: `r || s`, each `size` bytes, deterministic (RFC 6979), either half of s. */
export function sign(curve: string, d: Uint8Array, digest: Uint8Array, hash: string): Uint8Array {
  const ec = instance(curve, hash);
  checkSecret(ec, curve, d);
  checkBytes(digest, "the digest");
  return Uint8Array.from(
    ec.sign(digest, d, { prehash: false, lowS: false, format: "compact", extraEntropy: false }),
  );
}

/** True when `sig` (`r || s`, `size` bytes each) is a valid signature of the digest under the public key. */
export function verify(
  curve: string,
  pub: Uint8Array,
  digest: Uint8Array,
  sig: Uint8Array,
  hash: string,
): boolean {
  const ec = instance(curve, hash);
  checkBytes(digest, "the digest");
  checkBytes(sig, "the signature");
  if (!ec.utils.isValidPublicKey(checkBytes(pub, "the public key"), false))
    throw coerceFailure("bytes", `${curve} public key`, "the point is not on the curve");
  if (sig.length !== 2 * size(curve)) return false;
  try {
    return ec.verify(sig, digest, pub, { prehash: false, lowS: false, format: "compact" });
  } catch {
    return false;
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("ecdsa", "_size", "( curve:str -- int )", size, {
    doc: "The size in bytes of the order of an ECDSA curve (private helper of the ecdsa words).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_seed-length", "( curve:str -- int )", seedLength, {
    doc: "The seed length in bytes that _keygen wants for a curve (private helper).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_keygen", "( curve:str seed:bytes -- bytes )", keygen, {
    doc: "The private key (1 to the order minus 1) a seed of _seed-length bytes maps to (private helper).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_public-key", "( curve:str d:bytes -- bytes )", publicKey, {
    doc: "The uncompressed public point 04 || x || y of a private key (private helper).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_valid-point", "( curve:str pub:bytes -- bool )", validPoint, {
    doc: "True when the bytes are a point on the curve in the compressed or uncompressed form (private helper).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_uncompressed", "( curve:str pub:bytes -- bytes )", uncompressed, {
    doc: "The uncompressed form of a point on the curve; a point off the curve is E_COERCE (private helper).",
    category: "Public Key",
  }),
  definePrimitive("ecdsa", "_sign", "( curve:str d:bytes digest:bytes hash:str -- bytes )", sign, {
    doc: "Deterministic (RFC 6979) ECDSA of a digest, r || s fixed width (private helper of ecdsa:sign).",
    category: "Public Key",
  }),
  definePrimitive(
    "ecdsa",
    "_verify",
    "( curve:str pub:bytes digest:bytes sig:bytes hash:str -- bool )",
    verify,
    {
      doc: "True when r || s verifies over the digest (private helper of ecdsa:verify).",
      category: "Public Key",
    },
  ),
];
