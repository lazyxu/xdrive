import Combine
import CryptoKit
import Foundation
import Photos
import UIKit

private struct XDriveIOSNativePhotoProofStamp: Equatable {
    let id: String
    let kind: String
    let isLive: Bool
    let createdAt: Date?
    let modifiedAt: Date?
    let pixelWidth: Int
    let pixelHeight: Int

    static func current(_ id: String) -> Self? {
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard permission == .authorized || permission == .limited,
              !id.isEmpty, id.utf8.count <= 1024,
              let asset = PHAsset.fetchAssets(
                withLocalIdentifiers: [id], options: nil
              ).firstObject else { return nil }
        let kind: String
        switch asset.mediaType {
        case .image: kind = "image"
        case .video: kind = "video"
        default: return nil
        }
        return Self(id: asset.localIdentifier, kind: kind,
                    isLive: asset.mediaSubtypes.contains(.photoLive),
                    createdAt: asset.creationDate,
                    modifiedAt: asset.modificationDate,
                    pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight)
    }
}

private enum XDriveIOSNativeCurrentPhotoReceiptError: Error {
    case staleSource
    case invalidOriginal
}

private final class XDriveIOSNativePhotoProofObserver: NSObject, PHPhotoLibraryChangeObserver {
    let invalidated: () -> Void
    init(invalidated: @escaping () -> Void) { self.invalidated = invalidated }

    func photoLibraryDidChange(_ change: PHChange) {
        DispatchQueue.main.async { [invalidated] in invalidated() }
    }
}

/// Read-only proof of ONE explicit user-selected original. Only a current,
/// exact Owner Node readback after matching local original bytes may produce
/// "verified"; historical encrypted receipts alone cannot.
@MainActor
final class XDriveIOSNativeCurrentPhotoReceiptModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var message = "请选择一张本机照片或视频进行核验。"
    @Published private(set) var currentNodeVerified = false
    @Published private(set) var verifiedAt: Date?

    private var epoch = UUID()
    private var worker: Task<Void, Never>?
    private var observer: XDriveIOSNativePhotoProofObserver?

    func cancel() {
        epoch = UUID()
        worker?.cancel()
        worker = nil
        if let observer {
            PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        }
        observer = nil
        busy = false
        currentNodeVerified = false
        verifiedAt = nil
        message = "请选择一张本机照片或视频进行核验。"
    }

    func unsupportedPickerItem() {
        cancel()
        message = "无法将选择项映射到当前可授权的 PhotoKit 照片，请重新选择。"
    }

    func verify(localIdentifier: String, login: XDriveIOSNativeOwnerLoginModel,
                allowICloudOriginals: Bool) {
        cancel()
        guard let owner = login.owner, !localIdentifier.isEmpty else {
            message = "请先验证当前服务器账户，再选择本机照片。"
            return
        }
        let token = epoch
        let changes = XDriveIOSNativePhotoProofObserver { [weak self] in
            guard let self else { return }
            self.cancel()
            self.message = "系统照片库已变化；旧核验结果已失效，请重新核验。"
        }
        PHPhotoLibrary.shared().register(changes)
        observer = changes
        busy = true
        message = "正在核验本机原始文件、既有收据和当前云端 Node…"
        worker = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.epoch == token {
                    self.busy = false
                    self.worker = nil
                }
            }
            do {
                let first = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(first.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      UIApplication.shared.applicationState == .active,
                      let stamp = XDriveIOSNativePhotoProofStamp.current(localIdentifier)
                else { throw XDriveIOSNativeCurrentPhotoReceiptError.staleSource }

                guard XDriveIOSNativeCurrentPhotoReceiptPolicy.canVerifySingleOriginal(
                    kind: stamp.kind, isLive: stamp.isLive
                ) else {
                    self.publishUnverified(
                        "当前版本只支持单张普通照片或视频。Live Photo 需要校验静态与动态双原件归档，不能以单资源收据判定完成。",
                        token: token
                    )
                    return
                }
                guard let scope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: owner) else {
                    self.publishUnverified(
                        "当前设备没有既有可验证的 Owner 备份身份，不能判断这张照片是否已备份。",
                        token: token
                    )
                    return
                }
                let identity = try await XDriveIOSForegroundBackupIdentity.shared
                    .localScopeAndTag(owner: owner, localIdentifier: localIdentifier)
                guard identity.scope == scope else {
                    throw XDriveIOSNativeCurrentPhotoReceiptError.staleSource
                }
                let staged = try await XDrivePhotoKitOriginalExporter.stage(
                    localIdentifier: localIdentifier,
                    allowICloudDownload: allowICloudOriginals,
                    maximumBytesPerResource: 1_073_741_824
                )
                defer { staged.delete() }
                guard staged.kind == stamp.kind,
                      staged.resources.count == 1,
                      let original = staged.resources.first,
                      original.role == (stamp.kind == "video" ? "video" : "still"),
                      original.byteCount > 0,
                      XDriveIOSNativePhotoProofStamp.current(localIdentifier) == stamp
                else { throw XDriveIOSNativeCurrentPhotoReceiptError.staleSource }

                let sha256 = try Self.hashOriginal(original)
                guard XDriveIOSNativePhotoProofStamp.current(localIdentifier) == stamp,
                      let name = XDriveIOSNativeCurrentPhotoReceiptPolicy.destinationName(
                        originalFilename: original.originalFilename,
                        tag: identity.tag, sha256: sha256
                      )
                else { throw XDriveIOSNativeCurrentPhotoReceiptError.invalidOriginal }
                let role: XDrivePhotoSyncResourceRole =
                    stamp.kind == "video" ? .video : .still
                let receipt = try await XDrivePhotoSyncLedger.shared
                    .existingReceiptForCurrentOriginal(
                        scope: scope, role: role, name: name,
                        size: original.byteCount, sha256: sha256
                    )
                try Task.checkCancellation()
                guard self.epoch == token else { return }
                guard let receipt else {
                    self.publishUnverified(
                        "既有账本中未找到与当前原件名称、字节数和 SHA-256 完全一致的收据；不能据此认定未曾上传。",
                        token: token
                    )
                    return
                }
                guard receipt.state == .confirmed,
                      let nodeID = receipt.verifiedNodeID, nodeID > 0,
                      let revision = receipt.verifiedNodeRevision, revision > 0,
                      let sessionID = receipt.sessionID,
                      UUID(uuidString: sessionID) != nil else {
                    self.publishUnverified(
                        "找到了当前原件的历史记录，但收据尚未完整确认；请到收据核对区处理。",
                        token: token
                    )
                    return
                }

                let auth = XDriveIOSOriginalOwnerAuthorization.webBearer(first.accessToken)
                try await auth.verifyNodeReceipt(
                    XDriveNativeUploadReceipt(
                        nodeID: nodeID, nodeName: receipt.destinationName,
                        revision: revision, sha256: receipt.sha256,
                        bytes: receipt.byteSize, sessionID: sessionID
                    ),
                    owner: owner, parentID: receipt.destinationParentID,
                    expectedName: receipt.destinationName
                )
                try Task.checkCancellation()
                let later = try await login.verifiedAuthorization()
                guard self.epoch == token,
                      XDriveIOSNativePhotoOwnerScope.matches(later.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      UIApplication.shared.applicationState == .active,
                      XDriveIOSNativePhotoProofStamp.current(localIdentifier) == stamp
                else { throw XDriveIOSNativeCurrentPhotoReceiptError.staleSource }

                guard XDriveIOSNativeCurrentPhotoReceiptPolicy.canPublishCurrentProof(
                    matchedRoleAndDigest: receipt.role == role &&
                        receipt.sha256 == sha256 &&
                        receipt.byteSize == original.byteCount &&
                        receipt.destinationName == name,
                    historicalConfirmed: receipt.state == .confirmed,
                    completeReceipt: true,
                    ownerNodeReadbackSucceeded: true,
                    sourceStillSame: true
                ) else {
                    throw XDriveIOSNativeCurrentPhotoReceiptError.invalidOriginal
                }
                self.currentNodeVerified = true
                self.verifiedAt = Date()
                self.message =
                    "当前照片／视频的原始字节 SHA-256 与既有收据一致，且刚从当前 Owner 云端重新验证了文件 Node。"
            } catch is CancellationError {
            } catch {
                self.publishUnverified(
                    allowICloudOriginals ?
                        "未能核实当前原件和云端 Node；请检查服务器、PhotoKit 授权、iCloud 和本机空间后重试。" :
                        "未能核实当前原件和云端 Node；如仅在 iCloud，请明确允许下载原件后重新核验。",
                    token: token
                )
            }
        }
    }

    private func publishUnverified(_ reason: String, token: UUID) {
        guard epoch == token else { return }
        currentNodeVerified = false
        verifiedAt = nil
        message = reason
    }

    private static func hashOriginal(_ item: XDriveStagedPhotoKitResource) throws -> String {
        guard item.byteCount > 0, item.byteCount <= 1_073_741_824,
              let details = try? FileManager.default.attributesOfItem(
                atPath: item.fileURL.path
              ),
              (details[.type] as? FileAttributeType) == .typeRegular,
              (details[.size] as? NSNumber)?.int64Value == item.byteCount
        else { throw XDriveIOSNativeCurrentPhotoReceiptError.invalidOriginal }
        let file = try FileHandle(forReadingFrom: item.fileURL)
        defer { try? file.close() }
        var sha = SHA256()
        var count: Int64 = 0
        while let chunk = try file.read(upToCount: 8 * 1_048_576), !chunk.isEmpty {
            try Task.checkCancellation()
            count += Int64(chunk.count)
            guard count <= item.byteCount else {
                throw XDriveIOSNativeCurrentPhotoReceiptError.invalidOriginal
            }
            sha.update(data: chunk)
        }
        guard count == item.byteCount,
              let final = try? FileManager.default.attributesOfItem(
                atPath: item.fileURL.path
              ),
              (final[.type] as? FileAttributeType) == .typeRegular,
              (final[.size] as? NSNumber)?.int64Value == item.byteCount
        else { throw XDriveIOSNativeCurrentPhotoReceiptError.invalidOriginal }
        return sha.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
