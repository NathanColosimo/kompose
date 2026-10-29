"""Logits from the exported (dequantized) weights, for the TS forward-pass parity test.

uv run python model/dump_logits.py runs/<name> data/clean/<file>.jsonl [limit]
"""
import json
import sys
from pathlib import Path

import torch

from features import Featurizer, viterbi
from model import load_run
from train import inputs

run = Path(sys.argv[1])
model = load_run(run, "dequantized.safetensors")
featurizer = Featurizer()
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
cases = []
for line in list(open(sys.argv[2]))[:limit]:
    row = json.loads(line)
    encoded = featurizer.encode(row["text"], row["tagList"])
    with torch.no_grad():
        spans, tags = model(inputs([encoded]))
    cases.append({"text": row["text"], "tagList": row["tagList"], "spans": spans[0].flatten().tolist(), "tags": tags[0, : len(encoded.tag_positions)].tolist(), "viterbi": viterbi(encoded, spans[0].log_softmax(-1).tolist())})
json.dump(cases, open(run / "logits-parity.json", "w"))
print(len(cases), "cases")
