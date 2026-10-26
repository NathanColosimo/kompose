"""Out-of-fold disagreements between models and the labels, for review.

uv run python model/suspects.py --data <jsonl>... --runs runs/fold0 runs/fold1 --out data/suspects.jsonl

Each run must have been trained with --fold k/n (k = its index, n = number of
runs), so every row is scored by the model that did not train on it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from safetensors.torch import load_file

sys.path.insert(0, str(Path(__file__).parent))
from features import Featurizer, decode_spans, viterbi  # noqa: E402
from model import Config, TaskParser  # noqa: E402
from train import ROOT, Examples, collate, fold_of, load  # noqa: E402


def markup(text: str, spans: list[dict]) -> str:
    out, cursor = [], 0
    for span in sorted(spans, key=lambda s: s["start"]):
        if span["label"] == "L":
            continue
        out.append(text[cursor:span["start"]])
        out.append(f"[{span['label']}:{text[span['start']:span['end']]}]")
        cursor = span["end"]
    out.append(text[cursor:])
    return "".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--runs", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()
    rows = load(args.data)
    folds = len(args.runs)
    suspects = []
    for k, run in enumerate(args.runs):
        config = json.loads((Path(run) / "config.json").read_text())
        embeddings = config.pop("embeddings")
        config.pop("dev", None)
        model = TaskParser(Config(**config))
        model.load_state_dict(load_file(str(Path(run) / "model.safetensors")))
        model.eval()
        featurizer = Featurizer(str(ROOT / "data" / "embeddings" / embeddings / "tokenizer.json"))
        mine = [r for r in rows if fold_of(r, folds) == k]
        loader = torch.utils.data.DataLoader(Examples(mine, featurizer, [], augment=False), batch_size=128, collate_fn=collate)
        with torch.no_grad():
            for batch, items in loader:
                span_logits, tag_logits = model(batch)
                log_probs = span_logits.log_softmax(-1)
                for i, item in enumerate(items):
                    encoded = item["encoded"]
                    scores = log_probs[i, : len(encoded.ids)]
                    predicted = viterbi(encoded, scores.tolist())
                    spans = [s for s in decode_spans(encoded, predicted, item["text"]) if s["label"] != "L"]
                    gold = [s for s in item["spans"] if s["label"] != "L"]
                    probs = torch.sigmoid(tag_logits[i, : len(item["tags"])]).tolist()
                    chosen = sorted(t for t, p in zip(item["tags"], probs) if p >= args.threshold)
                    key = lambda s: (s["label"], s["start"], s["end"])  # noqa: E731
                    same_spans = sorted(map(key, spans)) == sorted(map(key, gold))
                    same_tags = chosen == sorted(item["gold"])
                    if same_spans and same_tags:
                        continue
                    # Confidence of the model in its own reading: mean max prob of text tokens.
                    confidence = float(scores.max(-1).values.exp().mean())
                    row = item["row"]
                    suspects.append({
                        "id": row["id"], "text": row["text"], "tagList": row["tagList"],
                        "marked": markup(row["text"], gold), "tags": row["tags"],
                        "modelMarked": markup(row["text"], spans), "modelTags": chosen,
                        "spansDiffer": not same_spans, "tagsDiffer": not same_tags,
                        "confidence": round(confidence, 4),
                        "tagProbs": {t: round(p, 3) for t, p in zip(item["tags"], probs)},
                    })
    suspects.sort(key=lambda s: -s["confidence"])
    with open(args.out, "w") as f:
        for s in suspects:
            f.write(json.dumps(s) + "\n")
    print(f"{len(suspects)} of {len(rows)} rows disagree")


if __name__ == "__main__":
    main()
