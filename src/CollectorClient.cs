using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Text;

namespace CodexEnhance;
public sealed class CollectorClient : IDisposable
{
    private Process? process;
    private bool stopping;
    public event Action<JsonObject>? Snapshot;
    public event Action<string>? Error;
    public bool IsRunning { get { try { return process is { HasExited: false }; } catch { return false; } } }
    public void Start(Settings settings, string? seed)
    {
        var node = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        if (!File.Exists(node)) node = settings.NodePath ?? "node.exe";
        var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, StandardInputEncoding = new UTF8Encoding(false), WorkingDirectory = AppContext.BaseDirectory };
        start.ArgumentList.Add("--no-warnings"); start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "collector", "main.mjs"));
        start.ArgumentList.Add("--state-dir"); start.ArgumentList.Add(Settings.StateDirectory);
        if (seed is not null) { start.ArgumentList.Add("--thread"); start.ArgumentList.Add(seed); }
        process = Process.Start(start) ?? throw new InvalidOperationException("采集进程未能启动");
        process.EnableRaisingEvents = true;
        process.Exited += (_, _) => { if (!stopping) Error?.Invoke("采集进程已退出，请从托盘重新连接"); };
        _ = Task.Run(async () =>
        {
            try
            {
                while (!stopping && await process.StandardOutput.ReadLineAsync() is { } line)
                {
                    try { if (JsonNode.Parse(line) is JsonObject data) Snapshot?.Invoke(data); }
                    catch (Exception e) { Error?.Invoke("采集结果读取失败：" + e.Message); }
                }
            }
            catch (Exception e) { if (!stopping) Error?.Invoke("采集通道已断开：" + e.Message); }
        });
        _ = Task.Run(async () => { while (!stopping && await process.StandardError.ReadLineAsync() is { } line) if (!line.Contains("ExperimentalWarning")) Error?.Invoke(line.Length > 150 ? line[..150] : line); });
    }
    public void Send(JsonObject command)
    {
        try { if (process is { HasExited: false }) { process.StandardInput.WriteLine(command.ToJsonString()); process.StandardInput.Flush(); } } catch { }
    }
    public void Dispose()
    {
        stopping = true;
        try { Send(new JsonObject { ["type"] = "stop" }); process?.StandardInput.Close(); if (process is { HasExited: false } && !process.WaitForExit(3500)) process.Kill(); } catch { }
        process?.Dispose();
    }
}
