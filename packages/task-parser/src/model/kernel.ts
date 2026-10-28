/**
 * The encoder's heavy lifting on WebAssembly SIMD (scripts/build-kernel.ts):
 * int8 dense layers, attention and layer norm.
 * Int8 weights stay int8: each token's activations are scaled to 7-bit
 * integers around their midpoint and multiplied in integer lanes (16
 * products per instruction with relaxed SIMD), so the model takes a quarter
 * of the memory of float32 and runs about twice as fast. Test-set accuracy
 * stays within half a point of float32.
 * Weights are copied into the module's memory once (placeWeights), padded;
 * activations are copied in and out per call.
 */
import { KERNEL_RELAXED_WASM, KERNEL_WASM } from "./kernel-wasm";
import type { Matrix } from "./weights";

interface Exports {
  attention: (
    qkv: number,
    n: number,
    dim: number,
    heads: number,
    scale: number,
    scores: number,
    out: number
  ) => void;
  dequantize: (
    sums: number,
    n: number,
    rows: number,
    meta: number,
    scales: number,
    rowSums: number,
    bias: number,
    out: number
  ) => void;
  gelu: (at: number, count: number) => void;
  layer_norm: (
    x: number,
    n: number,
    dim: number,
    gain: number,
    bias: number,
    epsilon: number,
    out: number
  ) => void;
  linear: (
    x: number,
    n: number,
    w: number,
    rows: number,
    cols: number,
    out: number
  ) => void;
  memory: WebAssembly.Memory;
  quantize: (
    x: number,
    n: number,
    cols: number,
    q: number,
    meta: number
  ) => void;
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

  #reserve(bytes: number) {
    const { memory } = this.#exports;
    const needed = this.#top + bytes - memory.buffer.byteLength;
    if (needed > 0) {
      memory.grow(Math.ceil(needed / PAGE));
    }
  }

  /** Copies float32 values in at the top, zero-padded to `length`. */
  #append(values: Float32Array, length: number) {
    const offset = this.#top;
    this.#reserve(length * 4);
    new Float32Array(this.#exports.memory.buffer, offset, length)
      .fill(0)
      .set(values);
    this.#top += pad4(length) * 4;
    return offset;
  }

  /**
   * Copies an int8 matrix (columns a multiple of 16) in with its row
   * scales, row sums and bias, then drops its own data so the weight file
   * it was read from can be freed.
   */
  place(weight: Matrix, bias: Float32Array | undefined) {
    const data = weight.data as Int8Array;
    const rows = pad4(weight.rows);
    const offset = this.#top;
    this.#reserve(rows * weight.cols);
    new Int8Array(this.#exports.memory.buffer, offset, rows * weight.cols)
      .fill(0)
      .set(data);
    this.#top += rows * weight.cols;
    const rowSums = new Float32Array(weight.rows);
    for (let i = 0; i < data.length; i += 1) {
      const r = Math.floor(i / weight.cols);
      rowSums[r] = (rowSums[r] as number) + (data[i] as number);
    }
    this.#placed.set(weight, {
      bias: this.#append(bias ?? new Float32Array(0), rows),
      rowSums: this.#append(rowSums, rows),
      scales: this.#append(weight.scales as Float32Array, rows),
      weight: offset,
    });
    weight.data = new Int8Array(0);
  }

  /**
   * out[n, rows] = x[n, cols] · Wᵀ + bias for a placed int8 W, then exact
   * GELU if `gelu`. Each token maps its [min, max] onto ±63 around its
   * midpoint (relaxed SIMD's int8 dot product is exact on every CPU only
   * for 7-bit second operands); the int32 sums are scaled back and the
   * midpoint's share added from W's row sums.
   */
  linear(x: Float32Array, n: number, weight: Matrix, gelu = false) {
    const { cols, rows } = weight;
    const placed = this.#placed.get(weight);
    if (!placed) {
      throw new Error("Weight not placed in the kernel");
    }
    const paddedN = pad4(n);
    const paddedRows = pad4(rows);
    const xAt = this.#top;
    const qAt = xAt + n * cols * 4;
    const metaAt = qAt + paddedN * cols;
    const sumsAt = metaAt + paddedN * 8;
    const outAt = sumsAt + paddedN * paddedRows * 4;
    this.#reserve(outAt + paddedN * paddedRows * 4 - xAt);
    const { buffer } = this.#exports.memory;
    new Float32Array(buffer, xAt, n * cols).set(x.subarray(0, n * cols));
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
    const result = new Float32Array(buffer, outAt, n * paddedRows);
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
    const qkvAt = this.#top;
    const scoresAt = qkvAt + n * 3 * dim * 4;
    const outAt = scoresAt + (n + 4) * 4;
    this.#reserve(outAt + n * dim * 4 - qkvAt);
    const { buffer } = this.#exports.memory;
    new Float32Array(buffer, qkvAt, n * 3 * dim).set(
      qkv.subarray(0, n * 3 * dim)
    );
    this.#exports.attention(
      qkvAt,
      n,
      dim,
      heads,
      1 / Math.sqrt(dim / heads),
      scoresAt,
      outAt
    );
    return new Float32Array(buffer, outAt, n * dim).slice();
  }

  #placeVector(values: Float32Array) {
    let offset = this.#placedVectors.get(values);
    if (offset === undefined) {
      offset = this.#append(values, values.length);
      this.#placedVectors.set(values, offset);
    }
    return offset;
  }

  /** Layer norm of each token of x [n, dim] (dim a multiple of 4). */
  layerNorm(
    x: Float32Array,
    n: number,
    dim: number,
    gain: Float32Array,
    bias: Float32Array,
    epsilon: number
  ) {
    const gainAt = this.#placeVector(gain);
    const biasAt = this.#placeVector(bias);
    const xAt = this.#top;
    const outAt = xAt + n * dim * 4;
    this.#reserve(n * dim * 8);
    const { buffer } = this.#exports.memory;
    new Float32Array(buffer, xAt, n * dim).set(x.subarray(0, n * dim));
    this.#exports.layer_norm(xAt, n, dim, gainAt, biasAt, epsilon, outAt);
    return new Float32Array(buffer, outAt, n * dim).slice();
  }
}
