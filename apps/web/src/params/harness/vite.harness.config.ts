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
// Manual harness for `forge-param-form`. In apps/web:
//   HARNESS_OUT=/tmp/harness npx vite build --config src/params/harness/vite.harness.config.ts
//   HARNESS_OUT=/tmp/harness npx vite preview --config src/params/harness/vite.harness.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  build: {
    outDir: process.env.HARNESS_OUT ?? "dist-harness",
    emptyOutDir: true,
    target: "es2022",
  },
  preview: { port: 4399 },
});
