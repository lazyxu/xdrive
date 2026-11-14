import SwiftUI

/// Presentation-only layout shared across Browse, collections and Viewer.
enum XDriveIOSNativeFilesUIStyle {
    static let rowHeight: CGFloat = 52
    static let tapHeight: CGFloat = 44
    static let selectionDockHeight: CGFloat = 52
    static let actionIconSize: CGFloat = 18
    static let cardRadius: CGFloat = 14
    static let metadataFont: Font = .caption
    static let dockLabelFont: Font = .caption2.weight(.semibold)

    static func rowName(_ value: String) -> some View {
        Text(value).font(.subheadline.weight(.medium)).lineLimit(2)
    }

    static func tileName(_ value: String) -> some View {
        Text(value).font(.footnote.weight(.medium)).lineLimit(2)
    }

    static func metadata(_ value: String) -> some View {
        Text(value).font(metadataFont).foregroundStyle(.secondary).lineLimit(1)
    }
}


/// File extensions inform presentation only: never treat badges as MIME proof.
extension XDriveIOSNativeFilesUIStyle {
    static func fileAppearance(_ node: XDriveIOSNativeFilesNode)
        -> (label: String, symbol: String, tint: Color) {
        if node.isDirectory {
            return ("文件夹", "folder.fill", .accentColor)
        }
        switch (node.name as NSString).pathExtension.lowercased() {
        case "pdf": return ("PDF", "doc.richtext", .red)
        case "doc", "docx", "odt": return ("DOC", "doc.text", .blue)
        case "xls", "xlsx", "csv", "ods": return ("XLS", "tablecells", .green)
        case "ppt", "pptx", "odp": return ("PPT", "rectangle.on.rectangle", .orange)
        case "zip", "7z", "rar", "tar", "gz": return ("ZIP", "archivebox", .indigo)
        case "mp4", "mov", "m4v", "avi", "mkv": return ("视频", "video.fill", .purple)
        case "jpg", "jpeg", "png", "heic", "webp", "gif": return ("图片", "photo", .teal)
        case "mp3", "m4a", "wav", "flac", "aac": return ("音频", "waveform", .pink)
        case "swift", "go", "py", "js", "ts", "json", "html", "css", "xml":
            return ("代码", "curlybraces", .indigo)
        case "txt", "md", "log": return ("TXT", "doc.plaintext", .secondary)
        default: return ("文件", "doc", .secondary)
        }
    }

    static func typeBadge(_ node: XDriveIOSNativeFilesNode) -> some View {
        let appearance = fileAppearance(node)
        return Text(appearance.label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(appearance.tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(appearance.tint.opacity(0.10), in: Capsule())
            .accessibilityLabel("文件类型：" + appearance.label)
    }
}

/// Read-only, Owner-fenced metadata from an already verified list snapshot.
/// This view never requests file contents or performs a second mutation.
struct XDriveIOSNativeFilesQuickInfoPanel: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) {
                    Section {
                        HStack(spacing: 12) {
                            Image(systemName: XDriveIOSNativeFilesUIStyle.fileAppearance(node).symbol)
                                .font(.title2)
                                .foregroundStyle(XDriveIOSNativeFilesUIStyle.fileAppearance(node).tint)
                                .frame(width: 44, height: 44)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(node.name).font(.headline).lineLimit(3)
                                XDriveIOSNativeFilesUIStyle.typeBadge(node)
                            }
                        }
                    }
                    Section("属性") {
                        LabeledContent("名称", value: node.name)
                        LabeledContent("类型", value: XDriveIOSNativeFilesUIStyle.fileAppearance(node).label)
                        if !node.isDirectory {
                            LabeledContent("大小", value: ByteCountFormatter.string(
                                fromByteCount: node.size, countStyle: .file))
                        }
                        LabeledContent("版本", value: String(node.revision))
                        if let created = node.createdDate {
                            LabeledContent("创建", value: XDriveIOSNativeFilesDatePolicy.display(created))
                        }
                        if let updated = node.modifiedDate {
                            LabeledContent("修改", value: XDriveIOSNativeFilesDatePolicy.display(updated))
                        }
                    }
                    Section {
                        Text("属性来自已核验的文件列表；任何写入仍会重新检查账户与文件版本。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Text("账户已变化，请关闭后重新打开文件属性。")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("属性")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成", action: onClose)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("native-ios-files-quick-info-sheet")
    }
}
