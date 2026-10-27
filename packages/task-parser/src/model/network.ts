/**
 * Forward pass of training/model/model.py in plain TypeScript. Activations
 * are row-major Float32Arrays of shape [tokens, dim].
 */
import type { Encoded } from "./features";
import { Kernel } from "./kernel";
import type { Matrix, Weights } from "./weights";

/** The WebAssembly kernel, or null where SIMD isn't available. */
let kernel: Kernel | null | undefined;

const GELU_C = Math.sqrt(2 / Math.PI);

function tensor(weights: Weights, name: string): Matrix {
  const found = weights.tensors.get(name);
  if (!found) {
    throw new Error(`Missing weight ${name}`);
  }
  return found;
}

/** One output: x[t] · W[r] over `cols`. */
function dot(
  x: Float32Array,
  xo: number,
  w: Float32Array,
  wo: number,
  cols: number
) {
  let sum = 0;
  for (let c = 0; c < cols; c += 1) {
    sum += (x[xo + c] as number) * (w[wo + c] as number);
  }
  return sum;
}

/**
 * out[n, rows] = x[n, cols] · Wᵀ in plain JS. Blocks of 4 tokens × 4 rows
 * keep 16 sums in registers, so each loaded weight and activation is used
 * four times (2-4× faster than row by row).
 */
function matmul(x: Float32Array, n: number, weight: Matrix) {
  const { cols, rows } = weight;
  const w = weight.data as Float32Array;
  const out = new Float32Array(n * rows);
  let t = 0;
  for (; t + 3 < n; t += 4) {
    const x0 = t * cols;
    const x1 = x0 + cols;
    const x2 = x1 + cols;
    const x3 = x2 + cols;
    let r = 0;
    for (; r + 3 < rows; r += 4) {
      const w0 = r * cols;
      const w1 = w0 + cols;
      const w2 = w1 + cols;
      const w3 = w2 + cols;
      let a00 = 0;
      let a01 = 0;
      let a02 = 0;
      let a03 = 0;
      let a10 = 0;
      let a11 = 0;
      let a12 = 0;
      let a13 = 0;
      let a20 = 0;
      let a21 = 0;
      let a22 = 0;
      let a23 = 0;
      let a30 = 0;
      let a31 = 0;
      let a32 = 0;
      let a33 = 0;
      for (let c = 0; c < cols; c += 1) {
        const p = w[w0 + c] as number;
        const q = w[w1 + c] as number;
        const s = w[w2 + c] as number;
        const z = w[w3 + c] as number;
        let u = x[x0 + c] as number;
        a00 += u * p;
        a01 += u * q;
        a02 += u * s;
        a03 += u * z;
        u = x[x1 + c] as number;
        a10 += u * p;
        a11 += u * q;
        a12 += u * s;
        a13 += u * z;
        u = x[x2 + c] as number;
        a20 += u * p;
        a21 += u * q;
        a22 += u * s;
        a23 += u * z;
        u = x[x3 + c] as number;
        a30 += u * p;
        a31 += u * q;
        a32 += u * s;
        a33 += u * z;
      }
      const o = t * rows + r;
      out[o] = a00;
      out[o + 1] = a01;
      out[o + 2] = a02;
      out[o + 3] = a03;
      out[o + rows] = a10;
      out[o + rows + 1] = a11;
      out[o + rows + 2] = a12;
      out[o + rows + 3] = a13;
      out[o + 2 * rows] = a20;
      out[o + 2 * rows + 1] = a21;
      out[o + 2 * rows + 2] = a22;
      out[o + 2 * rows + 3] = a23;
      out[o + 3 * rows] = a30;
      out[o + 3 * rows + 1] = a31;
      out[o + 3 * rows + 2] = a32;
      out[o + 3 * rows + 3] = a33;
    }
    for (; r < rows; r += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[(t + k) * rows + r] = dot(x, (t + k) * cols, w, r * cols, cols);
      }
    }
  }
  for (; t < n; t += 1) {
    for (let r = 0; r < rows; r += 1) {
      out[t * rows + r] = dot(x, t * cols, w, r * cols, cols);
    }
  }
  return out;
}

/** out[n, rows] = a[n, cols] · b[rows, cols]ᵀ for activations. */
function product(
  a: Float32Array,
  n: number,
  b: Float32Array,
  rows: number,
  cols: number
) {
  kernel ??= Kernel.create();
  if (kernel) {
    return kernel.multiply(a, n, b, rows, cols);
  }
  return matmul(a, n, { cols, data: b, rows, scales: null });
}

/** out[n, rows] = x[n, cols] · Wᵀ + bias. W is float32 (see weights.ts). */
function linear(
  x: Float32Array,
  n: number,
  weight: Matrix,
  bias: Matrix | undefined
) {
  kernel ??= Kernel.create();
  const b = bias?.data as Float32Array | undefined;
  if (kernel?.supports(weight)) {
    return kernel.linear(x, n, weight, b);
  }
  const out = matmul(x, n, weight);
  if (b) {
    const { rows } = weight;
    for (let t = 0; t < n; t += 1) {
      const o = t * rows;
      for (let r = 0; r < rows; r += 1) {
        out[o + r] = (out[o + r] as number) + (b[r] as number);
      }
    }
  }
  return out;
}

function layerNorm(
  x: Float32Array,
  n: number,
  dim: number,
  weight: Matrix,
  bias: Matrix | undefined,
  epsilon = 1e-5
) {
  const out = new Float32Array(x.length);
  const g = weight.data as Float32Array;
  const b = bias?.data as Float32Array | undefined;
  for (let t = 0; t < n; t += 1) {
    const o = t * dim;
    let mean = 0;
    for (let i = 0; i < dim; i += 1) {
      mean += x[o + i] as number;
    }
    mean /= dim;
    let variance = 0;
    for (let i = 0; i < dim; i += 1) {
      const d = (x[o + i] as number) - mean;
      variance += d * d;
    }
    const inv = 1 / Math.sqrt(variance / dim + epsilon);
    for (let i = 0; i < dim; i += 1) {
      out[o + i] =
        ((x[o + i] as number) - mean) * inv * (g[i] as number) +
        (b ? (b[i] as number) : 0);
    }
  }
  return out;
}

function gelu(x: Float32Array) {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] as number;
    x[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044_715 * v * v * v)));
  }
  return x;
}

/**
 * Exact GELU, x·Φ(x), as BERT-style encoders use. erf by Abramowitz and
 * Stegun 7.1.26 (error < 1.5e-7).
 */
function geluExact(x: Float32Array) {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] as number;
    const z = Math.abs(v) / Math.SQRT2;
    const t = 1 / (1 + 0.327_591_1 * z);
    const poly =
      t *
      (0.254_829_592 +
        t *
          (-0.284_496_736 +
            t * (1.421_413_741 + t * (-1.453_152_027 + t * 1.061_405_429))));
    const erf = 1 - poly * Math.exp(-z * z);
    x[i] = 0.5 * v * (1 + (v < 0 ? -erf : erf));
  }
  return x;
}

function addInPlace(target: Float32Array, source: Float32Array) {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = (target[i] as number) + (source[i] as number);
  }
}

/** Row `index` of a matrix, dequantized. */
function row(matrix: Matrix, index: number) {
  const out = new Float32Array(matrix.cols);
  const scale = matrix.scales ? (matrix.scales[index] as number) : 1;
  if (matrix.data instanceof Uint8Array) {
    // 4-bit: two values per byte, low nibble first, stored +8.
    const start = (index * matrix.cols) / 2;
    for (let i = 0; i < matrix.cols; i += 2) {
      const byte = matrix.data[start + i / 2] as number;
      out[i] = ((byte % 16) - 8) * scale;
      out[i + 1] = (Math.floor(byte / 16) - 8) * scale;
    }
    return out;
  }
  const start = index * matrix.cols;
  for (let i = 0; i < matrix.cols; i += 1) {
    out[i] = (matrix.data[start + i] as number) * scale;
  }
  return out;
}

interface AttentionOptions {
  /** Attend only within this many tokens either way (local layers). */
  halfWindow?: number;
  /** Rotary position embedding base for queries and keys. */
  ropeTheta?: number;
}

/** Rotate each [t, size] row by its position (RoPE, rotate-half form). */
function rope(x: Float32Array, n: number, size: number, theta: number) {
  const half = size / 2;
  for (let i = 0; i < half; i += 1) {
    const frequency = 1 / theta ** ((2 * i) / size);
    for (let t = 0; t < n; t += 1) {
      const angle = t * frequency;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const a = x[t * size + i] as number;
      const b = x[t * size + i + half] as number;
      x[t * size + i] = a * cos - b * sin;
      x[t * size + i + half] = b * cos + a * sin;
    }
  }
}

/**
 * Softmax over each row of [n, n] attention scores (scaled), in place.
 * With `halfWindow`, keys further than that from the query are masked.
 */
function softmaxRows(
  scores: Float32Array,
  n: number,
  scale: number,
  halfWindow: number | undefined
) {
  for (let i = 0; i < n; i += 1) {
    const o = i * n;
    const from = halfWindow === undefined ? 0 : Math.max(0, i - halfWindow);
    const to = halfWindow === undefined ? n : Math.min(n, i + halfWindow + 1);
    let max = Number.NEGATIVE_INFINITY;
    for (let j = from; j < to; j += 1) {
      max = Math.max(max, (scores[o + j] as number) * scale);
    }
    let total = 0;
    for (let j = 0; j < n; j += 1) {
      const weight =
        j >= from && j < to
          ? Math.exp((scores[o + j] as number) * scale - max)
          : 0;
      scores[o + j] = weight;
      total += weight;
    }
    for (let j = 0; j < n; j += 1) {
      scores[o + j] = (scores[o + j] as number) / total;
    }
  }
}

function attention(
  weights: Weights,
  prefix: string,
  h: Float32Array,
  n: number,
  { halfWindow, ropeTheta }: AttentionOptions = {}
) {
  const { dim, heads } = weights.config;
  const size = dim / heads;
  const qkv = linear(
    h,
    n,
    tensor(weights, `${prefix}.qkv.weight`),
    weights.tensors.get(`${prefix}.qkv.bias`)
  );
  const mixed = new Float32Array(n * dim);
  const scale = 1 / Math.sqrt(size);
  // Each head's queries, keys and (transposed) values, contiguous.
  const q = new Float32Array(n * size);
  const k = new Float32Array(n * size);
  const vt = new Float32Array(size * n);
  for (let head = 0; head < heads; head += 1) {
    for (let t = 0; t < n; t += 1) {
      const at = t * 3 * dim + head * size;
      q.set(qkv.subarray(at, at + size), t * size);
      k.set(qkv.subarray(at + dim, at + dim + size), t * size);
      for (let c = 0; c < size; c += 1) {
        vt[c * n + t] = qkv[at + 2 * dim + c] as number;
      }
    }
    if (ropeTheta) {
      rope(q, n, size, ropeTheta);
      rope(k, n, size, ropeTheta);
    }
    const scores = product(q, n, k, n, size);
    softmaxRows(scores, n, scale, halfWindow);
    const perHead = product(scores, n, vt, size, n);
    for (let t = 0; t < n; t += 1) {
      mixed.set(
        perHead.subarray(t * size, (t + 1) * size),
        t * dim + head * size
      );
    }
  }
  return linear(
    mixed,
    n,
    tensor(weights, `${prefix}.out.weight`),
    weights.tensors.get(`${prefix}.out.bias`)
  );
}

function normalize(vector: Float32Array) {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  const scale = 1 / Math.max(Math.sqrt(norm), 1e-12);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = (vector[i] as number) * scale;
  }
  return vector;
}

/**
 * Per tag: max and top-3 mean cosine similarity between the tag's summed
 * word embedding and each text word's embedding (model.py `similarity`).
 * Non-text tokens count as -1, as in training.
 */
function tagSimilarity(weights: Weights, encoded: Encoded) {
  const words = tensor(weights, "words.weight");
  const n = encoded.ids.length;
  const unit = (id: number) => normalize(row(words, Math.max(id, 0)));
  const text: Float32Array[] = [];
  for (let t = 0; t < n; t += 1) {
    if (!encoded.specials[t] && encoded.segments[t] === 0) {
      text.push(unit(encoded.ids[t] ?? 0));
    }
  }
  return encoded.tagPositions.map((_, index) => {
    if (text.length === 0) {
      return [0, 0] as const;
    }
    const tag = new Float32Array(words.cols);
    for (const id of tagWordIds(encoded, index)) {
      addInPlace(tag, unit(id));
    }
    normalize(tag);
    const top = [-1, -1, -1].slice(0, Math.min(3, n));
    for (const word of text) {
      const cosine = dot(tag, 0, word, 0, tag.length);
      if (cosine > (top.at(-1) as number)) {
        top[top.length - 1] = cosine;
        top.sort((a, b) => b - a);
      }
    }
    // With fewer than 3 text words, masked tokens (-1) fill the top 3.
    return [
      top[0] as number,
      top.reduce((a, b) => a + b, 0) / top.length,
    ] as const;
  });
}

/** The word-piece ids of the `index`th tag (after its [TAG] marker). */
function tagWordIds(encoded: Encoded, index: number): number[] {
  const sequence = encoded.tagSequences?.[index]?.encoded;
  if (sequence) {
    return sequence.ids.filter((_, t) => !sequence.specials[t]);
  }
  const position = encoded.tagPositions[index] ?? 0;
  const end = encoded.tagPositions[index + 1] ?? encoded.ids.length;
  return encoded.ids.slice(position + 1, end);
}

export interface Logits {
  /** [tokens, TAG_NAMES.length] */
  spans: Float32Array;
  /** One logit per tag in the list. */
  tags: Float32Array;
}

/** Per token: word or special row + shape + segment + flags + position. */
function sumInputs(
  weights: Weights,
  encoded: Encoded,
  base: Float32Array,
  width: number
) {
  const n = encoded.ids.length;
  const tables = {
    flags: tensor(weights, "flags.weight"),
    positions: tensor(weights, "positions.weight"),
    segments: tensor(weights, "segments.weight"),
    shapes: tensor(weights, "shapes.weight"),
    specials: tensor(weights, "specials.weight"),
  };
  const x = new Float32Array(n * width);
  for (let t = 0; t < n; t += 1) {
    const special = encoded.specials[t] ?? 0;
    const first =
      special > 0
        ? row(tables.specials, special)
        : base.subarray(t * width, (t + 1) * width);
    const parts = [
      row(tables.shapes, encoded.shapes[t] ?? 0),
      row(tables.segments, encoded.segments[t] ?? 0),
      row(
        tables.flags,
        (encoded.spaced[t] ?? 0) + 2 * (encoded.overlap[t] ?? 0)
      ),
      row(tables.positions, t),
    ];
    for (let i = 0; i < width; i += 1) {
      let value = first[i] as number;
      for (const part of parts) {
        value += part[i] as number;
      }
      x[t * width + i] = value;
    }
  }
  return x;
}

/**
 * Token inputs: the word (or special) embedding plus shape, segment, flag
 * and position embeddings. The scratch encoder sums them at model width
 * after projecting words; ELECTRA sums them at embedding width, normalizes
 * and then projects.
 */
function embed(weights: Weights, encoded: Encoded) {
  const { arch = "scratch" } = weights.config;
  const n = encoded.ids.length;
  const words = tensor(weights, "words.weight");
  const width = arch === "scratch" ? weights.config.dim : words.cols;
  const embedded = new Float32Array(n * words.cols);
  for (let t = 0; t < n; t += 1) {
    if (!encoded.specials[t]) {
      embedded.set(row(words, encoded.ids[t] ?? 0), t * words.cols);
    }
  }
  // Word embeddings are projected together, one row per token.
  const base =
    arch === "scratch"
      ? linear(
          embedded,
          n,
          tensor(weights, "project.weight"),
          weights.tensors.get("project.bias")
        )
      : embedded;
  const x = sumInputs(weights, encoded, base, width);
  if (arch === "scratch") {
    return x;
  }
  const electra = arch === "electra";
  const normed = layerNorm(
    x,
    n,
    width,
    tensor(weights, "embed_norm.weight"),
    weights.tensors.get("embed_norm.bias"),
    electra ? 1e-12 : 1e-5
  );
  return electra
    ? linear(
        normed,
        n,
        tensor(weights, "project.weight"),
        weights.tensors.get("project.bias")
      )
    : normed;
}

/** Pre-norm layer (scratch encoder). */
function preNormLayer(weights: Weights, p: string, x: Float32Array, n: number) {
  const { dim } = weights.config;
  const h = layerNorm(
    x,
    n,
    dim,
    tensor(weights, `${p}.norm1.weight`),
    tensor(weights, `${p}.norm1.bias`)
  );
  addInPlace(x, attention(weights, p, h, n));
  const h2 = layerNorm(
    x,
    n,
    dim,
    tensor(weights, `${p}.norm2.weight`),
    tensor(weights, `${p}.norm2.bias`)
  );
  const up = gelu(
    linear(
      h2,
      n,
      tensor(weights, `${p}.up.weight`),
      weights.tensors.get(`${p}.up.bias`)
    )
  );
  addInPlace(
    x,
    linear(
      up,
      n,
      tensor(weights, `${p}.down.weight`),
      weights.tensors.get(`${p}.down.bias`)
    )
  );
  return x;
}

/** Post-norm BERT/ELECTRA layer with exact GELU. */
function postNormLayer(
  weights: Weights,
  p: string,
  x: Float32Array,
  n: number
) {
  const { dim } = weights.config;
  addInPlace(x, attention(weights, p, x, n));
  const h = layerNorm(
    x,
    n,
    dim,
    tensor(weights, `${p}.norm1.weight`),
    tensor(weights, `${p}.norm1.bias`),
    1e-12
  );
  const up = geluExact(
    linear(
      h,
      n,
      tensor(weights, `${p}.up.weight`),
      weights.tensors.get(`${p}.up.bias`)
    )
  );
  addInPlace(
    h,
    linear(
      up,
      n,
      tensor(weights, `${p}.down.weight`),
      weights.tensors.get(`${p}.down.bias`)
    )
  );
  return layerNorm(
    h,
    n,
    dim,
    tensor(weights, `${p}.norm2.weight`),
    tensor(weights, `${p}.norm2.bias`),
    1e-12
  );
}

/**
 * ModernBERT/Ettin layer: pre-norm without biases (none before the first
 * attention), RoPE, GeGLU; all but every `global_every`-th layer attend
 * locally.
 */
function modernLayer(
  weights: Weights,
  index: number,
  x: Float32Array,
  n: number
) {
  const {
    dim,
    ffn,
    global_every: globalEvery = 3,
    local_window: localWindow = 128,
    rope_theta: ropeTheta = 160_000,
  } = weights.config;
  const p = `layers.${index}`;
  const h =
    index > 0
      ? layerNorm(
          x,
          n,
          dim,
          tensor(weights, `${p}.attn_norm.weight`),
          undefined
        )
      : x;
  addInPlace(
    x,
    attention(weights, p, h, n, {
      halfWindow: index % globalEvery === 0 ? undefined : localWindow / 2,
      ropeTheta,
    })
  );
  const m = layerNorm(
    x,
    n,
    dim,
    tensor(weights, `${p}.mlp_norm.weight`),
    undefined
  );
  const up = linear(m, n, tensor(weights, `${p}.up.weight`), undefined);
  // GeGLU: GELU of the first half times the second half.
  const gated = new Float32Array(n * ffn);
  for (let t = 0; t < n; t += 1) {
    gated.set(up.subarray(t * 2 * ffn, t * 2 * ffn + ffn), t * ffn);
  }
  geluExact(gated);
  for (let t = 0; t < n; t += 1) {
    for (let j = 0; j < ffn; j += 1) {
      gated[t * ffn + j] =
        (gated[t * ffn + j] as number) * (up[t * 2 * ffn + ffn + j] as number);
    }
  }
  addInPlace(
    x,
    linear(gated, n, tensor(weights, `${p}.down.weight`), undefined)
  );
  return x;
}

/** Final token states of one sequence: embeddings through every layer. */
function encodeSequence(weights: Weights, encoded: Encoded): Float32Array {
  const { arch = "scratch", dim, layers } = weights.config;
  const n = encoded.ids.length;
  let x: Float32Array = embed(weights, encoded);
  for (let l = 0; l < layers; l += 1) {
    if (arch === "electra") {
      x = postNormLayer(weights, `layers.${l}`, x, n);
    } else if (arch === "modernbert") {
      x = modernLayer(weights, l, x, n);
    } else {
      x = preNormLayer(weights, `layers.${l}`, x, n);
    }
  }
  if (arch !== "electra") {
    x = layerNorm(
      x,
      n,
      dim,
      tensor(weights, "norm.weight"),
      weights.tensors.get("norm.bias")
    );
  }
  return x;
}

/** Late-tag vectors by tag name: a tag's encoding doesn't depend on the text. */
const tagVectorCache = new WeakMap<Weights, Map<string, Float32Array>>();
const TAG_CACHE_SIZE = 512;

function tagVector(
  weights: Weights,
  { encoded, name }: { encoded: Encoded; name: string }
) {
  let cache = tagVectorCache.get(weights);
  if (!cache) {
    cache = new Map();
    tagVectorCache.set(weights, cache);
  }
  let vector = cache.get(name);
  if (!vector) {
    vector = encodeSequence(weights, encoded).slice(0, weights.config.dim);
    if (cache.size >= TAG_CACHE_SIZE) {
      cache.clear();
    }
    cache.set(name, vector);
  }
  return vector;
}

/**
 * Late tags: each tag's own [TAG] state plus what it attends to among the
 * text tokens (model.py `late_tag_states`).
 */
function lateTagStates(weights: Weights, encoded: Encoded, x: Float32Array) {
  const { dim, heads } = weights.config;
  const sequences = encoded.tagSequences ?? [];
  const count = sequences.length;
  const n = encoded.ids.length;
  const states = new Float32Array(count * dim);
  sequences.forEach((sequence, index) => {
    states.set(tagVector(weights, sequence), index * dim);
  });
  const q = linear(
    states,
    count,
    tensor(weights, "cross_q.weight"),
    weights.tensors.get("cross_q.bias")
  );
  const kv = linear(
    x,
    n,
    tensor(weights, "cross_kv.weight"),
    weights.tensors.get("cross_kv.bias")
  );
  const size = dim / heads;
  const scale = 1 / Math.sqrt(size);
  const context = new Float32Array(count * dim);
  const scores = new Float32Array(n);
  for (let tag = 0; tag < count; tag += 1) {
    for (let head = 0; head < heads; head += 1) {
      const qAt = tag * dim + head * size;
      let max = Number.NEGATIVE_INFINITY;
      for (let t = 0; t < n; t += 1) {
        const score = dot(q, qAt, kv, t * 2 * dim + head * size, size) * scale;
        scores[t] = score;
        max = Math.max(max, score);
      }
      let total = 0;
      for (let t = 0; t < n; t += 1) {
        const weight = Math.exp((scores[t] as number) - max);
        scores[t] = weight;
        total += weight;
      }
      for (let t = 0; t < n; t += 1) {
        const weight = (scores[t] as number) / total;
        const vAt = t * 2 * dim + dim + head * size;
        for (let c = 0; c < size; c += 1) {
          context[qAt + c] =
            (context[qAt + c] as number) + weight * (kv[vAt + c] as number);
        }
      }
    }
  }
  addInPlace(
    states,
    linear(
      context,
      count,
      tensor(weights, "cross_out.weight"),
      weights.tensors.get("cross_out.bias")
    )
  );
  return states;
}

export function forward(weights: Weights, encoded: Encoded): Logits {
  const { dim } = weights.config;
  const n = encoded.ids.length;
  const x = encodeSequence(weights, encoded);
  const spans = linear(
    x,
    n,
    tensor(weights, "spans.weight"),
    weights.tensors.get("spans.bias")
  );
  // The tag head runs on every tag's state at once.
  const count = encoded.tagPositions.length;
  let states: Float32Array;
  if (weights.config.late_tags) {
    states = lateTagStates(weights, encoded, x);
  } else {
    states = new Float32Array(count * dim);
    encoded.tagPositions.forEach((position, index) => {
      states.set(x.subarray(position * dim, (position + 1) * dim), index * dim);
    });
  }
  addInPlace(
    states,
    linear(
      Float32Array.from(tagSimilarity(weights, encoded).flat()),
      count,
      tensor(weights, "tag_similarity.weight"),
      weights.tensors.get("tag_similarity.bias")
    )
  );
  const hidden = gelu(
    linear(
      states,
      count,
      tensor(weights, "tag_hidden.weight"),
      weights.tensors.get("tag_hidden.bias")
    )
  );
  const tags = linear(
    hidden,
    count,
    tensor(weights, "tag_out.weight"),
    weights.tensors.get("tag_out.bias")
  );
  return { spans, tags };
}
