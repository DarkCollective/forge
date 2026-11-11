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
 * sm2 primitives: the point arithmetic of the SM2 curve (GB/T 32918.5-2017, the 256-bit recommended curve
 * sm2p256v1, OID 1.2.156.10197.1.301) over `@noble/curves`' generic short Weierstrass curve, for the SM2
 * public key encryption of GB/T 32918.4 in vocab/sm2.fth. The scalar multiplication of a 256-bit curve is far
 * beyond the FL step budget. Everything else is FL: SM3 (the `sm3` words), the key derivation function, the
 * C1C3C2 / C1C2C3 layouts and the randomness (`random:bytes-of`; this file never reads the host's generator,
 * and the curve is built with a `randomBytes` that throws, so the library does not blind and does not read it).
 *
 * Scalars are 32-byte big-endian numbers; points are the 65-byte uncompressed form `04 || x || y`.
 */
import { weierstrass } from "@noble/curves/abstract/weierstrass.js";
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const { normaliseInt } = valueHelpers;

const big = (hex: string): bigint => BigInt(`0x${hex}`);

/** The parameters of GB/T 32918.5-2017 (checked against `openssl ecparam -name SM2 -param_enc explicit`). */
export const SM2_PARAMS = {
  p: big("fffffffeffffffffffffffffffffffffffffffff00000000ffffffffffffffff"),
  a: big("fffffffeffffffffffffffffffffffffffffffff00000000fffffffffffffffc"),
  b: big("28e9fa9e9d9f5e344d5a9e4bcf6509a7f39789f515ab8f92ddbcbd414d940e93"),
  n: big("fffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123"),
  h: 1n,
  Gx: big("32c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7"),
  Gy: big("bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0"),
};

function noRandom(): never {
  throw new Error("no host randomness");
}

let cached: ReturnType<typeof weierstrass<bigint>> | undefined;
function point() {
  cached ??= weierstrass(SM2_PARAMS, { randomBytes: noRandom });
  return cached;
}

function scalar(k: unknown, what: string): bigint {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw rangeFailure(`${what} must be 32 bytes`);
  let v = 0n;
  for (const b of k) v = (v << 8n) | BigInt(b);
  if (v < 1n || v >= SM2_PARAMS.n)
    throw rangeFailure(`${what} must be a number from 1 to the order of the curve minus 1`);
  return v;
}

function fromBytes(p: unknown, what: string) {
  if (!(p instanceof Uint8Array) || p.length !== 65 || p[0] !== 4)
    throw coerceFailure("bytes", "SM2 point", `${what} must be 65 bytes: 04, x and y`);
  try {
    const pt = point().fromBytes(p);
    pt.assertValidity();
    return pt;
  } catch {
    throw coerceFailure("bytes", "SM2 point", `${what} is not a point on the SM2 curve`);
  }
}

/** The order of the curve, n (the largest private key is n - 1). */
export function order(): number | bigint {
  return normaliseInt(SM2_PARAMS.n);
}

/** k * G as the 65-byte point; k is 1 to n - 1. */
export function mulBase(k: Uint8Array): Uint8Array {
  return Uint8Array.from(point().BASE.multiply(scalar(k, "the SM2 scalar")).toBytes(false));
}

/** k * P as the 65-byte point; P must be on the curve, k is 1 to n - 1. */
export function mul(p: Uint8Array, k: Uint8Array): Uint8Array {
  const pt = fromBytes(p, "the point");
  return Uint8Array.from(pt.multiply(scalar(k, "the SM2 scalar")).toBytes(false));
}

/** True when the bytes are an uncompressed point (04 || x || y) on the curve. */
export function validPoint(p: Uint8Array): boolean {
  try {
    fromBytes(p, "the point");
    return true;
  } catch {
    return false;
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sm2", "_order", "( -- int )", order, {
    doc: "The order n of the SM2 curve (private helper of the sm2 words).",
    category: "Public Key",
  }),
  definePrimitive("sm2", "_mul-base", "( k:bytes -- bytes )", mulBase, {
    doc: "k times the base point as 04 || x || y, k being 32 bytes from 1 to n - 1 (private helper).",
    category: "Public Key",
  }),
  definePrimitive("sm2", "_mul", "( point:bytes k:bytes -- bytes )", mul, {
    doc: "k times a point on the SM2 curve, both as in _mul-base (private helper).",
    category: "Public Key",
  }),
  definePrimitive("sm2", "_valid-point", "( point:bytes -- bool )", validPoint, {
    doc: "True when the bytes are 04 || x || y of a point on the SM2 curve (private helper).",
    category: "Public Key",
  }),
];
