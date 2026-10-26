"""Dev metrics for a trained run.

uv run python model/score.py runs/<name> --data data/clean/<file>.jsonl ... [--threshold 0.5]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from safetensors.torch import load_file

sys.path.insert(0, str(Path(__file__).parent))
from features import Featurizer  # noqa: E402
from model import Config, TaskParser  # noqa: E402
from train import ROOT, Examples, collate, evaluate, is_dev, load  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run")
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--threshold", type=float, nargs="+", default=[0.5])
    args = parser.parse_args()
    run = Path(args.run)
    config = json.loads((run / "config.json").read_text())
    embeddings = config.pop("embeddings")
    config.pop("dev", None)
    model = TaskParser(Config(**config))
    model.load_state_dict(load_file(str(run / "model.safetensors")))
    featurizer = Featurizer(str(ROOT / "data" / "embeddings" / embeddings / "tokenizer.json"))
    rows = [r for r in load(args.data) if is_dev(r)]
    loader = torch.utils.data.DataLoader(Examples(rows, featurizer, [], augment=False), batch_size=128, collate_fn=collate)
    for threshold in args.threshold:
        print(threshold, json.dumps(evaluate(model, loader, torch.device("cpu"), threshold)))


if __name__ == "__main__":
    main()
