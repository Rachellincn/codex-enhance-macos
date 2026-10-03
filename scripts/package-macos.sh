#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE_BINARY:-$(command -v node || true)}"
VERSION="$("$NODE" -p "JSON.parse(require('fs').readFileSync(process.argv[1])).macVersion" "$ROOT/package.json")"
ARCH="$(uname -m)"
NAME="CodexEnhance-v${VERSION}-macos-${ARCH}"
OUT="$ROOT/artifacts/releases/v$VERSION"
mkdir -p "$OUT"
DMG="$OUT/$NAME.dmg"
if [[ -e "$DMG" ]]; then echo "Release already exists: $DMG" >&2; exit 1; fi
STAGE="$(mktemp -d "$OUT/staging.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
NODE_BINARY="$NODE" APP_OUTPUT="$STAGE/Codex Enhance.app" bash "$ROOT/scripts/build-macos.sh"
ln -s /Applications "$STAGE/Applications"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/README.en.md" "$STAGE/README.en.md"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/"
cp "$ROOT/CHANGELOG.md" "$STAGE/"
cp -R "$ROOT/licenses" "$STAGE/"
mkdir -p "$STAGE/docs" "$STAGE/collector"
cp "$ROOT/docs/macos.md" "$ROOT/docs/macos-changelog.md" "$STAGE/docs/"
cp "$ROOT/collector/prices.json" "$STAGE/collector/"
"$NODE" -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1],JSON.stringify({product:"Codex Enhance for macOS",version:process.argv[2],architecture:process.argv[3],minimumMacOS:"13.5",node:process.version,signing:"ad-hoc; not notarized",builtAtUtc:new Date().toISOString()},null,2)+"\n")' "$STAGE/version.json" "$VERSION" "$ARCH"
hdiutil create -volname "Codex Enhance" -srcfolder "$STAGE" -format UDZO -ov "$DMG"
hdiutil verify "$DMG"
(cd "$OUT" && shasum -a 256 "$NAME.dmg" > SHA256SUMS.txt)
echo "$DMG"
