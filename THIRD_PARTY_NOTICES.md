# Third-party notices

- **Codex Usage Monitor for Windows**, MIT, Copyright (c) 2026 contributors.
  Source: https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/tree/e0f1a18750df0f2489d68e7205d190dce2a61513
  `collector/tail.mjs` and `collector/cdp.mjs` adapt its incremental reader, CDP request transport and DOM selection approach. Substantial modifications add bounded buffers, focus/ambiguity handling and read-only runtime observation.
  License: `licenses/windows-monitor-MIT.txt`.
- **codex-monitor**, MIT, Copyright (c) 2026 falyx6851-byte.
  Source: https://github.com/falyx6851-byte/codex-monitor/tree/b565aa66adab1f3733a0ad9b95ebe2189a19dca7
  Usage field compatibility in `collector/state.mjs` derives from its session parser. This project has an independent state reducer and does not ship the upstream web server.
  License: `licenses/codex-monitor-MIT.txt`.
- **Microsoft Fluent UI System Icons**, MIT. SVG assets from https://github.com/microsoft/fluentui-system-icons are rendered as native WPF geometry without redesigning their shapes.
  License: `licenses/fluent-icons-MIT.txt`.
- **Node.js**: packaged runtime is copied from the locally installed Node 24 runtime. See `licenses/node-LICENSE.txt` for its runtime and dependency licenses.
- **.NET runtime and Windows Desktop runtime**: self-contained publishing includes Microsoft .NET 10 runtime components. Their licenses and notices are included in `licenses/dotnet-runtime-LICENSE.txt`, `licenses/dotnet-runtime-THIRD-PARTY-NOTICES.txt` and `licenses/dotnet-desktop-LICENSE.txt`.
