import Combine
import Foundation
import UIKit

/// A Server-proven iOS Photos managed Source/Node binding. This is a target
/// selection receipt, not an upload permission or a claim of backed-up media.
struct XDriveIOSPhotoManagedDestination: Equatable {
    let sourceID: UInt64
    let deviceID: String
    let name: String
    let targetNodeID: UInt64
    let targetPath: String
}

private struct XDriveIOSPhotoManagedDestinationDTO: Decodable {
    let configured: Bool
    let source_id: UInt64?
    let device_id: String?
    let suggested_name: String?
    let name: String?
    let target_node_id: UInt64?
    let target_path: String?
}

private enum XDriveIOSPhotoManagedDestinationFailure: Error {
    case currentOwnerChanged
    case missingDevice
    case invalidResponse
    case serverRejected(Int)
}

private final class XDriveIOSPhotoManagedDestinationDenyRedirect:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Native UI owns only the editable folder name. Real Source/Node/Path
/// authority belongs to the Server, re-verified with Owner+Device on read.
@MainActor
final class XDriveIOSNativePhotoBackupDestinationModel: ObservableObject {
    @Published var folderName =
        XDriveIOSPhotoBackupDestinationNamePolicy.suggested(
            deviceName: UIDevice.current.name
        )
    @Published private(set) var busy = false
    @Published private(set) var needsDeviceRegistration = false
    @Published private(set) var confirmed: XDriveIOSPhotoManagedDestination?
    @Published private(set) var message = "请先核验设备并保存备份目的地。"
    @Published private(set) var errorMessage: String?

    private var generation = UUID()
    private var job: Task<Void, Never>?

    var canSave: Bool {
        !busy && XDriveIOSPhotoBackupDestinationNamePolicy.normalized(folderName) != nil
    }

    /// When a user edits the text after saving, the old binding is no
    /// longer the requested destination. Do not silently write there.
    var confirmedForCurrentName: Bool {
        guard !busy, let stored = confirmed,
              let name = XDriveIOSPhotoBackupDestinationNamePolicy.normalized(folderName)
        else { return false }
        return stored.name == name
    }

    func cancel() {
        generation = UUID()
        job?.cancel()
        job = nil
        busy = false
    }

    func reset() {
        cancel()
        confirmed = nil
        needsDeviceRegistration = false
        folderName = XDriveIOSPhotoBackupDestinationNamePolicy.suggested(
            deviceName: UIDevice.current.name
        )
        message = "请先核验设备并保存备份目的地。"
        errorMessage = nil
    }

    /// Read-only; registration is NEVER performed without a separate button.
    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        confirmed = nil
        needsDeviceRegistration = false
        guard let owner = login.owner else {
            message = "请先登录当前 xDrive 账户。"
            return
        }
        let ticket = generation
        busy = true
        errorMessage = nil
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { throw XDriveIOSPhotoManagedDestinationFailure.currentOwnerChanged }
                guard let device = try await XDriveIOSDeviceEnrollment.shared
                    .backgroundPhotoDeviceProof(owner: owner, accessToken: auth.accessToken)
                else {
                    if self.generation == ticket {
                        self.needsDeviceRegistration = true
                        self.message = "当前 iPhone 尚未注册。请明确注册后保存目标文件夹。"
                    }
                    return
                }
                let dto = try await self.request(
                    owner: owner, accessToken: auth.accessToken, device: device,
                    method: "GET", body: nil
                )
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                if dto.configured {
                    let binding = try self.verifiedBinding(dto, owner: owner, device: device)
                    self.confirmed = binding
                    self.folderName = binding.name
                    self.message = "服务器已核验备份目录，原件上传授权仍需单独验证。"
                } else {
                    guard dto.device_id == device.deviceID else {
                        throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
                    }
                    if let suggested = dto.suggested_name,
                       let name = XDriveIOSPhotoBackupDestinationNamePolicy.normalized(suggested) {
                        self.folderName = name
                    }
                    self.message = "尚未配置备份目的地，输入文件夹名后保存。"
                }
            } catch is CancellationError {
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                self.confirmed = nil
                self.errorMessage = "无法验证当前 Owner、iPhone 设备身份或云端目录；未授权上传。"
            }
        }
    }

    func registerDevice(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        guard let owner = login.owner else { return }
        let ticket = generation
        confirmed = nil
        busy = true
        errorMessage = nil
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      UIApplication.shared.applicationState == .active
                else { throw XDriveIOSPhotoManagedDestinationFailure.currentOwnerChanged }
                let enrollment = XDriveIOSDeviceEnrollment.shared
                if try await enrollment.verifyExisting(owner: owner,
                                                        accessToken: auth.accessToken) == nil {
                    _ = try await enrollment.enroll(
                        owner: owner, accessToken: auth.accessToken,
                        displayName: XDriveIOSPhotoBackupDestinationNamePolicy.suggested(
                            deviceName: UIDevice.current.name
                        ),
                        version: "ios-photos-v1"
                    )
                }
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self.refresh(login: login)
            } catch is CancellationError {
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                self.errorMessage = "注册或验证 iPhone 失败。若服务器提交结果未知，请刷新并核对原设备，勿重复注册。"
            }
        }
    }

    /// One explicit, user-confirmed Server transaction. This call NEVER
    /// prepares UploadSession or claims an existing Owner-root backup moved.
    func save(login: XDriveIOSNativeOwnerLoginModel) {
        guard let name = XDriveIOSPhotoBackupDestinationNamePolicy.normalized(folderName),
              !busy, let owner = login.owner else { return }
        cancel()
        confirmed = nil
        let ticket = generation
        busy = true
        errorMessage = nil
        job = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      UIApplication.shared.applicationState == .active
                else { throw XDriveIOSPhotoManagedDestinationFailure.currentOwnerChanged }
                guard let device = try await XDriveIOSDeviceEnrollment.shared
                    .backgroundPhotoDeviceProof(owner: owner, accessToken: auth.accessToken)
                else { throw XDriveIOSPhotoManagedDestinationFailure.missingDevice }
                let body = try JSONSerialization.data(withJSONObject: ["name": name])
                let dto = try await self.request(
                    owner: owner, accessToken: auth.accessToken, device: device,
                    method: "PUT", body: body
                )
                let binding = try self.verifiedBinding(dto, owner: owner, device: device)
                guard binding.name == name else {
                    throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
                }
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self.confirmed = binding
                self.folderName = binding.name
                self.message = "备份目的地已由服务器创建并验证；尚未授予受管目录的原件上传权限。"
            } catch is CancellationError {
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
                self.confirmed = nil
                self.errorMessage = "目录保存结果尚未核实。请刷新服务器绑定状态，不要重复创建未知结果的文件夹。"
            }
        }
    }

    private func verifiedBinding(_ dto: XDriveIOSPhotoManagedDestinationDTO,
                                 owner: XDriveNativeOwnerRoot,
                                 device: XDriveIOSBackgroundDeviceProof) throws
        -> XDriveIOSPhotoManagedDestination {
        guard dto.configured, dto.device_id == device.deviceID,
              let sourceID = dto.source_id, sourceID > 0,
              let targetID = dto.target_node_id, targetID > 0,
              targetID != owner.rootNodeID,
              let name = dto.name,
              XDriveIOSPhotoBackupDestinationNamePolicy.normalized(name) == name,
              let path = dto.target_path,
              path.hasPrefix("同步文件夹/设备备份/"),
              path.hasSuffix("/" + name)
        else { throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse }
        return XDriveIOSPhotoManagedDestination(
            sourceID: sourceID, deviceID: device.deviceID, name: name,
            targetNodeID: targetID, targetPath: path
        )
    }

    private func request(owner: XDriveNativeOwnerRoot, accessToken: String,
                         device: XDriveIOSBackgroundDeviceProof,
                         method: String, body: Data?) async throws
        -> XDriveIOSPhotoManagedDestinationDTO {
        guard method == "GET" || method == "PUT",
              !accessToken.isEmpty,
              let canonical = try? ServerAddress.parse(owner.origin.absoluteString),
              canonical == owner.origin,
              var parts = URLComponents(url: canonical, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse }
        parts.path = "/api/v1/ios/photos/backup-destination"
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForRequest = 30
        let session = URLSession(
            configuration: cfg, delegate: XDriveIOSPhotoManagedDestinationDenyRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        req.setValue(device.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
        req.setValue(device.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if method == "PUT" {
            guard let body, body.count <= 4096 else {
                throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
            }
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (bytes, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
        }
        guard http.statusCode == 200 || method == "PUT" && http.statusCode == 201 else {
            throw XDriveIOSPhotoManagedDestinationFailure.serverRejected(http.statusCode)
        }
        guard bytes.count > 0, bytes.count <= 65_536 else {
            throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
        }
        return try JSONDecoder().decode(XDriveIOSPhotoManagedDestinationDTO.self, from: bytes)
    }
    /// Read-only upload admission. It never creates or renames a destination:
    /// it requires an already registered Device and a Server-confirmed
    /// Owner/Device/Source/Target binding before the shared CAS writer can run.
    static func readExistingForUpload(
        owner: XDriveNativeOwnerRoot, accessToken: String
    ) async throws -> XDriveIOSManagedOriginalAuthority {
        guard !accessToken.isEmpty,
              let canonical = try? ServerAddress.parse(owner.origin.absoluteString),
              canonical == owner.origin
        else { throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse }

        // This verifies the current Owner session and already-enrolled iPhone
        // against the same Server. It never silently enrolls another device.
        guard let device = try await XDriveIOSDeviceEnrollment.shared
            .backgroundPhotoDeviceProof(owner: owner, accessToken: accessToken)
        else { throw XDriveIOSPhotoManagedDestinationFailure.missingDevice }

        let reader = XDriveIOSNativePhotoBackupDestinationModel()
        let dto = try await reader.request(
            owner: owner, accessToken: accessToken, device: device,
            method: "GET", body: nil
        )
        try Task.checkCancellation()
        let destination = try reader.verifiedBinding(
            dto, owner: owner, device: device
        )
        let authority = XDriveIOSManagedOriginalAuthority(
            owner: owner, destination: destination,
            device: device, accessToken: accessToken
        )
        guard authority.matches(owner) else {
            throw XDriveIOSPhotoManagedDestinationFailure.invalidResponse
        }
        return authority
    }

}
