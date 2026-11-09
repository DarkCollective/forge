import { expect, test } from "vitest";
import { FORGE_LANG_VERSION } from "./index.js";

test("exports the language version", () => {
  expect(FORGE_LANG_VERSION).toBe("0.0.0");
});
