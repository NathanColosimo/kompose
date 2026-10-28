/**
 * Forward pass of training/model/model.py: an ELECTRA-small encoder with a
 * span head and a tag head. Activations are row-major Float32Arrays of shape
 * [tokens, width]; the encoder runs in the WebAssembly kernel (kernel.ts).
 */
import type { Encoded } from "./features";
import { Kernel } from "./kernel";
import type { Matrix, Weights } from "./weights";

const EPSILON = 1e-12;
const GELU_C = Math.sqrt(2 / Math.PI);
const WEIGHT_SUFFIX = /weight$/;

interface Logits {
  /** [tokens, TAG_NAMES.length] */
  spans: Float32Array;
  /** One logit per tag in the list. */
  tags: Float32Array;
}

interface Model {
  kernel: Kernel;
  weights: Weights;
}

function tensor({ weights }: Model, name: string): Matrix {
  const found = weights.tensors.get(name);
  if (!found) {
    throw new Error(`Missing weight ${name}`);
  }
  return found;
}

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
 * out[n, rows] = x[n, cols] · Wᵀ + b for the layer `name`: int8 layers in
 * the kernel (with exact GELU if `gelu`), the small float32 heads here.
 */
function linear(
  model: Model,
  x: Float32Array,
  n: number,
  name: string,
  gelu = false
) {
  const weight = tensor(model, `${name}.weight`);
  if (weight.scales) {
    return model.kernel.linear(x, n, weight, gelu);
  }
  const { cols, rows } = weight;
  const w = weight.data as Float32Array;
  const b = model.weights.tensors.get(`${name}.bias`)?.data;
  const out = new Float32Array(n * rows);
  for (let t = 0; t < n; t += 1) {
    for (let r = 0; r < rows; r += 1) {
      out[t * rows + r] =
        dot(x, t * cols, w, r * cols, cols) + (b ? (b[r] as number) : 0);
    }
  }
  return out;
}

function layerNorm(model: Model, x: Float32Array, n: number, name: string) {
  const gain = tensor(model, `${name}.weight`).data as Float32Array;
  const bias = tensor(model, `${name}.bias`).data as Float32Array;
  return model.kernel.layerNorm(x, n, gain.length, gain, bias, EPSILON);
}

/** GELU, tanh approximation (the tag head's), in place. */
function tanhGelu(x: Float32Array) {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] as number;
    x[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044_715 * v * v * v)));
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
  const scale = matrix.scales ? (matrix.scales[index] as number) : 1;
  const start = index * matrix.cols;
  return Float32Array.from(
    matrix.data.subarray(start, start + matrix.cols),
    (value) => value * scale
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
function tagSimilarity(model: Model, encoded: Encoded) {
  const words = tensor(model, "words.weight");
  const n = encoded.ids.length;
  const unit = (id: number) => normalize(row(words, Math.max(id, 0)));
  const text: Float32Array[] = [];
  for (let t = 0; t < n; t += 1) {
    if (!encoded.specials[t] && encoded.segments[t] === 0) {
      text.push(unit(encoded.ids[t] ?? 0));
    }
  }
  return encoded.tagPositions.flatMap((position, index) => {
    if (text.length === 0) {
      return [0, 0];
    }
    // The tag's word pieces, after its [TAG] marker.
    const end = encoded.tagPositions[index + 1] ?? n;
    const tag = new Float32Array(words.cols);
    for (const id of encoded.ids.slice(position + 1, end)) {
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
    return [top[0] as number, top.reduce((a, b) => a + b, 0) / top.length];
  });
}

/**
 * Token inputs: the word (or special) embedding plus shape, segment, flag
 * and position embeddings, summed at embedding width, normalized and
 * projected to model width.
 */
function embed(model: Model, encoded: Encoded) {
  const n = encoded.ids.length;
  const words = tensor(model, "words.weight");
  const specials = tensor(model, "specials.weight");
  const shapes = tensor(model, "shapes.weight");
  const segments = tensor(model, "segments.weight");
  const flags = tensor(model, "flags.weight");
  const positions = tensor(model, "positions.weight");
  const width = words.cols;
  const x = new Float32Array(n * width);
  for (let t = 0; t < n; t += 1) {
    const special = encoded.specials[t] ?? 0;
    const parts = [
      special > 0 ? row(specials, special) : row(words, encoded.ids[t] ?? 0),
      row(shapes, encoded.shapes[t] ?? 0),
      row(segments, encoded.segments[t] ?? 0),
      row(flags, (encoded.spaced[t] ?? 0) + 2 * (encoded.overlap[t] ?? 0)),
      row(positions, t),
    ];
    for (let i = 0; i < width; i += 1) {
      let value = 0;
      for (const part of parts) {
        value += part[i] as number;
      }
      x[t * width + i] = value;
    }
  }
  return linear(model, layerNorm(model, x, n, "embed_norm"), n, "project");
}

/** Post-norm BERT/ELECTRA layer with exact GELU. */
function layer(model: Model, p: string, x: Float32Array, n: number) {
  const { dim, heads } = model.weights.config;
  const qkv = linear(model, x, n, `${p}.qkv`);
  const mixed = model.kernel.attention(qkv, n, dim, heads);
  addInPlace(x, linear(model, mixed, n, `${p}.out`));
  const h = layerNorm(model, x, n, `${p}.norm1`);
  const up = linear(model, h, n, `${p}.up`, true);
  addInPlace(h, linear(model, up, n, `${p}.down`));
  return layerNorm(model, h, n, `${p}.norm2`);
}

function forward(model: Model, encoded: Encoded): Logits {
  const { dim, layers } = model.weights.config;
  const n = encoded.ids.length;
  let x = embed(model, encoded);
  for (let l = 0; l < layers; l += 1) {
    x = layer(model, `layers.${l}`, x, n);
  }
  const spans = linear(model, x, n, "spans");
  // The tag head runs on every tag's [TAG] state at once.
  const count = encoded.tagPositions.length;
  const states = new Float32Array(count * dim);
  encoded.tagPositions.forEach((position, index) => {
    states.set(x.subarray(position * dim, (position + 1) * dim), index * dim);
  });
  addInPlace(
    states,
    linear(
      model,
      Float32Array.from(tagSimilarity(model, encoded)),
      count,
      "tag_similarity"
    )
  );
  const hidden = tanhGelu(linear(model, states, count, "tag_hidden"));
  return { spans, tags: linear(model, hidden, count, "tag_out") };
}

/**
 * The model over `weights`. Its int8 layers move into a new WebAssembly
 * kernel up front, so the weight file needn't be kept.
 */
export function createNetwork(
  weights: Weights,
  options?: { relaxed?: boolean }
) {
  const kernel = new Kernel(options);
  for (const [name, matrix] of weights.tensors) {
    if (name !== "words.weight" && matrix.scales) {
      const bias = weights.tensors.get(name.replace(WEIGHT_SUFFIX, "bias"));
      kernel.place(matrix, bias?.data as Float32Array | undefined);
    }
  }
  const model = { kernel, weights };
  return (encoded: Encoded) => forward(model, encoded);
}
