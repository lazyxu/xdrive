import Foundation
import UIKit
import WebKit

/// Handle the canonical PWA's <a download>/Blob downloads without exposing
/// its HttpOnly cookies or native Keychain credentials to another transport.
/// File bytes stay in a private, temporary container until the user chooses
/// an iOS system share/export destination; no automatic cloud re-upload.
@MainActor
final class XDriveWebDownloadCoordinator: NSObject, WKDownloadDelegate {
    private struct DownloadRecord {
        let download: WKDownload
        let destination: URL
        let directory: URL
    }

    private let origin: URL
    private let onNotice: (String?) -> Void
    private var active: [ObjectIdentifier: DownloadRecord] = [:]
    weak var presentingWebView: WKWebView?

    init(origin: URL, onNotice: @escaping (String?) -> Void) {
        self.origin = origin
        self.onNotice = onNotice
    }

    func attach(_ download: WKDownload) {
        download.delegate = self
    }

    func stopPendingDownloads() {
        let outstanding = Array(active.values)
        active.removeAll()
        for item in outstanding {
            item.download.cancel(nil)
            try? FileManager.default.removeItem(at: item.directory)
        }
        presentingWebView = nil
    }

    /// Compare the HTTPS origin inside a Blob URL instead of accepting
    /// arbitrary blob:null or blob:https://other-server downloads.
    func accepts(_ url: URL) -> Bool {
        if sameOrigin(url) { return true }
        guard url.scheme?.lowercased() == "blob",
              url.absoluteString.hasPrefix("blob:"),
              let inner = URL(string: String(url.absoluteString.dropFirst(5)))
        else { return false }
        return sameOrigin(inner)
    }

    private func sameOrigin(_ target: URL) -> Bool {
        guard let a = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let b = URLComponents(url: target, resolvingAgainstBaseURL: false),
              a.scheme?.lowercased() == "https",
              b.scheme?.lowercased() == "https",
              a.host?.lowercased() == b.host?.lowercased(),
              (a.port ?? 443) == (b.port ?? 443),
              b.user == nil, b.password == nil
        else { return false }
        return true
    }

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard let remoteURL = response.url, accepts(remoteURL),
              active.count < 2 else {
            onNotice("下载已拒绝：来源不属于当前 xDrive 服务器，或同时下载数超过 2 个。")
            completionHandler(nil)
            return
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-web-download-" + UUID().uuidString,
                                    isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: false,
                attributes: [.posixPermissions: NSNumber(value: 0o700),
                             .protectionKey: FileProtectionType.complete]
            )
            let name = sanitizedFilename(suggestedFilename)
            let destination = directory.appendingPathComponent(name, isDirectory: false)
            // WebKit itself creates this path, which MUST NOT exist already.
            active[ObjectIdentifier(download)] = DownloadRecord(
                download: download, destination: destination, directory: directory
            )
            onNotice("正在准备系统文件下载，完成后将弹出 iOS 保存或分享选项。")
            completionHandler(destination)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            onNotice("无法创建受保护的下载临时文件，下载已停止。")
            completionHandler(nil)
        }
    }

    func download(_ download: WKDownload,
                  willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest,
                  decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        // A WKDownload must not follow a redirect to an unrelated origin.
        // Do not send Web/PWA session data or bytes to other hosts.
        let isAllowed = request.url.map(sameOrigin) ?? false
        decisionHandler(isAllowed ? .allow : .cancel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let item = active.removeValue(forKey: ObjectIdentifier(download)) else {
            return
        }
        guard FileManager.default.fileExists(atPath: item.destination.path) else {
            removePrivateDownload(item)
            onNotice("下载已结束但没有可保存的完整文件。")
            return
        }
        guard let root = presentingWebView?.window?.rootViewController else {
            removePrivateDownload(item)
            onNotice("下载已完成，但当前没有可呈现的 iOS 保存窗口；临时文件已清理。")
            return
        }
        var presenter = root
        while let visible = presenter.presentedViewController {
            presenter = visible
        }
        let picker = UIActivityViewController(
            activityItems: [item.destination], applicationActivities: nil
        )
        if let popover = picker.popoverPresentationController,
           let view = presentingWebView {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX,
                                       y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        picker.completionWithItemsHandler = { [onNotice] _, completed, _, _ in
            try? FileManager.default.removeItem(at: item.directory)
            onNotice(completed
                ? "已将下载文件交给 iOS 系统保存或分享。"
                : "已关闭保存或分享窗口，临时下载文件已清理。")
        }
        onNotice(nil)
        presenter.present(picker, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error,
                  resumeData: Data?) {
        if let item = active.removeValue(forKey: ObjectIdentifier(download)) {
            removePrivateDownload(item)
        }
        // No implicit resume or fabricated completion when WebKit failed.
        onNotice("下载失败或中断，私有临时文件已清理；请重新检查服务器连接。")
    }

    private func removePrivateDownload(_ record: DownloadRecord) {
        try? FileManager.default.removeItem(at: record.directory)
    }

    private func sanitizedFilename(_ suggested: String) -> String {
        let normalized = suggested.replacingOccurrences(of: "\\", with: "/")
        let name = (normalized as NSString).lastPathComponent
        let valid = String(name.unicodeScalars.filter { scalar in
            scalar.value >= 32 &&
            !CharacterSet(charactersIn: "<>:\\"/|?*").contains(scalar)
        }.prefix(160))
        let trimmed = valid.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "." || trimmed == ".." {
            return "xdrive-download"
        }
        return trimmed
    }
}
