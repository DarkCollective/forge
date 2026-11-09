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
import { defineConfig } from "vite";

// The harness page of Gate 2 (G2-5). `scripts/gate2-browser.mjs` adds the COOP and COEP headers
// (or not) when it starts the server. Primitive modules are lazy chunks, which a worker can only
// load as an ES module.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022" },
});
