#!/bin/sh
# Train, export and score a run on the hand-written suite.
# Usage: ./train-eval.sh <name> [train.py args...]
set -e
name=$1; shift
uv run python model/train.py --out runs/$name "$@"
uv run python model/export.py runs/$name --out runs/$name/task-parser.bin
bun gen/evaluate.ts runs/$name handwritten
