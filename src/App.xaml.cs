using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;

namespace CodexEnhance;
public partial class App : Application
{
    private Mutex? mutex;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Contains("--self-test"))
        {
            int index = Array.IndexOf(e.Args, "--self-test");
            Verification.Run(index + 1 < e.Args.Length ? e.Args[index + 1] : "verification.json");
            Shutdown(); return;
        }
        bool preview = e.Args.Contains("--preview") || e.Args.Contains("--render");
        if (!preview)
        {
            mutex = new Mutex(true, "Local\\CodexEnhance.User." + Environment.UserName, out bool created);
            if (!created) { Shutdown(); return; }
        }
        DispatcherUnhandledException += (_, args) =>
        {
            Directory.CreateDirectory(Settings.StateDirectory);
            File.AppendAllText(Path.Combine(Settings.StateDirectory, "error.log"), DateTimeOffset.Now + " " + args.Exception + Environment.NewLine);
            args.Handled = true;
        };
        var window = new MainWindow(e.Args);
        MainWindow = window;
        window.Show();
    }
    protected override void OnExit(ExitEventArgs e) { mutex?.Dispose(); base.OnExit(e); }
}
