import UIKit
import UniformTypeIdentifiers

/// User-triggered iOS Share Extension for selected text, URLs and one image/file.
/// No stored plaintext, no background upload, no E2EE/Owner secrets crossing
/// process boundaries. The only handoff is an explicit, expiring, local-only
/// system paste operation. The native Clipboard page reads it on an explicit
/// paste tap and sends plaintext only after a separate user confirmation.
final class ShareViewController: UIViewController {
    private let status = UILabel()
    private let copyButton = UIButton(type: .system)
    private var proposedText: String?
    private var fileProvider: NSItemProvider?
    private var fileTypeIdentifier = ""
    private var fileIsImage = false
    // Private, local-only UIPasteboard types. No bearer, E2EE or Owner ID
    // crosses the extension boundary; the native page requires another tap.
    private static let bytesType = "com.lazyxu.xdrive.clipboard.file.bytes"
    private static let nameType = "com.lazyxu.xdrive.clipboard.file.name"
    private static let kindType = "com.lazyxu.xdrive.clipboard.file.kind"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.numberOfLines = 0
        status.text = "正在读取所选文本…"
        status.textAlignment = .center
        copyButton.setTitle("复制到本机剪贴板", for: .normal)
        copyButton.isEnabled = false
        copyButton.addTarget(self, action: #selector(copySelectedText), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [status, copyButton])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
        ])
        loadFirstSupportedInput()
    }

    private func loadFirstSupportedInput() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        // Photos may offer both image and URL representations; prefer the
        // actual user-selected photo instead of silently downgrading to URL.
        if let image = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
        }) {
            prepareBinaryShare(image, isImage: true)
            return
        }
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) ||
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) else {
            if let file = providers.first(where: {
                $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) ||
                $0.hasItemConformingToTypeIdentifier(UTType.data.identifier)
            }) {
                prepareBinaryShare(file, isImage: false)
                return
            }
            status.text = "只能接收文字、链接、图片或文件。"
            return
        }
        let type = provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
            ? UTType.plainText.identifier : UTType.url.identifier
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, error in
            // Do not read the system clipboard or log input, even on failure.
            let value: String?
            if let text = item as? String { value = text }
            else if let url = item as? URL { value = url.absoluteString }
            else if let data = item as? Data { value = String(data: data, encoding: .utf8) }
            else { value = nil }
            let accepted = error == nil ? XDriveIOSClipboardSharePolicy.acceptable(value) : nil
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.proposedText = accepted
                self.copyButton.isEnabled = accepted != nil
                self.status.text = accepted == nil
                    ? "所选内容不支持，或超过 64 KiB。"
                    : "复制后 2 分钟内，打开 xDrive → 剪贴板 → 从本机粘贴 → 发送。消息不加密，请勿发送密码或验证码。"
            }
        }
    }

    private func prepareBinaryShare(_ provider: NSItemProvider, isImage: Bool) {
        let type = provider.registeredTypeIdentifiers.first(where: { identifier in
            guard let content = UTType(identifier) else { return false }
            return isImage ? content.conforms(to: .image) :
                (content.conforms(to: .data) || content.conforms(to: .fileURL))
        }) ?? (isImage ? UTType.image.identifier : UTType.data.identifier)
        fileProvider = provider
        fileTypeIdentifier = type
        fileIsImage = isImage
        copyButton.setTitle("复制所选图片或文件供 xDrive 导入", for: .normal)
        copyButton.isEnabled = true
        status.text = "仅复制所选文件到本机临时剪贴板（最多 64 MiB、有效 2 分钟）。打开 xDrive → 剪贴板，选择目标设备和图片/文件类型，再点击“从分享内容导入”。不会自动上传或发送。"
    }

    @objc private func copySelectedText() {
        if let provider = fileProvider {
            copySelectedBinary(provider)
            return
        }
        guard let text = XDriveIOSClipboardSharePolicy.acceptable(proposedText) else { return }
        // No universal clipboard mirroring. A short expiry avoids lingering
        // shared sensitive content indefinitely after the explicit user action.
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: text]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
        )
        proposedText = nil
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func copySelectedBinary(_ provider: NSItemProvider) {
        copyButton.isEnabled = false
        let requested = fileTypeIdentifier
        // File representations are temporary until this callback returns.
        // Copy only after a foreground user tap; never invoke any xDrive API.
        provider.loadFileRepresentation(forTypeIdentifier: requested) { [weak self] url, _ in
            if let url = url {
                let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
                let bytes = (attrs?[.size] as? NSNumber)?.intValue ?? -1
                let data: Data? = XDriveIOSClipboardSharePolicy.acceptableFileSize(bytes)
                    ? try? Data(contentsOf: url, options: .mappedIfSafe) : nil
                DispatchQueue.main.async { self?.finishBinaryCopy(data) }
            } else {
                provider.loadDataRepresentation(forTypeIdentifier: requested) { [weak self] data, _ in
                    DispatchQueue.main.async { self?.finishBinaryCopy(data) }
                }
            }
        }
    }

    private func finishBinaryCopy(_ data: Data?) {
        guard let provider = fileProvider, let data,
              XDriveIOSClipboardSharePolicy.acceptableFileSize(data.count) else {
            copyButton.isEnabled = true
            status.text = "所选文件不可读取或超过 64 MiB，请改用 xDrive Files 选择器。"
            return
        }
        let ext = UTType(fileTypeIdentifier)?.preferredFilenameExtension ?? (fileIsImage ? "png" : "bin")
        let proposedName = provider.suggestedName ?? (fileIsImage ? "Shared-Image" : "Shared-File")
        let filename = proposedName.contains(".") ? proposedName : proposedName + "." + ext
        guard let safeName = XDriveIOSClipboardSharePolicy.acceptableFileName(filename) else {
            copyButton.isEnabled = true
            status.text = "所选文件名无效，请在 xDrive Files 中手动选择。"
            return
        }
        UIPasteboard.general.setItems([[
            Self.bytesType: data,
            Self.nameType: safeName,
            Self.kindType: fileIsImage ? "image" : "file",
        ]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
        fileProvider = nil
        proposedText = nil
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
