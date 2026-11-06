import Combine
import Foundation
import Photos
import SwiftUI
import UIKit

/// Foreground-only, explicit diagnostic: verifies current cloud Nodes for a
/// bounded slice of the current PhotoKit snapshot using the SAME single-file
/// read-only receipt proof as the existing user-selected audit.
enum XDriveIOSNativePhotoWholeLibraryAuditPolicy {
    static let maximumOriginalsPerBatch = 8

    static func complete(checked: Int, total: Int,
                         currentlyVerified: Int, unverified: Int) -> Bool {
        checked >= 0 && total >= 0 && checked == total &&
            currentlyVerified == total && unverified == 0
    }
}

private enum XDriveIOSNativePhotoWholeAuditError: Error {
    case changedScope
    case changedPhotoLibrary
    case invalidProgress
}

/// A PhotoKit mutation invalidates even a previously green point-in-time
/// cloud receipt audit while the user remains on this screen.
private final class XDriveIOSNativeWholeAuditChangeObserver: NSObject, PHPhotoLibraryChangeObserver {
    let invalidate: () -> Void
    init(invalidate: @escaping () -> Void) { self.invalidate = invalidate }

    func photoLibraryDidChange(_ change: PHChange) {
        DispatchQueue.main.async { [invalidate] in invalidate() }
    }
}

@MainActor
final class XDriveIOSNativePhotoWholeLibraryAuditModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var total: Int?
    @Published private(set) var checked = 0
    @Published private(set) var currentVerified = 0
    @Published private(set) var unverified = 0
    @Published private(set) var completeAt: Date?
    @Published private(set) var message = "尚未逐项核验当前图库。"

    private var owner: XDriveNativeOwnerRoot?
    private var photoToken: Data?
    private var managedSourceID: UInt64?
    private var managedTargetNodeID: UInt64?
    private var epoch = UUID()
    private var job: Task<Void, Never>?
    private var activeProof: XDriveIOSNativeCurrentPhotoReceiptModel?
    private var changeObserver: XDriveIOSNativeWholeAuditChangeObserver?
    private var observerGeneration = UUID()

    private func stopMonitoringLibrary() {
        // Also invalidate callbacks already dispatched onto the main queue.
        observerGeneration = UUID()
        if let changeObserver {
            PHPhotoLibrary.shared().unregisterChangeObserver(changeObserver)
        }
        changeObserver = nil
    }

    func reset() {
        epoch = UUID()
        stopMonitoringLibrary()
        job?.cancel()
        job = nil
        activeProof?.cancel()
        activeProof = nil
        owner = nil
        photoToken = nil
        managedSourceID = nil
        managedTargetNodeID = nil
        busy = false
        total = nil
        checked = 0
        currentVerified = 0
        unverified = 0
        completeAt = nil
        message = "尚未逐项核验当前图库。"
    }

    private func monitorLibraryWhileResultIsVisible() {
        guard changeObserver == nil else { return }
        let generation = observerGeneration
        let observer = XDriveIOSNativeWholeAuditChangeObserver { [weak self] in
            guard let self, self.observerGeneration == generation else { return }
            // A queued callback from an old Owner cannot revoke a newer
            // audit: reset rotates the observer generation first.
            self.reset()
            self.message = "系统照片库已变化，旧的整库核验结果已失效；请重新开始。"
        }
        PHPhotoLibrary.shared().register(observer)
        changeObserver = observer
    }

    /// One click never reads more than 8 originals. A restart, background,
    /// account change or failed generation check cannot retain a green result.
    func verifyNext(login: XDriveIOSNativeOwnerLoginModel,
                    allowICloudOriginals: Bool) {
        guard !busy, let requestedOwner = login.owner,
              UIApplication.shared.applicationState == .active,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
        else {
            message = "核验需要当前登录账户、App 前台和 iOS“所有照片”访问权限。"
            return
        }
        if let total, checked >= total {
            message = "本次图库已检查结束；如果照片或云端状态已变化，请重新开始核验。"
            return
        }
        // Keep monitoring after all 8-item batches finish. A later PhotoKit
        // edit must immediately revoke a green point-in-time result.
        monitorLibraryWhileResultIsVisible()
        let token = UUID()
        epoch = token
        busy = true
        completeAt = nil
        job = Task { @MainActor [weak self, weak login] in
            guard let self, let login else { return }
            let scanner = XDrivePhotoKitBoundedSnapshotScanner()
            defer {
                if self.epoch == token {
                    self.activeProof?.cancel()
                    self.activeProof = nil
                    self.job = nil
                    self.busy = false
                }
            }
            do {
                let authenticated = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard self.epoch == token,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        authenticated.owner, requestedOwner
                      ),
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, requestedOwner
                      ),
                      UIApplication.shared.applicationState == .active
                else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }

                // One audit may only describe ONE current Server-proven
                // Source/Target, across every foreground 8-item batch.
                let managed = try await XDriveIOSNativePhotoBackupDestinationModel
                    .readExistingForUpload(owner: requestedOwner,
                                           accessToken: authenticated.accessToken)
                try Task.checkCancellation()
                guard self.epoch == token,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, requestedOwner),
                      managed.destination.sourceID > 0,
                      managed.destination.targetNodeID > 0
                else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                if let sourceID = self.managedSourceID,
                   let targetNodeID = self.managedTargetNodeID {
                    guard sourceID == managed.destination.sourceID,
                          targetNodeID == managed.destination.targetNodeID
                    else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                } else {
                    guard self.managedSourceID == nil,
                          self.managedTargetNodeID == nil
                    else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                    self.managedSourceID = managed.destination.sourceID
                    self.managedTargetNodeID = managed.destination.targetNodeID
                }

                let snapshot = try XDriveIOSPhotoKitLibraryEpoch.capture()
                if let original = self.photoToken {
                    guard XDriveIOSNativePhotoOwnerScope.matches(
                            self.owner, requestedOwner
                          ),
                          XDriveIOSPhotoKitLibraryEpoch.matches(
                            original, as: snapshot.token
                          )
                    else { throw XDriveIOSNativePhotoWholeAuditError.changedPhotoLibrary }
                } else {
                    self.owner = requestedOwner
                    self.photoToken = snapshot.serialized
                }

                let count = try await scanner.start(
                    atOffset: self.checked, requireStableResume: true
                )
                let page = try await scanner.nextPage()
                try Task.checkCancellation()
                guard self.epoch == token,
                      self.total == nil || self.total == count,
                      self.checked <= count, page.startOffset == self.checked,
                      page.totalAccessibleAssets == count,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, requestedOwner
                      )
                else { throw XDriveIOSNativePhotoWholeAuditError.invalidProgress }
                self.total = count

                for candidate in page.items.prefix(
                    XDriveIOSNativePhotoWholeLibraryAuditPolicy.maximumOriginalsPerBatch
                ) {
                    try Task.checkCancellation()
                    try self.verifyGeneration(
                        requestedOwner: requestedOwner, login: login
                    )
                    var verified = false
                    if candidate.kind == "image" || candidate.kind == "video" {
                        let proof = XDriveIOSNativeCurrentPhotoReceiptModel()
                        self.activeProof = proof
                        verified = await proof.verifyAndWait(
                            localIdentifier: candidate.id, login: login,
                            allowICloudOriginals: allowICloudOriginals
                        )
                        try Task.checkCancellation()
                        if verified {
                            // Per-item proof itself revalidates its Source
                            // after Node readback. Never add an ACK from
                            // another current managed destination to this audit.
                            guard let bound = proof.verifiedManagedDestination,
                                  bound.sourceID == self.managedSourceID,
                                  bound.targetNodeID == self.managedTargetNodeID
                            else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                        }
                        proof.cancel()
                        self.activeProof = nil
                    }
                    try self.verifyGeneration(
                        requestedOwner: requestedOwner, login: login
                    )
                    guard self.epoch == token else {
                        throw XDriveIOSNativePhotoWholeAuditError.changedScope
                    }
                    self.checked += 1
                    if verified { self.currentVerified += 1 }
                    else { self.unverified += 1 }
                }

                // Distinguish a scan of every current source from proof of
                // every original. A prior confirmed journal entry is not
                // sufficient: the single-item proof freshly reads the Node.
                try self.verifyGeneration(
                    requestedOwner: requestedOwner, login: login
                )
                // Do not publish a green result if Source/Target was revoked,
                // switched or renamed to another binding during the batch.
                let verifiedEnd = try await login.verifiedAuthorization()
                let latestTarget = try await XDriveIOSNativePhotoBackupDestinationModel
                    .readExistingForUpload(owner: requestedOwner,
                                           accessToken: verifiedEnd.accessToken)
                try Task.checkCancellation()
                guard self.epoch == token,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        verifiedEnd.owner, requestedOwner
                      ),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, requestedOwner),
                      latestTarget.destination.sourceID == self.managedSourceID,
                      latestTarget.destination.targetNodeID == self.managedTargetNodeID
                else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                try self.verifyGeneration(
                    requestedOwner: requestedOwner, login: login
                )
                await scanner.reset()
                // Actor cleanup is an await point: an Owner change, UI
                // dismissal or PhotoKit notification can cancel this run
                // while the scanner releases resources. Never republish a
                // green result from the retired task after that suspension.
                try Task.checkCancellation()
                guard self.epoch == token,
                      XDriveIOSNativePhotoOwnerScope.matches(
                          login.owner, requestedOwner
                      ),
                      UIApplication.shared.applicationState == .active
                else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
                try self.verifyGeneration(
                    requestedOwner: requestedOwner, login: login
                )
                if XDriveIOSNativePhotoWholeLibraryAuditPolicy.complete(
                    checked: self.checked, total: count,
                    currentlyVerified: self.currentVerified,
                    unverified: self.unverified
                ) {
                    self.completeAt = Date()
                    self.message = count == 0 ?
                        "当前已授权图库没有待核验的媒体。":
                        "本轮逐项核验已全部通过；仅代表核验期间的原件及云端 Node 状态。"
                } else if self.checked == count {
                    self.message = "当前图库已检查完毕，但有未核验通过的原件，不得宣称整库已备份。"
                } else {
                    self.message = "本批只读核验已结束；可继续下一批，未检查的原件不计为备份成功。"
                }
            } catch is CancellationError {
                await scanner.reset()
            } catch {
                await scanner.reset()
                if self.epoch == token {
                    // An aborted audit no longer owns a usable generation.
                    // Release the PhotoKit listener and fence queued events.
                    self.stopMonitoringLibrary()
                    // Any stale PhotoKit generation, stale Owner/session or
                    // failed scan invalidates this entire in-memory snapshot.
                    self.owner = nil
                    self.photoToken = nil
                    self.managedSourceID = nil
                    self.managedTargetNodeID = nil
                    self.total = nil
                    self.checked = 0
                    self.currentVerified = 0
                    self.unverified = 0
                    self.completeAt = nil
                    self.message = "核验无法继续：账户、图库、权限或扫描状态可能变化。之前的结果已废弃，请重新开始。"
                }
            }
        }
    }

    private func verifyGeneration(
        requestedOwner: XDriveNativeOwnerRoot,
        login: XDriveIOSNativeOwnerLoginModel
    ) throws {
        try Task.checkCancellation()
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, requestedOwner),
              XDriveIOSNativePhotoOwnerScope.matches(owner, requestedOwner),
              let photoToken,
              UIApplication.shared.applicationState == .active,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
        else { throw XDriveIOSNativePhotoWholeAuditError.changedScope }
        let latest = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard XDriveIOSPhotoKitLibraryEpoch.matches(
            photoToken, as: latest.token
        ) else { throw XDriveIOSNativePhotoWholeAuditError.changedPhotoLibrary }
    }
}

/// An explicitly initiated, on-device read-only audit. It does not schedule
/// background work, mutate the queue, mark uploads as complete or delete files.
struct XDriveIOSNativePhotoWholeLibraryAuditSection: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @StateObject private var audit = XDriveIOSNativePhotoWholeLibraryAuditModel()
    @Environment(\.scenePhase) private var phase
    @State private var allowICloudOriginals = false

    var body: some View {
        Section("当前图库逐项原件核验") {
            Text("从本机读取原件 SHA-256，并逐项查询当前受管目标的历史收据与服务器 Node。每次最多核验 8 项；只读取，不上传、不删除。")
                .font(.footnote).foregroundStyle(.secondary)
            Toggle("核验时允许下载 iCloud 原件", isOn: $allowICloudOriginals)
                .disabled(audit.busy)
            if let total = audit.total {
                Text("本次已核验 \(audit.checked)/\(total) 项 · 当前云端核验通过 \(audit.currentVerified) · 尚未通过 \(audit.unverified)")
                    .monospacedDigit()
                    .accessibilityIdentifier("native-ios-photo-whole-audit-progress")
                if total > 0 {
                    ProgressView(value: Double(audit.checked),
                                 total: Double(total))
                        .accessibilityLabel("逐项核验扫描进度，非备份完成率")
                }
            }
            if audit.completeAt != nil {
                Label("本轮当前图库原件核验全部通过", systemImage: "checkmark.shield")
                    .accessibilityIdentifier("native-ios-photo-whole-audit-confirmed")
            }
            Text(audit.message)
                .font(.footnote).foregroundStyle(.secondary)
            if audit.busy {
                ProgressView("正在核验当前原件及云端 Node…")
                Button("停止并清除本次核验") { audit.reset() }
                    .accessibilityIdentifier("native-ios-photo-whole-audit-cancel")
            } else {
                Button(audit.total == nil ? "开始只读核验" : "核验下一批") {
                    audit.verifyNext(login: login,
                                     allowICloudOriginals: allowICloudOriginals)
                }
                .disabled(login.owner == nil || phase != .active ||
                          PHPhotoLibrary.authorizationStatus(for: .readWrite) != .authorized ||
                          (audit.total != nil && audit.checked >= audit.total!))
                .accessibilityIdentifier("native-ios-photo-whole-audit-next")
                if audit.total != nil {
                    Button("重新开始整库核验") {
                        audit.reset()
                        audit.verifyNext(login: login,
                                         allowICloudOriginals: allowICloudOriginals)
                    }
                    .accessibilityIdentifier("native-ios-photo-whole-audit-restart")
                }
            }
            Text("历史收据数量、扫描进度、部分通过都不是整库备份完成证明。即使本轮全部通过，云端内容之后仍可能变化。")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("native-ios-photo-whole-audit-truthful")
        }
        .onDisappear { audit.reset() }
        .onChange(of: login.owner) { _ in audit.reset() }
        .onChange(of: phase) { state in
            if state != .active { audit.reset() }
        }
    }
}
