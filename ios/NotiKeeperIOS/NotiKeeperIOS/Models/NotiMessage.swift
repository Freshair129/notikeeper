import Foundation

struct NotiMessage: Identifiable, Codable, Hashable {
    enum Source: String, Codable, CaseIterable, Identifiable {
        case notification = "noti"
        case screen = "screen"

        var id: String { rawValue }

        var label: String {
            switch self {
            case .notification: return "Notification"
            case .screen: return "Screen"
            }
        }
    }

    enum Side: String, Codable {
        case none = ""
        case me
        case them

        var label: String {
            switch self {
            case .none: return ""
            case .me: return "Me"
            case .them: return "Them"
            }
        }
    }

    let id: Int64
    let source: Source
    let packageName: String
    let appName: String
    let title: String
    let text: String
    let side: Side
    let timestamp: Date

    var searchBlob: String {
        [
            source.rawValue,
            source.label,
            packageName,
            appName,
            title,
            text,
            side.rawValue,
            side.label
        ]
        .joined(separator: " ")
        .lowercased()
    }

    var dedupKey: String {
        "\(id)|\(Int64(timestamp.timeIntervalSince1970 * 1000))|\(appName)|\(title)|\(text)"
    }

    var spokenText: String {
        [appName, title, text]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: ". ")
    }
}

struct AndroidMessagePayload: Codable {
    let id: Int64?
    let source: String?
    let app: String?
    let pkg: String?
    let title: String?
    let text: String?
    let side: String?
    let time: Int64?
}

extension NotiMessage {
    init(payload: AndroidMessagePayload, fallbackId: Int64) {
        let source = Source(rawValue: payload.source ?? "") ?? .notification
        let side = Side(rawValue: payload.side ?? "") ?? .none
        let millis = payload.time ?? 0

        self.id = payload.id ?? fallbackId
        self.source = source
        self.packageName = payload.pkg ?? ""
        self.appName = payload.app ?? "Unknown"
        self.title = payload.title ?? ""
        self.text = payload.text ?? ""
        self.side = side
        self.timestamp = millis > 0 ? Date(timeIntervalSince1970: TimeInterval(millis) / 1000) : Date()
    }

    var exportPayload: AndroidMessagePayload {
        AndroidMessagePayload(
            id: id,
            source: source.rawValue,
            app: appName,
            pkg: packageName,
            title: title,
            text: text,
            side: side.rawValue,
            time: Int64(timestamp.timeIntervalSince1970 * 1000)
        )
    }
}
