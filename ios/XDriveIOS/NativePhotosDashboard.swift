import Combine
import SwiftUI
import UIKit

/// Native-only Photos MVP. The WebKit migration shell remains in the source
/// tree for rollback but is not the runtime App entry.
struct XDriveIOSNativePhotosDashboard: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView {
            NavigationStack {
                XDriveIOSNativeLocalGalleryScreen()
            }
            .tabItem { Label("本机相册", systemImage: "photo.on.rectangle") }

            NavigationStack {
                XDriveIOSNativePhotoBackupScreen(login: login, controller: backup)
            }
            .tabItem { Label("自动备份", systemImage: "arrow.up.circle") }

            NavigationStack {
                XDriveIOSNativeCloudOriginalGallery(login: login)
            }
            .tabItem { Label("云端原件", systemImage: "cloud") }

            NavigationStack {
                LocalPhotoInventoryScreen()
            }
            .tabItem { Label("相册目录", systemImage: "rectangle.stack") }
        }
        .navigationBarBackButtonHidden(false)
        .onAppear {
            backup.refresh(owner: login.owner)
            if phase == .active { backup.tickIfDue(login: login) }
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            guard phase == .active else { return }
            backup.tickIfDue(login: login)
        }
        .onChange(of: phase) { state in
            if state == .active { backup.tickIfDue(login: login) }
            else { backup.cancel() }
        }
        .onChange(of: login.owner) { _ in
            backup.cancel()
            backup.refresh(owner: login.owner)
        }
        .onDisappear { backup.cancel() }
    }
}
