using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace CodexEnhance;
public partial class MainWindow
{
    internal static string CurrentModelText(JsonObject data)
    {
        string model=S(data["modelIdentity"]?["response"]);
        if(string.IsNullOrEmpty(model))model=S(data["modelIdentity"]?["requested"],S(data["model"]));
        return string.IsNullOrEmpty(model)?"等待任务":model.Replace("gpt-","GPT-").Replace("-astra"," Astra").Replace("-sol"," Sol").Replace("-luna"," Luna");
    }
    private void OpenModels(object sender,RoutedEventArgs e)
    {
        var stack=DetailStack();
        var hero=Text("", "Text",24);hero.FontWeight=FontWeights.SemiBold;hero.Margin=new Thickness(0,10,0,4);stack.Children.Add(hero);
        var status=Text("", "Muted",12);stack.Children.Add(status);
        Section(stack,"本轮记录");
        var requested=MetricRow(stack,"请求模型");var source=MetricRow(stack,"显示来源");var observed=MetricRow(stack,"响应记录时间");
        var routes=MetricRow(stack,"转向记录");
        var records=new StackPanel();stack.Children.Add(records);
        Note(stack,"优先显示上游返回的模型，未取得返回标识时显示任务模型。");
        var dialog=Detail("Codex · 当前模型",new ScrollViewer {Content=stack,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});
        dialog.Height=Math.Min(dialog.Height,380);
        string previous="";
        refreshDetail=()=>{
            var m=snapshot["modelIdentity"];string key=m?.ToJsonString()??"";
            hero.Text=CurrentModelText(snapshot);
            status.Text=S(m?["state"]) switch {"different"=>"上游返回模型","same"=>"上游返回模型","reported"=>"上游返回模型",_=>"当前任务模型"};
            requested(S(m?["requested"],S(snapshot["model"],"—")));source(S(m?["source"]) switch {"response_header"=>"服务端响应头","response_model"=>"服务端响应字段",_=>"任务设置"});
            observed(LocalTime(N(m?["observedAtMs"])));routes(S(m?["routedModel"],"无"));
            if(previous==key)return;previous=key;records.Children.Clear();
            var history=(m?["records"] as JsonArray)?.OfType<JsonObject>().Take(4).ToArray()??Array.Empty<JsonObject>();
            if(history.Length>1){Section(records,"最近响应");foreach(var entry in history)MetricRow(records,LocalTime(N(entry["atMs"])))(S(entry["model"]));}
        };
        refreshDetail();
    }
}
