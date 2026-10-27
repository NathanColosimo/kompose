#!/bin/sh
# Run a training script from a frozen copy of model/, so editing model/*.py
# during a long run can't break it (DataLoader workers re-import the code).
# Usage: ./run-snapshot.sh <name> <script.py> [args...]
set -e
name=$1; script=$2; shift 2
snap=/tmp/task-parser-snap/$name
rm -rf "$snap" && mkdir -p "$snap" && cp model/*.py "$snap/"
TRAINING_ROOT="$PWD" exec uv run python "$snap/$script" "$@"
