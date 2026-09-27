using System;
using System.Windows;
using System.Windows.Controls;

namespace CodexEnhance;
public partial class MainWindow
{
    private void OpenVoice(object sender,RoutedEventArgs e)
    {
        var stack=DetailStack();
        var status=MetricRow(stack,"连接状态");var checkedAt=MetricRow(stack,"更新时间");
        var refresh=new Button {Content="刷新状态",Padding=new Thickness(12,7,12,7),Margin=new Thickness(0,12,0,0),HorizontalAlignment=HorizontalAlignment.Left,Background=BrushFor("Hover")};
        refresh.Click+=(_,_)=>{if(!preview)Send("checkVoice");};stack.Children.Add(refresh);
        Note(stack,"实际通话时长与费用暂不可用，不计入本地估算。");
        var dialog=Detail("Codex · 语音连接",new ScrollViewer {Content=stack,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});dialog.Height=Math.Min(dialog.Height,270);
        refreshDetail=()=>{
            var v=snapshot["voice"];
            status(S(v?["state"])=="checking"?"正在读取":S(v?["reportedPhase"]) switch {"active"=>"客户端报告已连接","inactive"=>"未连接","starting"=>"正在连接","stopping"=>"正在结束",_=>"尚未读取"});
            checkedAt(LocalTime(N(v?["checkedAtMs"])));refresh.IsEnabled=!preview&&S(v?["state"])!="checking";
        };
        refreshDetail();if(!preview)Send("checkVoice");
    }
}
