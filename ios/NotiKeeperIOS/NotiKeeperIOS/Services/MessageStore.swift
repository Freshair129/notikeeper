import Combine
import Foundation

@MainActor
final class MessageStore: ObservableObject {
    @Published private(set) var messages: [NotiMessage] = []
    @Published var lastStatus = ""

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private let decoder = JSONDecoder()

    init() {
        load()
    }

    var appNames: [String] {
        Array(Set(messages.map(\.appName))).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    func importFile(at url: URL) {
        let canAccess = url.startAccessingSecurityScopedResource()
        defer {
            if canAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(contentsOf: url)
            let imported = try ImportParser.messages(from: data, fileName: url.lastPathComponent)
            let added = merge(imported)
            try save()
            lastStatus = "Imported \(added) new rows from \(url.lastPathComponent)."
        } catch {
            lastStatus = error.localizedDescription
        }
    }

    func clear() {
        messages = []
        do {
            try save()
            lastStatus = "Archive cleared."
        } catch {
            lastStatus = error.localizedDescription
        }
    }

    func exportJSON() throws -> URL {
        let payloads = messages.map(\.exportPayload)
        let data = try encoder.encode(payloads)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("notikeeper-ios-export.json")
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    func exportCSV() throws -> URL {
        var lines = ["id,source,app,pkg,title,text,side,time"]

        for message in messages {
            let payload = message.exportPayload
            let fields = [
                String(payload.id ?? 0),
                payload.source ?? "",
                payload.app ?? "",
                payload.pkg ?? "",
                payload.title ?? "",
                payload.text ?? "",
                payload.side ?? "",
                String(payload.time ?? 0)
            ]
            lines.append(fields.map(csv).joined(separator: ","))
        }

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("notikeeper-ios-export.csv")
        try lines.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    private func merge(_ imported: [NotiMessage]) -> Int {
        var existing = Set(messages.map(\.dedupKey))
        var fresh: [NotiMessage] = []

        for message in imported where !existing.contains(message.dedupKey) {
            existing.insert(message.dedupKey)
            fresh.append(message)
        }

        messages.append(contentsOf: fresh)
        messages.sort { left, right in
            if left.timestamp == right.timestamp {
                return left.id > right.id
            }
            return left.timestamp > right.timestamp
        }

        return fresh.count
    }

    private func load() {
        do {
            let url = try storeURL()
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            messages = try decoder.decode([NotiMessage].self, from: Data(contentsOf: url))
        } catch {
            lastStatus = error.localizedDescription
        }
    }

    private func save() throws {
        let url = try storeURL()
        let data = try encoder.encode(messages)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    private func storeURL() throws -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NotiKeeperIOS", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("messages.json")
    }

    private func csv(_ value: String) -> String {
        let escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
        if escaped.contains(",") || escaped.contains("\n") || escaped.contains("\r") || escaped.contains("\"") {
            return "\"\(escaped)\""
        }
        return escaped
    }
}
