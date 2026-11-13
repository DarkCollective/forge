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
// Extra HTML entry points of the build (UI.md section 2.3). Owned by the "site pages" work package:
// it adds one line per page, key = output name, value = path of the page's index.html relative to
// apps/web. The shell's vite.config.ts feeds this to rollup.
export const pageInputs: Record<string, string> = {
  about: "./pages/about/index.html",
  privacy: "./pages/privacy/index.html",
  terms: "./pages/terms/index.html",
  security: "./pages/security/index.html",
  accessibility: "./pages/accessibility/index.html",
  notFound: "./pages/404/index.html",
};

// The template of the generated operation reference pages (UI.md section 8.2). It is built like a page,
// so its stylesheets and script get hashed names, but it is not one: vite.reference.ts fills it in for
// each operation under dist/ops/ and removes it. Kept apart from pageInputs because it is not moved.
export const referenceTemplateInput: Record<string, string> = {
  opsTemplate: "./pages/ops/template/index.html",
};
