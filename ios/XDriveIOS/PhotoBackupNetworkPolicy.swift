import Combine
import CryptoKit
import Foundation
import Network
import SwiftUI

enum XDriveIOSPhotoBackupNetworkError: Error {
    case wifiRequired
}

@MainActor
final class XDriveIOSPhotoBackupNetworkPolicy: ObservableObject {
    static let shared = XDriveIOSPhotoBackupNetworkPolicy()
    let objectWillChange = ObservableObjectPublisher()

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor [weak self] in self?.objectWillChange.send() }
        }
        monitor.start(queue: DispatchQueue(label: "com.lazyxu.xdrive.ios.photos.network"))
    }

    var hasWiFi: Bool {
        let path = monitor.currentPath
        return path.status == .satisfied && path.usesInterfaceType(.wifi)
    }

    func wifiOnly(for owner: XDriveNativeOwnerRoot) -> Bool {
        // Missing or unreadable preferences, including existing installs,
        // always take the same conservative default.
        UserDefaults.standard.object(forKey: key(for: owner)) as? Bool ?? true
    }

    func setWiFiOnly(_ enabled: Bool, for owner: XDriveNativeOwnerRoot) -> Bool {
        // All original writers hold this gate. A cellular-enabled request
        // must settle before the UI can promise the stricter policy.
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else { return false }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }
        objectWillChange.send()
        UserDefaults.standard.set(enabled, forKey: key(for: owner))
        return true
    }

    /// Apple PhotoKit downloads do not expose URLSession's cellular
    /// restriction. Keep strict Wi-Fi-only source downloads OFF by default;
    /// only the owner can separately opt into OS-managed, best-effort Wi-Fi
    /// downloads with an explicit cellular-fallback warning.
    func allowSystemICloudDownloadOnWiFi(for owner: XDriveNativeOwnerRoot) -> Bool {
        UserDefaults.standard.bool(forKey: key(for: owner) + ".icloud-wifi-consent")
    }

    func setSystemICloudDownloadOnWiFi(_ enabled: Bool,
                                       for owner: XDriveNativeOwnerRoot) -> Bool {
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else { return false }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }
        UserDefaults.standard.set(enabled, forKey: key(for: owner) + ".icloud-wifi-consent")
        objectWillChange.send()
        return true
    }

    /// Independently approved iOS BGProcessing may fetch iCloud originals
    /// only after this separate Owner-local consent. Defaults OFF.
    func backgroundICloudAllowed(for owner: XDriveNativeOwnerRoot) -> Bool {
        UserDefaults.standard.bool(forKey: key(for: owner) + ".background-icloud-consent")
    }

    func setBackgroundICloudAllowed(_ enabled: Bool,
                                    for owner: XDriveNativeOwnerRoot) -> Bool {
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else { return false }
        defer { XDriveIOSOriginalRunGate.shared.release(gate) }
        UserDefaults.standard.set(enabled, forKey: key(for: owner) + ".background-icloud-consent")
        objectWillChange.send()
        return true
    }

    func mayDownloadICloudOriginals(for owner: XDriveNativeOwnerRoot,
                                    userRequested: Bool) -> Bool {
        guard userRequested else { return false }
        return !wifiOnly(for: owner) ||
            (hasWiFi && allowSystemICloudDownloadOnWiFi(for: owner))
    }

    func mayDownloadICloudInBackground(for owner: XDriveNativeOwnerRoot) -> Bool {
        backgroundICloudAllowed(for: owner) &&
            mayDownloadICloudOriginals(for: owner, userRequested: true)
    }

    func requireWiFiIfNeeded(for owner: XDriveNativeOwnerRoot) throws -> Bool {
        let onlyWiFi = wifiOnly(for: owner)
        guard !onlyWiFi || hasWiFi else { throw XDriveIOSPhotoBackupNetworkError.wifiRequired }
        return onlyWiFi
    }

    private func key(for owner: XDriveNativeOwnerRoot) -> String {
        let scope = owner.origin.absoluteString + "\n" + owner.instanceID + "\n" +
            String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        return "xdrive.ios.photos.wifi-only.v1." + SHA256.hash(data: Data(scope.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
}

@MainActor
struct XDriveIOSPhotoBackupNetworkSettings: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject private var policy = XDriveIOSPhotoBackupNetworkPolicy.shared
    @State private var couldNotChange = false

    var body: some View {
        Section("备份网络") {
            if let owner = login.owner {
                let wifiOnly = policy.wifiOnly(for: owner)
                Toggle("仅 Wi-Fi 备份", isOn: Binding(
                    get: { policy.wifiOnly(for: owner) },
                    set: { enabled in
                        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                        couldNotChange = !policy.setWiFiOnly(enabled, for: owner)
                    }
                ))
                .accessibilityIdentifier("native-ios-photos-wifi-only")
                if wifiOnly {
                    Toggle("允许 PhotoKit 在 Wi-Fi 下尝试下载 iCloud 原件", isOn: Binding(
                        get: { policy.allowSystemICloudDownloadOnWiFi(for: owner) },
                        set: { value in
                            guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                            couldNotChange = !policy.setSystemICloudDownloadOnWiFi(value, for: owner)
                        }
                    ))
                    .accessibilityIdentifier("native-ios-photos-icloud-wifi-optin")
                    Text("此为单独授权：xDrive 会在 Wi-Fi 丢失时取消 PhotoKit 请求，但 Apple 不提供禁止蜂窝下载的接口；系统可能在取消前改用蜂窝网络。严格仅 Wi-Fi 时请保持关闭。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Toggle("系统后台允许下载 iCloud 原件", isOn: Binding(
                    get: { policy.backgroundICloudAllowed(for: owner) },
                    set: { value in
                        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                        couldNotChange = !policy.setBackgroundICloudAllowed(value, for: owner)
                    }
                ))
                .accessibilityIdentifier("native-ios-photos-bg-icloud-optin")
                Text("仅限已单独授权的 BGProcessing、设备已解锁且系统允许运行的时间段；不承诺锁屏连续下载。")
                    .font(.caption).foregroundStyle(.secondary)
                if wifiOnly && !policy.hasWiFi {
                    Label("等待 Wi-Fi 连接", systemImage: "wifi.slash")
                        .font(.footnote)
                }
                if couldNotChange {
                    Text("有原件操作正在运行。完成后再修改备份网络设置。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Text("相册上传仅 Wi-Fi 时，xDrive 的上传连接始终禁止蜂窝。PhotoKit 的 iCloud 下载由系统管理，默认不开启；勾选单独授权可能发生系统蜂窝切换。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .onChange(of: login.owner) { _ in couldNotChange = false }
    }
}
