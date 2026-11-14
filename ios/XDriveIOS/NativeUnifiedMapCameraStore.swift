import CoreLocation
import CryptoKit
import Foundation
import MapKit
import Photos
import Security

/// M15: process-restart restoration for the same current Owner and PhotoKit
/// generation. Unlike UserDefaults this encrypted, device-only Keychain item
/// contains private camera coordinates; it never stores media IDs or tokens.
enum XDriveIOSUnifiedMapCameraStore {
    private static let service = "com.lazyxu.xdrive.ios.unified-map-camera.v1"

    private struct Record: Codable {
        let latitude: Double
        let longitude: Double
        let latitudeSpan: Double
        let longitudeSpan: Double
        let libraryEpoch: Data
        let savedAt: Date
    }

    private static func account(_ owner: XDriveNativeOwnerRoot) -> String {
        let raw = [String(describing: owner.origin), owner.instanceID,
                   String(describing: owner.ownerID), owner.username,
                   String(describing: owner.rootNodeID)].joined(separator: "\u{001F}")
        let hash = SHA256.hash(data: Data(raw.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private static func query(_ owner: XDriveNativeOwnerRoot) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account(owner)]
    }

    private static func valid(_ record: Record) -> Bool {
        XDriveIOSNativePhotoMapPolicy.validCoordinate(
            latitude: record.latitude, longitude: record.longitude) &&
            record.latitudeSpan.isFinite && record.longitudeSpan.isFinite &&
            record.latitudeSpan > 0 && record.latitudeSpan <= 160 &&
            record.longitudeSpan > 0 && record.longitudeSpan <= 360 &&
            Date().timeIntervalSince(record.savedAt) >= 0 &&
            Date().timeIntervalSince(record.savedAt) < 90 * 24 * 60 * 60 &&
            !record.libraryEpoch.isEmpty
    }

    static func save(_ camera: MKCoordinateRegion, owner: XDriveNativeOwnerRoot) {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              let epoch = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        else { return }
        let record = Record(
            latitude: camera.center.latitude, longitude: camera.center.longitude,
            latitudeSpan: camera.span.latitudeDelta,
            longitudeSpan: camera.span.longitudeDelta,
            libraryEpoch: epoch.serialized, savedAt: Date())
        guard valid(record), let data = try? JSONEncoder().encode(record)
        else { return }
        var entry = query(owner)
        SecItemDelete(entry as CFDictionary)
        entry[kSecValueData as String] = data
        entry[kSecAttrAccessible as String] =
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        // A failed Keychain write leaves no unsafe fallback in preferences.
        _ = SecItemAdd(entry as CFDictionary, nil)
    }

    static func load(owner: XDriveNativeOwnerRoot) -> MKCoordinateRegion? {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
              let epoch = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        else { return nil }
        var request = query(owner)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &found) == errSecSuccess,
              let bytes = found as? Data,
              let record = try? JSONDecoder().decode(Record.self, from: bytes),
              valid(record),
              XDriveIOSPhotoKitLibraryEpoch.matches(record.libraryEpoch,
                                                       as: epoch.token)
        else { return nil }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: record.latitude, longitude: record.longitude),
            span: MKCoordinateSpan(latitudeDelta: record.latitudeSpan,
                                   longitudeDelta: record.longitudeSpan))
    }

    static func clear(owner: XDriveNativeOwnerRoot) {
        SecItemDelete(query(owner) as CFDictionary)
    }
}
