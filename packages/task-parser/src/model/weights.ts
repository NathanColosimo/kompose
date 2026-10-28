/** Reads the runtime weight file written by training/model/export.py. */

export interface ModelConfig {
  dim: number;
  heads: number;
  layers: number;
  max_positions: number;
}

/** A row-major matrix; int8 matrices carry one scale per row. */
export interface Matrix {
  cols: number;
  data: Float32Array | Int8Array;
  rows: number;
  scales: Float32Array | null;
}

export interface Weights {
  config: ModelConfig;
  tensors: Map<string, Matrix>;
  vocab: string[];
}

interface TensorEntry {
  dtype: "f32" | "i8";
  name: string;
  offset: number;
  scales?: number;
  shape: number[];
}

const MAGIC = "KTP1";

export function readWeights(buffer: ArrayBuffer): Weights {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error("Not a task parser weight file");
  }
  const headerLength = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))
  ) as { config: ModelConfig; tensors: TensorEntry[]; vocab: string[] };
  const base = 8 + headerLength;
  const tensors = new Map<string, Matrix>();
  for (const entry of header.tensors) {
    const rows = entry.shape.length === 2 ? (entry.shape[0] ?? 1) : 1;
    const cols = entry.shape.at(-1) ?? 1;
    const at = base + entry.offset;
    // Dense int8 layers stay views of the file: the kernel copies them into
    // its own memory and releases them (network.ts placeWeights), so the
    // file can be freed. Everything else is copied out now.
    let data: Float32Array | Int8Array;
    if (entry.dtype === "f32") {
      data = new Float32Array(buffer.slice(at, at + rows * cols * 4));
    } else if (entry.name === "words.weight") {
      data = new Int8Array(buffer.slice(at, at + rows * cols));
    } else {
      data = new Int8Array(buffer, at, rows * cols);
    }
    const scales =
      entry.scales === undefined
        ? null
        : new Float32Array(
            buffer.slice(base + entry.scales, base + entry.scales + rows * 4)
          );
    tensors.set(entry.name, { cols, data, rows, scales });
  }
  return { config: header.config, tensors, vocab: header.vocab };
}
