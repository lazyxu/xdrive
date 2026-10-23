package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/url"
	"syscall"

	"github.com/lazyxu/xdrive/internal/client"
)

// Keep the real Go Agent login's network/TLS errors consistent with Desktop's
// pre-login Chromium probe. Never echo arbitrary upstream URLs, X509 names,
// credentials, or underlying transport error strings back to the Renderer.
// This classifier never modifies TLS roots, transport security or retry policy.
func classifyDesktopLoginTransportError(err error) (code, message string, status int, ok bool) {
	if err == nil {
		return "", "", 0, false
	}
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		// Existing Server authorization/password errors must remain authoritative.
		return "", "", 0, false
	}
	if errors.Is(err, client.ErrAuthRedirect) {
		return "server_auth_redirect", "登录入口发生重定向；为保护密码已拒绝继续发送。请检查当前 IP HTTPS 的 Caddy 配置，不要依赖其他域名的登录跳转。", http.StatusBadGateway, true
	}
	var hostErr x509.HostnameError
	if errors.As(err, &hostErr) {
		return "server_tls_name", "HTTPS 证书与服务器地址不匹配；证书的 IP SAN 必须包含当前局域网 IP。", http.StatusBadGateway, true
	}
	var certErr x509.CertificateInvalidError
	if errors.As(err, &certErr) {
		if certErr.Reason == x509.Expired {
			return "server_tls_date", "HTTPS 证书已过期或设备时间不正确；请检查证书有效期与系统时间。", http.StatusBadGateway, true
		}
		return "server_tls_trust", "HTTPS 证书验证失败；请核对受信任的 Caddy 本地 CA 与证书链。", http.StatusBadGateway, true
	}
	var authorityErr x509.UnknownAuthorityError
	if errors.As(err, &authorityErr) {
		return "server_tls_trust", "HTTPS 证书尚未受信任；请通过可信渠道核验并安装 Caddy 本地根 CA，不要跳过 TLS 验证。", http.StatusBadGateway, true
	}
	var headerErr tls.RecordHeaderError
	if errors.As(err, &headerErr) {
		return "server_tls_protocol", "HTTPS 握手失败；请确认端口提供 HTTPS，且实际运行的 Caddy 已启用 IP 入口。", http.StatusBadGateway, true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "server_timeout", "服务器连接超时；请检查局域网连通性与 HTTPS 端口。", http.StatusGatewayTimeout, true
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) && networkErr.Timeout() {
		return "server_timeout", "服务器连接超时；请检查局域网连通性与 HTTPS 端口。", http.StatusGatewayTimeout, true
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return "server_refused", "连接被拒绝；请检查 Caddy 实际监听、8443 端口映射与防火墙。", http.StatusBadGateway, true
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "server_network", "服务器域名无法解析；请检查地址、网络与 DNS 配置。", http.StatusBadGateway, true
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return "server_network", "服务器网络不可达；请检查局域网地址、路由与端口。", http.StatusBadGateway, true
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return "server_unreachable", "无法连接指定服务器；请检查地址、端口、网络及 HTTPS 证书。", http.StatusBadGateway, true
	}
	return "", "", 0, false
}

func writeDesktopIPCLoginError(w http.ResponseWriter, err error) {
	if code, message, status, classified := classifyDesktopLoginTransportError(err); classified {
		writeDesktopIPCError(w, status, code, message)
		return
	}
	writeDesktopIPCControllerError(w, err)
}
