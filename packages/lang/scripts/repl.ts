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
 * The FL console (WP 1.9): a read-eval-print loop over one persistent runtime.
 *
 * Each line goes to `runtime.run`. The data stack and the variable store persist between lines.
 * A line that leaves a colon definition open (more `:` than `;`) continues on the next line.
 * Errors are printed with `formatErrorMessage` and leave the stack as it was before the line.
 *
 * Only Node built-ins are used. The script runs against the built library (`dist/index.js`), so
 * build first: `npm run repl` at the repository root does that and starts the console.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  createRuntime,
  formatErrorMessage,
  isForgeError,
  read,
  type Diagnostic,
  type ForgeRuntime,
  type Token,
  type Value,
} from "../dist/index.js";

const HELP = `FL console. Type FL source at the prompt; the data stack is shown after each line.
Meta-commands:
  .load <file>   compile a source unit into the session (its warnings are printed)
  .help          show this help
  .quit          leave the console (Ctrl-D does the same)
A line with an unclosed ':' continues on the next line (prompt "... ") until its ';'.`;

const META_COMMANDS = [".load", ".help", ".quit"];

/** Net number of colon definitions left open by `source`: each `:` word opens one, each `;` closes one. */
function openDefinitions(source: string): number {
  let tokens: readonly Token[];
  try {
    tokens = read(source);
  } catch {
    // A lexical error is reported when the text is run, so treat the text as complete here.
    return 0;
  }
  let depth = 0;
  for (const token of tokens) {
    if (token.kind !== "word") continue;
    if (token.text === ":") depth++;
    else if (token.text === ";") depth--;
  }
  return depth;
}

function printWarnings(warnings: readonly Diagnostic[]): void {
  for (const w of warnings) {
    const at = w.pos ? ` at ${w.pos.line}:${w.pos.col}` : "";
    process.stdout.write(`warning ${w.code}: ${w.message}${at}\n`);
  }
}

function loadFile(runtime: ForgeRuntime, file: string): void {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch (e) {
    process.stdout.write(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}\n`);
    return;
  }
  try {
    const result = runtime.load(source, { unit: file });
    printWarnings(result.warnings);
    process.stdout.write(`loaded ${file}: ${result.defined.length} definition(s)\n`);
  } catch (e) {
    if (!isForgeError(e)) throw e;
    process.stdout.write(`${formatErrorMessage(e)}\n`);
  }
}

async function main(): Promise<void> {
  const runtime = createRuntime();
  // The session state: the stack (deepest first) and the variable store shared by every line.
  let stack: readonly Value[] = [];
  const vars = new Map<string, Value>();
  // Lines of a colon definition that is not closed yet.
  let pending = "";

  // Prompts and line editing only when a person types; piped input runs without prompts.
  const interactive = process.stdin.isTTY === true;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  });
  const showPrompt = (): void => {
    if (!interactive) return;
    rl.setPrompt(pending === "" ? `${runtime.currentVocab()}> ` : "... ");
    rl.prompt();
  };

  // Ctrl-C drops an unfinished definition; without one it leaves the console.
  rl.on("SIGINT", () => {
    if (pending === "") {
      rl.close();
      return;
    }
    pending = "";
    process.stdout.write("\n");
    showPrompt();
  });

  const evaluate = async (source: string): Promise<void> => {
    const result = await runtime.run(source, { stack, vars });
    if (result.output !== "") process.stdout.write(result.output);
    if (!result.ok) {
      process.stdout.write(`${formatErrorMessage(result.error)}\n`);
      return;
    }
    stack = [...result.stack];
    const shown = await runtime.run(".s", { stack });
    process.stdout.write(shown.output);
  };

  showPrompt();
  for await (const line of rl) {
    const command = line.trim().split(/\s+/)[0] ?? "";
    if (command === ".quit") break;
    if (pending === "" && META_COMMANDS.includes(command)) {
      if (command === ".help") process.stdout.write(`${HELP}\n`);
      else if (command === ".load") {
        const file = line.trim().slice(".load".length).trim();
        if (file === "") process.stdout.write("usage: .load <file>\n");
        else loadFile(runtime, file);
      }
    } else {
      const source = pending === "" ? line : `${pending}\n${line}`;
      if (openDefinitions(source) > 0) {
        pending = source;
      } else {
        pending = "";
        await evaluate(source);
      }
    }
    showPrompt();
  }

  // End of input with a definition still open: run it so its syntax error is reported.
  if (pending !== "") await evaluate(pending);
  if (interactive) process.stdout.write("\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exitCode = 1;
});
