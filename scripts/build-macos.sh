#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE_BINARY:-$(command -v node || true)}"
if [[ -z "$NODE" ]] || ! "$NODE" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' ; then
  echo '需要 Node.js 24+。可通过 NODE_BINARY=/绝对路径/node 指定。' >&2; exit 1
fi
APP="${APP_OUTPUT:-$ROOT/dist/Codex Enhance.app}"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime" "$ROOT/artifacts/swift-cache"
xcrun swiftc -O -target "$(uname -m)-apple-macos13.5" -module-cache-path "$ROOT/artifacts/swift-cache" -framework Cocoa -framework SwiftUI -framework Charts "$ROOT"/macos/*.swift -o "$APP/Contents/MacOS/CodexEnhance.new"
mv -f "$APP/Contents/MacOS/CodexEnhance.new" "$APP/Contents/MacOS/CodexEnhance"
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
if otool -L "$NODE" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/Library/|/usr/lib/)' >/dev/null; then
  echo "Node runtime depends on non-system libraries; use a standalone Node.js distribution." >&2; exit 1
fi
cp "$NODE" "$APP/Contents/Resources/runtime/node.new"
codesign --force --sign - "$APP/Contents/Resources/runtime/node.new"
mv -f "$APP/Contents/Resources/runtime/node.new" "$APP/Contents/Resources/runtime/node"
# Replace only this build's resource folders, so removed source files cannot linger.
rm -rf "$APP/Contents/Resources/collector" "$APP/Contents/Resources/licenses"
cp -R "$ROOT/collector" "$APP/Contents/Resources/collector"
mkdir -p "$APP/Contents/Resources/macos"
cp "$ROOT/macos/launch.mjs" "$APP/Contents/Resources/macos/"
cp -R "$ROOT/licenses" "$APP/Contents/Resources/licenses"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/"
"$NODE" -p 'process.release.name + " " + process.version' > "$APP/Contents/Resources/runtime/VERSION.txt"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "$APP"
