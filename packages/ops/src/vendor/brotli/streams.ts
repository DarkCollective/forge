// @ts-nocheck: Modified by Darkcollective, LLC, 2026: type-check pragma (vendored upstream JavaScript, brotli 2.1.0; see NOTICE and the vendor note in packages/ops/README.md).
export class BrotliInput {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }
  read(buf, i, count) {
    if (this.pos + count > this.buffer.length) {
      count = this.buffer.length - this.pos;
    }

    for (var p = 0; p < count; p++)
      buf[i + p] = this.buffer[this.pos + p];

    this.pos += count;
    return count;
  }
}


// Modified by Darkcollective, LLC, 2026: output cap. `max` is the most bytes the output may hold; a
// write that would pass it raises the wave 6 bomb error (E_LIMIT_VALUE) before any copy.
import { bombFailure } from '../../prim-util.js';

export class BrotliOutput {
  constructor(buf, max) {
    this.buffer = buf;
    this.pos = 0;
    this.max = max;
  }
  write(buf, count) {
    if (this.pos + count > this.buffer.length) {
      if (this.pos + count > this.max) throw bombFailure(this.max, this.pos + count);
      throw new Error('Output buffer is not large enough');
    }

    this.buffer.set(buf.subarray(0, count), this.pos);
    this.pos += count;
    return count;
  }
}


