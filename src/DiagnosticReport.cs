using System;
using System.Text.Json.Nodes;

namespace CodexEnhance;
public static class DiagnosticReport
{
    // Deliberately export a whitelist, never a full snapshot with removed fields.
    public static JsonObject Create(JsonObject snapshot)
    {
        var report = new JsonObject { ["format"] = 1, ["createdAt"] = DateTimeOffset.UtcNow.ToString("O"), ["appVersion"] = typeof(DiagnosticReport).Assembly.GetName().Version?.ToString() };
        void Numbers(JsonObject target, JsonNode? source, params string[] keys)
        {
            foreach (var key in keys)
                if (source?[key] is JsonValue v && (v.TryGetValue<double>(out _) || v.TryGetValue<int>(out _) || v.TryGetValue<long>(out _))) target[key] = v.DeepClone();
        }
        Numbers(report, snapshot, "elapsedMs", "ttftMs", "cacheHit", "totalTokens", "compactions", "readErrors", "updatedAtMs");
        foreach (var (name, keys) in new[] {
            ("context", new[] { "used", "limit", "percent", "sampledAtMs" }),
            ("performance", new[] { "progressGapMs", "logGapMs", "baselineMs", "baselineSamples", "ttftRatio", "recentTtftMs", "compactionElapsedMs" }),
            ("lastCompaction", new[] { "before", "after", "durationMs" }),
            ("tools", new[] { "running", "completed", "attention", "notes" }) })
        { var obj = new JsonObject(); Numbers(obj, snapshot[name], keys); report[name] = obj; }
        var connection = new JsonObject();
        connection["connected"] = snapshot["connection"]?["cdp"]?.ToString() == "connected";
        connection["runtime"] = snapshot["connection"]?["runtime"]?.ToString().Equals("true", StringComparison.OrdinalIgnoreCase) == true;
        report["connection"] = connection;
        var records = new JsonArray();
        foreach (var item in snapshot["tools"]?["items"] as JsonArray ?? new JsonArray())
        {
            var record = new JsonObject(); Numbers(record, item, "durationMs", "exitCode");
            foreach (var key in new[] { "severity", "status" })
            {
                string? value = item?[key]?.ToString();
                if (value is "info" or "warning" or "error" or "critical" or "running" or "completed" or "failed" or "interrupted") record[key] = value;
            }
            records.Add(record);
        }
        report["toolRecords"] = records;
        return report;
    }
}
