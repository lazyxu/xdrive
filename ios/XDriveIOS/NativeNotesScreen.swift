import SwiftUI

// Newer SwiftUI SDKs expose two toolbar(content:) builder overloads.
// The ToolbarContent constraint disambiguates native Notes toolbar calls.
private extension View {
    func xDriveNotesToolbar<Content: ToolbarContent>(
        @ToolbarContentBuilder content: () -> Content
    ) -> some View {
        self.toolbar(content: content)
    }
}
import UIKit
import UniformTypeIdentifiers

struct XDriveIOSNativeMarkdownDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    static var writableContentTypes: [UTType] { [.plainText] }

    var markdown: String

    init(markdown: String) {
        self.markdown = markdown
    }

    init(configuration: ReadConfiguration) throws {
        let data = configuration.file.regularFileContents ?? Data()
        guard let text = String(data: data, encoding: .utf8) else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        self.markdown = text
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(markdown.utf8))
    }
}

// Native SwiftUI "全部 → 笔记", living in the existing dynamic module's
// NavigationStack. Never add a sixth bottom tab or an embedded browser fallback.
struct XDriveIOSNativeNotesScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var source: XDriveIOSNativeNoteSource = .mine
    @State private var search = ""
    @State private var items: [XDriveIOSNativeNoteSummary] = []
    @State private var nextOffset = 0
    @State private var isLoading = false
    @State private var isCreating = false
    @State private var importPickerOpen = false
    @State private var importingMarkdown = false
    @State private var errorMessage: String?
    @State private var createdNote: XDriveIOSNativeNoteSummary?
    @State private var showCreatedNote = false
    @State private var reloadEpoch = 0

    @ViewBuilder
    private var notesListToolbarButtons: some View {
        if source.writable {
            Button {
                Task { await createNote() }
            } label: {
                Label("新建笔记", systemImage: "square.and.pencil")
            }
            .disabled(isCreating || isLoading)
        } else {
            Button {
                importPickerOpen = true
            } label: {
                Label("导入 Markdown 和图片", systemImage: "square.and.arrow.down")
            }
            .disabled(importingMarkdown || isLoading)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("笔记来源", selection: $source) {
                ForEach(XDriveIOSNativeNoteSource.allCases) { option in
                    Text(option.title).tag(option)
                }
            }
            .pickerStyle(.segmented)
            // The Picker's localized title is not reliably exposed as an
            // iOS 18.5 SegmentedControl label. Give real segments a stable ID.
            .accessibilityIdentifier("native-ios-notes-source-picker")
            .padding(.horizontal, 16)
            .padding(.top, 8)
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            List {
                ForEach(items) { note in
                    NavigationLink {
                        XDriveIOSNativeNoteDetailScreen(
                            login: login, id: note.id, source: source,
                            onDeleted: { reloadEpoch &+= 1 }
                        )
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(note.title).font(.body).lineLimit(2)
                            HStack {
                                if !source.writable {
                                    Label("只读备份", systemImage: "lock.doc")
                                }
                                Text("版本 \(note.revision)")
                                Spacer()
                                Text(String(note.updated_at.prefix(10)))
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                if nextOffset > 0 {
                    Button {
                        Task { await loadMore() }
                    } label: {
                        HStack {
                            Spacer()
                            Text("加载更多")
                            Spacer()
                        }
                    }
                    .disabled(isLoading)
                }
                if !isLoading && items.isEmpty && errorMessage == nil {
                    VStack(spacing: 10) {
                        Image(systemName: "note.text")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text(source == .mine ? "暂无笔记" : "暂无 iOS 备份")
                            .font(.headline)
                        Text(source == .mine
                            ? "点击右上角的新建按钮，创建 Markdown 笔记。"
                            : "通过 Apple 快捷指令或手动导入，将 Apple 备忘录备份至此。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                }
            }
            .listStyle(.plain)
            .overlay {
                if isLoading && items.isEmpty {
                    ProgressView("读取笔记…")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-ios-notes-page")
        .navigationTitle("笔记")
        .searchable(text: $search, prompt: "搜索标题或正文")
        .xDriveNotesToolbar {
            ToolbarItem(placement: .topBarTrailing) {
                notesListToolbarButtons
            }
        }
        .fileImporter(isPresented: $importPickerOpen, allowedContentTypes: [.item],
                      allowsMultipleSelection: true) { result in
            Task { await importMarkdownFile(result) }
        }
        .navigationDestination(isPresented: $showCreatedNote) {
            if let note = createdNote {
                XDriveIOSNativeNoteDetailScreen(
                    login: login, id: note.id,
                    source: XDriveIOSNativeNoteSource(rawValue: note.source) ?? .mine,
                    onDeleted: { reloadEpoch &+= 1 }
                )
            }
        }
        .task(id: "\(source.rawValue)|\(search)|\(reloadEpoch)") {
            // Search is bound to the current native Owner/Source, and a rapid
            // source switch cancels the older request before applying results.
            do {
                try await Task.sleep(nanoseconds: 240_000_000)
                try Task.checkCancellation()
                await reload()
            } catch is CancellationError {
                return
            } catch {
                return
            }
        }
        .onAppear {
            reloadEpoch &+= 1
        }
        .refreshable {
            await reload()
        }
    }

    private func authorizedClient() async throws -> XDriveIOSNativeNotesClient {
        let proof = try await login.verifiedAuthorization()
        return try XDriveIOSNativeNotesClient(
            owner: proof.owner, accessToken: proof.accessToken
        )
    }

    @MainActor
    private func reload() async {
        let expectedSource = source
        let expectedSearch = search
        isLoading = true
        errorMessage = nil
        defer {
            if source == expectedSource && search == expectedSearch {
                isLoading = false
            }
        }
        do {
            let client = try await authorizedClient()
            try await client.initializeNamespace()
            let page = try await client.list(
                source: expectedSource, search: expectedSearch
            )
            try Task.checkCancellation()
            guard source == expectedSource && search == expectedSearch else { return }
            items = page.items
            nextOffset = page.next_offset
        } catch is CancellationError {
            return
        } catch {
            guard source == expectedSource && search == expectedSearch else { return }
            items = []
            nextOffset = 0
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadMore() async {
        guard nextOffset > 0 && !isLoading else { return }
        let expectedSource = source
        let expectedSearch = search
        let offset = nextOffset
        isLoading = true
        defer { isLoading = false }
        do {
            let client = try await authorizedClient()
            let page = try await client.list(
                source: expectedSource, search: expectedSearch, offset: offset
            )
            try Task.checkCancellation()
            guard source == expectedSource && search == expectedSearch,
                  nextOffset == offset else { return }
            let existing = Set(items.map(\.id))
            items += page.items.filter { !existing.contains($0.id) }
            nextOffset = page.next_offset
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // Security-scoped file imports must be bounded even if metadata claims
    // a smaller size. No copying to a persistent iOS cache or backup journal.
    private func readSelectedImportFile(_ url: URL, maxBytes: Int) throws -> Data {
        guard url.isFileURL else { throw XDriveIOSNativeNotesError.invalidResponse }
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted { url.stopAccessingSecurityScopedResource() }
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: maxBytes + 1) ?? Data()
        guard data.count <= maxBytes else { throw XDriveIOSNativeNotesError.tooLarge }
        return data
    }

    @MainActor
    private func importMarkdownFile(_ result: Result<[URL], Error>) async {
        guard source == .ios_notes && !importingMarkdown else { return }
        importingMarkdown = true
        defer { importingMarkdown = false }
        do {
            let selected = try result.get()
            guard !selected.isEmpty,
                  selected.count <= XDriveIOSNativeManualNotesImportPolicy.maxImages + 1
            else {
                throw XDriveIOSNativeManualNotesImportPolicy.Problem.tooManyFiles
            }
            let markdownFiles = selected.filter {
                ["md", "markdown"].contains($0.pathExtension.lowercased())
            }
            guard markdownFiles.count == 1, let markdownURL = markdownFiles.first else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            let photos = selected.filter { url in
                XDriveIOSNativeManualNotesImportPolicy.supportedImageExtensions
                    .contains(url.pathExtension.lowercased())
            }
            guard selected.count == photos.count + 1 else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            let title = markdownURL.deletingPathExtension().lastPathComponent
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty, title.utf8.count <= 255,
                  !title.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
            else { throw XDriveIOSNativeNotesError.invalidResponse }
            let markdownData = try readSelectedImportFile(
                markdownURL, maxBytes: 1_048_576
            )
            guard let original = String(data: markdownData, encoding: .utf8) else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            let names = try XDriveIOSNativeManualNotesImportPolicy.references(in: original)
            let requiredImages = try XDriveIOSNativeManualNotesImportPolicy.selectedImages(
                requiredNames: names, availableNames: photos.map(\.lastPathComponent)
            )
            let selectedByName = Dictionary(
                uniqueKeysWithValues: photos.map { ($0.lastPathComponent, $0) }
            )
            let client = try await authorizedClient()
            try await client.initializeNamespace()
            // A random import identity is scoped only to THIS explicit import
            // transaction. It never pretends to be an Apple Notes native ID.
            // The same random identity updates only the just-created snapshot
            // after the referenced images have been received and verified.
            let importID: String? = requiredImages.isEmpty
                ? nil : "manual-md:" + UUID().uuidString.lowercased()
            let first = try await client.importIOSMarkdown(
                title: title, markdown: original, externalID: importID
            )
            var rewritten = original
            for name in requiredImages {
                try Task.checkCancellation()
                guard let fileURL = selectedByName[name] else {
                    throw XDriveIOSNativeManualNotesImportPolicy.Problem.missingSelectedImage
                }
                let bytes = try readSelectedImportFile(
                    fileURL,
                    maxBytes: XDriveIOSNativeManualNotesImportPolicy.maxImageBytes
                )
                let path = try await client.importIOSNoteImage(
                    noteID: first.id, bytes: bytes
                )
                rewritten = try XDriveIOSNativeManualNotesImportPolicy.replacing(
                    rewritten, filename: name, with: path, noteID: first.id
                )
            }
            let committed: XDriveIOSNativeNoteSummary
            if rewritten != original, let importID {
                committed = try await client.importIOSMarkdown(
                    title: title, markdown: rewritten, externalID: importID
                )
                guard committed.id.lowercased() == first.id.lowercased(),
                      committed.revision > first.revision else {
                    throw XDriveIOSNativeNotesError.invalidResponse
                }
            } else {
                committed = first
            }
            try Task.checkCancellation()
            if source == .ios_notes {
                createdNote = committed
                showCreatedNote = true
                reloadEpoch &+= 1
                if photos.count > requiredImages.count {
                    errorMessage = "正文与引用图片已导入；未引用的图片没有上传。"
                }
            } else {
                errorMessage = "备份已导入至 iOS 备份分类，请切回查看。"
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = "导入未确认：\(error.localizedDescription)。若网络中断，请先核对备份列表再重试，避免重复导入。"
        }
    }

    @MainActor
    private func createNote() async {
        guard source == .mine && !isCreating else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let client = try await authorizedClient()
            try await client.initializeNamespace()
            let note = try await client.create(
                title: "未命名笔记", markdown: ""
            )
            guard note.isMine else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            createdNote = note
            showCreatedNote = true
            reloadEpoch &+= 1
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct XDriveIOSNativeNoteDetailScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let id: String
    let source: XDriveIOSNativeNoteSource
    let onDeleted: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var committed: XDriveIOSNativeNoteDetail?
    @State private var title = ""
    @State private var markdown = ""
    @State private var loading = false
    @State private var saving = false
    @State private var deleting = false
    @State private var conflict = false
    @State private var errorMessage: String?
    @State private var preview = true
    @State private var draftEpoch = 0
    @State private var askDelete = false
    @State private var askDiscard = false
    @State private var showHistory = false
    @State private var exporting = false
    @State private var imagePickerOpen = false
    @State private var imageUploading = false

    private var dirty: Bool {
        guard let committed else { return false }
        return committed.title != title || committed.markdown != markdown
    }

    @ViewBuilder
    private var notesDetailToolbarButtons: some View {
        if committed != nil {
            Button {
                showHistory = true
            } label: {
                Label("版本历史", systemImage: "clock.arrow.circlepath")
            }
            Button {
                exporting = true
            } label: {
                Label("导出 Markdown", systemImage: "square.and.arrow.up")
            }
            if source.writable {
                Button {
                    imagePickerOpen = true
                } label: {
                    Label("插入图片", systemImage: "photo.badge.plus")
                }
                .disabled(saving || deleting || conflict || imageUploading)
                Button {
                    Task { await save() }
                } label: {
                    Label("保存", systemImage: "checkmark")
                }
                .disabled(!dirty || conflict || saving || deleting)
                Button(role: .destructive) {
                    askDelete = true
                } label: {
                    Label("删除笔记", systemImage: "trash")
                }
                .disabled(saving || deleting)
            }
        }
    }

    var body: some View {
        Group {
            if loading && committed == nil {
                ProgressView("载入 Markdown…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if committed == nil {
                VStack(spacing: 12) {
                    Label("笔记无法读取", systemImage: "exclamationmark.triangle")
                        .font(.headline)
                    Text(errorMessage ?? "请检查当前服务器和登录状态。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label(source.writable ? "我的笔记" : "iOS 只读备份",
                              systemImage: source.writable ? "note.text" : "lock.doc")
                        .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        if saving {
                            ProgressView().controlSize(.small)
                        } else if dirty {
                            Text("待保存").foregroundStyle(.orange)
                        } else {
                            Text("已保存").foregroundStyle(.secondary)
                        }
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(conflict ? .orange : .red)
                    }
                    if source.writable {
                        TextField("标题", text: $title)
                            .font(.title3).bold()
                            .textFieldStyle(.roundedBorder)
                        Picker("编辑模式", selection: $preview) {
                            Text("编辑").tag(false)
                            Text("预览").tag(true)
                        }
                        .pickerStyle(.segmented)
                    } else {
                        Text(title).font(.title2).bold()
                    }
                    if !source.writable || preview {
                        ScrollView {
                            XDriveIOSNativeNotesMarkdownPreview(
                                login: login, noteID: id, markdown: markdown
                            )
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 8)
                        }
                    } else {
                        TextEditor(text: $markdown)
                            .font(.body.monospaced())
                            .scrollContentBackground(.hidden)
                            .background(Color(uiColor: .secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    if conflict {
                        HStack {
                            Button("复制当前草稿") {
                                UIPasteboard.general.string = "# \(title)\n\n\(markdown)"
                            }
                            .buttonStyle(.bordered)
                            Button("重新加载") { askDiscard = true }
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
        }
        .navigationTitle("笔记")
        .navigationBarTitleDisplayMode(.inline)
        .xDriveNotesToolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                notesDetailToolbarButtons
            }
        }
        .confirmationDialog("删除这条笔记？", isPresented: $askDelete) {
            Button("删除", role: .destructive) { Task { await delete() } }
        } message: {
            Text("仅删除我的笔记和该笔记的图片；iOS 备份不受影响。")
        }
        .confirmationDialog("放弃尚未保存的修改？", isPresented: $askDiscard) {
            Button("放弃并重新加载", role: .destructive) {
                Task { await load(discard: true) }
            }
        } message: {
            Text("服务器版本将替换当前未保存的草稿。")
        }
        .fileImporter(
            isPresented: $imagePickerOpen, allowedContentTypes: [.image],
            allowsMultipleSelection: false
        ) { result in
            Task { await insertImage(result) }
        }
        .fileExporter(
            isPresented: $exporting,
            document: XDriveIOSNativeMarkdownDocument(markdown: markdown),
            contentType: .plainText,
            defaultFilename: id + ".md"
        ) { result in
            if case .failure(let error) = result {
                errorMessage = error.localizedDescription
            }
        }
        .sheet(isPresented: $showHistory) {
            if let note = committed {
                XDriveIOSNativeNoteHistorySheet(
                    login: login, noteID: id, nodeID: note.node_id
                )
            }
        }
        .task(id: id) { await load(discard: false) }
        .onChange(of: title) { _ in draftEpoch &+= 1 }
        .onChange(of: markdown) { _ in draftEpoch &+= 1 }
        .task(id: draftEpoch) {
            guard draftEpoch > 0 else { return }
            do {
                try await Task.sleep(nanoseconds: 1_200_000_000)
                try Task.checkCancellation()
                await save()
            } catch {
                // Cancellation means the draft changed; the next task wins.
            }
        }
    }

    private func authorizedClient() async throws -> XDriveIOSNativeNotesClient {
        let proof = try await login.verifiedAuthorization()
        return try XDriveIOSNativeNotesClient(
            owner: proof.owner, accessToken: proof.accessToken
        )
    }

    @MainActor
    private func load(discard: Bool) async {
        if dirty && !discard { return }
        loading = true
        errorMessage = nil
        do {
            let client = try await authorizedClient()
            let note = try await client.detail(id: id)
            try Task.checkCancellation()
            guard note.source == source.rawValue else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            committed = note
            title = note.title
            markdown = note.markdown
            conflict = false
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    @MainActor
    private func save() async {
        guard source == .mine, !saving, !deleting, !conflict,
              let old = committed, dirty else { return }
        guard title.utf8.count <= 255, !title.trimmingCharacters(in: .whitespaces).isEmpty,
              markdown.utf8.count <= 1_048_576 else {
            errorMessage = "标题或 Markdown 超过 Server 限制。"
            return
        }
        let oldTitle = title
        let oldText = markdown
        saving = true
        errorMessage = nil
        var committedSuccessfully = false
        do {
            let client = try await authorizedClient()
            let saved = try await client.update(
                id: id, title: oldTitle, markdown: oldText, revision: old.revision
            )
            try Task.checkCancellation()
            guard saved.id.lowercased() == id.lowercased(),
                  saved.source == XDriveIOSNativeNoteSource.mine.rawValue,
                  saved.revision > old.revision else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            committed = XDriveIOSNativeNoteDetail(
                id: saved.id, source: saved.source, title: oldTitle,
                node_id: saved.node_id, revision: saved.revision,
                sha256: saved.sha256, bytes: saved.bytes, markdown: oldText
            )
            committedSuccessfully = true
        } catch XDriveIOSNativeNotesError.staleRevision {
            conflict = true
            errorMessage = XDriveIOSNativeNotesError.staleRevision.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
        saving = false
        if committedSuccessfully && dirty && !conflict {
            // A newer keystroke may have arrived while the old revision was
            // committing. Schedule another save without dropping that draft.
            draftEpoch &+= 1
        }
    }

    @MainActor
    private func insertImage(_ result: Result<[URL], Error>) async {
        guard source == .mine, committed != nil,
              !saving, !deleting, !conflict, !imageUploading else { return }
        imageUploading = true
        defer { imageUploading = false }
        do {
            let files = try result.get()
            guard let url = files.first else {
                throw XDriveIOSNativeNotesError.invalidResponse
            }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let knownSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
            if let knownSize, knownSize > 20 * 1_048_576 {
                throw XDriveIOSNativeNotesError.tooLarge
            }
            let bytes = try Data(contentsOf: url, options: .mappedIfSafe)
            guard !bytes.isEmpty, bytes.count <= 20 * 1_048_576 else {
                throw XDriveIOSNativeNotesError.tooLarge
            }
            let initialOwner = login.owner?.ownerID
            let client = try await authorizedClient()
            let path = try await client.uploadMyNoteImage(noteID: id, bytes: bytes)
            try Task.checkCancellation()
            guard login.owner?.ownerID == initialOwner, source == .mine else {
                throw XDriveIOSNativeNotesError.invalidOwner
            }
            let name = String(url.deletingPathExtension().lastPathComponent
                .filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" || $0 == "_" }
                .prefix(80))
            let alt = name.isEmpty ? "图片" : name
            markdown += (markdown.hasSuffix("\n") || markdown.isEmpty ? "" : "\n") +
                "\n![\(alt)](\(path))\n"
            preview = true
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete() async {
        guard source == .mine, !deleting, !saving,
              let note = committed, !dirty else {
            errorMessage = "请先保存草稿，再删除笔记。"
            return
        }
        deleting = true
        defer { deleting = false }
        do {
            let client = try await authorizedClient()
            try await client.delete(id: id, revision: note.revision)
            onDeleted()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct XDriveIOSNativeNoteHistorySheet: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let noteID: String
    let nodeID: UInt64

    @Environment(\.dismiss) private var dismiss
    @State private var versions: [XDriveIOSNativeNoteVersion] = []
    @State private var oldMarkdown: String?
    @State private var errorMessage: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(versions) { version in
                    Button {
                        Task { await read(version) }
                    } label: {
                        HStack {
                            Text("版本 \(version.revision)")
                            Spacer()
                            Text("\(version.bytes) B")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if let oldMarkdown {
                    Section("旧版内容（只读）") {
                        XDriveIOSNativeNotesMarkdownPreview(
                            login: login, noteID: noteID, markdown: oldMarkdown
                        )
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .overlay { if loading { ProgressView() } }
            .navigationTitle("历史版本")
            .xDriveNotesToolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task {
            await loadVersions()
        }
    }

    private func client() async throws -> XDriveIOSNativeNotesClient {
        let proof = try await login.verifiedAuthorization()
        return try XDriveIOSNativeNotesClient(
            owner: proof.owner, accessToken: proof.accessToken
        )
    }

    @MainActor
    private func loadVersions() async {
        loading = true
        defer { loading = false }
        do {
            versions = try await client().versions(id: noteID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func read(_ version: XDriveIOSNativeNoteVersion) async {
        loading = true
        defer { loading = false }
        do {
            oldMarkdown = try await client().previousMarkdown(
                nodeID: nodeID, version: version
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
