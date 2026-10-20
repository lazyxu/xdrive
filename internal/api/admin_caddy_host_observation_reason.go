package api

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// These fixed diagnostic reasons are read-only hints for an UNOBSERVED Caddy
// Host Control witness. They never authenticate a live process, infer an
// applied revision or authorize any gateway restart/rollback.
// No file contents, paths, addresses, credentials or Docker details are read.
func (s *Server) caddyHostUnobservedReason() string {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return "control-not-configured"
	}
	for _, entry := range []struct {
		filename string
		kind     string
	}{
		{filename: "heartbeat", kind: "heartbeat"},
		{filename: caddyHostStatusName, kind: "snapshot"},
	} {
		info, err := os.Lstat(filepath.Join(s.HostControlDir, entry.filename))
		switch {
		case errors.Is(err, os.ErrNotExist):
			return entry.kind + "-missing"
		case err != nil:
			return entry.kind + "-unreadable"
		case !info.Mode().IsRegular():
			return entry.kind + "-invalid"
		case time.Since(info.ModTime()) > caddyHostFreshness ||
			time.Until(info.ModTime()) > 15*time.Second:
			return entry.kind + "-stale"
		}
	}
	// Both files were present/fresh but the original authoritative reader
	// rejected the proof. The status may also have changed between samples.
	// No new potentially credential-bearing bytes are read for this hint.
	return "snapshot-invalid-or-changing"
}

// Only static nonsecret text reaches the existing seven-check HTTPS preflight
// response and its shared Web/Mobile Web/PWA/Desktop UI. Missing witness
// evidence is NEVER proof that Caddy has stopped or that Apply is safe.
func (s *Server) caddyHostUnobservedDetail() string {
	return caddyHostUnobservedDetailForReason(s.caddyHostUnobservedReason())
}

// Keep the reason and the display detail from one observation decision.
// A changed or missing witness is never evidence that HTTPS is down.
func caddyHostUnobservedDetailForReason(reason string) string {
	switch reason {
	case "control-not-configured":
		return "Server 未设置可信 Host Control 目录；核对宿主控制服务与只读挂载，不代表 Caddy 已停止"
	case "heartbeat-missing":
		return "Host Control 心跳文件缺失；检查宿主控制进程及容器共享挂载，不代表 Caddy 已停止"
	case "heartbeat-unreadable":
		return "Host Control 心跳元数据不可访问；检查挂载和文件权限"
	case "heartbeat-invalid":
		return "Host Control 心跳不是可信普通文件；拒绝使用其状态"
	case "heartbeat-stale":
		return "Host Control 心跳超过有效期或时间异常；请检查宿主控制进程是否持续运行"
	case "snapshot-missing":
		return "Caddy 宿主状态快照缺失；不代表网关未安装。新版 Host Control 会尝试只读补采样；若持续缺失，请检查宿主观察器及 Server 共享挂载"
	case "snapshot-unreadable":
		return "Caddy 宿主状态快照元数据不可访问；检查只读挂载和文件权限"
	case "snapshot-invalid":
		return "Caddy 宿主状态快照不是可信普通文件；拒绝使用其状态"
	case "snapshot-stale":
		return "Caddy 宿主状态快照超过有效期或时间异常；请检查宿主观测是否持续更新"
	default:
		return "Caddy 宿主状态快照内容不符合安全合同或采样期间发生变化；请手动重新检测"
	}
}

// CaddyHostReadOnlyWitness is strictly a read-only observation made from
// the running Server's own Host Control mount. No TLS/WAN or applied-revision
// claim follows merely from a configured or running container.
func CaddyHostReadOnlyWitness(hostControlDir string) (string, bool) {
	s := &Server{HostControlDir: hostControlDir}
	host, observed := s.readCaddyHostStatus()
	if !observed {
		return s.caddyHostUnobservedReason(), false
	}
	if host.State != "healthy" {
		return "gateway-" + host.State, false
	}
	if !host.HTTPSConfigured && !host.LANHTTPSConfigured {
		return "https-not-configured", false
	}
	if host.HTTPSConfigured &&
		(!host.TLSCheckSupported || host.TLSState != "verified" ||
			!validCaddyTLSVerifiedDomainDigest(host.TLSVerifiedDomainSHA256)) {
		return "domain-tls-unverified", false
	}
	if host.LANHTTPSConfigured &&
		(host.LANTLSState != "verified" ||
			!validCaddyTLSVerifiedDomainDigest(host.LANVerifiedIPSHA256)) {
		return "lan-tls-unverified", false
	}
	return "local-https-observed", true
}
