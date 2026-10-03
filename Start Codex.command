#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$ROOT/dist/Codex Enhance.app/Contents/Resources/runtime/node"
if [[ ! -x "$NODE" ]]; then echo '请先运行 scripts/build-macos.sh。'; exit 1; fi
exec "$NODE" "$ROOT/macos/launch.mjs"
