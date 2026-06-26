import SwiftUI

struct MessageRowView: View {
    let message: NotiMessage
    let isSpeaking: Bool
    let onSpeak: () -> Void

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(message.appName)
                        .font(.headline)
                    Text(Self.timeFormatter.string(from: message.timestamp))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 12)

                sourceBadge
            }

            if !message.title.isEmpty {
                Text(message.title)
                    .font(.subheadline.weight(.semibold))
            }

            if !message.text.isEmpty {
                Text(message.text)
                    .font(.body)
                    .textSelection(.enabled)
            }

            HStack {
                if !message.side.label.isEmpty {
                    Label(message.side.label, systemImage: message.side == .me ? "person.fill" : "person")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button(action: onSpeak) {
                    Label(isSpeaking ? "Stop" : "Speak", systemImage: isSpeaking ? "stop.fill" : "speaker.wave.2.fill")
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 6)
    }

    private var sourceBadge: some View {
        Text(message.source.label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(message.source == .screen ? .purple : .blue)
            .background((message.source == .screen ? Color.purple : Color.blue).opacity(0.12))
            .clipShape(Capsule())
    }
}
