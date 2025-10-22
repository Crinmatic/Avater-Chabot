#!/usr/bin/env bash
set -euo pipefail

# Creates a .venv in the project root and installs requirements if present.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"

echo "Creating virtual environment at $VENV_DIR"
if [ -d "$VENV_DIR" ]; then
  echo ".venv already exists, skipping creation"
else
  python3 -m venv "$VENV_DIR"
fi

echo "Activating venv and installing requirements (if any)"
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
if [ -f "$ROOT_DIR/requirements.txt" ]; then
  python -m pip install -r "$ROOT_DIR/requirements.txt"
else
  echo "No requirements.txt found at $ROOT_DIR/requirements.txt"
fi
deactivate

echo "Done. To run the backend manually: $VENV_DIR/bin/python backend/server.py"
