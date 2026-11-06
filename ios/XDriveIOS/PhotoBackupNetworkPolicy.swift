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
                if wifiOnly && !policy.hasWiFi {
                    Label("等待 Wi-Fi 连接", systemImage: "wifi.slash")
                        .font(.footnote)
                }
                if couldNotChange {
                    Text("有原件操作正在运行。完成后再修改备份网络设置。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Text("适用于前台和系统后台相册备份。开启时只使用已下载到本机的原件；关闭后才会应用前台备份的 iCloud 下载设置。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .onChange(of: login.owner) { _ in couldNotChange = false }
    }
}
