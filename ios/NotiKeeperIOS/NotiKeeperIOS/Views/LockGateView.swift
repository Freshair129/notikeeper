import LocalAuthentication
import SwiftUI

struct LockGateView<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase

    @State private var unlocked = false
    @State private var message = "Unlock to view your local archive."

    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        Group {
            if unlocked {
                content()
            } else {
                VStack(spacing: 18) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 52, weight: .semibold))
                        .foregroundStyle(.blue)

                    VStack(spacing: 6) {
                        Text("NotiKeeper")
                            .font(.largeTitle.bold())
                        Text(message)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    Button {
                        unlock()
                    } label: {
                        Label("Unlock", systemImage: "faceid")
                            .frame(maxWidth: 240)
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(28)
                .onAppear(perform: unlock)
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active {
                unlocked = false
            }
        }
    }

    private func unlock() {
        let context = LAContext()
        var error: NSError?
        let reason = "Unlock your local NotiKeeper archive."

        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            message = "Device passcode is not configured, so the archive is open on this device."
            unlocked = true
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, authenticationError in
            DispatchQueue.main.async {
                if success {
                    unlocked = true
                } else {
                    message = authenticationError?.localizedDescription ?? "Authentication failed."
                }
            }
        }
    }
}
