using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace CodexEnhance;
public partial class MainWindow
{
    private static string WeekDate(double? value) => value is null ? "—" : DateTimeOffset.FromUnixTimeMilliseconds((long)value.Value).ToLocalTime().ToString("yyyy-MM-dd");
    private void OpenQuotaHistory(object sender, RoutedEventArgs e)
    {
        var stack=DetailStack();
        var back=new Button { Content="‹  返回账号额度", FontSize=12, Foreground=BrushFor("Accent"), HorizontalAlignment=HorizontalAlignment.Left, Padding=new Thickness(0,4,6,6) };
        back.Click+=OpenQuota; stack.Children.Add(back);
        var subtitle=Text("","Muted",11); subtitle.Margin=new Thickness(0,8,0,14);stack.Children.Add(subtitle);
        var entries=new StackPanel();stack.Children.Add(entries);
        Detail("Codex · 每周记录",new ScrollViewer { Content=stack,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled });
        string last="";
        refreshDetail=()=>{
            var history=snapshot["quota"]?["history"];
            string key=(history?.ToJsonString()??"")+settings.QuotaIncludeAstraLongContext+settings.QuotaNormalizeFast;
            if(last==key && entries.Children.Count>0)return;last=key;entries.Children.Clear();
            subtitle.Text=(preview?"示例数据 · ":"")+"按实际重置周期保存，金额按当前换算开关显示。";
            if(S(history?["state"])=="unavailable") Note(entries,"周记录暂无法保存或读取，已有文件会保留。");
            var rows=(history?["entries"] as JsonArray ?? new()).OfType<JsonObject>().ToArray();
            if(rows.Length==0) {
                entries.Children.Add(Text("尚无每周记录","Text",15));
                Note(entries,"连接账号并完成用量统计后开始记录；下次额度重置时保留本周末次采样。");
                return;
            }
            foreach(var row in rows) {
                var section=new StackPanel { Margin=new Thickness(0,0,0,15) };
                var heading=Text(WeekDate(N(row["startMs"]))+" → "+WeekDate(N(row["resetsAtMs"])),"Text",13);heading.FontWeight=FontWeights.SemiBold;section.Children.Add(heading);
                var state=Text(B(row["adjusted"])?"周期已调整 · 末次采样":B(row["closed"])?"已结束 · 末次采样":"本周 · 记录中","Muted",11);state.Margin=new Thickness(0,5,0,9);section.Children.Add(state);
                var figures=QuotaFigures(row,settings.QuotaIncludeAstraLongContext,settings.QuotaNormalizeFast,false);
                MetricRow(section,"额度已用")((N(row["usedPercent"])?.ToString("0.#")??"—")+"%");
                MetricRow(section,"已用等效 / 周总额估算")(Money(figures.Used)+" / "+(figures.Total is null?"—":"≈$"+figures.Total.Value.ToString("N0")));
                var records=Text(CompactNumber(N(row["requests"]))+" 次请求 · "+CompactNumber(N(row["tokens"]))+" tokens · Fast "+(N(row["fastRequests"])??0).ToString("N0")+" 次","Muted",11);records.Margin=new Thickness(0,6,0,0);section.Children.Add(records);
                var models=(row["models"] as JsonArray ?? new()).OfType<JsonObject>().Take(3).Select(m=>S(m["model"]).Replace("gpt-","")+" "+CompactNumber(N(m["requests"]))+" 次");
                string modelText=string.Join(" · ",models);if(modelText.Length>0) Note(section,modelText);
                Note(section,"采样截至 "+LocalTime(N(row["checkedAtMs"])));
                if(B(row["closed"]) && N(row["observationGapMs"])>300000) Note(section,(B(row["adjusted"])?"周期调整前 ":"结束前 ")+Duration(N(row["observationGapMs"]))+" 未采样，以上保留当时数据。");
                if((row["estimateReasons"] as JsonArray)?.Count>0) Note(section,"该次记录不足以推算周总额。");
                section.Children.Add(new Border { Height=1,Background=BrushFor("Line"),Margin=new Thickness(0,16,0,0) });entries.Children.Add(section);
            }
        };
        refreshDetail();
    }
}
