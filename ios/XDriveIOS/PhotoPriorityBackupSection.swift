import Photos
import PhotosUI
import SwiftUI

/// Synology-style one-item priority backup. Selection and confirmation are
/// native and Owner-bound; the controller still uses the shared CAS writer.
struct XDriveIOSPhotoPriorityBackupSection: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @ObservedObject var destination: XDriveIOSNativePhotoBackupDestinationModel
    let allowICloud: Bool

    @Environment(\.scenePhase) private var phase
    @State private var selectedItem: PhotosPickerItem?
    @State private var localIdentifier: String?
    @State private var consentOwner: XDriveNativeOwnerRoot?
    @State private var showConsent = false
    @State private var errorMessage: String?

    var body: some View {
        Section("单张优先备份") {
            Text("从当前授权相册选择一张照片、视频或 Live Photo，立即优先上传，不等待自动扫描窗口。仍使用当前 Owner 的受管目录、加密账本、CAS UploadSession 和服务器原件收据。")
                .font(.footnote).foregroundStyle(.secondary)
            PhotosPicker(selection: $selectedItem,
                         matching: .any(of: [.images, .videos])) {
                Label("选择一张照片或视频优先备份", systemImage: "arrow.up.circle")
            }
            .disabled(controller.busy || login.owner == nil ||
                      !destination.confirmedForCurrentName ||
                      (PHPhotoLibrary.authorizationStatus(for: .readWrite) != .authorized &&
                       PHPhotoLibrary.authorizationStatus(for: .readWrite) != .limited))
            .accessibilityIdentifier("native-ios-photo-priority-picker")
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.orange)
                    .accessibilityIdentifier("native-ios-photo-priority-error")
            }
            Text("仅处理本次明确选择的原件，不改变自动备份范围或扫描游标。上传结果不确定时仍会暂停并要求收据核对。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .confirmationDialog(
            "立即优先备份所选原件？",
            isPresented: $showConsent,
            titleVisibility: .visible
        ) {
            Button("确认上传所选原件") {
                guard let id = localIdentifier,
                      let expected = consentOwner,
                      destination.confirmedForCurrentName,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
                    errorMessage = "服务器、账户或受管目标已变化；未上传所选原件。"
                    return
                }
                controller.startSingle(
                    login: login, expectedOwner: expected,
                    localIdentifier: id, allowICloud: allowICloud
                )
                clearSelection()
            }
            .accessibilityIdentifier("native-ios-photo-priority-confirm")
        } message: {
            Text("服务器：\(consentOwner?.origin.host ?? "未验证") · Owner：\(consentOwner?.username ?? "未验证")。只上传这一项；\(allowICloud ? "允许按需下载 iCloud 原件。" : "不下载 iCloud 原件。")")
        }
        .onChange(of: selectedItem) { item in
            guard let item else { return }
            guard let id = item.itemIdentifier, !id.isEmpty,
                  let owner = login.owner else {
                errorMessage = "无法取得所选照片的当前 PhotoKit 身份；未上传。"
                selectedItem = nil
                return
            }
            errorMessage = nil
            localIdentifier = id
            consentOwner = owner
            showConsent = true
        }
        .onChange(of: login.owner) { _ in
            clearSelection()
            errorMessage = nil
        }
        .onChange(of: phase) { state in
            // PhotosPicker may briefly make the scene inactive while its
            // system sheet is presented; keep the selected item through that
            // transition and clear only when the app actually backgrounds.
            if state == .background { clearSelection() }
        }
        .onDisappear {
            clearSelection()
        }
    }

    private func clearSelection() {
        showConsent = false
        localIdentifier = nil
        consentOwner = nil
        selectedItem = nil
    }
}
