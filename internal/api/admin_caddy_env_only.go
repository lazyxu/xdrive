package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) adminCaddyHTTPSConfigHost(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	snap, err := s.readCaddyHostEnv()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host .env snapshot unavailable")
		return
	}
	host, observed := s.readCaddyHostStatus()
	tls := "unknown"
	if observed && host.TLSCheckSupported {
		tls = host.TLSState
	}
	c.JSON(http.StatusOK, adminCaddyHTTPSConfigDTO{
		DesiredEnabled: snap.DomainEnabled, DesiredDomain: snap.Domain,
		DesiredLANEnabled: snap.LANEnabled, DesiredLANIP: snap.LANIP,
		Revision: 0, Source: "host-env", UpdatedAt: &snap.ObservedAt,
		ApplyState: "pending", Editable: true, ApplySupported: false,
		RequiresRestrictedMaintenance: true,
		Requirement:                   "Caddy Host .env saved; re-create Caddy separately to apply changes",
		HostObserved:                  observed, HostHTTPSConfigured: observed && host.HTTPSConfigured,
		HostTLSState: tls, HostLANTLSState: caddyLANLocalEffectState(host, observed, snap.LANIP),
		HostLANConfigured: host.LANHTTPSConfigured, HostLANIP: snap.LANIP,
		HostEnvSHA256: snap.SHA256, HostEnvPendingRedeploy: snap.PendingRedeploy,
	})
}

func (s *Server) adminCaddyAliDNSConfigHost(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	snap, err := s.readCaddyHostEnv()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host .env snapshot unavailable")
		return
	}
	c.JSON(http.StatusOK, adminCaddyAliDNSConfigDTO{
		Configured: snap.AliDNSConfigured, Revision: 0, Source: "host-env",
		UpdatedAt: &snap.ObservedAt, Editable: true, ApplyState: "pending",
		ApplySupported: false, Requirement: "AliDNS currently comes from Host .env; deployment is separate",
		HostApplyPending: false, HostEnvSHA256: snap.SHA256,
	})
}

// Direct Host-only save; zero PostgreSQL writes, reads, schema migrations or
// credential history in this first iteration. Cross-process CAS uses the
// current complete four-field SHA rather than legacy SQL revisions.
func (s *Server) adminSaveCaddyEnvOnly(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.HostControlDir == "" {
		fail(c, http.StatusServiceUnavailable, "Caddy Host Control unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input atomicCaddySaveInput
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var trailing any
	if decoder.Decode(&input) != nil || decoder.Decode(&trailing) != io.EOF ||
		!validCaddyHostEnvSHA(input.HostEnvSHA256) ||
		(input.HTTPS == nil && input.AliDNS == nil) {
		fail(c, http.StatusBadRequest, "Full current Host .env fingerprint and changed configuration required")
		return
	}
	snap, err := s.readCaddyHostEnv()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy Host .env unavailable")
		return
	}
	if snap.SHA256 != input.HostEnvSHA256 {
		fail(c, http.StatusConflict, "Host Caddy .env changed; reread before saving")
		return
	}
	if input.HTTPS != nil {
		cfg := input.HTTPS
		if cfg.Enabled == nil || cfg.Domain == nil || cfg.LANEnabled == nil || cfg.LANIP == nil {
			fail(c, http.StatusBadRequest, "Invalid Caddy HTTPS request")
			return
		}
		domain := strings.ToLower(*cfg.Domain)
		if !validCaddyIngressSelection(*cfg.Enabled, domain, *cfg.LANEnabled, *cfg.LANIP) {
			fail(c, http.StatusBadRequest, "Invalid HTTPS domain or LAN selection")
			return
		}
		cfg.Domain = &domain
	}
	if input.AliDNS != nil {
		a := input.AliDNS
		switch a.Action {
		case "replace":
			if !validCaddyAliDNSChange(a.AccessKeyID, a.AccessKeySecret) {
				fail(c, http.StatusBadRequest, "Invalid AliDNS credential update")
				return
			}
		case "clear":
			if a.AccessKeyID != "" || a.AccessKeySecret != "" {
				fail(c, http.StatusBadRequest, "Invalid AliDNS clear request")
				return
			}
		default:
			fail(c, http.StatusBadRequest, "Invalid AliDNS operation")
			return
		}
	}
	result, err := s.runCaddyHostEnv(c.Request.Context(), caddyHostEnvRequest{
		Operation: "save", ExpectedSHA256: snap.SHA256, HTTPS: input.HTTPS, AliDNS: input.AliDNS,
	})
	if err != nil || verifyCaddyHostEnvAck(result) != nil {
		fail(c, http.StatusServiceUnavailable,
			"Caddy Host .env save not confirmed; refresh and inspect before retry")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"saved": true, "host_applied": false, "apply_supported": false,
		"https_revision": uint64(0), "alidns_revision": uint64(0),
		"host_env_sha256": result.SHA256,
	})
}

// Host-only AliDNS reveal: explicit admin action, no PostgreSQL credential read.
// Go receives a one-time, 30-second private Host response, removes it before
// publishing the response, and never puts the secret in general Host status.
func (s *Server) adminRevealCaddyAliDNSHost(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || !s.CaddyHostEnvAuthoritative || s.HostControlDir == "" {
		fail(c, http.StatusServiceUnavailable, "Caddy Host Control unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var extra any
	if decoder.Decode(&input) != nil || decoder.Decode(&extra) != io.EOF ||
		input.Revision == nil || *input.Revision != 0 {
		fail(c, http.StatusBadRequest, "Current host-env credential revision required")
		return
	}
	snap, err := s.readCaddyHostEnv()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host .env unavailable")
		return
	}
	if !snap.AliDNSConfigured {
		fail(c, http.StatusConflict, "AliDNS credentials are not configured on Host")
		return
	}
	result, err := s.runCaddyHostEnv(c.Request.Context(), caddyHostEnvRequest{
		Operation: "reveal", ExpectedSHA256: snap.SHA256,
	})
	if err != nil || result.State != "revealed" ||
		result.SHA256 != snap.SHA256 || result.ExpiresInSeconds != 30 ||
		!validCaddyAliDNSPair(caddyAliDNSSecretPair{
			AccessKeyID: result.AccessKeyID, AccessKeySecret: result.AccessKeySecret,
		}) {
		fail(c, http.StatusServiceUnavailable, "Caddy Host credential reveal not confirmed")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_key_id":      result.AccessKeyID,
		"access_key_secret":  result.AccessKeySecret,
		"expires_in_seconds": 30,
	})
}
