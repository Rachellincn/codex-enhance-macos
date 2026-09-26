using System;
using System.Collections.Generic;
using System.Linq;

namespace CodexEnhance;
public sealed class Disclosure
{
    public bool UserExpanded { get; private set; }
    public bool ToolsExpanded { get; private set; }
    public bool TemporaryExpanded { get; private set; }
    public bool Expanded => UserExpanded || TemporaryExpanded;
    private bool manualTools;
    private readonly HashSet<string> seen = new();
    private DateTimeOffset? recoverAt;
    public Disclosure(bool expanded) { UserExpanded = expanded; }
    public void SetExpanded(bool expanded) { UserExpanded = expanded; TemporaryExpanded = false; if (!expanded) { ToolsExpanded = false; manualTools = false; } }
    public void ToggleTools() { ToolsExpanded = !ToolsExpanded; manualTools = ToolsExpanded; }
    public void Observe(IEnumerable<string> issueIds, DateTimeOffset now)
    {
        var ids = issueIds.ToArray();
        bool fresh = false;
        foreach (var id in ids) if (seen.Add(id)) fresh = true;
        if (fresh) { TemporaryExpanded = !UserExpanded; ToolsExpanded = true; recoverAt = null; }
        if (ids.Length == 0 && (TemporaryExpanded || (ToolsExpanded && !manualTools)))
        {
            recoverAt ??= now.AddSeconds(4);
            if (now >= recoverAt) { TemporaryExpanded = false; if (!manualTools) ToolsExpanded = false; recoverAt = null; }
        }
        else if (ids.Length > 0) recoverAt = null;
    }
}
