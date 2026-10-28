import SwiftUI
import UniformTypeIdentifiers

/// Matches the Android native auth card: same brand, compact centered surface,
/// server / username / password inputs, reveal action, keep-login and errors.
struct LoginScreen: View {
    @StateObject private var model = LoginViewModel()
    @State private var passwordVisible = false
    @State private var showPhotoInventory = false
    @State private var showDocumentPicker = false
    @State private var manualUploadTask: Task<Void, Never>?
    @Environment(\.colorScheme) private var colorScheme

    private var colors: XDrivePalette { XDrivePalette(dark: colorScheme == .dark) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack {
                    card
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: geometry.size.height)
                .padding(.horizontal, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(
                LinearGradient(
                    colors: [colors.primary.opacity(0.055), colors.background],
                    startPoint: .top, endPoint: .bottom
                )
            )
        }
        .task { await model.restore() }
        .sheet(isPresented: $showPhotoInventory) {
            LocalPhotoInventoryScreen()
        }
        .fileImporter(
            isPresented: $showDocumentPicker,
            allowedContentTypes: [.item],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let file = urls.first {
                manualUploadTask?.cancel()
                manualUploadTask = Task {
                    await model.uploadManualDocument(file)
                }
            }
        }
        .onDisappear {
            manualUploadTask?.cancel()
            manualUploadTask = nil
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image("Brand")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("xDrive")
                VStack(alignment: .leading, spacing: 3) {
                    Text("xDrive")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(colors.text)
                    Text("连接到你的个人云端")
                        .font(.footnote)
                        .foregroundColor(colors.secondary)
                }
                Spacer(minLength: 0)
            }

            Text(model.signedInName == nil ? "欢迎使用 xDrive" : "已连接 xDrive")
                .font(.title3.weight(.semibold))
                .foregroundColor(colors.text)

            if let user = model.signedInName {
                connectedView(user: user)
            } else {
                loginForm
            }
        }
        .padding(24)
        .frame(maxWidth: 430)
        .background(RoundedRectangle(cornerRadius: 14).fill(colors.surface))
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.22 : 0.08),
                radius: 14, y: 6)
        .padding(.vertical, 24)
    }

    private var loginForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            fieldLabel("服务器")
            inputSurface {
                TextField("https://drive.example.com:8443", text: $model.server)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .accessibilityIdentifier("server")
            }
            Text("支持 HTTPS 域名或证书有效的内网 IP 地址；独立内网优先路由尚未加入首版。")
                .font(.footnote)
                .foregroundColor(colors.secondary)
                .fixedSize(horizontal: false, vertical: true)

            fieldLabel("用户名")
            inputSurface {
                TextField("用户名", text: $model.username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .accessibilityIdentifier("username")
            }

            fieldLabel("密码")
            inputSurface {
                HStack(spacing: 8) {
                    Group {
                        if passwordVisible {
                            TextField("密码", text: $model.password)
                        } else {
                            SecureField("密码", text: $model.password)
                        }
                    }
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("password")
                    Button {
                        passwordVisible.toggle()
                    } label: {
                        Image(systemName: passwordVisible ? "eye.slash" : "eye")
                            .foregroundColor(colors.secondary)
                            .frame(width: 32, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(passwordVisible ? "隐藏密码" : "显示密码")
                    .accessibilityIdentifier("password-reveal")
                }
            }

            Toggle("保持登录", isOn: $model.keepLogin)
                .tint(colors.primary)
                .font(.subheadline)
                .accessibilityIdentifier("keep-login")

            if let error = model.errorMessage {
                Text(error)
                    .font(.subheadline)
                    .foregroundColor(colors.error)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("request-error")
            }
            if let notice = model.noticeMessage {
                Text(notice)
                    .font(.footnote)
                    .foregroundColor(colors.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await model.login() }
            } label: {
                HStack(spacing: 8) {
                    if model.isLoading {
                        ProgressView().tint(.white)
                    }
                    Text(model.isLoading ? "连接中…" : "登录")
                }
                .frame(maxWidth: .infinity, minHeight: 48)
                .font(.body.weight(.semibold))
                .foregroundColor(.white)
                .background(RoundedRectangle(cornerRadius: 12).fill(colors.primary))
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            .accessibilityIdentifier("auth-submit")

            Text("账户由 xDrive 管理员创建。")
                .font(.footnote)
                .foregroundColor(colors.secondary)
        }
        .disabled(model.isLoading)
    }

    private func connectedView(user: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("已以 \(user) 的身份登录", systemImage: "checkmark.circle.fill")
                .foregroundColor(colors.primary)
                .font(.subheadline.weight(.medium))
            if let server = model.signedInServer {
                Text("服务器：\(server)")
                    .font(.footnote)
                    .foregroundColor(colors.secondary)
            }
            Text("文件、图库与 Viewer 请使用共用 PWA 页面。本页仅提供原生单文件上传诊断，不是自动相册备份。")
                .font(.footnote)
                .foregroundColor(colors.secondary)
            Button {
                Task { await model.verifyOwnerRoot() }
            } label: {
                Label("验证 Owner 与云端根目录（只读）", systemImage: "checkmark.shield")
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundColor(colors.primary)
                    .background(RoundedRectangle(cornerRadius: 12)
                        .stroke(colors.primary, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            .accessibilityIdentifier("native-owner-root-verify")
            if let owner = model.verifiedOwner {
                VStack(alignment: .leading, spacing: 5) {
                    Label("已验证服务器与当前 Owner 根目录", systemImage: "checkmark.shield.fill")
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(colors.primary)
                    Text("Owner #\(owner.ownerID) · Root #\(owner.rootNodeID)")
                        .font(.footnote)
                        .foregroundColor(colors.secondary)
                    Text("当前仅完成只读身份验证；尚未注册 Device/同步文件夹，也未启动备份。")
                        .font(.footnote)
                        .foregroundColor(colors.secondary)
                }
                .accessibilityIdentifier("native-owner-root-verified")
            }
            if let failure = model.ownerVerificationMessage {
                Text(failure)
                    .font(.footnote)
                    .foregroundColor(colors.error)
            }
            if model.verifiedOwner != nil {
                Button {
                    showDocumentPicker = true
                } label: {
                    Label("手动上传单个文件（不超过 128 MiB）", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundColor(colors.primary)
                        .background(RoundedRectangle(cornerRadius: 12)
                            .stroke(colors.primary, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(model.isLoading || model.manualUploadBusy)
                .accessibilityIdentifier("native-manual-upload")
            }
            if model.manualUploadBusy {
                ProgressView("原生上传处理中…")
                    .font(.footnote)
                Button("取消本机上传请求") { manualUploadTask?.cancel() }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("native-manual-upload-cancel")
            }
            if let uploadMessage = model.manualUploadMessage {
                Text(uploadMessage)
                    .font(.footnote)
                    .foregroundColor(colors.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("native-manual-upload-result")
            }
            Button {
                showPhotoInventory = true
            } label: {
                Label("检查系统相册（不上传）", systemImage: "photo.on.rectangle.angled")
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundColor(colors.primary)
                    .background(RoundedRectangle(cornerRadius: 12)
                        .stroke(colors.primary, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            .accessibilityIdentifier("local-photo-inventory")
            if let notice = model.noticeMessage {
                Text(notice).font(.footnote).foregroundColor(colors.error)
            }
            Button {
                Task { await model.logout() }
            } label: {
                Text(model.isLoading ? "退出中…" : "退出登录")
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundColor(colors.primary)
                    .background(RoundedRectangle(cornerRadius: 12)
                        .stroke(colors.primary, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading || model.manualUploadBusy)
        }
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label)
            .font(.subheadline.weight(.medium))
            .foregroundColor(colors.secondary)
            .padding(.bottom, -10)
    }

    private func inputSurface<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .font(.body)
            .foregroundColor(colors.text)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 12).fill(colors.surface))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(colors.outline, lineWidth: 1))
    }
}

private struct XDrivePalette {
    let primary: Color
    let background: Color
    let surface: Color
    let text: Color
    let secondary: Color
    let outline: Color
    let error: Color

    init(dark: Bool) {
        primary = dark ? Color(red: 95/255, green: 143/255, blue: 244/255)
                       : Color(red: 65/255, green: 119/255, blue: 230/255)
        background = dark ? Color(red: 15/255, green: 20/255, blue: 29/255)
                          : Color(red: 245/255, green: 247/255, blue: 251/255)
        surface = dark ? Color(red: 23/255, green: 29/255, blue: 39/255) : .white
        text = dark ? .white : .black.opacity(0.87)
        secondary = dark ? .white.opacity(0.7) : .black.opacity(0.6)
        outline = dark ? .white.opacity(0.12) : .black.opacity(0.12)
        error = dark ? Color(red: 244/255, green: 67/255, blue: 54/255)
                     : Color(red: 211/255, green: 47/255, blue: 47/255)
    }
}
