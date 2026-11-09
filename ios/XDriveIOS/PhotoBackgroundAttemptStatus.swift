import CryptoKit
import Foundation

/// Last observed, non-secret BGProcessing outcome; this is not a background
/// execution guarantee or an authoritative current Node/backup receipt.
enum XDriveIOSBGAttemptReason: String, Codable {
    case scheduled
    case scheduledAfterUnlock
    case scheduledAfterPush
    case started
    case protectedDataUnavailable
    case photosPermissionUnavailable
    case otherWriterActive
    case pendingReceiptReview
    case historyRecoveryRequired
    case noDueWindow
    case completedBoundedWindow
    case interruptedAfterWrite
    case systemExpired
    case cancelled
    case networkRetry
    case authorizationFailure
    case otherFailure

    var userMessage: String {
        switch self {
        case .scheduled: return "已提交系统任务请求，具体启动时间由 iOS 决定"
        case .scheduledAfterUnlock: return "设备解锁后已重新申请系统任务，尚未证明执行"
        case .scheduledAfterPush: return "收到静默唤醒提示后已申请系统任务，未证明上传"
        case .started: return "系统已启动本次受限后台任务，尚无上传结果"
        case .protectedDataUnavailable: return "锁屏时原件或加密账本不可读取，安全退出，未上传"
        case .photosPermissionUnavailable: return "照片授权不足，未读取原件，需在系统设置中恢复权限"
        case .otherWriterActive: return "前台已有原件写入任务，本次让位并等待系统下次调度"
        case .pendingReceiptReview: return "存在未核验回执，本机后台暂停以避免重复上传"
        case .historyRecoveryRequired: return "PhotoKit 历史已失效，等待前台显式确认全库核对"
        case .noDueWindow: return "本次没有到期任务；不代表整库备份完成"
        case .completedBoundedWindow: return "本次有界后台检查完成；不代表全部照片已备份"
        case .interruptedAfterWrite: return "上传可能已提交但结果不确定，须先核对收据"
        case .systemExpired: return "系统结束了任务，本轮未确认写入；等待下次允许的机会"
        case .cancelled: return "本轮后台任务已取消"
        case .networkRetry: return "写入前网络或只读校验暂时不可用，仅允许延后重试"
        case .authorizationFailure: return "后台授权或设备证明未通过，不能重试上传"
        case .otherFailure: return "本轮后台未完成；请在前台核验设备、目标和收据"
        }
    }
}

struct XDriveIOSBGAttemptSnapshot: Codable {
    let reason: XDriveIOSBGAttemptReason
    let at: Date
}

/// UserDefaults contains only an Owner-scoped hash + one local diagnostic.
/// NEVER store an auth token, PhotoKit ID, GPS, Node URL or original filename.
@MainActor
enum XDriveIOSBGAttemptStatus {
    private static func key(owner: XDriveNativeOwnerRoot) -> String {
        let plain = owner.origin.absoluteString + "\n" + owner.instanceID +
            "\n" + String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        let hash = SHA256.hash(data: Data(plain.utf8))
        return "xdrive.ios.photos.bg.attempt.v1." +
            hash.map { String(format: "%02x", $0) }.joined()
    }

    static func record(_ reason: XDriveIOSBGAttemptReason,
                       owner: XDriveNativeOwnerRoot, at: Date = Date()) {
        let value = XDriveIOSBGAttemptSnapshot(reason: reason, at: at)
        guard let encoded = try? JSONEncoder().encode(value) else { return }
        UserDefaults.standard.set(encoded, forKey: key(owner: owner))
    }

    /// Only non-secret wake admission timestamps are persisted. A push must
    /// never carry an Owner credential, upload authority or PhotoKit ID.
    static func lastRemoteWake(owner: XDriveNativeOwnerRoot) -> Date? {
        guard let last = UserDefaults.standard.object(forKey: key(owner: owner) + ".apns-wake") as? Date,
              last.timeIntervalSince1970.isFinite,
              last <= Date().addingTimeInterval(120) else { return nil }
        return last
    }

    static func recordRemoteWake(owner: XDriveNativeOwnerRoot, at: Date) {
        UserDefaults.standard.set(at, forKey: key(owner: owner) + ".apns-wake")
    }

    static func last(owner: XDriveNativeOwnerRoot) -> XDriveIOSBGAttemptSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: key(owner: owner)),
              let value = try? JSONDecoder().decode(
                XDriveIOSBGAttemptSnapshot.self, from: data
              ), value.at.timeIntervalSince1970.isFinite,
              value.at <= Date().addingTimeInterval(120) else { return nil }
        return value
    }
}
