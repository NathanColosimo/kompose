"""Logits from the exported (dequantized) weights, for the TS forward-pass parity test
(src/model/network.parity.test.ts, which runs them against ../task-parser.bin).

uv run python model/dump_logits.py runs/<name> data/clean/<file>.jsonl [limit]
→ testset/parity/logits.json (rounded: the test allows a drift of 1)
"""
import json
import sys
from pathlib import Path

import torch

from features import ROOT, Featurizer, viterbi
from model import load_run
from train import inputs

run = Path(sys.argv[1])
model = load_run(run, "dequantized.safetensors")
featurizer = Featurizer()
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 100
cases = []
for line in list(open(sys.argv[2]))[:limit]:
    row = json.loads(line)
    encoded = featurizer.encode(row["text"], row["tagList"])
    with torch.no_grad():
        spans, tags = model(inputs([encoded]))
    cases.append({"text": row["text"], "tagList": row["tagList"], "spans": [round(v, 4) for v in spans[0].flatten().tolist()], "tags": [round(v, 4) for v in tags[0, : len(encoded.tag_positions)].tolist()], "viterbi": viterbi(encoded, spans[0].log_softmax(-1).tolist())})
json.dump(cases, open(ROOT / "testset/parity/logits.json", "w"))
print(len(cases), "cases")
