# Codex Enhance for macOS

**See what Codex is doing and how local usage is estimated.**

[Download DMG](https://github.com/Rachellincn/codex-enhance-macos/releases/latest) · [中文](README.md) · [English](README.en.md) · [Report an issue](https://github.com/Rachellincn/codex-enhance-macos/issues)

This project integrates [hrx114514x/codex-enhance](https://github.com/hrx114514x/codex-enhance), reuses its Node.js collector from upstream commit `f55ee83` (v0.4.0), and ports the interface to a **native macOS SwiftUI / AppKit floating window**. Thanks to the upstream author and contributors. This repository expands the model pricing catalog, improves quota calculations and weekly history, and adds **tool-call details for the current window**. The upstream Windows source is retained; visit the original project for Windows releases.

This is an independent community project with no official affiliation with OpenAI.

<p>
  <img src="docs/screenshots/macos-calculation.png" width="380" alt="Native macOS dark window: account quota and calculation details" />
  <img src="docs/screenshots/macos-current-window.png" width="380" alt="Native macOS dark window: current window and tool-call details" />
</p>

*Native macOS interface: calculation details and current window.*

## Quick start

1. Install and sign in to the Codex desktop client. Use **macOS 13.5 or later on an Apple Silicon (M-series) Mac**.
2. Download `CodexEnhance-v0.4.0-mac.4-macos-arm64.dmg` from [Releases](https://github.com/Rachellincn/codex-enhance-macos/releases/latest).
3. Open the DMG and drag **Codex Enhance.app** into **Applications**. Eject the disk and launch the app from Applications.
4. View account quota and weekly history. Open the “当前窗口” (Current window) tab for model, context and tool-call details.

Node.js is bundled. No separate Node.js, .NET installation or extra API key is required. Closing the window keeps the menu-bar entry available; press `⌘Q` to quit. Quit the previous version before replacing the app; local settings and history are retained.

The release is ad-hoc signed and **has not been signed with an Apple Developer ID or notarized**. If macOS blocks the first launch, after attempting to open it, go to System Settings → Privacy & Security → Open Anyway, verify the source, and continue. To verify integrity, place the DMG and `SHA256SUMS.txt` in the same directory and run `shasum -a 256 -c SHA256SUMS.txt`.

## Features

| Feature | What it shows |
| --- | --- |
| Native Mac window | Always-on-top mode, compact mode, menu-bar entry and persistent light/dark preferences |
| Account quota | Remaining percentage and reset time from the read-only Codex app-server interface, refreshed every minute |
| Expanded pricing | Separate input, cache-read, cache-write and output rates, with Fast and long-context rules |
| Calculation details | Ordinary costs, surcharges, API-equivalent estimates and Astra / Fast conversion options |
| Weekly history | The latest 26 actual reset cycles, with quota, tokens, estimated cost and sampling gaps |
| Current window | Follow the visible page or pin a task; view model, effort, phase, context and cache-hit ratio |
| Tool-call details | Tool names, status, duration and diagnostic reasons for the current turn; hover for available details, up to 40 entries |

Tool states distinguish completed, failed, running, interrupted and unknown. Missing prices, insufficient samples and incomplete records display “—” with a reason. Voice collection is disabled on Mac; the upstream Windows tool catalog checker and screenshot-gallery interface have not been ported.

## Follow the current page

Account quota refresh does not require a debugging connection. For live page tracking, click “连接…” (Connect) in the floating window, save your work, wait for active tasks to finish, and confirm a normal client restart. The helper requests a local CDP debugging port (9336–9350), bound to `127.0.0.1`; it does not force-kill processes. When live tracking is unavailable, the app labels its view “本地记录” (Local records) and temporarily shows the most recently updated task. You can also manually pin a task.

The helper supports `Codex.app` and `ChatGPT.app` distributions that contain Codex Framework. Client updates and internal-interface changes may affect tracking. With multiple windows, check the selected task and pin it when needed. Upstream response models are shown only when matching records exist.

## Local model pricing catalog

The table below is the release's bundled **estimation configuration**, in **USD per million tokens**, rather than a new verification of current official prices. See [collector/prices.json](collector/prices.json) for full rules. Estimated amounts are not official balances or bills.

| Model | Input | Cache read | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6.1-sol` | $2 | $0.1 | $2.5 | $10 |
| `gpt-6-astra` | $10 | $1 | $12.5 | $50 |
| `gpt-6-sol` | $2 | $0.2 | $2.5 | $10 |
| `gpt-6-luna` | $0.1 | $0.01 | $0.125 | $0.5 |
| `gpt-5.6-sol` | $4 | $0.4 | $5 | $20 |
| `gpt-5.6-terra` | $2 | $0.2 | $2.5 | $12 |
| `codex-auto-review` | $2 | $0.2 | $2.5 | $12 |
| `gpt-5.6-luna` | $0.2 | $0.02 | $0.25 | $1.2 |
| `gpt-5.5` | $5 | $0.5 | — | $30 |
| `gpt-5.4` | $2.5 | $0.25 | — | $15 |

`codex-auto-review` uses the locally specified `gpt-5.6-terra` rules while retaining its original model name. This is not an officially published auto-review price. “—” means a rate is unavailable. Fast and long-context multipliers are defined in the JSON; API-equivalent cost and subscription quota conversion are calculated separately.

The app periodically reads this repository's public JSON catalog, validates its format, size and version, and caches it. Offline operation uses the validated cache or bundled catalog. The request includes no account, task, usage or credentials.

## Data and scope

- Conversations and usage are processed locally. State is stored in `~/Library/Application Support/CodexEnhance`; task databases and logs under `$CODEX_HOME` (default `~/.codex`) are read-only inputs.
- Quota uses the locally signed-in account without creating model tasks or requiring another login.
- API-equivalent cost reflects local records and excludes other devices and voice usage. Quota percentages are not fabricated for unobserved cycles.
- The DMG is Apple Silicon arm64 only. Intel and universal releases are not available. The app interface is currently Chinese; this English README does not imply an English UI.

## Build from source

Requires macOS 13.5+, Xcode Command Line Tools and a **standalone Node.js 24+ runtime**. Packaging rejects Node binaries linked to non-system libraries such as Homebrew dependencies. You can use an official Node.js runtime and specify its absolute path with `NODE_BINARY`.

```bash
npm test
NODE_BINARY=/absolute/path/to/node npm run build:mac
open "dist/Codex Enhance.app"
NODE_BINARY=/absolute/path/to/node npm run package:mac
```

`build:mac` creates the native app. `package:mac` builds a separate app and produces a DMG containing bilingual READMEs and a version manifest, plus SHA-256 checksums in `artifacts/releases/v0.4.0-mac.4/`. Builds target the host architecture; the release requires macOS 13.5 or later.

[macOS guide (Chinese)](docs/macos.md) · [Mac release history](docs/macos-changelog.md) · [Upstream changelog](CHANGELOG.md) · [Third-party notices and licenses](THIRD_PARTY_NOTICES.md)
