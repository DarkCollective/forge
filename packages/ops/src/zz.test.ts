import { valueHelpers } from "@forge/lang";
import { test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";
import { readFileSync, writeFileSync } from "node:fs";
const { bytes, int, str, bool } = valueHelpers;
test("zz", async () => {
  const out: string[] = [];
  const bundle = await loadBundleNode(["packets","http","ip","mac","netbios","defang","uri","user-agent","fingerprint","hassh","varint","protobuf"]);
  const rt = assembleRuntime(bundle);
  const cases = JSON.parse(readFileSync(process.env.ZZ!, "utf8"));
  for (const c of cases) {
    const strFirst = /^(ip:|mac:|defang:|uri:|user-agent:|varint:encode)/.test(c.op);
    const args = c.args.map((a: any, i: number) => typeof a === "boolean" ? bool(a) : typeof a === "string" ? (i === 0 && !strFirst ? bytes(Buffer.from(a, c.enc ?? "utf8")) : str(a)) : typeof a === "number" ? int(BigInt(a)) : a);
    const r = await rt.call(c.op, args);
    out.push(r.ok ? Array.from(r.stack).map((x: any) => x.v instanceof Uint8Array ? "bytes:" + Buffer.from(x.v).toString("latin1") : String(x.v)).join(" | ") : r.error.code + ": " + r.error.message);
  }
  writeFileSync(process.env.ZZ + ".out", JSON.stringify(out));
});
