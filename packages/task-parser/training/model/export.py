"""Export a trained run to the runtime format (int8 weights, per-row scales).

uv run python model/export.py runs/<name>   → runs/<name>/task-parser.bin

Layout: b"KTP1", u32 header length, JSON header, then tensors (4-byte aligned).
Header: {"config", "vocab", "tensors": [{"name", "shape", "dtype", "offset", "scales"?}]}.
2-D weights of 4096+ values other than the position table are int8 with one
f32 scale per row; everything else is f32.
Also writes <run>/dequantized.safetensors so Python can score the exact runtime weights.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file, save_file

from features import Featurizer


def quantize(weight: np.ndarray):
    scales = np.abs(weight).max(axis=1) / 127.0
    scales[scales == 0] = 1.0
    q = np.clip(np.round(weight / scales[:, None]), -127, 127).astype(np.int8)
    return q, scales.astype(np.float32)


def main():
    run = Path(sys.argv[1])
    config = json.loads((run / "config.json").read_text())
    state = load_file(str(run / "model.safetensors"))
    ids = Featurizer().tokenizer.get_vocab()
    vocab = sorted(ids, key=ids.get)

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
        if array.ndim == 2 and array.size >= 4096 and name != "positions.weight":
            q, scales = quantize(array)
            entry = {"name": name, "shape": list(array.shape), "dtype": "i8", "offset": push(q.tobytes()), "scales": push(scales.tobytes())}
            dequantized[name] = torch.from_numpy(q.astype(np.float32) * scales[:, None])
        else:
            entry = {"name": name, "shape": list(array.shape), "dtype": "f32", "offset": push(array.astype(np.float32).tobytes())}
            dequantized[name] = torch.from_numpy(array.astype(np.float32))
        tensors.append(entry)

    header = json.dumps({"config": config, "tensors": tensors, "vocab": vocab}, ensure_ascii=False).encode()
    header += b" " * ((-len(header)) % 4)
    out = run / "task-parser.bin"
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
