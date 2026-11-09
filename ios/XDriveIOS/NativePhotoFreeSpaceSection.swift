import Combine
import Foundation
import Photos
import PhotosUI
import SwiftUI

private final class XDriveIOSPhotoRetentionDenyRedirect:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct XDriveIOSPhotoRetentionRequest: Encodable {
    let node_id: UInt64
    let node_revision: UInt64
    let session_id: String
    let sha256: String
    let byte_size: Int64
    let kind: String

    init(_ verified: XDriveIOSNativeVerifiedOriginal) {
        node_id = verified.nodeID
        node_revision = verified.nodeRevision
        session_id = verified.sessionID
        sha256 = verified.sha256
        byte_size = verified.byteSize
        kind = verified.kind
    }
}

private struct XDriveIOSPhotoRetentionResponse: Decodable {
    let hold_id: String
    let node_id: UInt64
    let node_revision: UInt64
    let source_id: UInt64
    let target_node_id: UInt64
    let sha256: String
    let byte_size: Int64
    let kind: String
    let retained: Bool

    func matches(_ original: XDriveIOSNativeVerifiedOriginal) -> Bool {
        UUID(uuidString: hold_id) != nil && retained &&
            node_id == original.nodeID && node_revision == original.nodeRevision &&
            source_id == original.sourceID && target_node_id == original.targetNodeID &&
            sha256 == original.sha256 && byte_size == original.byteSize &&
            kind == original.kind
    }
}

private struct XDriveIOSPhotoRetentionCandidate {
    let owner: XDriveNativeOwnerRoot
    let original: XDriveIOSNativeVerifiedOriginal
    let hold: XDriveIOSPhotoRetentionResponse
    let allowICloudOriginals: Bool
}

private enum XDriveIOSPhotoRetentionFailure: Error {
    case invalidScope, invalidProof, permissionChanged, pendingReceipt
}

/// Native, explicit ONE-photo Free Up Space. Preparing permanently preserves
/// the exact CAS original and its managed Node on the Server. Only after
/// re-verifying the live retained bytes may an independent foreground user
/// confirmation enter PhotoKit's own OS deletion confirmation.
@MainActor
final class XDriveIOSNativePhotoFreeSpaceModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var message =
        "选择一张照片，逐项核验云端完整原件并创建永久保留保证后，才可删除 iPhone 原件。"
    @Published private(set) var prepared = false
    @Published private(set) var confirmedDeletion = false
    private var worker: Task<Void, Never>?
    private var revision = UUID()
    private var selected: XDriveIOSPhotoRetentionCandidate?
    private let currentProof = XDriveIOSNativeCurrentPhotoReceiptModel()

    func cancel() {
        revision = UUID()
        worker?.cancel()
        worker = nil
        currentProof.cancel()
        selected = nil
        prepared = false
        busy = false
        confirmedDeletion = false
        message = "本次释放空间操作已取消；服务器已有的原件保留保证不会因此撤销。"
    }

    func prepare(localIdentifier: String, login: XDriveIOSNativeOwnerLoginModel,
                 allowICloudOriginals: Bool) {
        cancel()
        let nonce = revision
        guard let owner = login.owner, !localIdentifier.isEmpty else {
            message = "请先验证当前账户并选择一张本机照片。"
            return
        }
        busy = true
        message = "正在重新计算原件 SHA-256、核对受管 Node 并校验服务器物理 CAS…"
        worker = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.revision == nonce { self.busy = false; self.worker = nil }
            }
            do {
                guard UIApplication.shared.applicationState == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                else { throw XDriveIOSPhotoRetentionFailure.permissionChanged }
                guard await self.currentProof.verifyAndWait(
                    localIdentifier: localIdentifier, login: login,
                    allowICloudOriginals: allowICloudOriginals
                ), let original = self.currentProof.verifiedOriginal else {
                    throw XDriveIOSPhotoRetentionFailure.invalidProof
                }
                try Task.checkCancellation()
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      original.localIdentifier == localIdentifier,
                      XDriveIOSNativePhotoProofStamp.current(localIdentifier) == original.stamp,
                      try await XDriveIOSOriginalPendingReceiptPreflight
                          .pendingCount(owner: owner) == 0
                else { throw XDriveIOSPhotoRetentionFailure.invalidScope }
                let (body, proof) = try await Self.request(
                    method: "POST", owner: owner, accessToken: auth.accessToken,
                    path: "/api/v1/ios/photos/managed/original-retention",
                    body: try JSONEncoder().encode(XDriveIOSPhotoRetentionRequest(original))
                )
                guard body == 200 || body == 201,
                      proof.matches(original), self.revision == nonce,
                      self.currentProof.currentNodeVerified,
                      self.currentProof.verifiedOriginal == original,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      UIApplication.shared.applicationState == .active,
                      XDriveIOSNativePhotoProofStamp.current(localIdentifier) == original.stamp
                else { throw XDriveIOSPhotoRetentionFailure.invalidProof }
                self.selected = .init(
                    owner: owner, original: original, hold: proof,
                    allowICloudOriginals: allowICloudOriginals
                )
                self.prepared = true
                self.message = "服务器已永久保留这一版原件的实际字节、完整 Live 双资源（如适用）、受管 Node 和 CAS。可以单独确认删除这张照片的 iPhone 原件；iCloud Photos 删除会同步到其他设备。"
            } catch is CancellationError {
            } catch {
                guard self.revision == nonce else { return }
                self.selected = nil
                self.prepared = false
                self.message = "当前原件无法获得独立的物理云端保留保证。没有删除任何照片；请检查权限、收据或网络后重试。"
            }
        }
    }

    func deletePreparedOriginal(login: XDriveIOSNativeOwnerLoginModel,
                                controller: XDriveIOSNativePhotoBackupController) {
        guard !busy, !controller.busy, let chosen = selected else { return }
        let nonce = revision
        busy = true
        message = "删除前正在再次校验服务器保留保证与本机原件版本…"
        worker = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.revision == nonce { self.busy = false; self.worker = nil }
            }
            do {
                let owner = chosen.owner, original = chosen.original
                guard UIApplication.shared.applicationState == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      self.currentProof.currentNodeVerified,
                      self.currentProof.verifiedOriginal == original,
                      XDriveIOSNativePhotoProofStamp.current(original.localIdentifier) == original.stamp
                else { throw XDriveIOSPhotoRetentionFailure.permissionChanged }
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      try await XDriveIOSOriginalPendingReceiptPreflight.pendingCount(owner: owner) == 0
                else { throw XDriveIOSPhotoRetentionFailure.pendingReceipt }
                let (status, proof) = try await Self.request(
                    method: "GET", owner: owner, accessToken: auth.accessToken,
                    path: "/api/v1/ios/photos/managed/original-retention/" +
                        chosen.hold.hold_id, body: nil
                )
                try Task.checkCancellation()
                // The definitive delete gate recalculates the current source
                // original SHA and Live pair a second time, not just its
                // modificationDate. PhotoKit can change while the Server is
                // hashing CAS or issuing its retention proof.
                guard await self.currentProof.verifyAndWait(
                    localIdentifier: original.localIdentifier, login: login,
                    allowICloudOriginals: chosen.allowICloudOriginals
                ), self.currentProof.verifiedOriginal == original else {
                    throw XDriveIOSPhotoRetentionFailure.invalidProof
                }
                try Task.checkCancellation()
                let currentStamp = XDriveIOSNativePhotoProofStamp.current(
                    original.localIdentifier)
                let noPending = try await XDriveIOSOriginalPendingReceiptPreflight
                    .pendingCount(owner: owner) == 0
                try Task.checkCancellation()
                let allowed = XDriveIOSPhotoBackupResiliencePolicy.canDeleteApplePhotosOriginal(
                    currentOwnerAndSource:
                        XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) &&
                        original.sourceID == proof.source_id &&
                        original.targetNodeID == proof.target_node_id,
                    originalRevisionAndSHAReverified:
                        currentStamp == original.stamp &&
                        self.currentProof.currentNodeVerified &&
                        self.currentProof.verifiedOriginal == original,
                    allLiveResourcesProtected: original.kind != "live" ||
                        (proof.kind == "live" && proof.retained),
                    noUncertainUploadReceipt: noPending && !controller.busy,
                    durableServerRetentionLease: status == 200 &&
                        proof.matches(original) && proof.hold_id == chosen.hold.hold_id,
                    leaseStillValidAtDeletion: proof.retained,
                    inForegroundWithFullPhotoAccess:
                        UIApplication.shared.applicationState == .active &&
                        PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                    explicitUserConfirmation: true
                )
                guard self.revision == nonce, allowed,
                      let asset = PHAsset.fetchAssets(
                        withLocalIdentifiers: [original.localIdentifier], options: nil
                      ).firstObject
                else { throw XDriveIOSPhotoRetentionFailure.invalidProof }
                // Apple presents its own Photos deletion permission. When
                // iCloud Photos is enabled, it may delete on ALL synced devices.
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest.deleteAssets([asset] as NSArray)
                }
                guard self.revision == nonce else { return }
                self.confirmedDeletion = true
                self.prepared = false
                self.selected = nil
                self.currentProof.cancel()
                self.message = "iOS 已接受这张原件的删除操作。云端的永久保留保证保持有效；实际释放空间可能受 iCloud、最近删除和系统存储策略影响。"
            } catch is CancellationError {
            } catch {
                guard self.revision == nonce else { return }
                self.prepared = false
                self.selected = nil
                self.currentProof.cancel()
                self.message = "删除前版本、Owner、收据、物理保留保证或系统授权发生变化；未确认删除。请重新逐项核验。"
            }
        }
    }

    private static func request(method: String, owner: XDriveNativeOwnerRoot,
                                accessToken: String, path: String, body: Data?)
        async throws -> (Int, XDriveIOSPhotoRetentionResponse) {
        guard method == "POST" || method == "GET",
              path == "/api/v1/ios/photos/managed/original-retention" ||
              path.hasPrefix("/api/v1/ios/photos/managed/original-retention/"),
              !accessToken.isEmpty,
              let server = try? ServerAddress.parse(owner.origin.absoluteString),
              server == owner.origin,
              var url = URLComponents(url: server, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSPhotoRetentionFailure.invalidScope }
        url.path = path
        url.query = nil
        url.fragment = nil
        guard let endpoint = url.url else { throw XDriveIOSPhotoRetentionFailure.invalidScope }
        let device = try await XDriveIOSDeviceEnrollment.shared
            .backgroundPhotoDeviceProof(owner: owner, accessToken: accessToken)
        guard let device else { throw XDriveIOSPhotoRetentionFailure.invalidScope }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 120
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveIOSPhotoRetentionDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(device.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
        request.setValue(device.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200...201).contains(http.statusCode), data.count <= 8192 else {
            throw XDriveIOSPhotoRetentionFailure.invalidProof
        }
        return (http.statusCode,
                try JSONDecoder().decode(XDriveIOSPhotoRetentionResponse.self, from: data))
    }
}

/// A single-item, two-stage native irreversible-action flow. No blanket
/// delete-all, no background deletion and no auto-delete after a local ACK.
struct XDriveIOSNativePhotoFreeSpaceSection: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @StateObject private var model = XDriveIOSNativePhotoFreeSpaceModel()
    @State private var picker: PhotosPickerItem?
    @State private var localID: String?
    @State private var allowICloud = false
    @State private var confirmDelete = false
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Section("安全释放 iPhone 原件空间") {
            Text("仅针对你主动选择的一张照片或视频。先核验本机当前 SHA-256 与云端 Node，再在服务器创建不可自动回收的保留保证；Live Photo 必须完整保留静态图、动态视频与 ZIP 清单。")
                .font(.footnote).foregroundStyle(.secondary)
            Toggle("核验时允许读取 iCloud 原始文件", isOn: $allowICloud)
                .disabled(model.busy)
            PhotosPicker(selection: $picker, matching: .any(of: [.images, .videos])) {
                Label("选择一张待释放空间的照片", systemImage: "photo.badge.shield.checkmark")
            }
            .disabled(model.busy || controller.busy || login.owner == nil ||
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) != .authorized)
            .accessibilityIdentifier("native-ios-photo-free-space-picker")
            if let localID {
                Button("核验原件并永久保护服务器备份") {
                    model.prepare(localIdentifier: localID, login: login,
                                  allowICloudOriginals: allowICloud)
                }
                .disabled(model.busy || controller.busy)
                .accessibilityIdentifier("native-ios-photo-free-space-prepare")
            }
            if model.prepared {
                Label("服务器原件、Live 配对（如有）和 CAS 已获得持久保留证明",
                      systemImage: "checkmark.shield")
                Button("再次确认：删除这张 iPhone 原件", role: .destructive) {
                    confirmDelete = true
                }
                .disabled(model.busy || controller.busy || phase != .active)
                .accessibilityIdentifier("native-ios-photo-free-space-delete")
            }
            if model.busy { ProgressView("正在进行受控原件核验或系统照片操作…") }
            if model.confirmedDeletion {
                Label("已交由 iOS 照片图库处理删除", systemImage: "checkmark.circle")
            }
            Text(model.message).font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("native-ios-photo-free-space-message")
            Text("重要：如果启用了 iCloud Photos，删除操作会同步到其他 Apple 设备；照片也可能暂留在“最近删除”。如无法证明云端长期保留或服务器不可达，绝不删除。")
                .font(.caption).foregroundStyle(.orange)
        }
        .confirmationDialog(
            "永久删除这张 iPhone 照片原件？这也可能从 iCloud Photos 和所有同步设备删除。",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("确认：已了解 iCloud 跨设备删除风险", role: .destructive) {
                model.deletePreparedOriginal(login: login, controller: controller)
            }
            .accessibilityIdentifier("native-ios-photo-free-space-final-confirm")
        } message: {
            Text("仅删除已在 xDrive 服务器建立独立物理原件永久保留保证的这一张照片。系统还会再次请求照片删除授权。")
        }
        .onChange(of: picker) { item in
            model.cancel()
            localID = item?.itemIdentifier
        }
        .onChange(of: login.owner) { _ in
            model.cancel()
            picker = nil
            localID = nil
            confirmDelete = false
        }
        .onChange(of: phase) { state in
            if state != .active { model.cancel(); confirmDelete = false }
        }
        .onDisappear { model.cancel() }
    }
}
