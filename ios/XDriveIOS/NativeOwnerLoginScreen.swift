import SwiftUI

/// First native product-login surface, adapted from historical #2891's
/// visual card. Not mounted by XDriveIOSApp until native Files/Gallery
/// navigation and safe Owner/grant migration are available.
struct XDriveIOSNativeOwnerLoginScreen: View {
    @StateObject private var model = XDriveIOSNativeOwnerLoginModel()
    @State private var showPassword = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Image("Brand")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 48, height: 48)
                            .accessibilityLabel("xDrive")
                        VStack(alignment: .leading, spacing: 3) {
                            Text("xDrive")
                                .font(.title.bold())
                            Text("iOS 原生客户端")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(model.owner == nil ? "连接到你的个人云端" : "已验证的原生账户")
                        .font(.title3.weight(.semibold))

                    if let verified = model.owner {
                        verifiedAccount(verified)
                    } else {
                        loginForm
                    }

                    if let warning = model.errorMessage {
                        Text(warning)
                            .foregroundStyle(.red)
                            .font(.footnote)
                            .accessibilityIdentifier("native-ios-login-error")
                    }
                    if let notice = model.noticeMessage {
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(24)
                .frame(maxWidth: 430, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))
                )
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("xDrive")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await model.restore() }
    }

    private var loginForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("服务器 HTTPS 地址").font(.subheadline.weight(.medium))
            TextField("https://drive.example.com", text: $model.serverText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.URL)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-server")

            Text("用户名").font(.subheadline.weight(.medium))
            TextField("用户名", text: $model.username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("native-ios-login-username")

            Text("密码").font(.subheadline.weight(.medium))
            HStack {
                Group {
                    if showPassword {
                        TextField("密码", text: $model.password)
                    } else {
                        SecureField("密码", text: $model.password)
                    }
                }
                .textContentType(.password)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                Button {
                    showPassword.toggle()
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                }
                .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码")
            }
            .textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("native-ios-login-password")

            Toggle("保持登录", isOn: $model.keepSignedIn)
            Button {
                Task { await model.signIn() }
            } label: {
                HStack {
                    if model.busy { ProgressView() }
                    Text(model.busy ? "正在验证…" : "登录")
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.busy)
            .accessibilityIdentifier("native-ios-login-submit")

            Text("仅使用原生 HTTPS 会话；不会读取或复制 PWA Cookie。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .disabled(model.busy)
    }

    private func verifiedAccount(_ verified: XDriveNativeOwnerRoot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("当前服务器与 Owner 已验证", systemImage: "checkmark.shield.fill")
            Text(verified.origin.host ?? "xDrive")
            Text(verified.username)
            Text("Owner #\(verified.ownerID) · Root #\(verified.rootNodeID)")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
            Text("原生文件和图库导航仍在迁移中；本页面不假装已具备云端 Files 或后台备份能力。")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("退出原生账户", role: .destructive) {
                Task { await model.signOut() }
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("native-ios-login-signout")
        }
    }
}
