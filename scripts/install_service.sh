#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME=avater-backend.service
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$PROJECT_ROOT/packaging/$SERVICE_NAME"
UNIT_DST="/etc/systemd/system/$SERVICE_NAME"

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root (sudo) to install the systemd service."
  exit 2
fi

if [ ! -f "$UNIT_SRC" ]; then
  echo "Unit file not found: $UNIT_SRC"
  exit 1
fi

echo "Copying $UNIT_SRC -> $UNIT_DST"
cp "$UNIT_SRC" "$UNIT_DST"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
echo "Service installed and started. Check status with: systemctl status $SERVICE_NAME"
