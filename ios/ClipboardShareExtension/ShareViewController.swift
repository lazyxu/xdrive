import UIKit
import UniformTypeIdentifiers

/// User-triggered iOS Share Extension for selected text and URLs.
/// No stored plaintext, no background upload, no E2EE/Owner secrets crossing
/// process boundaries. The only handoff is an explicit, expiring, local-only
/// system paste operation. xDrive's native screen performs encryption itself.
final class ShareViewController: UIViewController {
    private let status = UILabel()
    private let copyButton = UIButton(type: .system)
    private var proposedText: String?

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
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) ||
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) else {
            status.text = "只能接收文字或链接。"
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
                    : "点击复制后，打开 xDrive → 剪贴板 → 解锁 → 从系统剪贴板读取 → 加密发送。"
            }
        }
    }

    @objc private func copySelectedText() {
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
}
