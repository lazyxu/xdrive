import SwiftUI
import UIKit
import Foundation

/// The selected native Viewer alone owns this presentation. It reports actual
/// decoded dimensions; the original byte size is metadata, not an assertion
/// that those exact bytes are stored offline or rendered at full resolution.
struct XDriveIOSNativeViewerQualityPanel: View {
    let fileName: String
    let source: String
    let image: UIImage
    var originalBytes: Int64? = nil
    var archiveOriginal: Bool = false
    var liveFiles: XDriveIOSLivePreviewFiles? = nil

    @State private var expanded = false

    // Display the known file/resource suffix, not an invented decoder MIME.
    // A Live container's outer LIVP/ZIP extension is not its still-image format.
    private var resourceFormat: String {
        if let liveFiles {
            let ext = liveFiles.stillURL.pathExtension.uppercased()
            return ext.isEmpty ? "实况静态资源（格式未知）" : ext + "（实况静态资源）"
        }
        let ext = URL(fileURLWithPath: fileName).pathExtension.uppercased()
        return ext.isEmpty ? "本机 PhotoKit（原始格式未确认）" :
            (archiveOriginal ? ext + "（实况容器）" : ext + "（文件扩展名）")
    }

    private var pixelWidth: Int {
        image.cgImage?.width ?? Int(image.size.width * image.scale)
    }
    private var pixelHeight: Int {
        image.cgImage?.height ?? Int(image.size.height * image.scale)
    }
    private func sizeLabel(_ count: Int64?) -> String {
        guard let count, count > 0 else { return "大小未知" }
        return ByteCountFormatter.string(fromByteCount: count, countStyle: .file)
    }
    private func stagedSize(_ url: URL) -> Int64? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? NSNumber else { return nil }
        return size.int64Value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button {
                expanded.toggle()
            } label: {
                Text("画质：\(source)")
                    .font(.caption)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("native-ios-viewer-quality-toggle")

            if expanded {
                VStack(alignment: .leading, spacing: 5) {
                    Text("来源格式：\(resourceFormat)")
                    Text("当前已解码：\(pixelWidth) × \(pixelHeight)")
                    Text("\(archiveOriginal ? "归档容器" : "原件")：\(sizeLabel(originalBytes))")
                    if let liveFiles {
                        Text("实况静态：已加载到临时文件 · \(sizeLabel(stagedSize(liveFiles.stillURL)))")
                        Text("实况动态：已加载到临时文件 · \(sizeLabel(stagedSize(liveFiles.motionURL)))")
                    } else if archiveOriginal {
                        Text("实况双资源：尚未完整加载")
                    }
                    Text("此处的“已加载”仅指本次会话的内存或临时文件，并非已保存到设备相册。")
                        .foregroundStyle(.white.opacity(0.75))
                }
                .font(.caption2)
                .accessibilityIdentifier("native-ios-viewer-quality-details")
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: 300, alignment: .leading)
        .background(Color.black.opacity(0.80), in: RoundedRectangle(cornerRadius: 10))
        .padding(10)
    }
}
