import Combine
import CoreLocation
import Foundation
import MapKit

struct XDriveIOSNativeMapLocationAlert: Identifiable {
    let id = UUID()
    let message: String
}

/// Optional, foreground-only locate-me action on the native Photos map.
/// Never asks for CoreLocation during PhotoKit scan, map entry or backup,
/// and never persists, logs or uploads the user's device position.
final class XDriveIOSNativeMapUserLocationController: NSObject, ObservableObject,
    CLLocationManagerDelegate {
    @Published private(set) var camera: MKCoordinateRegion?
    @Published private(set) var requestID: UUID?
    @Published private(set) var showsUserDot = false
    @Published private(set) var isLocating = false
    @Published var alert: XDriveIOSNativeMapLocationAlert?

    // Every explicit tap owns a new manager, so a delayed callback from a
    // cancelled/previous request cannot be confused with the current tap.
    private var manager: CLLocationManager?
    private var pending = false
    private var requestedFix = false

    /// One CoreLocation one-shot per explicit tap, even if an already-granted
    /// authorization callback arrives during manager initialization.
    private func requestLocationOnce(_ source: CLLocationManager) {
        guard pending, manager === source, !requestedFix else { return }
        requestedFix = true
        source.requestLocation()
    }

    func locate() {
        guard !pending else { return }
        alert = nil
        guard CLLocationManager.locationServicesEnabled() else {
            // A prior successful fix must not leave a stale location dot after
            // system-wide Location Services have been switched off.
            fail("系统定位服务未开启。请在 iOS 设置中开启定位后重试。")
            return
        }
        // A new explicit request never reuses the previous successful fix
        // while permission and accuracy are being checked again.
        camera = nil
        requestID = nil
        showsUserDot = false
        pending = true
        isLocating = true
        requestedFix = false
        let requestManager = CLLocationManager()
        requestManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager = requestManager
        requestManager.delegate = self
        switch requestManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            requestLocationOnce(requestManager)
        case .notDetermined:
            // An explicit tap is the ONLY call site for a location prompt.
            requestManager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            fail("无法读取当前位置。请在 iOS 设置中允许 xDrive 使用期间访问位置。")
        @unknown default:
            fail("当前系统不允许获取位置，请稍后重试。")
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.pending, self.manager === manager else { return }
            let status = manager.authorizationStatus
            if status == .denied || status == .restricted {
                self.showsUserDot = false
                if self.pending {
                    self.fail("定位权限已被关闭。请在 iOS 设置中重新授权。")
                }
                return
            }
            guard self.pending else { return }
            if status == .authorizedAlways || status == .authorizedWhenInUse {
                self.requestLocationOnce(manager)
            }
        }
    }

    func locationManager(_ manager: CLLocationManager,
                         didUpdateLocations locations: [CLLocation]) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.pending, self.manager === manager else { return }
            guard let location = locations.last(where: {
                $0.horizontalAccuracy.isFinite && $0.horizontalAccuracy >= 0 &&
                abs($0.timestamp.timeIntervalSinceNow) <= 120 &&
                CLLocationCoordinate2DIsValid($0.coordinate)
            }) else {
                self.fail("没有获得有效的位置坐标，请在室外或信号较好的位置重试。")
                return
            }
            self.pending = false
            self.isLocating = false
            self.requestedFix = false
            manager.delegate = nil
            self.manager = nil
            self.camera = MKCoordinateRegion(
                center: location.coordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2)
            )
            // A new token makes each explicit request re-center once, even
            // when successive results happen to have identical coordinates.
            self.showsUserDot = true
            self.requestID = UUID()
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.pending, self.manager === manager else { return }
            self.fail("无法获取当前位置，请检查系统定位权限及 GPS 信号后重试。")
        }
    }

    /// Prevent any outstanding one-shot callback from affecting a closed map.
    func cancel() {
        pending = false
        isLocating = false
        requestedFix = false
        manager?.stopUpdatingLocation()
        manager?.delegate = nil
        manager = nil
        camera = nil
        requestID = nil
        showsUserDot = false
        alert = nil
    }

    private func fail(_ message: String) {
        pending = false
        isLocating = false
        requestedFix = false
        manager?.stopUpdatingLocation()
        manager?.delegate = nil
        manager = nil
        camera = nil
        requestID = nil
        showsUserDot = false
        alert = XDriveIOSNativeMapLocationAlert(message: message)
    }
}
