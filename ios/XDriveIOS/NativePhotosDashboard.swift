import SwiftUI

/// Native-only Photos MVP. The WebKit migration shell remains in the source
/// tree for rollback but is not the runtime App entry.
struct XDriveIOSNativePhotosDashboard: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var backup: XDriveIOSNativePhotoBackupController

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
                XDriveIOSNativePhotoAlbumsScreen()
            }
            .tabItem { Label("相册", systemImage: "rectangle.stack") }
        }
        .navigationBarBackButtonHidden(false)
        // Scheduling lives on the authenticated root; changing tabs or
        // returning to account details does not interrupt a real backup.
        .onAppear { backup.refresh(owner: login.owner) }
    }
}
