using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace CodexEnhance;
public partial class MainWindow
{
    // Export the actual WPF views with synthetic data only. Never read live state.
    private void RenderGallery(string directory)
    {
        if (!preview || !renderMode) throw new InvalidOperationException("Gallery requires render mode.");
        Directory.CreateDirectory(directory);
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var data = Demo(false);
        data["title"] = "示例任务 · 优化项目界面";
        data["connection"]!["message"] = "界面预览 · 所有数值均为示例";
        data["quota"] = JsonNode.Parse("""
          {"state":"ready","plan":"pro","pricingDate":"2026-09-27","indexing":false,"windows":[{"minutes":10080,"usedPercent":24,"remainingPercent":76,"quotaBaseUsd":60,"quotaFastPremiumUsd":24,"astraPremiumUsd":8,"astraFastPremiumUsd":3,"usd":102,"requests":128,"tokens":18200000,"estimateReasons":[]}]}
          """);
        data["quota"]!["checkedAtMs"] = now;
        data["quota"]!["windows"]![0]!["startMs"] = now - 3 * 86400000L;
        data["quota"]!["windows"]![0]!["resetsAtMs"] = now + 4 * 86400000L;
        data["toolHealth"] = JsonNode.Parse("""
          {"state":"ready","watched":{"state":"listed"},"issues":[],"changes":[],"observations":[],"servers":[{"name":"codex_app","runtimeStatus":"connected","authStatus":"unsupported","catalogComplete":true,"toolCount":3,"tools":["read_thread","list_threads","open_in_codex"]},{"name":"cua_repl","runtimeStatus":"connected","authStatus":"unsupported","catalogComplete":true,"toolCount":2,"tools":["js","js_reset"]}]}
          """);
        data["toolHealth"]!["checkedAtMs"] = now;
        settings.Theme = "dark"; ApplyTheme(); disclosure = new Disclosure(true); ApplySnapshot(data);
        Capture(Path.Combine(directory, "overview.png"));
        disclosure.SetExpanded(false); UpdateDisclosure(); Capture(Path.Combine(directory, "compact.png"));
        disclosure.SetExpanded(true); UpdateDisclosure();
        OpenQuota(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "quota.png"));
        OpenCapabilities(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "tools.png"));
        OpenMetrics(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "performance.png"));
        detailWindow?.Close(); detailWindow = null;
        var critical = data.DeepClone().AsObject().WithAttention(true, "critical");
        disclosure = new Disclosure(true); ApplySnapshot(critical); Capture(Path.Combine(directory, "critical.png"));
        settings.Theme = "light"; ApplyTheme(); disclosure = new Disclosure(true); ApplySnapshot(data);
        Capture(Path.Combine(directory, "light.png"));
    }
    private void CaptureGalleryDetail(string file)
    {
        var window = detailWindow ?? throw new InvalidOperationException("No detail window to capture.");
        window.UpdateLayout();
        var visual = (FrameworkElement)window.Content;
        visual.Measure(new Size(window.Width, window.Height));
        visual.Arrange(new Rect(0, 0, window.Width, window.Height)); visual.UpdateLayout();
        const double scale = 2;
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(visual.ActualWidth * scale), (int)Math.Ceiling(visual.ActualHeight * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var output = File.Create(file); encoder.Save(output);
    }
}
