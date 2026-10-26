"""Export a trained run to the runtime format (int8 weights, per-row scales).

uv run python model/export.py runs/<name> [--out ../assets/task-parser.bin]

Layout: b"KTP1", u32 header length, JSON header, then tensors (4-byte aligned).
Header: {"config", "vocab", "tensors": [{"name", "shape", "dtype", "offset", "scales"?}]}.
2-D weights are int8 with one f32 scale per row; with --word-bits 4 the word
table is int4 instead (two per byte, low nibble first, stored +8).
Also writes <run>/dequantized.safetensors so Python can score the exact runtime weights.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent


def quantize(weight: np.ndarray):
    scales = np.abs(weight).max(axis=1) / 127.0
    scales[scales == 0] = 1.0
    q = np.clip(np.round(weight / scales[:, None]), -127, 127).astype(np.int8)
    return q, scales.astype(np.float32)


def quantize4(weight: np.ndarray):
    scales = np.abs(weight).max(axis=1) / 7.0
    scales[scales == 0] = 1.0
    q = np.clip(np.round(weight / scales[:, None]), -7, 7).astype(np.int8)
    unsigned = (q + 8).astype(np.uint8)
    packed = unsigned[:, 0::2] | (unsigned[:, 1::2] << 4)
    return packed, q, scales.astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run")
    parser.add_argument("--out")
    # 4-bit words cut the file ~30% for about a point of accuracy.
    parser.add_argument("--word-bits", type=int, default=8, choices=(4, 8))
    args = parser.parse_args()
    run = Path(args.run)
    config = json.loads((run / "config.json").read_text())
    state = load_file(str(run / "model.safetensors"))
    tokenizer = Tokenizer.from_file(str(ROOT / "data/embeddings" / config["embeddings"] / "tokenizer.json"))
    vocab = [token for token, _ in sorted(tokenizer.get_vocab().items(), key=lambda kv: kv[1])]

    blobs, tensors, dequantized = [], [], {}
    offset = 0

    def push(data: bytes):
        nonlocal offset
        start = offset
        padding = (-len(data)) % 4
        blobs.append(data + b"\0" * padding)
        offset += len(data) + padding
        return start

    for name, tensor in state.items():
        array = tensor.float().numpy()
        quantized = array.ndim == 2 and (name == "words.weight" or array.shape[0] * array.shape[1] >= 4096) and not name.startswith(("positions", "specials", "shapes", "segments", "flags"))
        if name == "words.weight" and args.word_bits == 4:
            packed, q, scales = quantize4(array)
            entry = {"name": name, "shape": list(array.shape), "dtype": "i4", "offset": push(packed.tobytes()), "scales": push(scales.tobytes())}
            dequantized[name] = torch.from_numpy(q.astype(np.float32) * scales[:, None])
        elif quantized:
            q, scales = quantize(array)
            entry = {"name": name, "shape": list(array.shape), "dtype": "i8", "offset": push(q.tobytes()), "scales": push(scales.tobytes())}
            dequantized[name] = torch.from_numpy(q.astype(np.float32) * scales[:, None])
        else:
            entry = {"name": name, "shape": list(array.shape), "dtype": "f32", "offset": push(array.astype(np.float32).tobytes())}
            dequantized[name] = torch.from_numpy(array.astype(np.float32))
        tensors.append(entry)

    header = json.dumps({"config": config, "tensors": tensors, "vocab": vocab}, ensure_ascii=False).encode()
    header += b" " * ((-len(header)) % 4)
    out = Path(args.out) if args.out else run / "task-parser.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as f:
        f.write(b"KTP1")
        f.write(struct.pack("<I", len(header)))
        f.write(header)
        for blob in blobs:
            f.write(blob)
    save_file({k: v.contiguous() for k, v in dequantized.items()}, str(run / "dequantized.safetensors"))
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
