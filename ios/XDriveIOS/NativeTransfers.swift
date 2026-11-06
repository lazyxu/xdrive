import Combine
import SwiftUI

/// Read-only presentation of work started by the existing native writers and
/// readers. A ticket holds no credentials, file URLs or task ownership.
@MainActor
final class XDriveIOSNativeTransferStore: ObservableObject {
    enum Kind: Equatable {
        case upload, download

        var title: String { self == .upload ? "上传" : "下载" }
        var icon: String { self == .upload ? "arrow.up" : "arrow.down" }
    }

    enum Phase: Equatable {
        case running, confirmed, downloaded, stopped, failed, needsReview

        var title: String {
            switch self {
            case .running: return "进行中"
            case .confirmed: return "服务器已确认"
            case .downloaded: return "已验证下载"
            case .stopped: return "已停止"
            case .failed: return "未完成"
            case .needsReview: return "待核对"
            }
        }
    }

    struct Item: Identifiable {
        let id = UUID()
        let kind: Kind
        let title: String
        var phase: Phase = .running
        var detail: String
    }

    @MainActor
    final class Ticket {
        private weak var store: XDriveIOSNativeTransferStore?
        private let id: UUID

        fileprivate init(store: XDriveIOSNativeTransferStore, id: UUID) {
            self.store = store
            self.id = id
        }

        func report(_ detail: String) {
            store?.update(id, phase: .running, detail: detail)
        }

        func finish(_ phase: Phase, detail: String?) {
            store?.update(id, phase: phase, detail: detail ?? phase.title)
        }

        func finishDownload(verified: Bool, stopped: Bool, detail: String?) {
            if verified {
                finish(.downloaded, detail: "已取得并验证临时文件。是否存入 iOS「文件」请在系统中确认。")
            } else if stopped {
                finish(.stopped, detail: "下载已停止，未自动保存到 iPhone。")
            } else {
                finish(.failed, detail: detail ?? "未取得经过验证的文件。")
            }
        }
    }

    @Published private var items: [Item] = []
    private var owner: XDriveNativeOwnerRoot?
    private let completedLimit = 24

    func selectOwner(_ next: XDriveNativeOwnerRoot?) {
        if let owner, XDriveIOSNativePhotoOwnerScope.matches(next, owner) { return }
        owner = next
        items = []
    }

    func visibleItems(for current: XDriveNativeOwnerRoot?) -> [Item] {
        guard let owner, XDriveIOSNativePhotoOwnerScope.matches(current, owner) else { return [] }
        return items
    }

    func begin(_ kind: Kind, title: String, owner expected: XDriveNativeOwnerRoot) -> Ticket? {
        guard XDriveIOSNativePhotoOwnerScope.matches(owner, expected) else { return nil }
        let item = Item(kind: kind, title: title, detail: "正在验证并准备")
        items.insert(item, at: 0)
        return Ticket(store: self, id: item.id)
    }

    private func update(_ id: UUID, phase: Phase, detail: String) {
        // Clearing the list invalidates even an A -> B -> A late callback.
        guard let index = items.firstIndex(where: { $0.id == id }),
              items[index].phase == .running else { return }
        if phase == .running {
            items[index].detail = detail
            return
        }
        var item = items.remove(at: index)
        item.phase = phase
        item.detail = detail
        items.insert(item, at: 0)
        let expired = items.filter { $0.phase != .running }.dropFirst(completedLimit)
        let expiredIDs = Set(expired.map(\.id))
        items.removeAll { expiredIDs.contains($0.id) }
    }
}

private struct XDriveIOSNativeTransferStoreKey: EnvironmentKey {
    static let defaultValue: XDriveIOSNativeTransferStore? = nil
}

extension EnvironmentValues {
    var xdriveNativeTransfers: XDriveIOSNativeTransferStore? {
        get { self[XDriveIOSNativeTransferStoreKey.self] }
        set { self[XDriveIOSNativeTransferStoreKey.self] = newValue }
    }
}

@MainActor
struct XDriveIOSNativeTransfersScreen: View {
    @ObservedObject var transfers: XDriveIOSNativeTransferStore
    @ObservedObject var backup: XDriveIOSNativePhotoBackupController
    let owner: XDriveNativeOwnerRoot?
    let openFiles: () -> Void
    let openBackup: () -> Void

    var body: some View {
        let items = transfers.visibleItems(for: owner)
        let active = items.filter { $0.phase == .running }
        let recent = items.filter { $0.phase != .running }
        Form {
            Section("进行中") {
                if active.isEmpty {
                    Text("暂无正在进行的文件传输").foregroundStyle(.secondary)
                } else {
                    ForEach(active) { row($0) }
                }
                Button("打开文件", action: openFiles)
            }
            Section("前台相册备份") {
                photoStatus
                Button("打开相册备份", action: openBackup)
            }
            Section {
                if recent.isEmpty {
                    Text("暂无已结束的任务").foregroundStyle(.secondary)
                } else {
                    ForEach(recent) { row($0) }
                }
            } header: {
                Text("本次登录的文件传输")
            } footer: {
                Text("取消、重新选择文件或保存下载，请回到发起任务的页面。")
            }
        }
        .accessibilityIdentifier("native-ios-transfer-overview")
    }

    @ViewBuilder
    private var photoStatus: some View {
        if backup.canShowTransferStatus(for: owner) {
            if backup.busy {
                ProgressView("正在备份相册")
            }
            if backup.schedule?.pausedForReview == true {
                Label("备份暂停，等待核对收据", systemImage: "exclamationmark.shield")
            } else if backup.schedule?.historyRecoveryRequiresConsent == true {
                Label("备份暂停，等待确认全库核对", systemImage: "pause.circle")
            } else if let failure = backup.errorMessage {
                Text(failure).foregroundStyle(.secondary)
            } else if !backup.busy {
                Text(backup.message).foregroundStyle(.secondary)
            }
            if let progress = backup.progress {
                Text("最近分段已检查 \(progress.scanned) 项 · 新增 \(progress.uploaded) 项 · 待核对 \(progress.needsReview) 项")
                    .font(.footnote)
                    .monospacedDigit()
            }
        } else {
            Text("当前账户的备份状态尚未读取").foregroundStyle(.secondary)
        }
    }

    private func row(_ item: XDriveIOSNativeTransferStore.Item) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(item.title, systemImage: item.kind.icon).font(.headline)
            Text("\(item.kind.title) · \(item.phase.title)").font(.subheadline)
            Text(item.detail).font(.footnote).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
