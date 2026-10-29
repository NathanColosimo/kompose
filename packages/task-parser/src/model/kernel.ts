/**
 * The encoder's heavy lifting on WebAssembly SIMD (scripts/build-kernel.ts):
 * int8 dense layers, attention and layer norm.
 * Int8 weights stay int8: each token's activations are scaled to 7-bit
 * integers around their midpoint and multiplied in integer lanes (16
 * products per instruction with relaxed SIMD), so the model takes a quarter
 * of the memory of float32 and runs about twice as fast. Test-set accuracy
 * stays within half a point of float32.
 * Weights are copied into the module's memory once (place), padded;
 * activations are copied in and out per call.
 */
import { KERNEL_RELAXED_WASM, KERNEL_WASM } from "./kernel-wasm";
import type { Matrix } from "./weights";

/** Byte offsets, sizes and scalars, as documented in scripts/build-kernel.ts. */
type KernelFunction = (...args: number[]) => void;

interface Exports {
  attention: KernelFunction;
  dequantize: KernelFunction;
  gelu: KernelFunction;
  layer_norm: KernelFunction;
  linear: KernelFunction;
  memory: WebAssembly.Memory;
  quantize: KernelFunction;
}

/** Byte offsets of an int8 matrix and its per-row values (rows padded to 4). */
interface Placed {
  bias: number;
  rowSums: number;
  scales: number;
  weight: number;
}

const PAGE = 65_536;
const pad4 = (value: number) => Math.ceil(value / 4) * 4;

function instantiate(base64: string): Exports | null {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  if (!WebAssembly.validate(bytes)) {
    return null;
  }
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
  return instance.exports as unknown as Exports;
}

export class Kernel {
  readonly #exports: Exports;
  readonly #placed = new WeakMap<Matrix, Placed>();
  /** Byte offset of each layer norm's gain and bias already copied in. */
  readonly #placedVectors = new WeakMap<Float32Array, number>();
  /** First free byte; weights grow upward, scratch sits above them. */
  #top = 0;

  /**
   * The relaxed-SIMD kernel where supported (unless `relaxed` is false),
   * else the plain SIMD one. Throws without WebAssembly SIMD.
   */
  constructor({ relaxed = true } = {}) {
    const exports =
      (relaxed ? instantiate(KERNEL_RELAXED_WASM) : null) ??
      instantiate(KERNEL_WASM);
    if (!exports) {
      throw new Error("The task parser needs WebAssembly SIMD");
    }
    this.#exports = exports;
  }

  /**
   * Consecutive regions of the given byte sizes at the top, growing memory
   * as needed; returns their byte offsets. Scratch is reused by every call.
   */
  #scratch<Sizes extends number[]>(...sizes: Sizes) {
    const offsets: number[] = [];
    let end = this.#top;
    for (const size of sizes) {
      offsets.push(end);
      end += size;
    }
    const { memory } = this.#exports;
    if (end > memory.buffer.byteLength) {
      memory.grow(Math.ceil((end - memory.buffer.byteLength) / PAGE));
    }
    return offsets as { [K in keyof Sizes]: number };
  }

  #floats(at: number, length: number) {
    return new Float32Array(this.#exports.memory.buffer, at, length);
  }

  /** Copies `values` in at the top for good, zero-padded to `length`. */
  #append(values: Float32Array | Int8Array, length: number) {
    const at = this.#top;
    const bytes = pad4(length) * values.BYTES_PER_ELEMENT;
    this.#scratch(bytes);
    new Uint8Array(this.#exports.memory.buffer, at, bytes)
      .fill(0)
      .set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    this.#top += bytes;
    return at;
  }

  /**
   * Copies an int8 matrix (columns a multiple of 16) in with its row
   * scales, row sums and bias, then drops its own data so the weight file
   * it was read from can be freed.
   */
  place(weight: Matrix, bias: Float32Array) {
    const { cols } = weight;
    const data = weight.data as Int8Array;
    const rows = pad4(weight.rows);
    const rowSums = new Float32Array(weight.rows);
    for (let r = 0; r < weight.rows; r += 1) {
      for (const value of data.subarray(r * cols, (r + 1) * cols)) {
        rowSums[r] = (rowSums[r] as number) + value;
      }
    }
    this.#placed.set(weight, {
      bias: this.#append(bias, rows),
      rowSums: this.#append(rowSums, rows),
      scales: this.#append(weight.scales as Float32Array, rows),
      weight: this.#append(data, rows * cols),
    });
    weight.data = new Int8Array(0);
  }

  /**
   * out[n, rows] = x[n, cols] · Wᵀ + bias for a placed int8 W, then exact
   * GELU if `gelu`. Each token maps its [min, max] onto ±63 around its
   * midpoint, sent shifted into 0–126 (relaxed SIMD's int8 dot product is
   * exact on every CPU only for 7-bit unsigned second operands; x86 reads
   * them as unsigned bytes). The int32 sums are scaled back, with the
   * shift's and the midpoint's shares taken from W's row sums.
   */
  linear(x: Float32Array, n: number, weight: Matrix, gelu = false) {
    const { cols, rows } = weight;
    const placed = this.#placed.get(weight);
    if (!placed) {
      throw new Error("Weight not placed in the kernel");
    }
    const paddedN = pad4(n);
    const paddedRows = pad4(rows);
    const [xAt, qAt, metaAt, sumsAt, outAt] = this.#scratch(
      x.length * 4,
      paddedN * cols,
      paddedN * 8,
      paddedN * paddedRows * 4,
      paddedN * paddedRows * 4
    );
    this.#floats(xAt, x.length).set(x);
    this.#exports.quantize(xAt, n, cols, qAt, metaAt);
    // Rows past n are left as they were: their sums are never read.
    this.#exports.linear(qAt, paddedN, placed.weight, paddedRows, cols, sumsAt);
    this.#exports.dequantize(
      sumsAt,
      n,
      paddedRows,
      metaAt,
      placed.scales,
      placed.rowSums,
      placed.bias,
      outAt
    );
    if (gelu) {
      this.#exports.gelu(outAt, n * paddedRows);
    }
    const result = this.#floats(outAt, n * paddedRows);
    const out = new Float32Array(n * rows);
    for (let t = 0; t < n; t += 1) {
      out.set(result.subarray(t * paddedRows, t * paddedRows + rows), t * rows);
    }
    return out;
  }

  /**
   * Self-attention over every head: qkv [n, 3·dim] (queries, keys, values)
   * to [n, dim]. Head size must be a multiple of 16.
   */
  attention(qkv: Float32Array, n: number, dim: number, heads: number) {
    const [qkvAt, scoresAt, outAt] = this.#scratch(
      qkv.length * 4,
      (n + 4) * 4,
      n * dim * 4
    );
    this.#floats(qkvAt, qkv.length).set(qkv);
    this.#exports.attention(
      qkvAt,
      n,
      dim,
      heads,
      1 / Math.sqrt(dim / heads),
      scoresAt,
      outAt
    );
    return this.#floats(outAt, n * dim).slice();
  }

  #placeVector(values: Float32Array) {
    let offset = this.#placedVectors.get(values);
    if (offset === undefined) {
      offset = this.#append(values, values.length);
      this.#placedVectors.set(values, offset);
    }
    return offset;
  }

  /** Layer norm of each token of x [n, dim], dim (gain's length) a multiple of 4. */
  layerNorm(
    x: Float32Array,
    n: number,
    gain: Float32Array,
    bias: Float32Array,
    epsilon: number
  ) {
    const gainAt = this.#placeVector(gain);
    const biasAt = this.#placeVector(bias);
    const [xAt, outAt] = this.#scratch(x.length * 4, x.length * 4);
    this.#floats(xAt, x.length).set(x);
    this.#exports.layer_norm(
      xAt,
      n,
      gain.length,
      gainAt,
      biasAt,
      epsilon,
      outAt
    );
    return this.#floats(outAt, x.length).slice();
  }
}
