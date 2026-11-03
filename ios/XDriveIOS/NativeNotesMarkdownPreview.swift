import SwiftUI
import UIKit

private struct XDriveIOSNativeNotesMarkdownLine: Identifiable {
    let id: Int
    let text: String
}

/// Render Markdown text in pure native SwiftUI. Only immutable local
/// _assets/<same Note ID>/<UUID> images may be requested over verified HTTPS.
/// Never issue a request for an embedded external Markdown URL.
struct XDriveIOSNativeNotesMarkdownPreview: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let noteID: String
    let markdown: String

    private var lines: [XDriveIOSNativeNotesMarkdownLine] {
        markdown.components(separatedBy: "\n").enumerated().map {
            XDriveIOSNativeNotesMarkdownLine(id: $0.offset, text: $0.element)
        }
    }

    private func assetPath(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("!["), trimmed.hasSuffix(")"),
              let middle = trimmed.range(of: "](") else { return nil }
        let last = trimmed.index(before: trimmed.endIndex)
        let path = String(trimmed[middle.upperBound..<last])
        return path.hasPrefix("_assets/") ? path : nil
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 4) {
            ForEach(lines) { line in
                if let path = assetPath(line.text) {
                    XDriveIOSNativeNotesInlineImage(
                        login: login, noteID: noteID, relativePath: path
                    )
                    .accessibilityIdentifier("ios-notes-image-\(line.id)")
                } else if line.text.trimmingCharacters(in: .whitespaces).hasPrefix("![") {
                    Text("此图片不是已授权的备忘录内置附件")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text((try? AttributedString(markdown: line.text)) ??
                         AttributedString(line.text.isEmpty ? " " : line.text))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct XDriveIOSNativeNotesInlineImage: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let noteID: String
    let relativePath: String

    @State private var picture: UIImage?
    @State private var failure: String?
    @State private var busy = false

    var body: some View {
        Group {
            if let picture {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: 560)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else if busy {
                ProgressView("读取图片…")
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Label(failure ?? "图片暂不可用", systemImage: "photo")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .task(id: "\(noteID)|\(relativePath)") {
            picture = nil
            failure = nil
            busy = true
            defer { busy = false }
            do {
                let proof = try await login.verifiedAuthorization()
                let client = try XDriveIOSNativeNotesClient(
                    owner: proof.owner, accessToken: proof.accessToken
                )
                let bytes = try await client.readNoteImage(
                    noteID: noteID, relativePath: relativePath
                )
                try Task.checkCancellation()
                guard let decoded = UIImage(data: bytes) else {
                    throw XDriveIOSNativeNotesError.invalidResponse
                }
                picture = decoded
            } catch is CancellationError {
                return
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
