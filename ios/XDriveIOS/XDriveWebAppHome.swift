import SwiftUI
import WebKit
import UIKit

/// Persist the PWA's selected HTTPS origin independently from the native
/// Keychain login's last-used server. Native login may intentionally target a
/// different Owner/server; it must never silently retarget the shared Web UI
/// at the next cold launch.
private enum XDriveIOSWebOriginPreference {
    private static let key = "xdrive.ios.web.origin"
    private static let legacyNativeKey = "xdrive.ios.server"

    static func load() -> String {
        if let saved = UserDefaults.standard.string(forKey: key) {
            // A malformed saved Web origin should show the connection form;
            // never fall back to a different, native-login server.
            return saved
        }
        // One-time migration for installs predating the split. An invalid
        // legacy value is left visible for the user to correct, not trusted.
        let legacy = UserDefaults.standard.string(forKey: legacyNativeKey) ?? ""
        if let origin = try? ServerAddress.parse(legacy) {
            UserDefaults.standard.set(origin.absoluteString, forKey: key)
            return origin.absoluteString
        }
        return legacy
    }

    static func save(_ origin: URL) {
        UserDefaults.standard.set(origin.absoluteString, forKey: key)
    }
}

/// Opt-in Web/PWA shell. The Web's HttpOnly cookie session is separate from
/// the native Keychain refresh token. No secret is injected into JS or URLs.
struct XDriveWebAppHome: View {
    @State private var serverText: String
    @State private var openedOrigin: URL?
    @State private var inputError: String?
    @State private var pageError: String?
    @State private var downloadNotice: String?
    @State private var confirmLeave = false
    @State private var emergencyStopBusy = false
    @State private var emergencyStopNotice: String?

    init() {
        let saved = XDriveIOSWebOriginPreference.load()
        _serverText = State(initialValue: saved)
        _openedOrigin = State(initialValue: try? ServerAddress.parse(saved))
    }

    var body: some View {
        Group {
            if let origin = openedOrigin {
                ZStack(alignment: .trailing) {
                    XDriveOriginLockedWebView(
                        origin: origin,
                        onPageError: { pageError = $0 },
                        onDownloadNotice: { downloadNotice = $0 },
                        onRequestServerChange: { confirmLeave = true }
                    )
                        .ignoresSafeArea(.container, edges: .bottom)
                        .id(origin.absoluteString)

                    if let downloadNotice {
                        VStack {
                            Spacer()
                            HStack(spacing: 12) {
                                Text(downloadNotice)
                                    .font(.footnote)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button {
                                    self.downloadNotice = nil
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                }
                                .accessibilityLabel("关闭下载提示")
                            }
                            .padding(12)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                            .padding(.horizontal, 12)
                            .padding(.bottom, 24)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }

                    if let pageError {
                        VStack(spacing: 10) {
                            Label("无法加载 xDrive 网页", systemImage: "wifi.exclamationmark")
                                .font(.headline)
                            Text(pageError)
                                .font(.caption)
                                .multilineTextAlignment(.center)
                            Button("更换服务器地址") { confirmLeave = true }
                                .buttonStyle(.borderedProminent)
                            Button("紧急停止本机后台相册备份", role: .destructive) {
                                emergencyStopBackgroundLocally()
                            }
                            .disabled(emergencyStopBusy)
                            .accessibilityIdentifier("offline-ios-photo-emergency-stop")
                            if let emergencyStopNotice {
                                Text(emergencyStopNotice).font(.caption)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                        .padding(20)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            } else {
                connectionForm
            }
        }
        .confirmationDialog(
            "切换服务器会终止当前网页内未完成的上传或下载。",
            isPresented: $confirmLeave,
            titleVisibility: .visible
        ) {
            Button("确认切换服务器", role: .destructive) {
                pageError = nil
                downloadNotice = nil
                openedOrigin = nil
            }
            Button("取消", role: .cancel) {}
        }
    }

    /// Bootstrap emergency action stays usable even if the PWA cannot load.
    /// It never creates a second native account or Photos settings page.
    private func emergencyStopBackgroundLocally() {
        guard !emergencyStopBusy else { return }
        emergencyStopBusy = true
        Task { @MainActor in
            do {
                let pendingRemote = try await XDriveIOSPhotoBackgroundGrantManager
                    .shared.emergencyStopLocally()
                emergencyStopNotice = pendingRemote
                    ? "本机后台任务与凭据已停止；联网登录后仍需撤销服务器授权。"
                    : "已取消本机后台任务；未找到活跃的本机后台凭据。"
            } catch {
                emergencyStopNotice =
                    "已请求取消后台任务，但 Keychain 清除尚未证实；请解锁后重试。"
            }
            emergencyStopBusy = false
        }
    }

    private var connectionForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image("Brand")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("xDrive").font(.title.bold())
                        Text("iOS App · 共用 PWA 页面").foregroundStyle(.secondary)
                    }
                }
                Text("服务器 HTTPS 地址").font(.headline)
                TextField("https://drive.example.com", text: $serverText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .padding(14)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("web-server-origin")
                if let inputError {
                    Text(inputError)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
                Button {
                    do {
                        let origin = try ServerAddress.parse(serverText)
                        serverText = origin.absoluteString
                        XDriveIOSWebOriginPreference.save(origin)
                        inputError = nil
                        pageError = nil
                        downloadNotice = nil
                        openedOrigin = origin
                    } catch {
                        inputError = AuthFailure.message(for: error)
                    }
                } label: {
                    Text("打开 xDrive 文件与图库")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("open-shared-web-app")
                Text("这里打开服务器提供的同一套 Web/PWA Files、图库、Viewer 和地图页面；请在网页内登录。网页 Cookie 与原生 Keychain 登录互不复用。必须使用真实可信的 HTTPS 域名或 IP 证书，不允许绕过证书校验。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .buttonStyle(.bordered)
                Button("紧急停止本机后台相册备份", role: .destructive) {
                    emergencyStopBackgroundLocally()
                }
                .disabled(emergencyStopBusy)
                .accessibilityIdentifier("offline-ios-photo-emergency-stop")
                if let emergencyStopNotice {
                    Text(emergencyStopNotice)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 430, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct XDriveOriginLockedWebView: UIViewRepresentable {
    let origin: URL
    let onPageError: (String?) -> Void
    let onDownloadNotice: (String?) -> Void
    let onRequestServerChange: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(origin: origin, onPageError: onPageError,
                    onDownloadNotice: onDownloadNotice,
                    onRequestServerChange: onRequestServerChange)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Persistent Web PWA cookie/storage lifecycle; no native bearer token.
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // The native iOS Host Adapter only accepts authenticated messages from
        // this trusted HTTPS main frame. No standalone SwiftUI backup page.
        configuration.userContentController.add(
            context.coordinator.photoHost,
            name: XDriveIOSPhotoHostBridge.messageName
        )
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.attach(webView: view)
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = UIColor.systemBackground
        view.load(URLRequest(url: origin, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.stopDownloads()
        uiView.configuration.userContentController.removeScriptMessageHandler(
            forName: XDriveIOSPhotoHostBridge.messageName
        )
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let origin: URL
        private let onPageError: (String?) -> Void
        private let downloads: XDriveWebDownloadCoordinator
        let photoHost: XDriveIOSPhotoHostBridge

        init(origin: URL, onPageError: @escaping (String?) -> Void,
             onDownloadNotice: @escaping (String?) -> Void,
             onRequestServerChange: @escaping () -> Void) {
            self.origin = origin
            self.onPageError = onPageError
            self.photoHost = XDriveIOSPhotoHostBridge(
                origin: origin, onRequestServerChange: onRequestServerChange
            )
            self.downloads = XDriveWebDownloadCoordinator(
                origin: origin, onNotice: onDownloadNotice
            )
        }

        func attach(webView: WKWebView) {
            downloads.presentingWebView = webView
            photoHost.webView = webView
        }

        func stopDownloads() {
            downloads.stopPendingDownloads()
            photoHost.cancelActive()
            photoHost.webView = nil
        }

        func webView(_ webView: WKWebView,
                     didStartProvisionalNavigation navigation: WKNavigation!) {
            // A full navigation is not an authenticated continuation of the
            // old PWA Owner's PhotoKit backup. Same-document hash routes do not
            // trigger this hook; the shared Settings unmount cancels instead.
            photoHost.cancelActive()
        }

        private func sameOrigin(_ target: URL) -> Bool {
            guard let source = URLComponents(url: origin, resolvingAgainstBaseURL: false),
                  let destination = URLComponents(url: target, resolvingAgainstBaseURL: false),
                  source.scheme?.lowercased() == "https",
                  destination.scheme?.lowercased() == "https",
                  source.host?.lowercased() == destination.host?.lowercased(),
                  (source.port ?? 443) == (destination.port ?? 443),
                  destination.user == nil, destination.password == nil
            else { return false }
            return true
        }

        private func openExplicitExternalLink(_ action: WKNavigationAction) {
            guard action.navigationType == .linkActivated,
                  let url = action.request.url,
                  url.scheme?.lowercased() == "https",
                  !sameOrigin(url) else { return }
            UIApplication.shared.open(url)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else {
                decisionHandler(.cancel)
                return
            }
            // PWA `<a download>` and same-origin Blob URLs are downloads,
            // never main-frame navigation or cross-origin credential hops.
            if action.shouldPerformDownload {
                decisionHandler(downloads.accepts(url) ? .download : .cancel)
                return
            }
            if action.targetFrame?.isMainFrame == false {
                // Isolated HTTPS map Child and ordinary same-origin subframes
                // are supported; never allow insecure HTTP subframe navigation.
                let scheme = url.scheme?.lowercased()
                decisionHandler(scheme == "https" || scheme == "about" || scheme == "blob" ? .allow : .cancel)
                return
            }
            if action.targetFrame == nil {
                if sameOrigin(url) && action.navigationType == .linkActivated {
                    webView.load(action.request)
                } else {
                    openExplicitExternalLink(action)
                }
                decisionHandler(.cancel)
                return
            }
            guard sameOrigin(url) else {
                openExplicitExternalLink(action)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard response.isForMainFrame else {
                // Preserve the existing HTTPS isolated-map subframe behavior.
                decisionHandler(.allow)
                return
            }
            guard let url = response.response.url, downloads.accepts(url) else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(response.canShowMIMEType ? .allow : .download)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction,
                     didBecome download: WKDownload) {
            downloads.attach(download)
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse,
                     didBecome download: WKDownload) {
            downloads.attach(download)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url,
               sameOrigin(url), navigationAction.navigationType == .linkActivated {
                webView.load(navigationAction.request)
            } else {
                openExplicitExternalLink(navigationAction)
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onPageError(nil)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            onPageError("请检查服务器连通性和系统信任的 HTTPS 证书。\\n" + error.localizedDescription)
        }

        // No serverTrust override: WebKit and iOS must validate TLS normally.
    }
}
