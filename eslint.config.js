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
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// ---------------------------------------------------------------------------------------------------------------------
// Pack guard rails (PACKS.md sections 3.5 and 8.5)
//
// 1. Core never imports a pack: a static import of `@forge/pack-*`, or of a file under `packs/<id>/`, fails lint in every
//    file that is not itself a pack. (The two generated registries import pack fragments as `?url` and pack entries by
//    literal `import()`: they are the one place, and the Vite plugin `forgePacks()` still fails the build on a static
//    edge from the core entry graph into `packs/`.)
// 2. Pack sources (`packs/*/src/**`) may not use the APIs that would let a pack reach outside its sandbox. These rules
//    are guard rails against mistakes and the careless attacker, not a security boundary (PACKS.md section 8.3).
// ---------------------------------------------------------------------------------------------------------------------

const PACK_IMPORT_MESSAGE =
  "Core must not import a pack. Packs are reached only through the dynamic imports of the generated registries (PACKS.md section 3).";

const noPackImports = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: ["@forge/pack-*", "@forge/pack-*/**"], message: PACK_IMPORT_MESSAGE },
        {
          regex:
            "(^|/)packs/[^/]+/(src|dist|vocab|engine|test|manifest\\.json|package\\.json)(/|$)",
          message: PACK_IMPORT_MESSAGE,
        },
      ],
    },
  ],
};

/** The browser globals a pack may not use, and why (PACKS.md section 8.5). `allowNetwork` keeps `fetch` for the one file module. */
const packGlobals = (allowNetwork) => [
  ...(allowNetwork
    ? []
    : ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((name) => ({
        name,
        message: "A pack may not use the network; non-JS pack files are read in src/files.ts only.",
      }))),
  ...["localStorage", "sessionStorage", "indexedDB", "caches"].map((name) => ({
    name,
    message: "A pack may not use browser storage; the host owns persistence.",
  })),
  { name: "DOMParser", message: "A pack may not parse markup with DOMParser." },
  { name: "importScripts", message: "A pack may not load scripts with importScripts." },
  { name: "eval", message: "A pack may not use eval." },
];

const WINDOWS = ["window", "globalThis", "self"];

const packProperties = (allowNetwork) => [
  ...(allowNetwork
    ? []
    : WINDOWS.flatMap((object) =>
        ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((property) => ({
          object,
          property,
          message: "A pack may not use the network.",
        })),
      )),
  ...(allowNetwork
    ? []
    : [
        { object: "navigator", property: "sendBeacon", message: "A pack may not use the network." },
      ]),
  ...WINDOWS.flatMap((object) =>
    ["localStorage", "sessionStorage", "indexedDB", "caches"].map((property) => ({
      object,
      property,
      message: "A pack may not use browser storage.",
    })),
  ),
  { object: "document", property: "cookie", message: "A pack may not use cookies." },
  {
    object: "Range",
    property: "createContextualFragment",
    message: "A pack may not build markup.",
  },
];

const packSyntax = [
  {
    selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
    message: "A pack may not assign innerHTML or outerHTML.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]",
    message: "A pack may not build markup from strings.",
  },
  {
    selector:
      "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln|open)$/]",
    message: "A pack may not use document.write.",
  },
  {
    selector:
      "CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name='open']",
    message: "A pack may not open windows.",
  },
  {
    selector:
      "CallExpression[callee.object.name='history'][callee.property.name=/^(pushState|replaceState|back|forward|go)$/]",
    message: "A pack may not navigate.",
  },
  {
    selector:
      "CallExpression[callee.object.property.name='history'][callee.property.name=/^(pushState|replaceState|back|forward|go)$/]",
    message: "A pack may not navigate.",
  },
  {
    selector: "AssignmentExpression[left.name='location']",
    message: "A pack may not write location.",
  },
  {
    selector: "AssignmentExpression[left.object.name='location']",
    message: "A pack may not write location.",
  },
  {
    selector: "AssignmentExpression[left.object.property.name='location']",
    message: "A pack may not write location.",
  },
  {
    selector:
      "AssignmentExpression[left.property.name='location'][left.object.name=/^(window|document|globalThis|self)$/]",
    message: "A pack may not write location.",
  },
  {
    selector:
      "CallExpression[callee.property.name='createElement'][arguments.0.value=/^(a|form)$/i]",
    message: "A pack may not create links or forms: their targets cannot be checked here.",
  },
  {
    selector:
      "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral|BinaryExpression)$/]",
    message: "A pack may not pass a string to setTimeout or setInterval.",
  },
  {
    selector:
      "CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral|BinaryExpression)$/]",
    message: "A pack may not pass a string to setTimeout or setInterval.",
  },
  {
    selector: "ImportExpression:not([source.type='Literal'])",
    message:
      "A pack may only import() a string literal: the build must see every chunk (PACKS.md section 3.4).",
  },
];

const packRules = (allowNetwork) => ({
  "no-eval": "error",
  "no-new-func": "error",
  "no-implied-eval": "error",
  "no-restricted-globals": ["error", ...packGlobals(allowNetwork)],
  "no-restricted-properties": ["error", ...packProperties(allowNetwork)],
  "no-restricted-syntax": ["error", ...packSyntax],
});

const PACK_SOURCES = ["packs/*/src/**/*.{ts,tsx,js,mjs}"];
const PACK_TESTS = ["packs/*/src/**/*.test.*", "packs/*/test/**"];
const PACK_FILE_MODULE = ["packs/*/src/files.{ts,js}"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-scripts/**",
      "**/coverage/**",
      "packages/ops/src/vendor/**",
      "**/node_modules/**",
      "infra/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  // core never imports a pack
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["packs/**"],
    rules: noPackImports,
  },
  {
    files: [
      "apps/web/src/packs/registry.generated.ts",
      "apps/web/src/bake/worker-packs.generated.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // what a pack may not do
  { files: PACK_SOURCES, ignores: PACK_TESTS, rules: packRules(false) },
  { files: PACK_FILE_MODULE, ignores: PACK_TESTS, rules: packRules(true) },
);
