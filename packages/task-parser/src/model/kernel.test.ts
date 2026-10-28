import { describe, expect, test } from "bun:test";
import { Kernel } from "./kernel";
import type { Matrix } from "./weights";

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const next = random(7);
const n = 13;
const rows = 18;
const cols = 64;
const x = Float32Array.from({ length: n * cols }, () => next() * 6 - 2);
const weight: Matrix = {
  cols,
  data: Int8Array.from({ length: rows * cols }, () =>
    Math.round(next() * 254 - 127)
  ),
  rows,
  scales: Float32Array.from({ length: rows }, () => 0.001 + next() * 0.01),
};
const bias = Float32Array.from({ length: rows }, () => next() - 0.5);

/** x · Wᵀ + bias in float64 from the dequantized weights. */
function reference() {
  const out = new Float64Array(n * rows);
  for (let t = 0; t < n; t += 1) {
    for (let r = 0; r < rows; r += 1) {
      let sum = 0;
      for (let c = 0; c < cols; c += 1) {
        sum +=
          (x[t * cols + c] as number) *
          (weight.data[r * cols + c] as number) *
          (weight.scales?.[r] as number);
      }
      out[t * rows + r] = sum + (bias[r] as number);
    }
  }
  return out;
}

/** x · Wᵀ + bias through a kernel (placing takes the matrix's data). */
function kernelLinear(relaxed: boolean) {
  const kernel = new Kernel({ relaxed });
  const placed = { ...weight, data: weight.data.slice() };
  kernel.place(placed, bias);
  return Array.from(kernel.linear(x, n, placed));
}

describe("int8 kernel", () => {
  test("relaxed and plain SIMD give the same sums", () => {
    expect(kernelLinear(true)).toEqual(kernelLinear(false));
  });

  test("7-bit activations stay close to float math", () => {
    const expected = reference();
    const got = kernelLinear(false);
    let worst = 0;
    let largest = 0;
    expected.forEach((value, i) => {
      worst = Math.max(worst, Math.abs(value - (got[i] as number)));
      largest = Math.max(largest, Math.abs(value));
    });
    // Each activation is off by at most half a step of (max − min) / 126.
    expect(worst / largest).toBeLessThan(0.02);
  });
});
