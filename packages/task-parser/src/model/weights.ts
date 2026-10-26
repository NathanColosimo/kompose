/** Reads the runtime weight file written by training/model/export.py. */

export interface ModelConfig {
  /** "scratch" (pre-norm, default) or "electra" (pretrained post-norm). */
  arch?: "scratch" | "electra";
  dim: number;
  embedding_dim: number;
  ffn: number;
  heads: number;
  layers: number;
  max_positions: number;
}

/**
 * A row-major matrix; quantized matrices carry one scale per row. 4-bit
 * data packs two values per byte (low nibble first, stored +8).
 */
export interface Matrix {
  cols: number;
  data: Float32Array | Int8Array | Uint8Array;
  rows: number;
  scales: Float32Array | null;
}

export interface Weights {
  config: ModelConfig;
  tensors: Map<string, Matrix>;
  vocab: string[];
}

interface TensorEntry {
  dtype: "f32" | "i8" | "i4";
  name: string;
  offset: number;
  scales?: number;
  shape: number[];
}

const MAGIC = "KTP1";

/**
 * Dense layers are expanded to float32 once at load, which makes the inner
 * loops several times faster. The word table stays int8 (one row per token
 * is read per call).
 */
function unpack(matrix: Matrix, name: string): Matrix {
  if (!matrix.scales || name === "words.weight") {
    return matrix;
  }
  if (matrix.data instanceof Uint8Array) {
    throw new Error(`Only the word table may be 4-bit, not ${name}`);
  }
  const data = new Float32Array(matrix.rows * matrix.cols);
  for (let r = 0; r < matrix.rows; r += 1) {
    const scale = matrix.scales[r] as number;
    for (let c = 0; c < matrix.cols; c += 1) {
      const i = r * matrix.cols + c;
      data[i] = (matrix.data[i] as number) * scale;
    }
  }
  return { ...matrix, data, scales: null };
}

export function readWeights(buffer: ArrayBuffer): Weights {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error("Not a task parser weight file");
  }
  const headerLength = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))
  ) as {
    config: ModelConfig;
    tensors: TensorEntry[];
    vocab: string[];
  };
  const base = 8 + headerLength;
  const tensors = new Map<string, Matrix>();
  for (const entry of header.tensors) {
    const rows = entry.shape.length === 2 ? (entry.shape[0] ?? 1) : 1;
    const cols = entry.shape.at(-1) ?? 1;
    const count = rows * cols;
    const data = {
      f32: () => new Float32Array(buffer, base + entry.offset, count),
      i4: () => new Uint8Array(buffer, base + entry.offset, count / 2),
      i8: () => new Int8Array(buffer, base + entry.offset, count),
    }[entry.dtype]();
    const scales =
      entry.dtype !== "f32" && entry.scales !== undefined
        ? new Float32Array(buffer, base + entry.scales, rows)
        : null;
    tensors.set(entry.name, unpack({ cols, data, rows, scales }, entry.name));
  }
  return { config: header.config, tensors, vocab: header.vocab };
}
