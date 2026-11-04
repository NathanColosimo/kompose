"""Train the task parser (see README.md for the recipe).

uv run python model/train.py --data data/clean/<name>.final.jsonl... --out runs/<name>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file
from torch import nn

from augment import build_pools, compose, holiday_in_title, holiday_pools, swap_holiday, swap_phrases, typo
from features import IGNORE, LABELS, ROOT, Featurizer, bio_targets, decode_spans, utf16_to_codepoints, viterbi, words_of
from model import Config, TaskParser, load_electra, load_run


def read_jsonl(path) -> list[dict]:
    return [json.loads(line) for line in open(path) if line.strip()]


def load(paths: list[str]) -> list[dict]:
    """Rows from clean jsonl files, with reviewed labels (data/overrides.jsonl) applied."""
    overrides = {row["text"]: row for row in read_jsonl(ROOT / "data/overrides.jsonl")}
    rows = []
    for path in paths:
        for row in read_jsonl(path):
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


class Examples(torch.utils.data.Dataset):
    def __init__(self, rows, featurizer, tag_pool, augment):
        self.rows, self.featurizer, self.tag_pool, self.augment = rows, featurizer, tag_pool, augment
        if augment:
            self.pools = build_pools(rows, json.loads((ROOT / "data/phrases.json").read_text()))
            self.holidays = holiday_pools(self.pools)

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
        transfer = row.get("transfer", False)
        if self.augment and not transfer:
            composed = compose(row, self.pools) if random.random() < 0.2 else None
            if composed:
                text, spans = composed
            else:
                text, spans = swap_phrases(text, spans, self.pools)
        # The teachers miss most holidays and never saw misspelled dates, so
        # examples given those are learned from their labels alone.
        teach = True
        if self.augment:
            text, spans, typed = typo(text, spans)
            teach = typed in (None, "T", "D")
            if not transfer:
                roll = random.random()
                changed = None
                if roll < 0.06:
                    changed = swap_holiday(text, spans, self.holidays)
                elif roll < 0.09:
                    changed = holiday_in_title(text, spans)
                if changed:
                    text, spans = changed
                    teach = False
            roll = random.random()
            changed = text
            if roll < 0.15:
                changed = text.lower()
            elif roll < 0.18:
                changed = text.upper()
            # Case changes that change the length ("İ") would move the spans.
            if len(changed) == len(text):
                text = changed
        tags, gold = self.tag_list(row)
        encoded = self.featurizer.encode(text, tags)
        targets = bio_targets(encoded, spans)
        tag_count = len(encoded.tag_positions)
        return {
            "encoded": encoded,
            "targets": [IGNORE] * len(targets) if transfer else targets,
            # The teacher covers every text token; transfer rows (unlabelled) only have it.
            "distill": [teach and t != IGNORE for t in targets],
            "spans": spans,
            "tag_targets": [-1.0] * tag_count if transfer else [1.0 if tag in gold else 0.0 for tag in tags[:tag_count]],
            "text": text,
            "tags": tags[:tag_count],
            "gold": gold,
        }


def pad(values, size, fill):
    return values + [fill] * (size - len(values))


def inputs(encodeds) -> dict[str, torch.Tensor]:
    """The model inputs of a batch of encoded texts."""
    n = max(len(e.ids) for e in encodeds)
    t = max(1, max(len(e.tag_positions) for e in encodeds))
    batch = {
        "ids": torch.tensor([pad(e.ids, n, 0) for e in encodeds]),
        "specials": torch.tensor([pad(e.specials, n, 0) for e in encodeds]),
        "shapes": torch.tensor([pad(e.shapes, n, 0) for e in encodeds]),
        "segments": torch.tensor([pad(e.segments, n, 0) for e in encodeds]),
        "spaced": torch.tensor([pad(e.spaced, n, 0) for e in encodeds]),
        "overlap": torch.tensor([pad(e.overlap, n, 0) for e in encodeds]),
        "mask": torch.tensor([pad([True] * len(e.ids), n, False) for e in encodeds]),
        "tag_positions": torch.tensor([pad(e.tag_positions, t, -1) for e in encodeds]),
        "tag_valid": torch.tensor([pad([True] * len(e.tag_positions), t, False) for e in encodeds]),
    }
    # Which tokens are each tag's words, and which are text words (for similarity).
    members = torch.zeros(len(encodeds), t, n, dtype=torch.bool)
    text_words = torch.zeros(len(encodeds), n, dtype=torch.bool)
    for b, e in enumerate(encodeds):
        for k, start in enumerate(e.tag_positions):
            end = e.tag_positions[k + 1] if k + 1 < len(e.tag_positions) else len(e.ids)
            members[b, k, start + 1:end] = True
        for i, special in enumerate(e.specials):
            if special == 0 and e.segments[i] == 0:
                text_words[b, i] = True
    batch["tag_members"] = members
    batch["text_words"] = text_words
    return batch


def collate(items):
    """Inputs plus training targets, and the items themselves (for evaluate)."""
    batch = inputs([item["encoded"] for item in items])
    n, t = batch["ids"].shape[1], batch["tag_valid"].shape[1]
    batch["targets"] = torch.tensor([pad(i["targets"], n, IGNORE) for i in items])
    batch["distill"] = torch.tensor([pad(i["distill"], n, False) for i in items])
    batch["tag_targets"] = torch.tensor([pad(i["tag_targets"], t, -1.0) for i in items])
    return batch, items


def evaluate(model, loader, device):
    model.eval()
    stats = {label: [0, 0, 0] for label in LABELS}  # tp, predicted, gold
    tag_tp = tag_pred = tag_gold = 0
    exact_spans = exact_tags = exact_all = total = 0
    with torch.no_grad():
        for batch, items in loader:
            span_logits, tag_logits = model({k: v.to(device) for k, v in batch.items()})
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
                chosen = {tag for tag, prob in zip(item["tags"], probs) if prob >= 0.5}
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


DISTILL_TEMPERATURE = 2.0
# Share of the loss that comes from the teachers.
DISTILL_WEIGHT = 0.5


def fake_quantize_activations(x: torch.Tensor) -> torch.Tensor:
    """Each token's [min, max] mapped onto ±63 around its midpoint, as the
    WebAssembly kernel does; gradients pass straight through."""
    low, high = x.amin(-1, keepdim=True), x.amax(-1, keepdim=True)
    middle = (high + low) / 2
    step = ((high - low) / 2).clamp_min(1e-8) / 63
    rounded = torch.round((x - middle) / step).clamp(-63, 63) * step + middle
    return x + (rounded - x).detach()


def fake_quantize_weight(w: torch.Tensor) -> torch.Tensor:
    """Per-row int8, as export.py quantize; gradients pass straight through."""
    step = w.abs().amax(-1, keepdim=True).clamp_min(1e-8) / 127
    return w + (torch.round(w / step).clamp(-127, 127) * step - w).detach()


class QuantizedLinear(nn.Linear):
    def forward(self, x):
        return nn.functional.linear(fake_quantize_activations(x), fake_quantize_weight(self.weight), self.bias)


def quantize_aware(model: nn.Module):
    """Linear layers that export.py stores as int8 run through the runtime's
    rounding (export.py: 2-D weights with at least 4096 values). The class is
    swapped, not the method, so EMA's deep copy keeps it."""
    count = 0
    for module in model.modules():
        if type(module) is nn.Linear and module.weight.numel() >= 4096:
            module.__class__ = QuantizedLinear
            count += 1
    print(f"quantization-aware: {count} linear layers", flush=True)


def distill_loss(span_logits, tag_logits, teacher_spans, teacher_tags, tensors):
    """KL to the teacher's softened span distribution on text tokens, plus
    cross-entropy to its tag probabilities."""
    t = DISTILL_TEMPERATURE
    tokens = tensors["distill"]
    student = nn.functional.log_softmax(span_logits[tokens] / t, dim=-1)
    target = nn.functional.softmax(teacher_spans[tokens] / t, dim=-1)
    loss = nn.functional.kl_div(student, target, reduction="batchmean") * t * t
    tag_mask = tensors["tag_valid"]
    if tag_mask.any():
        loss = loss + nn.functional.binary_cross_entropy_with_logits(
            tag_logits[tag_mask], torch.sigmoid(teacher_tags[tag_mask])
        )
    return loss


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--lr", type=float, default=1.5e-3)
    parser.add_argument("--embedding-lr", type=float, default=2e-4)
    parser.add_argument("--pretrained-lr", type=float, default=1e-4)
    parser.add_argument("--teacher", nargs="*", default=[], help="runs/<name>...: distill their averaged span and tag predictions")
    parser.add_argument("--transfer", nargs="*", default=[], help="data/transfer/*.jsonl: unlabelled rows learned only from the teacher")
    parser.add_argument("--qat", action="store_true", help="train through the runtime's int8 rounding: int8 weights and 7-bit activations (kernel.ts)")
    parser.add_argument("--init-from", default="", help="runs/<name>: start from a trained run's weights (same shape)")
    args = parser.parse_args()

    random.seed(0)
    torch.manual_seed(0)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    featurizer = Featurizer()

    rows = load(args.data)
    train_rows = [r for r in rows if not is_dev(r)]
    dev_rows = [r for r in rows if is_dev(r)]
    if args.transfer:
        if not args.teacher:
            raise SystemExit("--transfer rows are only learned through --teacher")
        transfer_rows = [row for path in args.transfer for row in read_jsonl(path)]
        print(f"{len(transfer_rows)} transfer rows (teacher-labelled)", flush=True)
        train_rows = train_rows + transfer_rows
    tag_pool = sorted({tag for r in train_rows for tag in r["tagList"]})
    print(f"{len(train_rows)} train, {len(dev_rows)} dev, {len(tag_pool)} distinct tags", flush=True)

    model = TaskParser(Config())
    if args.init_from:
        model.load_state_dict(load_file(str(Path(args.init_from) / "model.safetensors")))
    else:
        load_electra(model, featurizer.tokenizer.get_vocab())
    model = model.to(device)
    if args.qat:
        quantize_aware(model)

    train_loader = torch.utils.data.DataLoader(
        Examples(train_rows, featurizer, tag_pool, augment=True), batch_size=64, shuffle=True, collate_fn=collate, num_workers=4, persistent_workers=True
    )
    dev_loader = torch.utils.data.DataLoader(
        Examples(dev_rows, featurizer, tag_pool, augment=False), batch_size=128, collate_fn=collate, num_workers=2
    )
    # Pretrained parts fine-tune gently; new parts (features, heads) learn at --lr.
    pretrained_prefixes = ("layers.", "project.", "positions.", "segments.", "embed_norm.")
    groups = {"words": [], "pretrained": [], "new": []}
    for name, parameter in model.named_parameters():
        if name.startswith("words."):
            groups["words"].append(parameter)
        elif name.startswith(pretrained_prefixes):
            groups["pretrained"].append(parameter)
        else:
            groups["new"].append(parameter)
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
    teachers = [load_run(Path(run)).to(device) for run in args.teacher]
    # An exponential moving average of the weights is usually a little better
    # than the last step; it is what gets evaluated and saved.
    ema = torch.optim.swa_utils.AveragedModel(model, multi_avg_fn=torch.optim.swa_utils.get_ema_multi_avg_fn(0.999))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    best = -1.0
    started = time.time()
    for epoch in range(args.epochs):
        total = 0.0
        for step, (batch, _) in enumerate(train_loader):
            tensors = {k: v.to(device) for k, v in batch.items()}
            span_logits, tag_logits = model(tensors)
            targets = tensors["targets"]
            if (targets != IGNORE).any():
                loss = span_loss(span_logits.reshape(-1, span_logits.shape[-1]), targets.reshape(-1))
            else:  # only transfer rows
                loss = span_logits.sum() * 0.0
            tag_mask = tensors["tag_targets"] >= 0
            if tag_mask.any():
                loss = loss + nn.functional.binary_cross_entropy_with_logits(
                    tag_logits[tag_mask], tensors["tag_targets"][tag_mask], pos_weight=torch.tensor(2.0, device=device)
                )
            if teachers:
                with torch.no_grad():
                    outputs = [teacher(tensors) for teacher in teachers]
                    teacher_spans = torch.stack([o[0] for o in outputs]).mean(0)
                    teacher_tags = torch.stack([o[1] for o in outputs]).mean(0)
                loss = (1 - DISTILL_WEIGHT) * loss + DISTILL_WEIGHT * distill_loss(
                    span_logits, tag_logits, teacher_spans, teacher_tags, tensors
                )
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            ema.update_parameters(model)
            total += loss.item()
            if step % 500 == 499:
                print(f"  step {step + 1}/{len(train_loader)} loss {total / (step + 1):.4f} {time.time() - started:.0f}s", flush=True)
        metrics = evaluate(ema.module, dev_loader, device)
        print(f"epoch {epoch + 1} loss {total / len(train_loader):.4f} {json.dumps(metrics)} {time.time() - started:.0f}s", flush=True)
        if metrics["exact_all"] > best:
            best = metrics["exact_all"]
            save_file({k: v.detach().cpu().contiguous() for k, v in ema.module.state_dict().items()}, str(out / "model.safetensors"))
            (out / "config.json").write_text(json.dumps({**vars(model.config), "dev": metrics}, indent=1))
    print(f"best dev exact_all {best}")


if __name__ == "__main__":
    main()
