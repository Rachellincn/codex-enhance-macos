// Adapted from readAppendedUsageLines in Codex Usage Monitor (MIT).
// Copyright (c) 2026 Codex Usage Monitor contributors. See licenses/.
import fs from 'node:fs';

export class JsonlTail {
  constructor(file, onRecord, onMalformed = null) {
    this.file = file;
    this.onRecord = onRecord;
    this.onMalformed = onMalformed;
    this.offset = 0;
    this.pending = Buffer.alloc(0);
    this.identity = null;
    this.malformed = 0;
    this.dropped = 0;
    this.discarding = false;
  }

  read(maxBytes = 8 * 1024 * 1024) {
    let handle;
    try {
      handle = fs.openSync(this.file, 'r');
      const st = fs.fstatSync(handle);
      const identity = `${st.dev}:${st.ino}:${st.birthtimeMs}`;
      const reset = this.identity !== null && (identity !== this.identity || st.size < this.offset);
      if (reset) { this.offset = 0; this.pending = Buffer.alloc(0); this.discarding = false; }
      this.identity = identity;
      let read = 0;
      while (this.offset < st.size && read < maxBytes) {
        const chunk = Buffer.allocUnsafe(Math.min(256 * 1024, st.size - this.offset, maxBytes - read));
        const n = fs.readSync(handle, chunk, 0, chunk.length, this.offset);
        if (!n) break;
        this.offset += n; read += n;
        const data = this.pending.length ? Buffer.concat([this.pending, chunk.subarray(0, n)]) : chunk.subarray(0, n);
        let start = 0;
        for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, start)) {
          const line = data.subarray(start, end);
          start = end + 1;
          if (this.discarding) { this.discarding = false; continue; }
          // Skip large image/tool payloads which contain no relevant record header.
          const prefix = line.subarray(0, 220).toString('utf8');
          if (!/"type"\s*:\s*"(?:event_msg|turn_context|session_meta|compacted|token_usage_record|response_item)"/.test(prefix)) continue;
          try { this.onRecord(JSON.parse(line.toString('utf8'))); }
          catch (e) { if (e instanceof SyntaxError) { this.malformed++; this.onMalformed?.(prefix); } else throw e; }
        }
        this.pending = Buffer.from(data.subarray(start));
        if (this.pending.length > 32 * 1024 * 1024) {
          this.pending = Buffer.alloc(0); this.discarding = true; this.dropped++;
        }
      }
      return { bytes: read, caughtUp: this.offset >= st.size, reset, malformed: this.malformed, dropped: this.dropped };
    } finally { if (handle !== undefined) fs.closeSync(handle); }
  }
}
