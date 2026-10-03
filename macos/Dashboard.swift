import Cocoa
import SwiftUI
import Charts

private let blue = Color(red: 0.20, green: 0.43, blue: 0.86)
private let green = Color(red: 0.15, green: 0.57, blue: 0.39)

struct Dashboard: View {
    @ObservedObject var model: Monitor
    var data: [String: Any] { model.snapshot }
    var quota: [String: Any] { dictionary(data["quota"]) }
    var week: [String: Any] { (quota["windows"] as? [[String: Any]] ?? []).first { number($0["minutes"]) == 10080 } ?? [:] }
    var context: [String: Any] { dictionary(data["context"]) }
    var indexing: Bool { quota["indexing"] as? Bool == true }
    var surface: Color { model.dark ? Color(white: 0.16) : .white }
    var tile: Color { model.dark ? Color(white: 0.21) : Color(red: 0.955, green: 0.962, blue: 0.977) }
    var faint: Color { model.dark ? Color(white: 0.56) : Color(white: 0.53) }
    var toolItems: [[String: Any]] { (dictionary(data["tools"])["items"] as? [[String: Any]] ?? []).filter { string($0["turnId"], "") == string(data["turnId"], "") } }
    var modelName: String { string(dictionary(data["modelIdentity"])["response"], string(dictionary(data["modelIdentity"])["routedModel"], string(data["model"]))) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(.bottom, 22)
            summary
            if !model.compact {
                tabs.padding(.top, 20).padding(.bottom, 14)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if model.section == "history" { weeklyHistory }
                        else if model.section == "current" { currentWindow }
                        else { calculationDetails }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 3).padding(.trailing, 3)
                }.frame(maxHeight: .infinity).id(model.section)
                footer.padding(.top, 12)
            }
        }
        .padding(24)
        .frame(minWidth: 430, idealWidth: 470, maxWidth: .infinity)
        .frame(minHeight: model.compact ? 350 : 690, idealHeight: model.compact ? 350 : 790)
        .background(surface)
        .preferredColorScheme(model.dark ? .dark : .light)
        .tint(blue)
    }
    var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text("账号额度").font(.system(size: 21, weight: .semibold))
                Text("CODEX ENHANCE").font(.system(size: 9, weight: .medium)).tracking(1.9).foregroundStyle(faint)
            }
            Spacer()
            iconButton(model.dark ? "sun.max" : "moon", "切换深浅色") { model.toggleAppearance() }
            iconButton(model.pinned ? "pin.fill" : "pin", "窗口置顶") { model.togglePin() }
            iconButton(model.compact ? "chevron.down" : "chevron.up", "收起 / 展开") { model.compact.toggle() }
        }
    }
    func iconButton(_ symbol: String, _ help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 12)).frame(width: 25, height: 28).contentShape(Rectangle()) }
            .buttonStyle(.plain).foregroundStyle(.secondary).help(help).accessibilityLabel(help)
    }
    var summary: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("\(string(quota["plan"], "账号").capitalized) · 周额度").font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer()
                Button { if model.processRunning { model.send(["type": "refreshQuota"]) } else { model.start() } } label: {
                    Label(quota["checking"] as? Bool == true ? "更新中" : "刷新", systemImage: "arrow.clockwise").font(.system(size: 11, weight: .medium))
                }.buttonStyle(.plain).foregroundStyle(blue).disabled(quota["checking"] as? Bool == true)
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(number(week["remainingPercent"]).map { String(format: "%.0f%%", $0) } ?? "—")
                        .font(.system(size: 45, weight: .semibold, design: .rounded)).monospacedDigit().tracking(-1.8)
                    Text("本周剩余").font(.system(size: 12)).foregroundStyle(.secondary)
                    Spacer()
                    Text(number(week["usedPercent"]).map { String(format: "已用 %.0f%%", $0) } ?? "正在读取")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                progress(number(week["remainingPercent"]), color: blue, height: 5)
                Text(resetText).font(.system(size: 10)).foregroundStyle(faint)
            }
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text("当前上下文").font(.system(size: 11)).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(countText(context["used"])) / \(countText(context["limit"]))")
                        .font(.system(size: 11, weight: .medium)).monospacedDigit()
                    Text(number(context["percent"]).map { String(format: "· %.0f%%", $0) } ?? "")
                        .font(.system(size: 10)).foregroundStyle(faint)
                }
                progress(number(context["percent"]), color: (number(context["percent"]) ?? 0) >= 80 ? .orange : blue.opacity(0.55), height: 3)
            }.padding(.top, 2)
            HStack(spacing: 8) {
                amountCard("周额度估算", amount: week["estimatedTotalUsd"], approximate: true)
                amountCard("已用等效", amount: week["ordinaryQuotaUsd"], approximate: true)
                amountCard("剩余等效", amount: week["estimatedRemainingUsd"], approximate: true)
            }.padding(.top, 3)
            if let reason = estimateHint { Text(reason).font(.system(size: 10)).foregroundStyle(faint).fixedSize(horizontal: false, vertical: true) }
        }
    }
    func amountCard(_ title: String, amount: Any?, approximate: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 10)).foregroundStyle(.secondary)
            Text(indexing ? "…" : money(amount, approximate: approximate))
                .font(.system(size: 20, weight: .semibold, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 14)
            .background(tile, in: RoundedRectangle(cornerRadius: 12))
    }
    func progress(_ percent: Double?, color: Color, height: CGFloat) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(model.dark ? Color.white.opacity(0.10) : Color.black.opacity(0.065))
                Capsule().fill(color).frame(width: proxy.size.width * min(100, max(0, percent ?? 0)) / 100)
            }
        }.frame(height: height)
    }
    var resetText: String {
        guard let reset = number(week["resetsAtMs"]) else { return "等待额度重置时间" }
        let minutes = max(0, Int((reset / 1000 - Date().timeIntervalSince1970) / 60))
        if minutes == 0 { return "等待额度刷新" }
        if minutes >= 1440 { return "\(minutes / 1440) 天 \(minutes % 1440 / 60) 小时后重置" }
        return "\(minutes / 60) 小时 \(minutes % 60) 分钟后重置"
    }
    var estimateHint: String? {
        if indexing { return "正在整理本机用量，完成后更新等效估算。" }
        let reasons = week["estimateReasons"] as? [String] ?? []
        let descriptions = ["small_sample": "已用不足 3%，暂不估算周总额。", "quota_rebounded": "额度发生调整，暂不估算周总额。", "account_unknown": "等待确认账号归属。", "unpriced": "部分模型价格待补全。", "parse_errors": "本周期记录不完整，暂不估算周总额。", "index_error": "用量读取不完整，请刷新。", "no_usage": "本周期暂无本机用量。", "speed_weight_unknown": "部分 Fast 倍率待确认，暂不估算周总额。"]
        return reasons.compactMap { descriptions[$0] }.first
    }
    var tabs: some View {
        HStack(spacing: 3) {
            tab("计算明细", icon: "equal.square", key: "details")
            tab("每周历史", icon: "chart.bar", key: "history")
            tab("当前窗口", icon: "macwindow", key: "current")
        }.padding(4).background(tile, in: RoundedRectangle(cornerRadius: 10))
    }
    func tab(_ title: String, icon: String, key: String) -> some View {
        Button { model.section = key } label: {
            HStack(spacing: 5) { Image(systemName: icon).font(.system(size: 11)); Text(title).font(.system(size: 11, weight: model.section == key ? .semibold : .regular)) }
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .foregroundStyle(model.section == key ? blue : .secondary)
                .background(model.section == key ? surface : .clear, in: RoundedRectangle(cornerRadius: 7))
                .shadow(color: .black.opacity(model.section == key ? 0.04 : 0), radius: 3, y: 1)
        }.buttonStyle(.plain).accessibilityAddTraits(model.section == key ? .isSelected : [])
    }
    var calculationDetails: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 12) {
                Toggle("计入 Astra 长上下文加价", isOn: Binding(get: { model.includeAstra }, set: { model.includeAstra = $0; model.sendOptions() }))
                Toggle("Fast 折算普通额度", isOn: Binding(get: { model.normalizeFast }, set: { model.normalizeFast = $0; model.sendOptions() }))
            }.toggleStyle(.switch).controlSize(.mini).font(.system(size: 11)).padding(.bottom, 2)
            Divider().opacity(0.5)
            VStack(spacing: 10) {
                metric("本机用量", "\(countText(week["requests"])) 次 · \(countText(week["tokens"])) tokens")
                metric("任务普通计价", money(week["quotaBaseUsd"]))
                metric("Astra 长上下文", model.includeAstra ? "+" + money(week["astraAppliedUsd"]) : "未计入")
                metric("Fast 用量折算", model.normalizeFast ? "+" + money(week["speedNormalizationUsd"]) : "未计入")
                metric("API 标价等效", money(week["usd"]))
            }
            Text("周额度估算 ≈ 已用等效 ÷ 已用比例\n剩余等效 ≈ 周额度估算 − 已用等效")
                .font(.system(size: 10)).foregroundStyle(.secondary).lineSpacing(4).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(tile, in: RoundedRectangle(cornerRadius: 9))
            Text("金额基于本机模型用量，并非官方余额；不含其他设备或语音用量。开关只调整本地估算。").font(.system(size: 10)).foregroundStyle(faint)
            if let checked = number(quota["checkedAtMs"]) { Text("采样截至 \(Date(timeIntervalSince1970: checked / 1000).formatted()) · 价格 \(string(quota["pricingDate"]))").font(.system(size: 9)).foregroundStyle(faint) }
        }
    }
    var currentWindow: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Circle().fill(model.connected ? green : .orange).frame(width: 6, height: 6)
                Text(model.connected ? (model.choice.isEmpty ? "自动跟随当前页面" : "固定观察所选任务") : "本地记录 · 尚未实时连接").font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer()
                if let elapsed = number(dictionary(data["activity"])["elapsedMs"]) { Text(String(format: "%.0f 秒", elapsed / 1000)).font(.system(size: 10)).monospacedDigit().foregroundStyle(faint) }
            }
            Text(string(data["title"], "当前页面没有可识别任务")).font(.system(size: 14, weight: .semibold)).lineLimit(2)
            Picker("观察任务", selection: Binding(get: { model.choice }, set: { model.select($0) })) {
                Text("自动跟随当前页面").tag("")
                ForEach(model.threads, id: \.selfID) { thread in Text(string(thread["title"])).tag(string(thread["id"], "")) }
            }.labelsHidden().controlSize(.small)
            VStack(spacing: 10) {
                metric("模型", modelName)
                metric("Effort", string(data["effort"]))
                metric("当前阶段", string(dictionary(data["performance"])["stage"], "等待识别"))
                metric("上下文", "\(countText(context["used"])) / \(countText(context["limit"]))")
                metric("缓存命中", number(data["cacheHit"]).map { String(format: "%.1f%%", $0) } ?? "—")
            }.padding(13).background(tile, in: RoundedRectangle(cornerRadius: 10))
            toolList
        }
    }
    var toolList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("本轮工具调用").font(.system(size: 12, weight: .semibold))
                Spacer()
                Text("\(toolItems.filter { string($0["status"]) == "completed" }.count) 成功 · \(toolItems.filter { string($0["status"]) == "failed" }.count) 失败")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            if toolItems.isEmpty { Text("本轮暂无工具记录").font(.system(size: 11)).foregroundStyle(faint) }
            ForEach(Array(toolItems.prefix(40).enumerated()), id: \.offset) { _, item in
                ToolRow(item: item, dark: model.dark)
            }
        }
    }
    var footer: some View {
        HStack(spacing: 6) {
            Circle().fill(model.connected ? green : .orange).frame(width: 5, height: 5)
            Text(model.connected ? (model.choice.isEmpty ? "实时跟随" : "固定观察") : "本地记录").font(.system(size: 9)).foregroundStyle(faint)
            if !model.connected { Button("连接…") { model.enableFollowing() }.buttonStyle(.plain).font(.system(size: 9)).foregroundStyle(blue) }
            Spacer()
            if !model.error.isEmpty { Image(systemName: "exclamationmark.circle").foregroundStyle(.orange).help(model.error) }
            Text(quota["checking"] as? Bool == true ? "正在刷新额度" : "每分钟刷新额度").font(.system(size: 9)).foregroundStyle(faint)
        }
    }
    func metric(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) { Text(title).foregroundStyle(.secondary); Spacer(minLength: 12); Text(value).monospacedDigit().multilineTextAlignment(.trailing).textSelection(.enabled) }.font(.system(size: 11))
    }
    func money(_ value: Any?, approximate: Bool = false) -> String {
        guard let n = number(value) else { return "—" }
        return (approximate ? "≈" : "") + String(format: "$%.2f", n)
    }
    var weeklyHistory: some View {
        let quota = dictionary(data["quota"])
        let history = dictionary(quota["history"])
        let entries = (history["entries"] as? [[String: Any]] ?? []).sorted { (number($0["startMs"]) ?? 0) < (number($1["startMs"]) ?? 0) }
        let metricKey = model.historyMetric == "percent" ? "usedPercent" : model.historyMetric == "tokens" ? "tokens" : "usd"
        return VStack(alignment: .leading, spacing: 14) {
            Text("每周用量历史").font(.system(size: 12, weight: .semibold))
            Text("按账号实际重置周期记录；已结束周期保留末次采样。").font(.caption).foregroundStyle(.secondary)
            if quota["historyCached"] as? Bool == true { Text("离线历史 · 上次确认账号的已保存记录").font(.caption).foregroundStyle(.orange) }
            if string(history["state"]) == "unavailable" { Text("历史文件读写异常，已有记录保持不变。").font(.caption).foregroundStyle(.orange) }
            if entries.isEmpty {
                Image(systemName: "chart.bar.xaxis").font(.largeTitle).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 15)
                Text(quota["indexing"] as? Bool == true ? "索引完成后生成本周第一条记录" : "尚无周记录").frame(maxWidth: .infinity)
                Text("连接账号并完成本机用量索引后开始记录。以往没有采样的额度不补算。").font(.caption).foregroundStyle(.secondary)
            } else {
                Picker("图表指标", selection: $model.historyMetric) {
                    Text("额度已用 %").tag("percent")
                    Text("Tokens").tag("tokens")
                    Text("API 等效 $").tag("usd")
                }.pickerStyle(.segmented)
                ScrollView(.horizontal) {
                Chart(Array(entries.enumerated()), id: \.offset) { _, row in
                    if let value = number(row[metricKey]) {
                        BarMark(x: .value("周期", String(Int(number(row["startMs"]) ?? 0))), y: .value("用量", value))
                            .foregroundStyle(row["closed"] as? Bool == true ? Color.gray : blue)
                            .annotation(position: .top) { Text(model.historyMetric == "percent" ? String(format: "%.0f%%", value) : model.historyMetric == "usd" ? String(format: "$%.1f", value) : countText(value)).font(.caption2) }
                    }
                }.chartYScale(domain: model.historyMetric == "percent" ? 0...max(100, entries.compactMap { number($0[metricKey]) }.max() ?? 100) : 0...max(1, (entries.compactMap { number($0[metricKey]) }.max() ?? 1) * 1.2))
                 .chartXAxis { AxisMarks { value in
                     AxisValueLabel { if let raw = value.as(String.self), let ms = Double(raw) { Text(shortDate(ms)).font(.caption2) } }
                 } }
                 .frame(width: max(340, CGFloat(entries.count) * 100), height: 180).padding(.top, 12)
                }
                Text("百分比为账号额度采样；tokens 和 API 等效金额仅来自本机记录，金额不是余额或账单。").font(.caption2).foregroundStyle(.secondary)
                ForEach(Array(entries.reversed().enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(shortDate(row["startMs"])) → \(shortDate(row["resetsAtMs"]))").font(.system(size: 12, weight: .semibold))
                        Text(row["adjusted"] as? Bool == true ? "周期已调整 · 末次采样" : row["closed"] as? Bool == true ? "已结束 · 末次采样" : "本周 · 记录中").font(.caption).foregroundStyle(.secondary)
                        metric("额度已用", number(row["usedPercent"]).map { String(format: "%.1f%%", $0) } ?? "—")
                        metric("请求 / tokens", "\(countText(row["requests"])) / \(countText(row["tokens"]))")
                        metric("API 等效金额", number(row["usd"]).map { String(format: "$%.2f", $0) } ?? "—")
                        if let sample = number(row["checkedAtMs"]) { Text("采样：\(Date(timeIntervalSince1970: sample / 1000).formatted())").font(.caption2).foregroundStyle(.secondary) }
                        if row["closed"] as? Bool == true, let gap = number(row["observationGapMs"]), gap > 300000 { Text(String(format: "周期结束/调整前 %.1f 小时未采样，保留实际观测值。", gap / 3600000)).font(.caption2).foregroundStyle(.orange) }
                        Divider()
                    }
                }
            }
        }
    }
    func shortDate(_ value: Any?) -> String {
        guard let ms = number(value) else { return "—" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.year().month(.twoDigits).day(.twoDigits))
    }
}

struct ToolRow: View {
    let item: [String: Any]
    let dark: Bool
    var status: String { string(item["status"]) }
    var color: Color { status == "failed" ? .red : status == "completed" ? green : status == "running" ? blue : .secondary }
    var label: String { ["failed":"失败", "completed":"成功", "running":"执行中", "interrupted":"已中断", "unknown":"待确认"][status] ?? "待确认" }
    var symbol: String { status == "failed" ? "xmark.circle.fill" : status == "completed" ? "checkmark.circle.fill" : status == "running" ? "arrow.triangle.2.circlepath" : "questionmark.circle" }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: symbol).foregroundStyle(color).font(.system(size: 12)).padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(string(item["label"], "工具调用")).font(.system(size: 11, weight: .medium))
                    Text(string(item["name"])).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(label).font(.system(size: 9, weight: .medium)).foregroundStyle(color)
                    if let ms = number(item["durationMs"]) { Text(String(format: "%.1fs", ms / 1000)).font(.system(size: 9)).monospacedDigit().foregroundStyle(.secondary) }
                }
            }
            if !string(item["reason"], "").isEmpty { Text(string(item["reason"])).font(.system(size: 9)).foregroundStyle(.secondary).padding(.leading, 21) }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(status == "failed" ? Color.red.opacity(dark ? 0.09 : 0.04) : Color.gray.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .help(string(item["detail"], ""))
    }
}
