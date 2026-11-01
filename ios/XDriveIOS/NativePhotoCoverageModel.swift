import Combine
import Foundation
import Photos
import SwiftUI
import UIKit

/// Explicit, read-only snapshot for the current verified Owner. Does not
/// create a Keychain profile, prepare an upload or change backup cursors.
@MainActor
final class XDriveIOSNativePhotoCoverageModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var snapshot: XDriveIOSNativePhotoCoverageSnapshot?
    @Published private(set) var errorMessage: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func cancel() {
        epoch = UUID()
        job?.cancel()
        job = nil
        busy = false
        snapshot = nil
        errorMessage = nil
    }

    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        guard let expectedOwner = login.owner else {
            errorMessage = "请先验证当前服务器账户。"
            return
        }
        let request = epoch
        busy = true
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.epoch == request {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(
                    verified.owner, expectedOwner
                ), XDriveIOSNativePhotoOwnerScope.matches(
                    login.owner, expectedOwner
                ), UIApplication.shared.applicationState == .active
                else { throw XDriveIOSNativeSessionError.staleSession }

                let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                guard authorization == .authorized || authorization == .limited else {
                    self.errorMessage = "未授权读取本机照片，不能统计当前图库。"
                    return
                }

                // Two Photos fetch counts, not a 100k-item Swift asset array.
                let photos = PHAsset.fetchAssets(with: .image, options: nil).count
                let videos = PHAsset.fetchAssets(with: .video, options: nil).count
                try Task.checkCancellation()
                let existingScope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: expectedOwner)
                let counts: XDriveIOSNativePhotoReceiptTally?
                if let existingScope {
                    counts = try await XDrivePhotoSyncLedger.shared
                        .historicalReceiptTally(scope: existingScope)
                } else {
                    counts = nil
                }
                try Task.checkCancellation()
                guard self.epoch == request,
                      XDriveIOSNativePhotoOwnerScope.matches(
                          login.owner, expectedOwner
                      ), PHPhotoLibrary.authorizationStatus(for: .readWrite) ==
                          authorization,
                      UIApplication.shared.applicationState == .active
                else { return }

                self.snapshot = XDriveIOSNativePhotoCoverageSnapshot(
                    localImages: photos, localVideos: videos,
                    limitedAuthorization: authorization == .limited,
                    historicLedger: counts, checkedAt: Date()
                )
            } catch is CancellationError {
            } catch {
                guard self.epoch == request else { return }
                self.errorMessage =
                    "无法核验当前 Owner 或读取既有账本；历史收据数未知，不能认定整库完成。"
            }
        }
    }
}
