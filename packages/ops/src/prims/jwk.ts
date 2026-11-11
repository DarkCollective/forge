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
 * jwk primitives: the elliptic curve arithmetic behind PEM to JWK and JWK to PEM, over @noble/curves (imported from
 * the subpath modules, as the Wave 7 conventions say). Everything else (the key containers, base64url, the JSON) is
 * FL in vocab/jwk.fth. Two things need a curve: a private key in PKCS #8 or SEC 1 that does not carry its public key
 * (every Ed25519, X25519, Ed448 and X448 key, and an EC key written without the optional public part) needs the
 * public key derived from the private one, and a JWK's x and y should be checked to be a point of the curve before
 * they are written into a PEM.
 *
 *  - `_public ( crv:str d:bytes -- bytes )`: the public key of a private key. For P-256, P-384, P-521 and secp256k1
 *    the uncompressed point (04, x, y); for Ed25519, X25519, Ed448 and X448 the public key bytes. A private key of
 *    the wrong length, or outside the range of the curve, is E_COERCE; an unknown curve is E_RANGE.
 *  - `_on-curve ( crv:str point:bytes -- bool )`: whether an uncompressed point is on the curve (the public key
 *    bytes of the other curves are not checked: any 32 bytes are an X25519 key).
 * The library never reads the host's random generator in either call.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { ed448, x448 } from "@noble/curves/ed448.js";
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { coerceFailure, rangeFailure } from "../prim-util.js";

interface Weierstrass {
  getPublicKey(secretKey: Uint8Array, isCompressed?: boolean): Uint8Array;
  Point: { fromBytes(bytes: Uint8Array): unknown };
}

const WEIERSTRASS: Readonly<Record<string, Weierstrass>> = {
  "P-256": p256,
  "P-384": p384,
  "P-521": p521,
  secp256k1,
};

const MONTGOMERY_EDWARDS: Readonly<
  Record<string, { size: number; getPublicKey(secretKey: Uint8Array): Uint8Array }>
> = {
  Ed25519: { size: 32, getPublicKey: (k) => ed25519.getPublicKey(k) },
  X25519: { size: 32, getPublicKey: (k) => x25519.getPublicKey(k) },
  Ed448: { size: 57, getPublicKey: (k) => ed448.getPublicKey(k) },
  X448: { size: 56, getPublicKey: (k) => x448.getPublicKey(k) },
};

/** The public key of the private key d on the named curve. */
export function publicKey(crv: string, d: Uint8Array): Uint8Array {
  const w = WEIERSTRASS[crv];
  if (w !== undefined) {
    try {
      return w.getPublicKey(d, false);
    } catch (e) {
      throw coerceFailure(
        "bytes",
        "key",
        `the ${crv} private key is not valid: ${(e as Error).message}`,
      );
    }
  }
  const o = MONTGOMERY_EDWARDS[crv];
  if (o === undefined) throw rangeFailure(`unknown curve '${crv}'`);
  if (d.length !== o.size)
    throw coerceFailure("bytes", "key", `a ${crv} private key is ${o.size} bytes, not ${d.length}`);
  return o.getPublicKey(d);
}

/** Whether the uncompressed point is on the named curve. */
export function onCurve(crv: string, point: Uint8Array): boolean {
  const w = WEIERSTRASS[crv];
  if (w === undefined) {
    if (MONTGOMERY_EDWARDS[crv] === undefined) throw rangeFailure(`unknown curve '${crv}'`);
    return true;
  }
  try {
    w.Point.fromBytes(point);
    return true;
  } catch {
    return false;
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "jwk",
    "_public",
    "( crv:str d:bytes -- bytes )",
    (crv: string, d: Uint8Array) => publicKey(crv, d),
    {
      doc: "The public key of a private key (private helper of jwk:from-pem): the uncompressed point 04, x, y for P-256, P-384, P-521 and secp256k1; the public key bytes for Ed25519, X25519, Ed448 and X448. A private key that is not valid for the curve is E_COERCE.",
    },
  ),
  definePrimitive(
    "jwk",
    "_on-curve",
    "( crv:str point:bytes -- bool )",
    (crv: string, point: Uint8Array) => onCurve(crv, point),
    {
      doc: "Whether an uncompressed elliptic curve point is on the named curve (private helper of jwk:to-pem); true for the curves that have no point check (Ed25519, X25519, Ed448, X448).",
    },
  ),
];
