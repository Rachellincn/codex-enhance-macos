using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Xml.Linq;

namespace CodexEnhance;
public static class Icons
{
    private static readonly Dictionary<string, Geometry> cache = new();
    public static FrameworkElement Create(string name, double size = 18, string brush = "Muted")
    {
        if (!cache.TryGetValue(name, out var geometry))
        {
            string file = Path.Combine(AppContext.BaseDirectory, "assets", "icons", name + ".svg");
            var svg = XDocument.Load(file);
            var group = new GeometryGroup();
            foreach (var path in svg.Descendants().Where(e => e.Name.LocalName == "path"))
                if (path.Attribute("d") is { } data) group.Children.Add(Geometry.Parse(data.Value));
            group.Freeze(); geometry = group; cache[name] = geometry;
        }
        var icon = new System.Windows.Shapes.Path { Data = geometry, Width = size, Height = size, Stretch = Stretch.Uniform, IsHitTestVisible = false };
        icon.SetResourceReference(System.Windows.Shapes.Path.FillProperty, brush);
        return icon;
    }
}
