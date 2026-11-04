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

    private var showsLowResolutionWarning: Bool {
        source.contains("缩略图") || source.contains("低清")
    }

    var body: some View {
        Button {
            expanded = true
        } label: {
            // Keep the extra xDrive quality affordance compact on the
            // native photo canvas. Metadata belongs in a separate sheet.
            HStack(spacing: 5) {
                Image(systemName: "info.circle")
                Text(showsLowResolutionWarning ? "低清" : "画质")
                    .font(.caption2.weight(.semibold))
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(showsLowResolutionWarning ?
            "低清预览，查看画质与文件信息" : "查看画质与文件信息")
        .accessibilityHint("显示当前解码分辨率、原件大小及实况资源状态")
        .accessibilityIdentifier("native-ios-viewer-quality-toggle")
        .padding(8)
        .sheet(isPresented: $expanded) {
            NavigationStack {
                List {
                    Section("当前显示") {
                        LabeledContent("来源", value: source)
                        LabeledContent("解码分辨率",
                                       value: "\(pixelWidth) × \(pixelHeight)")
                        if showsLowResolutionWarning {
                            Text("当前仅显示低清预览，放大不能恢复未加载的原件细节。")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("文件与资源") {
                        LabeledContent("来源格式", value: resourceFormat)
                        LabeledContent(archiveOriginal ? "归档容器大小" : "原件大小",
                                       value: sizeLabel(originalBytes))
                        if let liveFiles {
                            LabeledContent("实况静态资源",
                                value: "临时文件 · \(sizeLabel(stagedSize(liveFiles.stillURL)))")
                            LabeledContent("实况动态资源",
                                value: "临时文件 · \(sizeLabel(stagedSize(liveFiles.motionURL)))")
                        } else if archiveOriginal {
                            Text("实况双资源尚未完整加载")
                        }
                    }

                    Section {
                        Text("“已加载”仅指当前会话中的图像内存或临时文件，不代表原件已经保存到系统照片。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("native-ios-viewer-quality-details")
                .navigationTitle("画质与文件信息")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { expanded = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        // Changing the viewed media must close an older item's information
        // sheet rather than leave a stale detail surface over its successor.
        .onChange(of: fileName) { _ in expanded = false }
        .onChange(of: source) { _ in expanded = false }
        .onChange(of: originalBytes) { _ in expanded = false }
        .onChange(of: liveFiles?.folderURL) { _ in expanded = false }
    }
}
