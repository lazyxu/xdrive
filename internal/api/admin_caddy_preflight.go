package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// A read-only inventory of prerequisites for a future restricted Host Manager
// transaction. Passing local checks NEVER authorizes apply or proves public TLS.
type adminCaddyPreflightCheck struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

type adminCaddyPreflightDTO struct {
	CheckedAt               time.Time                  `json:"checked_at"`
	Action                  string                     `json:"action"`
	DesiredRevision         uint64                     `json:"desired_revision"`
	CredentialRevision      uint64                     `json:"credential_revision"`
	ConfigurationComplete   bool                       `json:"configuration_complete"`
	HostObserved            bool                       `json:"host_observed"`
	HostIngressReady        bool                       `json:"host_ingress_ready"`
	HostLocalTLSVerified    bool                       `json:"host_local_tls_verified"`
	DesiredDomainLocalMatch string                     `json:"desired_domain_local_match"`
	HostRuntimeTLSAlignment string                     `json:"host_runtime_tls_alignment"`
	HostLiveConfigState     string                     `json:"host_live_config_state"`
	HostInstanceGeneration  string                     `json:"host_instance_generation"`
	HostAliDNSModuleState   string                     `json:"host_alidns_module_state"`
	SnapshotStable          bool                       `json:"revision_snapshot_consistent"`
	IngressChangeRisk       string                     `json:"ingress_change_risk"`
	ApplySupported          bool                       `json:"apply_supported"`
	Checks                  []adminCaddyPreflightCheck `json:"checks"`
}

func (s *Server) adminCaddyHTTPSPreflight(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	snapshot, err := s.readCaddyPreflightSnapshot(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS or AliDNS settings unavailable")
		return
	}
	desired := snapshot.Desired
	credential, hasCredentialRow := snapshot.Credential, snapshot.CredentialExists
	action := "unset"
	if desired.Revision > 0 {
		action = "disable"
		if desired.Enabled {
			action = "enable"
		}
	}
	checks := make([]adminCaddyPreflightCheck, 0, 7)
	add := func(id, state, detail string) {
		checks = append(checks, adminCaddyPreflightCheck{ID: id, State: state, Detail: detail})
	}
	if desired.Revision > 0 {
		add("desired", "pass", "管理员期望配置已持久化；不代表实际网关状态")
	} else {
		add("desired", "missing", "请先保存 HTTPS 启用或停用意图")
	}
	domainReady := desired.Enabled && validCaddyHTTPSDomain(desired.Domain)
	if action != "enable" {
		add("domain", "not-required", "仅启用 HTTPS 需要期望域名")
	} else if domainReady {
		add("domain", "pass", "期望域名格式通过本地校验；尚未验证 DNS 或证书")
	} else {
		add("domain", "missing", "缺少合法的 HTTPS 期望域名")
	}

	pairReady := false
	if action != "enable" {
		add("alidns", "not-required", "禁用 HTTPS 不要求新的 AliDNS 凭据")
	} else if !hasCredentialRow || len(credential.Ciphertext) == 0 {
		add("alidns", "missing", "请先加密保存成对 AliDNS 凭据")
	} else if s.ConnectorSecrets == nil {
		add("alidns", "blocked", "Server 加密密钥环不可用，无法核验保存的凭据")
	} else {
		plaintext, openErr := s.ConnectorSecrets.Open(
			caddyAliDNSSecretAADID, caddyAliDNSSecretKind,
			credential.KeyVersion, credential.Ciphertext,
		)
		if openErr == nil {
			var pair caddyAliDNSSecretPair
			openErr = json.Unmarshal(plaintext, &pair)
			pairReady = openErr == nil && validCaddyAliDNSPair(pair)
			clear(plaintext)
		}
		if pairReady {
			add("alidns", "pass", "保存的凭据可被本机密钥环解密；未验证阿里云 API 权限")
		} else {
			add("alidns", "blocked", "保存的凭据无法通过完整性校验或解密")
		}
	}

	host, observed := s.readCaddyHostStatus()
	if observed {
		add("host-manager", "pass", "最近存在受信任的宿主机只读状态心跳；不代表支持部署控制")
	} else {
		add("host-manager", "unknown", "宿主机状态缺失或过期，无法核验安全部署前置条件")
	}
	ingressReady := observed && host.State == "healthy"
	if ingressReady {
		add("ingress", "pass", "当前网关内部 HTTP 健康；不代表期望 HTTPS 已生效")
	} else if observed && (host.State == "unhealthy" || host.State == "stopped") {
		add("ingress", "blocked", "当前网关健康检测未通过；不允许据此执行应用")
	} else {
		add("ingress", "unknown", "当前网关未获得可信的内部 HTTP 健康结果")
	}
	add("restricted-apply", "blocked", "尚无防失联、受限审计、版本绑定、回滚与生效证明的 Host Manager 应用协议")
	add("public-https", "unknown", "本机观测不能证明公网 DNS、证书签发、端口及 WAN 可达性")

	complete := desired.Revision > 0 && (!desired.Enabled || (domainReady && pairReady))
	// Check again after plaintext validation and host observation. A
	// concurrent administrator edit/rotation produces an explicit 409, not
	// a mixed/stale positive preflight. This is NOT a host-apply CAS.
	current, err := s.readCaddyPreflightSnapshot(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS or AliDNS revision recheck unavailable")
		return
	}
	if !sameCaddyPreflightSnapshot(snapshot, current) {
		fail(c, http.StatusConflict, "HTTPS or AliDNS revision changed; run preflight again")
		return
	}
	c.JSON(http.StatusOK, adminCaddyPreflightDTO{
		CheckedAt: time.Now().UTC(), Action: action,
		DesiredRevision: desired.Revision, CredentialRevision: credential.Revision,
		ConfigurationComplete: complete,
		HostObserved:          observed, HostIngressReady: ingressReady,
		HostLocalTLSVerified:    observed && host.HTTPSConfigured && host.TLSCheckSupported && host.TLSState == "verified",
		DesiredDomainLocalMatch: caddyDesiredDomainLocalMatch(desired, host, observed),
		HostRuntimeTLSAlignment: caddyObservedRuntimeTLSAlignment(host, observed),
		HostLiveConfigState:     caddyObservedLiveConfigState(host, observed),
		HostInstanceGeneration:  caddyObservedInstanceGeneration(host, observed),
		HostAliDNSModuleState:   caddyObservedAliDNSModuleState(host, observed),
		IngressChangeRisk:       caddyIngressChangeRisk(desired, host, observed),
		SnapshotStable:          true,
		ApplySupported:          false, Checks: checks,
	})
}
