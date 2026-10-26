/**
 * Dense layers on WebAssembly SIMD (scripts/build-kernel.ts): 4 tokens × 4
 * outputs per step with f32x4 lanes (fused multiply-add where relaxed SIMD
 * is available), several times faster than plain JS.
 * Weights are copied into the module's memory on first use, padded to
 * multiples of 4; activations are copied in and out per call.
 */
import { KERNEL_FMA_WASM, KERNEL_WASM } from "./kernel-wasm";
import type { Matrix } from "./weights";

interface Exports {
  linear: (
    x: number,
    n: number,
    w: number,
    rows: number,
    cols: number,
    out: number
  ) => void;
  memory: WebAssembly.Memory;
}

const PAGE = 65_536;
const pad4 = (value: number) => Math.ceil(value / 4) * 4;

function instantiate(base64: string): Exports | null {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    if (!WebAssembly.validate(bytes)) {
      return null;
    }
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
    return instance.exports as unknown as Exports;
  } catch {
    return null;
  }
}

export class Kernel {
  readonly #exports: Exports;
  /** Byte offset of each weight matrix already copied in. */
  readonly #placed = new WeakMap<Matrix, number>();
  /** First free byte; weights grow upward, scratch sits above them. */
  #top = 0;

  private constructor(exports: Exports) {
    this.#exports = exports;
  }

  /**
   * The fused kernel where relaxed SIMD is supported, else the plain one;
   * null without WebAssembly SIMD (the JS kernel is used instead).
   */
  static create(): Kernel | null {
    const exports = instantiate(KERNEL_FMA_WASM) ?? instantiate(KERNEL_WASM);
    return exports ? new Kernel(exports) : null;
  }

  /** Whether `weight` can run here (float32, columns a multiple of 4). */
  supports(weight: Matrix) {
    return weight.data instanceof Float32Array && weight.cols % 4 === 0;
  }

  #reserve(bytes: number) {
    const { memory } = this.#exports;
    const needed = this.#top + bytes - memory.buffer.byteLength;
    if (needed > 0) {
      memory.grow(Math.ceil(needed / PAGE));
    }
  }

  #place(weight: Matrix) {
    const found = this.#placed.get(weight);
    if (found !== undefined) {
      return found;
    }
    const rows = pad4(weight.rows);
    const offset = this.#top;
    this.#reserve(rows * weight.cols * 4);
    new Float32Array(this.#exports.memory.buffer, offset, rows * weight.cols)
      .fill(0)
      .set(weight.data as Float32Array);
    this.#top += rows * weight.cols * 4;
    this.#placed.set(weight, offset);
    return offset;
  }

  /** Copies `rows` × `cols` values into memory at `at` with a padded stride. */
  #write(at: number, values: Float32Array, rows: number, cols: number) {
    const stride = pad4(cols);
    const target = new Float32Array(
      this.#exports.memory.buffer,
      at,
      pad4(rows) * stride
    );
    if (stride === cols) {
      target.set(values.subarray(0, rows * cols));
      target.fill(0, rows * cols);
      return;
    }
    target.fill(0);
    for (let r = 0; r < rows; r += 1) {
      target.set(values.subarray(r * cols, (r + 1) * cols), r * stride);
    }
  }

  /**
   * a[n, cols] · w[rows, cols]ᵀ. `w` is a placed weight's byte offset, or
   * values to copy in for this call.
   */
  #run(
    a: Float32Array,
    n: number,
    w: number | Float32Array,
    rows: number,
    cols: number,
    bias?: Float32Array
  ) {
    const stride = pad4(cols);
    const paddedN = pad4(n);
    const paddedRows = pad4(rows);
    const aBytes = paddedN * stride * 4;
    const wBytes = typeof w === "number" ? 0 : paddedRows * stride * 4;
    this.#reserve(aBytes + wBytes + paddedN * paddedRows * 4);
    const aAt = this.#top;
    const wAt = typeof w === "number" ? w : aAt + aBytes;
    const outAt = aAt + aBytes + wBytes;
    this.#write(aAt, a, n, cols);
    if (typeof w !== "number") {
      this.#write(wAt, w, rows, cols);
    }
    this.#exports.linear(aAt, paddedN, wAt, paddedRows, stride, outAt);
    const result = new Float32Array(
      this.#exports.memory.buffer,
      outAt,
      paddedN * paddedRows
    );
    // Copied out (later calls reuse this memory), adding the bias.
    const out = new Float32Array(n * rows);
    for (let t = 0; t < n; t += 1) {
      const from = t * paddedRows;
      const to = t * rows;
      for (let r = 0; r < rows; r += 1) {
        out[to + r] =
          (result[from + r] as number) + (bias ? (bias[r] as number) : 0);
      }
    }
    return out;
  }

  /** out[n, rows] = x[n, cols] · Wᵀ + bias. */
  linear(x: Float32Array, n: number, weight: Matrix, bias?: Float32Array) {
    return this.#run(x, n, this.#place(weight), weight.rows, weight.cols, bias);
  }

  /** out[n, rows] = a[n, cols] · b[rows, cols]ᵀ for short-lived matrices. */
  multiply(
    a: Float32Array,
    n: number,
    b: Float32Array,
    rows: number,
    cols: number
  ) {
    return this.#run(a, n, b, rows, cols);
  }
}
