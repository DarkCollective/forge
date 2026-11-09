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

// The package builds against ES2022 only (no DOM or Node typings). These are the few host globals it
// uses; browsers, Web Workers and Node 20 all provide them.

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

interface ReadableStreamDefaultReaderLike<T> {
  read(): Promise<{ done: boolean; value?: T }>;
  cancel(reason?: unknown): Promise<void>;
}

interface WritableStreamDefaultWriterLike<T> {
  write(chunk: T): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface ReadableStreamLike<T> {
  getReader(): ReadableStreamDefaultReaderLike<T>;
}

interface WritableStreamLike<T> {
  getWriter(): WritableStreamDefaultWriterLike<T>;
}

declare class CompressionStream {
  constructor(format: "deflate-raw");
  readonly readable: ReadableStreamLike<Uint8Array>;
  readonly writable: WritableStreamLike<Uint8Array>;
}

declare class DecompressionStream {
  constructor(format: "deflate-raw");
  readonly readable: ReadableStreamLike<Uint8Array>;
  readonly writable: WritableStreamLike<Uint8Array>;
}
