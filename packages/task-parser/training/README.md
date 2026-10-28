# Training the task parser

The labels are defined in [SPEC.md](SPEC.md). Data, runs and logs live in
`data/`, `runs/` and `logs/` (not in git). TypeScript runs with `bun` from
this directory; Python runs with `uv run`.

## Data (Codex)

1. `bun gen/seeds.ts`, then `bun gen/split.ts`: tag lists and personas,
   15% held out for the test set (`personas.json` is the train split of
   `personas-all.json`).
2. `bun gen/generate.ts <name> <batches>` (Luna-written examples) or
   `bun gen/solwrite.ts <name> <calls>` (Sol-written inputs, the larger win).
3. `bun gen/finalize.ts <name>`: Sol labels every example (it can run
   alongside step 2).
4. `bun gen/validate.ts <name>`: spec checks → `data/clean/<name>.final.jsonl`.
5. `bun gen/transfer.ts <raw name>`: unlabelled texts for distillation.
6. `bun gen/phrases.ts`: extra date phrases for the phrase-swap augmentation.

The test set (`gen/testset.ts`) and the date benchmark (`gen/datebench.ts`)
are built independently of the training data; see their headers.

## The shipped model (v21q)

Each generation distills from the previous ones (start with no `--teacher`).
`DATA` is `data/clean/{train-merged,train2-merged,train3-merged}.final.jsonl`
(labelled under an earlier scheme, kept as they are),
`data/clean/{train4,train5,train6,pilot2,train7}.final.jsonl` and
`data/clean/solw1.final.jsonl` four times (upweighted).
`data/overrides.jsonl` (reviewed relabels that `model/train.py` applies on
load) is a frozen artifact: the scripts that produced it were removed.

```sh
./run-snapshot.sh v18 train.py --data $DATA --epochs 8 \
  --teacher runs/v17-kd runs/v16-kd runs/v15-kd \
  --transfer data/transfer/train8.jsonl --out runs/v18-kd
# Quantization-aware fine-tune for the int8 kernel.
./run-snapshot.sh v18q train.py --data $DATA --init-from runs/v18-kd --qat \
  --epochs 2 --pretrained-lr 3e-5 --lr 3e-4 --embedding-lr 5e-5 \
  --teacher runs/v18-kd runs/v17-kd runs/v16-kd \
  --transfer data/transfer/train8.jsonl --out runs/v18q
# The same fine-tune again from v18q, after the holiday augmentations
# (misspelled dates, holiday swaps, holidays inside titles) were added.
./run-snapshot.sh v21q train.py --data $DATA --init-from runs/v18q --qat \
  --epochs 2 --pretrained-lr 3e-5 --lr 3e-4 --embedding-lr 5e-5 \
  --teacher runs/v18-kd runs/v17-kd runs/v16-kd \
  --transfer data/transfer/train8.jsonl --out runs/v21q
uv run python model/export.py runs/v21q   # → runs/v21q/task-parser.bin
bun gen/evaluate.ts runs/v21q both
# test 66.6% all right, 79.3% usable; handwritten 85.0%; holidays 82.6%
```

`testset/holidays.json` checks holidays: misspelled ones that date the task
and ones inside a title that don't.

To ship, copy `runs/<name>/task-parser.bin` to `../task-parser.bin`. To
check the TypeScript forward pass, run
`uv run python model/dump_logits.py runs/<name> data/clean/train-merged.final.jsonl 300`,
then `bun test` with `TASK_PARSER_RUN=$PWD/runs/<name>`. The tokenizer and
feature parity tests read the files that
`uv run python model/dump_parity.py data/clean/pilot.jsonl data/clean/pilot2.final.jsonl`
writes.
