package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	caddyAliDNSEndpoint     = "https://dns.aliyuncs.com/"
	caddyAliDNSReadAction   = "DescribeSubDomainRecords"
	caddyAliDNSAPIVersion   = "2015-01-09"
	caddyAliDNSProbeTimeout = 7 * time.Second
	caddyAliDNSProbeDelay   = 30 * time.Second
	caddyAliDNSMaxResponse  = 16 * 1024
)

var errCaddyAliDNSProbeRevision = errors.New("AliDNS read-probe revision changed")

type adminCaddyAliDNSReadProbeDTO struct {
	State                   string    `json:"state"`
	DesiredRevision         uint64    `json:"desired_revision"`
	CredentialRevision      uint64    `json:"credential_revision"`
	CheckedAt               time.Time `json:"checked_at"`
	ReadPermissionVerified  bool      `json:"read_permission_verified"`
	WritePermissionVerified bool      `json:"write_permission_verified"`
	ApplySupported          bool      `json:"apply_supported"`
	PublicHTTPSVerified     bool      `json:"public_https_verified"`
	Detail                  string    `json:"detail"`
}

// ACS3-HMAC-SHA256: no secret in URL, logs, status, audit or return DTO.
// The production caller fixes endpoint, RPC action and all query keys.
func signCaddyAliDNSACS3(req *http.Request, pair caddyAliDNSSecretPair, when time.Time, nonce string) {
	const algorithm = "ACS3-HMAC-SHA256"
	const signedHeaders = "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version"
	emptyPayload := sha256.Sum256(nil)
	payloadHash := hex.EncodeToString(emptyPayload[:])
	req.Header.Set("x-acs-action", caddyAliDNSReadAction)
	req.Header.Set("x-acs-version", caddyAliDNSAPIVersion)
	req.Header.Set("x-acs-content-sha256", payloadHash)
	req.Header.Set("x-acs-date", when.UTC().Format("2006-01-02T15:04:05Z"))
	req.Header.Set("x-acs-signature-nonce", nonce)
	req.Host = req.URL.Host
	query := strings.ReplaceAll(req.URL.Query().Encode(), "+", "%20")
	req.URL.RawQuery = query
	headers := "host:" + req.Host + "\n" +
		"x-acs-action:" + caddyAliDNSReadAction + "\n" +
		"x-acs-content-sha256:" + payloadHash + "\n" +
		"x-acs-date:" + req.Header.Get("x-acs-date") + "\n" +
		"x-acs-signature-nonce:" + nonce + "\n" +
		"x-acs-version:" + caddyAliDNSAPIVersion + "\n"
	canonical := req.Method + "\n/\n" + query + "\n" + headers + "\n" + signedHeaders + "\n" + payloadHash
	hash := sha256.Sum256([]byte(canonical))
	mac := hmac.New(sha256.New, []byte(pair.AccessKeySecret))
	_, _ = mac.Write([]byte(algorithm + "\n" + hex.EncodeToString(hash[:])))
	req.Header.Set("Authorization", algorithm+" Credential="+pair.AccessKeyID+
		",SignedHeaders="+signedHeaders+",Signature="+hex.EncodeToString(mac.Sum(nil)))
}

func (s *Server) caddyAliDNSReadProbe(ctx context.Context, pair caddyAliDNSSecretPair, domain string) string {
	// Do not accept any endpoint, domain or action from this request's HTTP body.
	// Domain is the administrator's independently validated saved ASCII FQDN.
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "unavailable"
	}
	values := url.Values{"SubDomain": {domain}, "PageNumber": {"1"}, "PageSize": {"1"}}
	ctx, cancel := context.WithTimeout(ctx, caddyAliDNSProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, caddyAliDNSEndpoint+"?"+values.Encode(), nil)
	if err != nil {
		return "unavailable"
	}
	signCaddyAliDNSACS3(req, pair, time.Now(), hex.EncodeToString(nonceBytes))
	transport := s.CaddyAliDNSProbeTransport
	if transport == nil {
		transport = &http.Transport{
			Proxy:             nil, // Do not forward signed requests through environment proxies.
			DisableKeepAlives: true,
			TLSClientConfig:   &tls.Config{MinVersion: tls.VersionTLS12},
		}
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   caddyAliDNSProbeTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return "unavailable"
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
		return "denied"
	}
	if resp.StatusCode != http.StatusOK {
		return "unavailable"
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, caddyAliDNSMaxResponse+1))
	if err != nil || len(body) > caddyAliDNSMaxResponse {
		return "unavailable"
	}
	var result struct {
		RequestID  string `json:"RequestId"`
		TotalCount *int   `json:"TotalCount"`
		Code       string `json:"Code"`
	}
	if json.Unmarshal(body, &result) != nil {
		return "unavailable"
	}
	if result.Code != "" {
		switch {
		case strings.Contains(result.Code, "Forbidden"),
			strings.Contains(result.Code, "AccessKey"),
			strings.Contains(result.Code, "Signature"),
			strings.Contains(result.Code, "Unauthorized"),
			strings.Contains(result.Code, "Permission"):
			return "denied"
		default:
			return "unavailable"
		}
	}
	if len(result.RequestID) == 0 || len(result.RequestID) > 128 ||
		result.TotalCount == nil || *result.TotalCount < 0 {
		return "unavailable"
	}
	// This proves *only* read access to the saved host's DNS records.
	// A zero-record success is allowed. TXT write permission is not tested.
	return "read_authorized"
}

func (s *Server) adminVerifyCaddyAliDNSRead(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "AliDNS read validation unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		DesiredRevision    *uint64 `json:"desired_revision"`
		CredentialRevision *uint64 `json:"credential_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.DesiredRevision == nil ||
		input.CredentialRevision == nil || *input.DesiredRevision == 0 ||
		*input.CredentialRevision == 0 || *input.DesiredRevision > 1<<60 ||
		*input.CredentialRevision > 1<<60 {
		fail(c, http.StatusBadRequest, "current HTTPS and AliDNS revisions required")
		return
	}
	s.caddyAliDNSProbeMu.Lock()
	defer s.caddyAliDNSProbeMu.Unlock()
	if !s.caddyAliDNSProbeAt.IsZero() && time.Since(s.caddyAliDNSProbeAt) < caddyAliDNSProbeDelay {
		fail(c, http.StatusTooManyRequests, "AliDNS read verification is temporarily rate limited")
		return
	}
	var pair caddyAliDNSSecretPair
	var domain string
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var desired meta.AdminCaddyHTTPSSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCaddyAliDNSProbeRevision
			}
			return err
		}
		if desired.Revision != *input.DesiredRevision || !desired.Enabled ||
			!validCaddyHTTPSDomain(desired.Domain) {
			return errCaddyAliDNSProbeRevision
		}
		var row meta.AdminServiceSecret
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyAliDNSSecretName).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCaddyAliDNSProbeRevision
			}
			return err
		}
		if row.Revision != *input.CredentialRevision || !row.Enabled ||
			row.KeyVersion == 0 || len(row.Ciphertext) == 0 {
			return errCaddyAliDNSProbeRevision
		}
		plaintext, err := s.ConnectorSecrets.Open(
			caddyAliDNSSecretAADID, caddyAliDNSSecretKind, row.KeyVersion, row.Ciphertext,
		)
		if err != nil {
			return err
		}
		err = json.Unmarshal(plaintext, &pair)
		clear(plaintext)
		if err != nil || !validCaddyAliDNSPair(pair) {
			return errors.New("AliDNS credential integrity failed")
		}
		domain = desired.Domain
		// Commit an audit before sending any secret-derived signed request.
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy_alidns.read_verify", "service", caddyAliDNSSecretName,
			"AliDNS domain record read verification", auditpkg.ResultSuccess,
			map[string]any{"desired_revision": desired.Revision,
				"credential_revision": row.Revision, "write_verified": false, "host_applied": false},
		))
	})
	if errors.Is(err, errCaddyAliDNSProbeRevision) {
		fail(c, http.StatusConflict, "HTTPS or AliDNS revision changed; refresh")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "AliDNS credential validation or audit unavailable")
		return
	}
	s.caddyAliDNSProbeAt = time.Now()
	state := s.caddyAliDNSReadProbe(c.Request.Context(), pair, domain)
	// A concurrently rotated key or changed HTTPS intent must never be
	// acknowledged as belonging to the newer revision.
	desired, desiredErr := s.readCaddyHTTPSDesired(c.Request.Context())
	row, exists, secretErr := s.readCaddyAliDNSSetting(c)
	if desiredErr != nil || secretErr != nil {
		fail(c, http.StatusServiceUnavailable, "AliDNS verification revision check unavailable")
		return
	}
	if desired.Revision != *input.DesiredRevision || !desired.Enabled ||
		!exists || row.Revision != *input.CredentialRevision || len(row.Ciphertext) == 0 {
		fail(c, http.StatusConflict, "HTTPS or AliDNS changed during verification; refresh")
		return
	}
	message := "AliDNS 只读 API 检测不可确认；并未修改 DNS 或 Caddy。"
	switch state {
	case "read_authorized":
		message = "已通过固定域名记录读取接口鉴权；没有验证 DNS TXT 写入权限、证书签发或 HTTPS 生效。"
	case "denied":
		message = "AliDNS 只读访问被拒绝；请检查凭据有效性及此域名的 RAM 读取权限。"
	}
	c.JSON(http.StatusOK, adminCaddyAliDNSReadProbeDTO{
		State:           state,
		DesiredRevision: desired.Revision, CredentialRevision: row.Revision,
		CheckedAt:               time.Now().UTC(),
		ReadPermissionVerified:  state == "read_authorized",
		WritePermissionVerified: false,
		ApplySupported:          false,
		PublicHTTPSVerified:     false,
		Detail:                  message,
	})
}
