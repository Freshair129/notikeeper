import SwiftUI

@main
struct NotiKeeperIOSApp: App {
    var body: some Scene {
        WindowGroup {
            LockGateView {
                ContentView()
            }
        }
    }
}
