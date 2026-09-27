using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace CodexEnhance;
public partial class MainWindow
{
    private static string TimingDuration(double ms)
    {
        var seconds = Math.Max(0, (long)(ms / 1000));
        return seconds < 60 ? $"{seconds}秒" : seconds < 3600 ? $"{seconds / 60}分{seconds % 60:00}秒" : $"{seconds / 3600}时{seconds / 60 % 60:00}分";
    }
    private void RenderBreakdown(StackPanel target, JsonNode? timing)
    {
        if (S(timing?["state"])!="available") { target.Children.Add(Text("本轮尚无可拆分的时间记录","Muted",12)); return; }
        var parts=(timing?["segments"] as JsonArray ?? new()).OfType<JsonObject>().ToArray();
        double total=N(timing?["totalMs"])??0;
        var bar=new Grid { Height=7, Margin=new Thickness(0,0,0,9), ClipToBounds=true };
        int i=0;
        foreach(var part in parts) {
            double ms=Math.Max(0,N(part["ms"])??0);
            string color=S(part["key"]) switch { "model"=>"Muted", "tools"=>"Accent", "waiting"=>"Attention", "compacting"=>"Faint", _=>"Track" };
            if(ms>0) {
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width=new GridLength(ms,GridUnitType.Star) });
                var span=new Border { Background=BrushFor(color), ToolTip=S(part["label"])+" · "+Duration(ms) };
                Grid.SetColumn(span,i++);bar.Children.Add(span);
            }
        }
        if(total>0)target.Children.Add(bar);
        foreach(var part in parts) {
            double ms=N(part["ms"])??0;
            MetricRow(target,S(part["label"]))(Duration(ms)+(total>0?$" · {ms/total:0%}":""));
        }
        string scope="模型阶段包含响应与等待；并行工具合并计时，缺失记录保留为未分类。";
        if(N(timing?["missingToolTimings"])>0) scope+=$" {N(timing?["missingToolTimings"]):0} 个调用缺少完整起止时间。";
        Note(target,scope);
    }
}
