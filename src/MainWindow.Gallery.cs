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
        data["connection"]!["message"] = "预览 · 示例数据";
        data["quota"] = JsonNode.Parse("""
          {"state":"ready","plan":"pro","pricingDate":"2026-09-27","indexing":false,"windows":[{"minutes":10080,"usedPercent":24,"remainingPercent":76,"quotaBaseUsd":60,"quotaFastPremiumUsd":24,"astraPremiumUsd":8,"astraFastPremiumUsd":3,"usd":102,"requests":128,"tokens":18200000,"estimateReasons":[]}]}
          """);
        data["quota"]!["checkedAtMs"] = now;
        data["voice"]=new JsonObject { ["state"]="observed",["reportedPhase"]="active",["checkedAtMs"]=now,["billingVerified"]=false };
        data["quota"]!["windows"]![0]!["startMs"] = now - 3 * 86400000L;
        data["quota"]!["windows"]![0]!["resetsAtMs"] = now + 4 * 86400000L;
        data["performance"]!["breakdown"] = JsonNode.Parse("""{"state":"available","totalMs":86000,"classifiedMs":85000,"modelObserved":true,"missingToolTimings":0,"segments":[{"key":"model","label":"思考/响应（估算）","ms":50000},{"key":"tools","label":"工具调用","ms":20000},{"key":"waiting","label":"等待你操作","ms":11000},{"key":"compacting","label":"上下文整理","ms":4000},{"key":"unknown","label":"其他／未分类","ms":1000}]}""");
        var historyRows=new JsonArray();
        for(int i=0;i<3;i++) {
            var row=data["quota"]!["windows"]![0]!.DeepClone();
            row["startMs"]=now-(3+i*7)*86400000L;row["resetsAtMs"]=now+(4-i*7)*86400000L;
            row["checkedAtMs"]=i==0?now:now+(4-i*7)*86400000L-60000;
            row["closed"]=i>0;row["observationGapMs"]=i==0?0:60000;row["fastRequests"]=16;
            row["models"]=JsonNode.Parse("""[{"model":"gpt-6-astra","requests":100,"usd":90},{"model":"gpt-6-sol","requests":28,"usd":12}]""");
            historyRows.Add(row);
        }
        data["quota"]!["history"]=new JsonObject { ["state"]="ready",["entries"]=historyRows };
        data["toolHealth"] = JsonNode.Parse("""
          {"state":"ready","watched":{"state":"listed"},"issues":[],"changes":[],"observations":[],"servers":[{"name":"codex_app","runtimeStatus":"connected","authStatus":"unsupported","catalogComplete":true,"toolCount":3,"tools":["read_thread","list_threads","open_in_codex"]},{"name":"cua_repl","runtimeStatus":"connected","authStatus":"unsupported","catalogComplete":true,"toolCount":2,"tools":["js","js_reset"]}]}
          """);
        data["toolHealth"]!["checkedAtMs"] = now;
        settings.Theme = "dark"; ApplyTheme(); disclosure = new Disclosure(true); ApplySnapshot(data);
        Capture(Path.Combine(directory, "overview.png"));
        bool currentToolPhase = PhaseText.Text == "调用工具" && ElapsedText.Text == "00:20";
        ActivityButton.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
        bool timingOpensDetails = detailWindow?.Title == "Codex · 性能详情";
        detailWindow?.Close(); detailWindow = null;
        var model=data.DeepClone().AsObject(); model["activity"]=new JsonObject { ["kind"]="model",["startedAtMs"]=now-7000,["observedAtMs"]=now,["items"]=new JsonArray() };
        model["tools"]!["running"]=0;ApplySnapshot(model);Capture(Path.Combine(directory,"model-phase.png"));
        bool modelResets=PhaseText.Text=="思考 / 响应"&&ElapsedText.Text=="00:07";
        model["activity"]!["observedAtMs"]=now+4000;ApplySnapshot(model);bool ticks=ElapsedText.Text=="00:11";
        var completed=data.DeepClone().AsObject();completed["phase"]="idle";completed["activity"]=new JsonObject { ["kind"]="complete" };
        completed["tools"]!["running"]=0;completed["tools"]!["completed"]=2;
        completed["tools"]!["items"]=JsonNode.Parse("""[{"id":"a","turnId":"demo-turn","status":"completed","label":"终端执行"},{"id":"b","turnId":"demo-turn","status":"completed","label":"网页检索"}]""");
        ApplySnapshot(completed);Capture(Path.Combine(directory,"completed.png"));
        bool completedHidesTimer=ElapsedText.Visibility==Visibility.Collapsed&&PhaseText.Text=="已完成";
        ApplySnapshot(data);
        File.WriteAllText(Path.Combine(directory,"activity-check.json"),System.Text.Json.JsonSerializer.Serialize(new {currentToolPhase,modelResets,ticks,completedHidesTimer,timingOpensDetails,passed=currentToolPhase&&modelResets&&ticks&&completedHidesTimer&&timingOpensDetails},Settings.JsonOptions));
        disclosure.SetExpanded(false); UpdateDisclosure(); Capture(Path.Combine(directory, "compact.png"));
        disclosure.SetExpanded(true); UpdateDisclosure();
        OpenQuota(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "quota.png"));
        OpenVoice(this,new RoutedEventArgs());
        bool voiceOpens=detailWindow?.Title=="Codex · 语音连接";
        bool mainVoiceRowRemoved=FindName("VoiceButton") is null;
        File.WriteAllText(Path.Combine(directory,"voice-control-check.json"),System.Text.Json.JsonSerializer.Serialize(new {voiceOpens,mainVoiceRowRemoved,passed=voiceOpens&&mainVoiceRowRemoved},Settings.JsonOptions));
        CaptureGalleryDetail(Path.Combine(directory,"voice.png"));
        settings.Theme="light";ApplyTheme();
        var openFrame=(System.Windows.Controls.Border)((System.Windows.Controls.Grid)detailWindow!.Content).Children[1];
        bool openDialogThemeUpdates=((SolidColorBrush)openFrame.Background).Color==Color.FromRgb(252,252,253);
        CaptureGalleryDetail(Path.Combine(directory,"voice-light.png"));
        File.WriteAllText(Path.Combine(directory,"theme-check.json"),System.Text.Json.JsonSerializer.Serialize(new {openDialogThemeUpdates,passed=openDialogThemeUpdates},Settings.JsonOptions));
        settings.Theme="dark";ApplyTheme();
        OpenQuotaHistory(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "weekly-history.png"));
        OpenCapabilities(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "tools.png"));
        OpenMetrics(this, new RoutedEventArgs()); CaptureGalleryDetail(Path.Combine(directory, "performance.png"));
        detailWindow?.Close(); detailWindow = null;
        var critical = data.DeepClone().AsObject().WithAttention(true, "critical");
        disclosure = new Disclosure(true); ApplySnapshot(critical); Capture(Path.Combine(directory, "critical.png"));
        settings.Theme = "light"; ApplyTheme(); disclosure = new Disclosure(true); ApplySnapshot(data);
        Capture(Path.Combine(directory, "light.png"));
        CaptureScene(Path.Combine(directory,"floating-light.png"));
        ApplySnapshot(completed);Capture(Path.Combine(directory,"completed-light.png"));ApplySnapshot(data);
        OpenMetrics(this,new RoutedEventArgs());CaptureGalleryDetail(Path.Combine(directory,"performance-light.png"));
        OpenQuotaHistory(this,new RoutedEventArgs());CaptureGalleryDetail(Path.Combine(directory,"weekly-history-light.png"));
        detailWindow?.Close();detailWindow=null;
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
    private void CaptureScene(string file)
    {
        // Paint the actual native control on a neutral surface so its transparent
        // shadow can be reviewed without the image viewer's black backdrop.
        var scene=new DrawingVisual();
        double w=SurfaceRoot.ActualWidth+40,h=SurfaceRoot.ActualHeight+40;
        using(var context=scene.RenderOpen()) {
            context.DrawRectangle(new SolidColorBrush(Color.FromRgb(241,243,247)),null,new Rect(0,0,w,h));
            context.DrawRectangle(new VisualBrush(SurfaceRoot),null,new Rect(20,20,SurfaceRoot.ActualWidth,SurfaceRoot.ActualHeight));
        }
        var bitmap=new RenderTargetBitmap((int)Math.Ceiling(w*2),(int)Math.Ceiling(h*2),192,192,PixelFormats.Pbgra32);bitmap.Render(scene);
        var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var output=File.Create(file);encoder.Save(output);
    }
}
