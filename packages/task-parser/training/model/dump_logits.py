"""Logits from the exported (dequantized) weights, for the TS forward-pass parity test.

uv run python model/dump_logits.py runs/<name> data/clean/<file>.jsonl [limit]
"""
import json
import sys
from pathlib import Path

import torch
from safetensors.torch import load_file

sys.path.insert(0, str(Path(__file__).parent))
from features import Featurizer, viterbi  # noqa: E402
from model import Config, TaskParser  # noqa: E402
from train import collate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
run = Path(sys.argv[1])
config = json.loads((run / "config.json").read_text())
model = TaskParser(Config(**{k: v for k, v in config.items() if k not in ("embeddings", "dev")}))
model.load_state_dict(load_file(str(run / "dequantized.safetensors")))
model.eval()
featurizer = Featurizer(str(ROOT / "data/embeddings" / config["embeddings"] / "tokenizer.json"))
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
cases = []
for line in list(open(sys.argv[2]))[:limit]:
    row = json.loads(line)
    encoded = featurizer.encode(row["text"], row["tagList"])
    item = {"encoded": encoded, "targets": [0] * len(encoded.ids), "tag_targets": [0.0] * len(encoded.tag_positions)}
    batch, _ = collate([item])
    with torch.no_grad():
        spans, tags = model(batch)
    cases.append({"text": row["text"], "tagList": row["tagList"], "spans": spans[0].flatten().tolist(), "tags": tags[0, : len(encoded.tag_positions)].tolist(), "viterbi": viterbi(encoded, spans[0].log_softmax(-1).tolist())})
json.dump(cases, open(run / "logits-parity.json", "w"))
print(len(cases), "cases")
