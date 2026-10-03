import Cocoa
import SwiftUI
import Charts

func dictionary(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }
func string(_ value: Any?, _ fallback: String = "—") -> String { value as? String ?? fallback }
func number(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }
func countText(_ value: Any?) -> String {
    guard let n = number(value) else { return "—" }
    if n >= 1_000_000 { return String(format: "%.1fM", n / 1_000_000) }
    return n >= 1000 ? String(format: "%.1fk", n / 1000) : String(format: "%.0f", n)
}

final class Monitor: ObservableObject {
    @Published var snapshot: [String: Any] = [:]
    @Published var error = ""
    @Published var choice = ""
    @Published var pinned = true
    @Published var compact = false
    @Published var section = "details"
    @Published var dark = UserDefaults.standard.bool(forKey: "darkAppearance")
    @Published var includeAstra = UserDefaults.standard.bool(forKey: "includeAstra")
    @Published var normalizeFast = UserDefaults.standard.object(forKey: "normalizeFast") as? Bool ?? true
    @Published var historyMetric = "percent"
    private var process: Process?
    private var input: Pipe?
    private var stopping = false
    private var buffer = Data()
    private let readQueue = DispatchQueue(label: "community.codex-enhance.collector")
    var window: NSWindow?
    var threads: [[String: Any]] { snapshot["recentThreads"] as? [[String: Any]] ?? [] }
    var connection: [String: Any] { dictionary(snapshot["connection"]) }
    var connected: Bool { string(connection["cdp"]) == "connected" }

    func start() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        stopping = false
        let child = Process(), output = Pipe(), errors = Pipe(), commands = Pipe()
        child.executableURL = resources.appendingPathComponent("runtime/node")
        child.arguments = ["--no-warnings", resources.appendingPathComponent("collector/main.mjs").path, "--follow-latest", "--no-voice"]
        child.standardOutput = output; child.standardError = errors; child.standardInput = commands
        child.currentDirectoryURL = resources
        child.terminationHandler = { [weak self] p in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                self.error = "采集进程已退出（\(p.terminationStatus)），请点击重新连接。"
                self.process = nil
            }
        }
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            self?.readQueue.async { [weak self] in self?.consume(data) }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let message = String(data: data, encoding: .utf8) ?? "采集错误"
            DispatchQueue.main.async { self?.error = String(message.prefix(240)) }
        }
        do { try child.run(); process = child; input = commands; error = ""; sendOptions() }
        catch { self.error = "无法启动采集：\(error.localizedDescription)" }
    }
    private func consume(_ data: Data) {
        buffer.append(data)
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer[..<end]; buffer.removeSubrange(...end)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.snapshot = value
                if let message = value["error"] as? String { self.error = message }

            }
        }
    }
    func send(_ command: [String: Any]) {
        guard process?.isRunning == true, let data = try? JSONSerialization.data(withJSONObject: command) else { return }
        try? input?.fileHandleForWriting.write(contentsOf: data + Data([10]))
    }
    func select(_ id: String) {
        choice = id
        send(id.isEmpty ? ["type": "follow"] : ["type": "select", "threadId": id])
    }
    func sendOptions() {
        UserDefaults.standard.set(includeAstra, forKey: "includeAstra")
        UserDefaults.standard.set(normalizeFast, forKey: "normalizeFast")
        send(["type": "quotaOptions", "options": ["includeAstraLongContext": includeAstra, "normalizeFast": normalizeFast]])
    }
    func toggleAppearance() {
        dark.toggle(); UserDefaults.standard.set(dark, forKey: "darkAppearance")
        window?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    }
    func enableFollowing() {
        let alert = NSAlert()
        alert.messageText = "启用当前页面自动跟随"
        alert.informativeText = "需要正常重启 Codex / ChatGPT，并仅在 127.0.0.1 开放调试连接。请先保存工作并等待运行中的任务结束。额度刷新不需要重启。"
        alert.addButton(withTitle: "重启并连接")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn, let resources = Bundle.main.resourceURL else { return }
        let helper = Process()
        helper.executableURL = resources.appendingPathComponent("runtime/node")
        helper.arguments = [resources.appendingPathComponent("macos/launch.mjs").path, "--wait-for-exit"]
        helper.terminationHandler = { [weak self] process in
            if process.terminationStatus != 0 { DispatchQueue.main.async { self?.error = "连接助手未完成；请正常退出客户端后运行 Start Codex.command。" } }
        }
        do {
            try helper.run()
            let clients = NSWorkspace.shared.runningApplications.filter { application in
                guard let bundle = application.bundleURL else { return false }
                return bundle.lastPathComponent == "Codex.app" || (bundle.lastPathComponent == "ChatGPT.app" && FileManager.default.fileExists(atPath: bundle.appendingPathComponent("Contents/Frameworks/Codex Framework.framework").path))
            }
            for client in clients { _ = client.terminate() }
            select("")
        } catch { self.error = "无法启动连接助手：\(error.localizedDescription)" }
    }
    func togglePin() { pinned.toggle(); window?.level = pinned ? .floating : .normal }
    func stop() {
        stopping = true
        let child = process
        send(["type": "stop"]); try? input?.fileHandleForWriting.close()
        if let child = child {
            DispatchQueue.global().asyncAfter(deadline: .now() + 4) { if child.isRunning { child.terminate() } }
        }
        process = nil; input = nil
    }
}

extension Dictionary where Key == String, Value == Any { var selfID: String { self["id"] as? String ?? "" } }
extension Monitor { var processRunning: Bool { process?.isRunning == true } }

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = Monitor()
    var window: NSWindow!
    var status: NSStatusItem!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let existing = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "").filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if let app = existing.first { app.activate(options: [.activateAllWindows]); NSApp.terminate(nil); return }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 470, height: 790), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Codex Enhance"; window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: model.dark ? .darkAqua : .aqua)
        window.contentView = NSHostingView(rootView: Dashboard(model: model))
        window.level = .floating; window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.setFrameAutosaveName("CodexEnhance.Main"); window.center(); model.window = window
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName: "waveform.path.ecg", accessibilityDescription: "Codex Enhance")
        let menu = NSMenu()
        menu.addItem(withTitle: "显示浮窗", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Codex Enhance", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }; status.menu = menu
        let appMenu = NSMenu(); let root = NSMenuItem(); root.submenu = menu; appMenu.addItem(root); NSApp.mainMenu = appMenu
        showWindow(); model.start()
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationWillTerminate(_ notification: Notification) { model.stop() }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
