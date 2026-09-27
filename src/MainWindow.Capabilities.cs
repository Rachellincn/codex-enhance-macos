using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace CodexEnhance;
public partial class MainWindow
{
    private JsonObject[] ActiveIssues() => (snapshot["tools"]?["issues"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
        .Concat((snapshot["toolHealth"]?["issues"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()).ToArray();

    private string CapabilityLabel()
    {
        var h = snapshot["toolHealth"];
        if (S(h?["state"]) == "checking") return "检查中";
        if (S(h?["state"]) != "ready") return "未验证";
        if ((h?["issues"] as JsonArray)?.Count > 0) return "服务状态失败";
        if (S(h?["watched"]?["state"]) is "missing" or "server_absent" || (h?["changes"] as JsonArray)?.Count > 0) return "目录有差异";
        if ((h?["servers"] as JsonArray)?.OfType<JsonObject>().Any(s => S(s["runtimeStatus"]) != "connected" || !B(s["catalogComplete"])) == true) return "部分未验证";
        return $"{(h?["servers"] as JsonArray)?.Count ?? 0} 个服务已读取";
    }
    private static string CapabilityState(string state) => state switch
    {
        "connected" => "已连接", "failed" => "状态失败", "starting" or "connecting" => "启动中",
        "disconnected" => "未连接", "disabled" => "已停用", _ => "状态未验证"
    };
    private static string ServiceTitle(string name) => name switch {
        "codex_app" => "Codex 应用工具", "codex_apps" => "应用连接器", "cua_repl" => "浏览器工具",
        "node_repl" => "代码执行环境", "creative_production_mcp" => "创作工具", _ => name
    };
    private void OpenCapabilities(object sender, RoutedEventArgs e)
    {
        var stack = DetailStack();
        var heading = Text("", "Text", 16); heading.FontWeight = FontWeights.SemiBold; stack.Children.Add(heading);
        Note(stack, "检查所选任务的 MCP 服务与工具目录，每 30 秒更新。已登记不等于执行成功；模型这一轮最终拿到的工具列表仍未验证。");
        var checkedAt = MetricRow(stack, "最近目录读取");
        var freshness = Text("", "Faint", 11); stack.Children.Add(freshness);
        DateTimeOffset refreshRequestedUntil = DateTimeOffset.MinValue;
        double? requestedAfter = null;
        var refresh = new Button { Content = "重新检查", Padding = new Thickness(12, 7, 12, 7), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 10, 0, 0), Background = BrushFor("Hover") };
        refresh.Click += (_, _) => {
            if (!preview && collector?.IsRunning != true) StartCollector();
            requestedAfter = N(snapshot["toolHealth"]?["checkedAtMs"]);
            refreshRequestedUntil = DateTimeOffset.UtcNow.AddSeconds(4);
            Send("checkTools", currentThread); refresh.Content = "已请求检查"; refresh.IsEnabled = false;
        }; stack.Children.Add(refresh);
        Section(stack, "关注工具");
        var watched = MetricRow(stack, "read_thread");
        var watchNote = Text("", "Muted", 12); watchNote.Margin = new Thickness(0, 7, 0, 0); stack.Children.Add(watchNote);
        Section(stack, "服务与已登记工具");
        var services = new StackPanel(); stack.Children.Add(services);
        var observations = Text("", "Muted", 12); observations.Margin = new Thickness(0, 10, 0, 0); stack.Children.Add(observations);
        var changes = Text("", "Muted", 12); changes.Margin = new Thickness(0, 16, 0, 0); stack.Children.Add(changes);
        Note(stack, "目录减少也可能来自插件设置变化，不会仅凭这一点判定服务故障。检查不执行工具、不重载配置、不恢复旧任务。");
        Detail("Codex · 工具可用性", new ScrollViewer { Content = stack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        string previous = ""; var expanded = new HashSet<string>();
        refreshDetail = () =>
        {
            var h = snapshot["toolHealth"]; string state = S(h?["state"]);
            var latest = N(h?["checkedAtMs"]) ?? N(h?["lastCheckedAtMs"]);
            heading.Text = CapabilityLabel(); checkedAt(LocalTime(latest));
            freshness.Text = preview ? "界面预览 · 示例目录，不自动刷新" : latest is null ? "尚未取得目录" : state == "ready" ? $"{Math.Max(0, (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - latest.Value) / 1000):0} 秒前 · 自动检查间隔 30 秒" : "显示上次读取时间，当前可用性尚未验证";
            if (N(h?["checkedAtMs"]) != requestedAfter) refreshRequestedUntil = DateTimeOffset.MinValue;
            bool queued = DateTimeOffset.UtcNow < refreshRequestedUntil;
            refresh.Content = B(h?["checking"]) ? "检查中…" : queued ? "已请求检查" : "重新检查";
            refresh.IsEnabled = !B(h?["checking"]) && !queued;
            string status = S(h?["watched"]?["state"]);
            watched(status switch { "listed" => "目录已登记", "missing" => "目录未提供", "server_absent" => "未见所属服务", _ => "未验证" });
            watchNote.Text = status switch {
                "listed" => "codex_app 当前工具目录包含 read_thread。",
                "missing" => "codex_app 已连接且目录读取完整，但没有 read_thread。",
                "server_absent" => "完整服务目录中没有 codex_app；不能仅据此区分未启用与未加载。",
                _ => state == "checking" ? "正在读取目录…" : S(h?["reason"]) switch { "thread_not_loaded" => "当前任务未加载，无法验证其工具目录。", "client_disconnected" => "客户端采集连接不可用，无法验证。", "stale" => "目录数据已过期，等待重新检查。", "rechecking" => "连接已恢复，正在重新核实工具目录。", "unsupported_shape" => "客户端目录格式暂不兼容，不能据此认定工具缺失。", _ => "尚未取得完整目录，无法判断工具是否缺失。" }
            };
            string key = h?["servers"]?.ToJsonString() ?? "[]";
            if (key != previous)
            {
                previous = key; services.Children.Clear();
                foreach (var s in (h?["servers"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
                {
                    string name = S(s["name"]); var row = new StackPanel { Margin = new Thickness(0, 0, 0, 14) };
                    MetricRow(row, ServiceTitle(name))($"{CapabilityState(S(s["runtimeStatus"]))} · " + (B(s["catalogComplete"]) ? $"{N(s["toolCount"]) ?? 0} 项" : "数量未确认"));
                    row.ToolTip = name;
                    if (!B(s["catalogComplete"])) Note(row, "工具目录未完整读取，此服务的工具是否缺失尚不能确定。");
                    var list = new StackPanel { Margin = new Thickness(8, 7, 0, 0) };
                    var toolScroll = new ScrollViewer { Content = list, MaxHeight = 180, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Visibility = expanded.Contains(name) ? Visibility.Visible : Visibility.Collapsed };
                    foreach (var tool in s["tools"] as JsonArray ?? new JsonArray()) { var text = Text(S(tool), "Muted", 11); text.Margin = new Thickness(0, 3, 0, 3); list.Children.Add(text); }
                    var toggle = new Button { Content = expanded.Contains(name) ? "收起工具名称" : "查看工具名称", FontSize = 11, Foreground = BrushFor("Accent"), HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(0, 3, 0, 3) };
                    toggle.Click += (_, _) => { bool show = toolScroll.Visibility != Visibility.Visible; if (show) expanded.Add(name); else expanded.Remove(name); toolScroll.Visibility = show ? Visibility.Visible : Visibility.Collapsed; toggle.Content = show ? "收起工具名称" : "查看工具名称"; };
                    row.Children.Add(toggle); row.Children.Add(toolScroll); services.Children.Add(row);
                }
            }
            var diffs = (h?["changes"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToArray();
            changes.Text = diffs.Length == 0 ? "" : "较此前目录有变化：\n" + string.Join("\n", diffs.Select(d => {
                if (S(d["kind"]) == "server_absent") return S(d["server"]) + "：目录未见此服务";
                var removed = d["removed"] as JsonArray ?? new JsonArray();
                return S(d["server"]) + "：减少 " + string.Join("、", removed.Take(8).Select(t => S(t))) + (removed.Count > 8 ? " 等" : "");
            }));
            var events = (h?["observations"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Take(3);
            observations.Text = string.Join("\n", events.Select(o => LocalTime(N(o["atMs"])) + " · " + S(o["name"]) + (S(o["kind"]) == "tool_registered_again" ? " 重新登记" : " 重新连接")));
        };
        refreshDetail();
    }
}
