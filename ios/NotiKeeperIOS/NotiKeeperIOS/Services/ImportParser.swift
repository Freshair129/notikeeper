import Foundation

enum ImportParser {
    enum ParserError: LocalizedError {
        case emptyFile
        case unsupportedFormat

        var errorDescription: String? {
            switch self {
            case .emptyFile:
                return "The selected file is empty."
            case .unsupportedFormat:
                return "Use a NotiKeeper JSON, JSONL, or CSV export."
            }
        }
    }

    static func messages(from data: Data, fileName: String) throws -> [NotiMessage] {
        guard let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            throw ParserError.emptyFile
        }

        let lowerName = fileName.lowercased()
        if lowerName.hasSuffix(".csv") {
            return try parseCSV(text)
        }

        if lowerName.hasSuffix(".jsonl") {
            return try parseJSONLines(text)
        }

        if text.first == "[" || text.first == "{" {
            if let json = try? parseJSON(data) {
                return json
            }
        }

        if text.contains("\n") {
            return try parseJSONLines(text)
        }

        throw ParserError.unsupportedFormat
    }

    private static func parseJSON(_ data: Data) throws -> [NotiMessage] {
        let decoder = JSONDecoder()
        if let payloads = try? decoder.decode([AndroidMessagePayload].self, from: data) {
            return payloads.enumerated().map { NotiMessage(payload: $0.element, fallbackId: Int64($0.offset)) }
        }

        let payload = try decoder.decode(AndroidMessagePayload.self, from: data)
        return [NotiMessage(payload: payload, fallbackId: 0)]
    }

    private static func parseJSONLines(_ text: String) throws -> [NotiMessage] {
        let decoder = JSONDecoder()
        var output: [NotiMessage] = []

        for (index, line) in text.split(whereSeparator: \.isNewline).enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            if let data = trimmed.data(using: .utf8),
               let payload = try? decoder.decode(AndroidMessagePayload.self, from: data) {
                output.append(NotiMessage(payload: payload, fallbackId: Int64(index)))
            }
        }

        if output.isEmpty {
            throw ParserError.unsupportedFormat
        }

        return output
    }

    private static func parseCSV(_ text: String) throws -> [NotiMessage] {
        let rows = csvRows(text)
        guard let header = rows.first, rows.count > 1 else {
            throw ParserError.unsupportedFormat
        }

        let normalizedHeader = header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        var messages: [NotiMessage] = []

        for (rowIndex, row) in rows.dropFirst().enumerated() {
            var values: [String: String] = [:]
            for (index, key) in normalizedHeader.enumerated() where index < row.count {
                values[key] = row[index]
            }

            let payload = AndroidMessagePayload(
                id: Int64(values["id"] ?? ""),
                source: values["source"],
                app: values["app"],
                pkg: values["pkg"] ?? "",
                title: values["title"],
                text: values["text"],
                side: values["side"],
                time: Int64(values["time"] ?? "")
            )
            messages.append(NotiMessage(payload: payload, fallbackId: Int64(rowIndex)))
        }

        return messages
    }

    private static func csvRows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var index = text.startIndex

        while index < text.endIndex {
            let char = text[index]

            if char == "\"" {
                let nextIndex = text.index(after: index)
                if inQuotes, nextIndex < text.endIndex, text[nextIndex] == "\"" {
                    field.append("\"")
                    index = text.index(after: nextIndex)
                    continue
                }
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                row.append(field)
                field = ""
            } else if (char == "\n" || char == "\r") && !inQuotes {
                if char == "\r" {
                    let nextIndex = text.index(after: index)
                    if nextIndex < text.endIndex, text[nextIndex] == "\n" {
                        index = nextIndex
                    }
                }
                row.append(field)
                field = ""
                if row.contains(where: { !$0.isEmpty }) {
                    rows.append(row)
                }
                row = []
            } else {
                field.append(char)
            }

            index = text.index(after: index)
        }

        row.append(field)
        if row.contains(where: { !$0.isEmpty }) {
            rows.append(row)
        }

        return rows
    }
}
