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
import { defineConfig } from "vitest/config";

// The tests use the built packages (@forge/lang, ops, recipe) and the built worker entry
// (dist/worker-node.js), so they run after `npm run typecheck` or `npm run build`.
export default defineConfig({
  test: {
    name: "worker",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // The GitHub runner is about 3x slower than a dev machine under full-suite load; the 5 s default caused CI run 42931777004 to fail.
    // Tests that start worker threads or wait for the watchdog set their own, larger timeouts.
    testTimeout: 30_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/types.ts",
        "src/ambient.d.ts",
        "src/worker-web.ts",
        "src/worker-node.ts",
      ],
    },
  },
});
