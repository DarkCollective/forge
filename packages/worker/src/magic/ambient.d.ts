// Host APIs the Magic engine uses that ../ambient.d.ts does not declare (every supported host has them).
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare function btoa(data: string): string;
