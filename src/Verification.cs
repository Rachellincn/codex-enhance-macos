using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;

namespace CodexEnhance;
public static class Verification
{
    public static void Run(string output)
    {
        var checks = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException(name); checks.Add(name); }
        var now = DateTimeOffset.UtcNow; var d = new Disclosure(false);
        d.Observe(Array.Empty<string>(), now); Check(!d.Expanded && !d.ToolsExpanded, "normal does not force expand");
        d.Observe(new[] { "a" }, now); Check(d.Expanded && d.ToolsExpanded && !d.UserExpanded, "new attention temporarily expands both layers");
        d.SetExpanded(false); d.Observe(new[] { "a" }, now); Check(!d.Expanded, "same attention does not reopen after dismissal");
        d.Observe(new[] { "a", "b" }, now); Check(d.Expanded && d.ToolsExpanded, "new distinct attention can be shown");
        d.Observe(Array.Empty<string>(), now); d.Observe(Array.Empty<string>(), now.AddSeconds(5)); Check(!d.Expanded && !d.ToolsExpanded, "recovery restores prior user state");
        d.SetExpanded(true); d.ToggleTools(); d.Observe(Array.Empty<string>(), now.AddSeconds(10)); Check(d.Expanded && d.ToolsExpanded, "manual expansion survives normal state");
        var escalation = new Disclosure(false); escalation.Observe(new[] { "call:warning" }, now); escalation.SetExpanded(false);
        escalation.Observe(new[] { "call:critical" }, now.AddSeconds(1)); Check(escalation.Expanded, "severity escalation is a new attention event");
        escalation.SetExpanded(false); escalation.Observe(new[] { "call:critical" }, now.AddSeconds(2)); Check(!escalation.Expanded, "dismissed critical does not repeatedly reopen");
        var settings = new Settings { Expanded = true, ManualThreadId = "test", TopOffset = 155.5, RightOffset = 18, FollowMode = false };
        var restored = JsonSerializer.Deserialize<Settings>(JsonSerializer.Serialize(settings, Settings.JsonOptions), Settings.JsonOptions)!;
        Check(restored.Expanded && restored.TopOffset == 155.5 && restored.ManualThreadId == "test" && !restored.FollowMode, "settings round trip preserves selection and geometry");
        var oldSettings = JsonSerializer.Deserialize<Settings>("{}", Settings.JsonOptions)!;
        Check(!oldSettings.QuotaIncludeAstraLongContext && oldSettings.QuotaNormalizeFast, "quota migration defaults Astra off and Fast on");
        settings.QuotaIncludeAstraLongContext = true; settings.QuotaNormalizeFast = false;
        restored = JsonSerializer.Deserialize<Settings>(JsonSerializer.Serialize(settings, Settings.JsonOptions), Settings.JsonOptions)!;
        Check(restored.QuotaIncludeAstraLongContext && !restored.QuotaNormalizeFast, "quota switches survive settings round trip");
        var previousStateDirectory = Environment.GetEnvironmentVariable("CODEX_ENHANCE_STATE_DIR");
        try {
            Environment.SetEnvironmentVariable("CODEX_ENHANCE_STATE_DIR", Path.Combine(Path.GetDirectoryName(Path.GetFullPath(output))!, "verification-settings"));
            settings.Save(); var diskSettings = Settings.Load();
            Check(diskSettings.QuotaIncludeAstraLongContext && !diskSettings.QuotaNormalizeFast && diskSettings.TopOffset==155.5, "quota switches persist on disk without changing other preferences");
        } finally { Environment.SetEnvironmentVariable("CODEX_ENHANCE_STATE_DIR", previousStateDirectory); }
        var quota = JsonNode.Parse("""{"usedPercent":10,"quotaBaseUsd":0.53,"astraPremiumUsd":0.505,"quotaFastPremiumUsd":0.795,"astraFastPremiumUsd":0.7575,"estimateReasons":[]}""")!;
        foreach (var (astra, fast, expected) in new[] { (false,false,.53), (true,false,1.035), (false,true,1.325), (true,true,2.5875) }) {
            var f = MainWindow.QuotaFigures(quota,astra,fast,false);
            Check(Math.Abs(f.Used!.Value-expected)<1e-9 && Math.Abs(f.Total!.Value-expected*10)<1e-9 && Math.Abs(f.Remaining!.Value-expected*9)<1e-9, $"quota UI arithmetic Astra={astra} Fast={fast}");
        }
        Check(MainWindow.QuotaFigures(quota,false,true,true).Total is null, "quota UI withholds partial indexing projection");
        quota["estimateReasons"] = new JsonArray("parse_errors");
        Check(MainWindow.QuotaFigures(quota,false,true,false).Total is null, "quota UI withholds incomplete current-window projection");
        var secret = JsonNode.Parse("""{"title":"PRIVATE","threadId":"PRIVATE","context":{"used":100,"path":"PRIVATE"},"tools":{"items":[{"name":"PRIVATE","command":"PRIVATE","detail":"PRIVATE","severity":"error","exitCode":1,"durationMs":12}]},"connection":{"cdp":"connected","runtime":true,"message":"PRIVATE"}}""")!.AsObject();
        string report = DiagnosticReport.Create(secret).ToJsonString();
        Check(!report.Contains("PRIVATE") && report.Contains("exitCode") && report.Contains("100"), "diagnostic export contains allowed metrics without private snapshot fields");
        var owner = new Window { Width = 200, Height = 100, ShowInTaskbar = false, ShowActivated = false };
        var attached = new Window { Width = 100, Height = 80, ShowInTaskbar = false, ShowActivated = false };
        var ownerHandle = new WindowInteropHelper(owner).EnsureHandle(); var attachedHandle = new WindowInteropHelper(attached).EnsureHandle();
        new WindowInteropHelper(attached).Owner = ownerHandle;
        Native.AttachToHost(attachedHandle, ownerHandle);
        Check(Native.GetWindow(attachedHandle, 4) == ownerHandle, "overlay has a native owner");
        Check((Native.GetWindowLongPtr(attachedHandle, -20).ToInt64() & 8) == 0, "owned overlay is not globally topmost");
        owner.Show(); attached.Show();
        Check(Native.GetWindow(attachedHandle, 4) == ownerHandle, "WPF Show preserves the native host owner");
        attached.Hide(); attached.Show();
        Check(Native.GetWindow(attachedHandle, 4) == ownerHandle, "WPF hide/show keeps the host attachment");
        var other = new Window { Width = 200, Height = 100, ShowInTaskbar = false, ShowActivated = false }; other.Show(); other.Activate();
        Check(Native.IsWindowVisible(attachedHandle), "switching to another window does not hide an owned overlay");
        owner.WindowState = WindowState.Minimized;
        Check(!Native.IsWindowVisible(attachedHandle), "minimizing the owner hides its overlay");
        other.Close();
        attached.Close(); owner.Close();
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
        File.WriteAllText(output, JsonSerializer.Serialize(new { passed = checks.Count, checks }, Settings.JsonOptions));
    }
}
