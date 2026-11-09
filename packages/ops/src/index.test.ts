import { expect, test } from "vitest";
import { FORGE_OPS_PLACEHOLDER } from "./index.js";

test("placeholder export exists", () => {
  expect(FORGE_OPS_PLACEHOLDER).toBe(true);
});
