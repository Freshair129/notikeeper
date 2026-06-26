import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    private enum SourceFilter: String, CaseIterable, Identifiable {
        case all
        case notification
        case screen

        var id: String { rawValue }

        var label: String {
            switch self {
            case .all: return "All"
            case .notification: return "Noti"
            case .screen: return "Screen"
            }
        }
    }

    @StateObject private var store = MessageStore()
    @StateObject private var speech = SpeechService()

    @State private var query = ""
    @State private var sourceFilter: SourceFilter = .all
    @State private var appFilter = "All apps"
    @State private var showingImporter = false
    @State private var shareFile: ShareFile?

    private var filteredMessages: [NotiMessage] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        return store.messages.filter { message in
            let matchesSource: Bool
            switch sourceFilter {
            case .all:
                matchesSource = true
            case .notification:
                matchesSource = message.source == .notification
            case .screen:
                matchesSource = message.source == .screen
            }

            let matchesApp = appFilter == "All apps" || message.appName == appFilter
            let matchesQuery = normalizedQuery.isEmpty || message.searchBlob.contains(normalizedQuery)

            return matchesSource && matchesApp && matchesQuery
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar

                if store.messages.isEmpty {
                    EmptyStateView(
                        title: "No Archive Imported",
                        systemImage: "tray.and.arrow.down",
                        detail: "Import JSON, JSONL, or CSV exported from NotiKeeper Android."
                    )
                } else if filteredMessages.isEmpty {
                    EmptyStateView(
                        title: "No Results",
                        systemImage: "magnifyingglass",
                        detail: "Try a different search term or filter."
                    )
                } else {
                    List(filteredMessages) { message in
                        MessageRowView(
                            message: message,
                            isSpeaking: speech.speakingMessageId == message.id,
                            onSpeak: { speech.speak(message) }
                        )
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("NotiKeeper")
            .searchable(text: $query, prompt: "Search app, sender, or text")
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button {
                        showingImporter = true
                    } label: {
                        Label("Import", systemImage: "square.and.arrow.down")
                    }
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            exportJSON()
                        } label: {
                            Label("JSON", systemImage: "curlybraces")
                        }

                        Button {
                            exportCSV()
                        } label: {
                            Label("CSV", systemImage: "tablecells")
                        }

                        Divider()

                        Button(role: .destructive) {
                            store.clear()
                        } label: {
                            Label("Clear", systemImage: "trash")
                        }
                        .disabled(store.messages.isEmpty)
                    } label: {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                }
            }
            .fileImporter(
                isPresented: $showingImporter,
                allowedContentTypes: [.json, .plainText, .commaSeparatedText, .data],
                allowsMultipleSelection: false
            ) { result in
                if case .success(let urls) = result, let url = urls.first {
                    store.importFile(at: url)
                }
            }
            .sheet(item: $shareFile) { file in
                ShareSheet(items: [file.url])
            }
            .safeAreaInset(edge: .bottom) {
                if !store.lastStatus.isEmpty {
                    Text(store.lastStatus)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(.bar)
                }
            }
        }
    }

    private var filterBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Label("\(store.messages.count)", systemImage: "archivebox")
                Label("\(filteredMessages.count)", systemImage: "line.3.horizontal.decrease.circle")
                Spacer()
            }
            .font(.footnote)
            .foregroundStyle(.secondary)

            Picker("Source", selection: $sourceFilter) {
                ForEach(SourceFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)

            Picker("App", selection: $appFilter) {
                Text("All apps").tag("All apps")
                ForEach(store.appNames, id: \.self) { appName in
                    Text(appName).tag(appName)
                }
            }
            .pickerStyle(.menu)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func exportJSON() {
        do {
            shareFile = ShareFile(url: try store.exportJSON())
        } catch {
            store.lastStatus = error.localizedDescription
        }
    }

    private func exportCSV() {
        do {
            shareFile = ShareFile(url: try store.exportCSV())
        } catch {
            store.lastStatus = error.localizedDescription
        }
    }
}

private struct ShareFile: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct EmptyStateView: View {
    let title: String
    let systemImage: String
    let detail: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

#Preview {
    ContentView()
}
