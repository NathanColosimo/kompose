"""Train the task parser.

uv run python model/train.py --data data/clean/train.final.jsonl --out runs/name [--embeddings potion-base-4M]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from torch import nn

from augment import build_pools, compose, swap_phrases, typo
from features import IGNORE, LABELS, Featurizer, bio_targets, decode_spans, utf16_to_codepoints, viterbi, words_of
from model import Config, TaskParser, load_electra

ROOT = Path(__file__).resolve().parent.parent


def load(paths: list[str]) -> list[dict]:
    """Rows from clean jsonl files, with reviewed labels (gen/review.ts) applied."""
    overrides = {}
    path = ROOT / "data" / "overrides.jsonl"
    if path.exists():
        for line in open(path):
            if line.strip():
                row = json.loads(line)
                overrides[row["text"]] = row
    rows = []
    for path in paths:
        for line in open(path):
            if line.strip():
                row = json.loads(line)
                fixed = overrides.get(row["text"])
                if fixed:
                    row = {**row, "spans": fixed["spans"], "tags": fixed["tags"]}
                row["spans"] = utf16_to_codepoints(row["text"], row["spans"])
                rows.append(row)
    return rows


def is_dev(row: dict) -> bool:
    # Hold out whole generation batches so near-duplicates don't leak.
    batch = "/".join(row["id"].split("/")[:2])
    return int(hashlib.md5(batch.encode()).hexdigest(), 16) % 20 == 0


def fold_of(row: dict, folds: int) -> int:
    batch = "/".join(row["id"].split("/")[:2])
    return int(hashlib.sha1(batch.encode()).hexdigest(), 16) % folds


class Examples(torch.utils.data.Dataset):
    def __init__(self, rows, featurizer, tag_pool, augment):
        self.rows, self.featurizer, self.tag_pool, self.augment = rows, featurizer, tag_pool, augment
        phrases = ROOT / "data" / "phrases.json"
        extra = json.loads(phrases.read_text()) if phrases.exists() else None
        self.pools = build_pools(rows, extra) if augment else {}

    def __len__(self):
        return len(self.rows)

    def tag_list(self, row):
        gold = list(dict.fromkeys(row["tags"]))
        tags = list(row["tagList"])
        if not self.augment:
            return tags, gold
        if random.random() < 0.3:
            tags = [t for t in tags if t in gold or random.random() < 0.6]
        if random.random() < 0.5:
            text_words = words_of(row["text"]) | words_of(" ".join(tags))
            for _ in range(random.randint(1, 4)):
                extra = random.choice(self.tag_pool)
                if extra not in tags and not (words_of(extra) & text_words):
                    tags.append(extra)
        if gold and random.random() < 0.08:
            removed = random.choice(gold)
            tags = [t for t in tags if t != removed]
            gold = [t for t in gold if t != removed]
        if random.random() < 0.04:
            tags, gold = [], []
        random.shuffle(tags)
        return tags, gold

    def __getitem__(self, index):
        row = self.rows[index]
        text = row["text"]
        spans = row["spans"]
        composed = compose(row, self.pools) if self.augment and random.random() < 0.2 else None
        if composed:
            text, spans = composed
        elif self.augment:
            text, spans = swap_phrases(text, spans, self.pools)
        if self.augment:
            text, spans = typo(text, spans)
            roll = random.random()
            changed = text.lower() if roll < 0.15 else text.upper() if roll < 0.18 else text
            if len(changed) == len(text):
                text = changed
        tags, gold = self.tag_list(row)
        encoded = self.featurizer.encode(text, tags)
        return {
            "encoded": encoded,
            "targets": bio_targets(encoded, spans),
            "spans": spans,
            "tag_targets": [1.0 if tag in gold else 0.0 for tag in tags[: len(encoded.tag_positions)]],
            "row": row,
            "text": text,
            "tags": tags[: len(encoded.tag_positions)],
            "gold": gold,
        }


def collate(items):
    n = max(len(item["encoded"].ids) for item in items)
    t = max(1, max(len(item["encoded"].tag_positions) for item in items))
    def pad(values, size, fill):
        return values + [fill] * (size - len(values))
    batch = {
        "ids": torch.tensor([pad(i["encoded"].ids, n, 0) for i in items]),
        "specials": torch.tensor([pad(i["encoded"].specials, n, 0) for i in items]),
        "shapes": torch.tensor([pad(i["encoded"].shapes, n, 0) for i in items]),
        "segments": torch.tensor([pad(i["encoded"].segments, n, 0) for i in items]),
        "spaced": torch.tensor([pad(i["encoded"].spaced, n, 0) for i in items]),
        "overlap": torch.tensor([pad(i["encoded"].overlap, n, 0) for i in items]),
        "mask": torch.tensor([pad([True] * len(i["encoded"].ids), n, False) for i in items]),
        "targets": torch.tensor([pad(i["targets"], n, IGNORE) for i in items]),
        "tag_positions": torch.tensor([pad(i["encoded"].tag_positions, t, -1) for i in items]),
        "tag_targets": torch.tensor([pad(i["tag_targets"], t, -1.0) for i in items]),
    }
    # Which tokens are each tag's words, and which are text words (for similarity).
    members = torch.zeros(len(items), t, n, dtype=torch.bool)
    text_words = torch.zeros(len(items), n, dtype=torch.bool)
    for b, item in enumerate(items):
        e = item["encoded"]
        for k, start in enumerate(e.tag_positions):
            end = e.tag_positions[k + 1] if k + 1 < len(e.tag_positions) else len(e.ids)
            members[b, k, start + 1:end] = True
        for i, special in enumerate(e.specials):
            if special == 0 and e.segments[i] == 0:
                text_words[b, i] = True
    batch["tag_members"] = members
    batch["text_words"] = text_words
    # Pad tokens are real ids 0 with no special; mark them as [PAD] special.
    batch["specials"] = torch.where(batch["mask"], batch["specials"], torch.zeros_like(batch["specials"]))
    return batch, items


def evaluate(model, loader, device, threshold=0.5):
    model.eval()
    stats = {label: [0, 0, 0] for label in LABELS}  # tp, predicted, gold
    tag_tp = tag_pred = tag_gold = 0
    exact_spans = exact_tags = exact_all = total = 0
    with torch.no_grad():
        for batch, items in loader:
            tensors = {k: v.to(device) for k, v in batch.items()}
            span_logits, tag_logits = model(tensors)
            log_probs = span_logits.log_softmax(-1).cpu().tolist()
            tag_probs = torch.sigmoid(tag_logits).cpu().tolist()
            for item, scores, probs in zip(items, log_probs, tag_probs):
                text = item["text"]
                prediction = viterbi(item["encoded"], scores[: len(item["encoded"].ids)])
                predicted = {(s["label"], s["start"], s["end"]) for s in decode_spans(item["encoded"], prediction, text) if s["label"] != "L"}
                gold = {(s["label"], s["start"], s["end"]) for s in item["spans"] if s["label"] != "L"}
                for label in LABELS:
                    p = {s for s in predicted if s[0] == label}
                    g = {s for s in gold if s[0] == label}
                    stats[label][0] += len(p & g)
                    stats[label][1] += len(p)
                    stats[label][2] += len(g)
                chosen = {tag for tag, prob in zip(item["tags"], probs) if prob >= threshold}
                gold_tags = set(item["gold"])
                tag_tp += len(chosen & gold_tags)
                tag_pred += len(chosen)
                tag_gold += len(gold_tags)
                total += 1
                exact_spans += predicted == gold
                exact_tags += chosen == gold_tags
                exact_all += predicted == gold and chosen == gold_tags
    def f1(tp, p, g):
        return 2 * tp / (p + g) if p + g else 1.0
    result = {f"f1_{label}": round(f1(*stats[label]), 4) for label in LABELS}
    result.update(
        exact_spans=round(exact_spans / total, 4),
        exact_tags=round(exact_tags / total, 4),
        exact_all=round(exact_all / total, 4),
        tag_precision=round(tag_tp / tag_pred, 4) if tag_pred else 1.0,
        tag_recall=round(tag_tp / tag_gold, 4) if tag_gold else 1.0,
    )
    model.train()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--embeddings", default="potion-base-4M")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1.5e-3)
    parser.add_argument("--embedding-lr", type=float, default=2e-4)
    parser.add_argument("--pretrained-lr", type=float, default=1e-4)
    parser.add_argument("--keep-layers", type=int, default=0, help="pretrained encoders: use only the first N layers (faster)")
    parser.add_argument("--dim", type=int, default=160)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--heads", type=int, default=4)
    parser.add_argument("--ffn", type=int, default=448)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--fold", default="", help="k/n: hold out fold k of n (for out-of-fold predictions)")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    embedding_dir = ROOT / "data" / "embeddings" / args.embeddings
    featurizer = Featurizer(str(embedding_dir / "tokenizer.json"))
    electra = args.embeddings.startswith("electra")
    weights = load_file(str(embedding_dir / "model.safetensors"))
    embeddings = (weights["electra.embeddings.word_embeddings.weight"] if electra else weights["embeddings"]).float()

    rows = load(args.data)
    if args.fold:
        # k/n: train on every batch outside fold k; that fold is the dev set.
        k, n = (int(x) for x in args.fold.split("/"))
        dev_rows = [r for r in rows if fold_of(r, n) == k]
        train_rows = [r for r in rows if fold_of(r, n) != k]
    else:
        train_rows = [r for r in rows if not is_dev(r)]
        dev_rows = [r for r in rows if is_dev(r)]
    if not dev_rows:  # tiny runs: hold out every 10th row instead
        dev_rows, train_rows = rows[::10], [r for i, r in enumerate(rows) if i % 10]
    tag_pool = sorted({tag for r in train_rows for tag in r["tagList"]})
    print(f"{len(train_rows)} train, {len(dev_rows)} dev, {len(tag_pool)} distinct tags", flush=True)

    if electra:
        pretrained = json.loads((embedding_dir / "config.json").read_text())
        config = Config(
            arch="electra", dim=pretrained["hidden_size"], layers=args.keep_layers or pretrained["num_hidden_layers"],
            heads=pretrained["num_attention_heads"], ffn=pretrained["intermediate_size"], dropout=args.dropout,
            embedding_dim=embeddings.shape[1], vocab=embeddings.shape[0],
        )
        model = TaskParser(config)
        load_electra(model, str(embedding_dir / "model.safetensors"), featurizer.tokenizer.get_vocab())
        model = model.to(device)
    else:
        config = Config(
            dim=args.dim, layers=args.layers, heads=args.heads, ffn=args.ffn, dropout=args.dropout,
            embedding_dim=embeddings.shape[1], vocab=embeddings.shape[0],
        )
        model = TaskParser(config, embeddings).to(device)
    encoder_params = sum(p.numel() for n, p in model.named_parameters() if not n.startswith("words."))
    print(f"encoder parameters: {encoder_params:,}; embedding table: {embeddings.numel():,}", flush=True)

    train_loader = torch.utils.data.DataLoader(
        Examples(train_rows, featurizer, tag_pool, augment=True), batch_size=args.batch, shuffle=True, collate_fn=collate, num_workers=4, persistent_workers=True
    )
    dev_loader = torch.utils.data.DataLoader(
        Examples(dev_rows, featurizer, tag_pool, augment=False), batch_size=128, collate_fn=collate, num_workers=2
    )
    # Pretrained parts fine-tune gently; new parts (features, heads) learn at --lr.
    pretrained_prefixes = ("layers.", "project.", "positions.", "segments.", "embed_norm.") if electra else ()
    groups = {"words": [], "pretrained": [], "new": []}
    for name, parameter in model.named_parameters():
        key = "words" if name.startswith("words.") else "pretrained" if name.startswith(pretrained_prefixes) else "new"
        groups[key].append(parameter)
    optimizer = torch.optim.AdamW(
        [
            {"params": groups["words"], "lr": args.embedding_lr, "weight_decay": 0.0},
            {"params": groups["pretrained"], "lr": args.pretrained_lr, "weight_decay": 0.01},
            {"params": groups["new"], "lr": args.lr, "weight_decay": 0.01},
        ]
    )
    steps = args.epochs * len(train_loader)
    warmup = max(1, min(500, steps // 10))
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda s: min(1.0, (s + 1) / warmup) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps)))
    )
    span_loss = nn.CrossEntropyLoss(ignore_index=IGNORE)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    best = -1.0
    started = time.time()
    for epoch in range(args.epochs):
        total = 0.0
        for step, (batch, _) in enumerate(train_loader):
            tensors = {k: v.to(device) for k, v in batch.items()}
            span_logits, tag_logits = model(tensors)
            loss = span_loss(span_logits.reshape(-1, span_logits.shape[-1]), tensors["targets"].reshape(-1))
            tag_mask = tensors["tag_targets"] >= 0
            if tag_mask.any():
                loss = loss + nn.functional.binary_cross_entropy_with_logits(
                    tag_logits[tag_mask], tensors["tag_targets"][tag_mask], pos_weight=torch.tensor(2.0, device=device)
                )
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            total += loss.item()
        metrics = evaluate(model, dev_loader, device)
        print(f"epoch {epoch + 1} loss {total / len(train_loader):.4f} {json.dumps(metrics)} {time.time() - started:.0f}s", flush=True)
        if metrics["exact_all"] > best:
            best = metrics["exact_all"]
            save_file({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}, str(out / "model.safetensors"))
            (out / "config.json").write_text(json.dumps({**config.to_dict(), "embeddings": args.embeddings, "dev": metrics}, indent=1))
    print(f"best dev exact_all {best}")


if __name__ == "__main__":
    main()
