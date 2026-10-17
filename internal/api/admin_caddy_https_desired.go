package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const caddyHTTPSSettingName = "caddy-https"

var errCaddyHTTPSRevision = errors.New("caddy HTTPS desired revision changed")
var errCaddyHTTPSIngress = errors.New("at least one valid HTTPS entry must remain enabled")

// The Server stores only *desired* Caddy state. No interface offered here may
// restart or reconfigure the ingress or assert a host-applied revision.
type adminCaddyHTTPSDesired struct {
	Revision   uint64
	Enabled    bool
	Domain     string
	LANEnabled bool
	LANIP      string
	Source     string
	UpdatedAt  *time.Time
}

type adminCaddyHTTPSConfigDTO struct {
	DesiredEnabled                bool       `json:"desired_enabled"`
	DesiredDomain                 string     `json:"desired_domain"`
	DesiredLANEnabled             bool       `json:"desired_lan_enabled"`
	DesiredLANIP                  string     `json:"desired_lan_ip"`
	HostLANConfigured             bool       `json:"host_lan_configured"`
	HostLANIP                     string     `json:"host_lan_ip,omitempty"`
	Revision                      uint64     `json:"revision"`
	Source                        string     `json:"source"`
	UpdatedAt                     *time.Time `json:"updated_at,omitempty"`
	ApplyState                    string     `json:"apply_state"`
	Editable                      bool       `json:"editable"`
	ApplySupported                bool       `json:"apply_supported"`
	RequiresRestrictedMaintenance bool       `json:"requires_restricted_maintenance"`
	Requirement                   string     `json:"requirement"`
	HostObserved                  bool       `json:"host_observed"`
	HostHTTPSConfigured           bool       `json:"host_https_configured"`
	HostTLSState                  string     `json:"host_tls_state"`
	HostLANTLSState               string     `json:"host_lan_tls_state"`
}

const caddyHTTPSApplyRequirement = "已保存的 HTTPS 期望配置尚未应用。修改实际域名、DNS 凭据或启停 Caddy 需要具备防管理入口失联、预检、回滚及审计能力的受限 Host Manager；当前阶段不允许从 Server 或浏览器执行容器操作。"

func (s *Server) readCaddyHTTPSDesired(ctx context.Context) (adminCaddyHTTPSDesired, error) {
	if s == nil || s.DB == nil {
		return adminCaddyHTTPSDesired{Source: "default"}, errors.New("Caddy desired configuration database unavailable")
	}
	return readCaddyHTTPSDesiredDB(s.DB.WithContext(ctx))
}

func readCaddyHTTPSDesiredDB(db *gorm.DB) (adminCaddyHTTPSDesired, error) {
	defaults := adminCaddyHTTPSDesired{Source: "default"}
	var row meta.AdminCaddyHTTPSSetting
	err := db.Where("name = ?", caddyHTTPSSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if row.Revision == 0 ||
		!validCaddyIngressFields(row.Enabled, row.Domain, row.LANEnabled, row.LANIP) {
		return defaults, errors.New("invalid stored Caddy HTTPS desired revision")
	}
	return adminCaddyHTTPSDesired{
		Revision: row.Revision, Enabled: row.Enabled, Domain: row.Domain,
		LANEnabled: row.LANEnabled, LANIP: row.LANIP,
		Source: "saved", UpdatedAt: &row.UpdatedAt,
	}, nil
}

func (s *Server) adminCaddyHTTPSConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	desired, err := s.readCaddyHTTPSDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS desired settings unavailable")
		return
	}
	// A freshly deployed IP-only instance has no persisted admin revision.
	// Initialize the editor from a canonical deployment declaration without
	// reporting that the desired revision was saved, applied or TLS-verified.
	hostLANIP := os.Getenv("XD_LAN_HTTPS_IP")
	if !validCaddyLANIP(hostLANIP) {
		hostLANIP = ""
	}
	if desired.Revision == 0 && hostLANIP != "" {
		desired.LANEnabled = true
		desired.LANIP = hostLANIP
	}
	state := "unmanaged"
	if desired.Revision > 0 {
		state = "pending"
	}
	host, observed := s.readCaddyHostStatus()
	tlsState := "unknown"
	if observed && host.TLSCheckSupported {
		tlsState = host.TLSState
	}
	c.JSON(http.StatusOK, adminCaddyHTTPSConfigDTO{
		DesiredEnabled: desired.Enabled, DesiredDomain: desired.Domain,
		DesiredLANEnabled: desired.LANEnabled, DesiredLANIP: desired.LANIP,
		HostLANConfigured: hostLANIP != "",
		HostLANIP:         hostLANIP,
		Revision:          desired.Revision, Source: desired.Source, UpdatedAt: desired.UpdatedAt,
		ApplyState: state, Editable: true, ApplySupported: false,
		RequiresRestrictedMaintenance: true, Requirement: caddyHTTPSApplyRequirement,
		HostObserved: observed, HostHTTPSConfigured: observed && host.HTTPSConfigured,
		HostTLSState:    tlsState,
		HostLANTLSState: caddyLANLocalEffectState(host, observed, hostLANIP),
	})
}

func recordCaddyHTTPSRevisionTx(tx *gorm.DB, revision uint64, enabled bool,
	domain string, lanEnabled bool, lanIP, origin string) error {
	if !validCaddyIngressFields(enabled, domain, lanEnabled, lanIP) {
		return errors.New("invalid historical Caddy HTTPS configuration")
	}
	var existing meta.AdminCaddyHTTPSRevision
	err := tx.Where("name = ? AND revision = ?", caddyHTTPSSettingName, revision).Take(&existing).Error
	if err == nil {
		if existing.Enabled != enabled || existing.Domain != domain ||
			existing.LANEnabled != lanEnabled || existing.LANIP != lanIP {
			return errors.New("immutable Caddy HTTPS revision mismatch")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminCaddyHTTPSRevision{
		Name: caddyHTTPSSettingName, Revision: revision, Enabled: enabled,
		Domain: domain, LANEnabled: lanEnabled, LANIP: lanIP,
		Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *Server) adminSaveCaddyHTTPS(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS database unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Revision   *uint64 `json:"revision"`
		Enabled    *bool   `json:"enabled"`
		Domain     *string `json:"domain"`
		LANEnabled *bool   `json:"lan_enabled"`
		LANIP      *string `json:"lan_ip"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.Enabled == nil ||
		input.Domain == nil || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "full revisioned Caddy HTTPS intent required")
		return
	}
	domain := strings.ToLower(*input.Domain)
	if !validCaddyIngressFields(*input.Enabled, domain, false, "") {
		fail(c, http.StatusBadRequest, "invalid Caddy HTTPS FQDN; supply a plain DNS hostname")
		return
	}
	s.caddyHTTPSSaveMu.Lock()
	defer s.caddyHTTPSSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var previous meta.AdminCaddyHTTPSSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", caddyHTTPSSettingName).Take(&previous).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if (exists && previous.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errCaddyHTTPSRevision
		}
		oldEnabled, oldDomain, oldLANEnabled, oldLANIP, oldOrigin := false, "", false, "", "default"
		if exists {
			oldEnabled, oldDomain = previous.Enabled, previous.Domain
			oldLANEnabled, oldLANIP, oldOrigin = previous.LANEnabled, previous.LANIP, "saved"
		}
		lanEnabled, lanIP := oldLANEnabled, oldLANIP
		if input.LANEnabled != nil {
			lanEnabled = *input.LANEnabled
		}
		if input.LANIP != nil {
			lanIP = *input.LANIP
		}
		if !validCaddyIngressSelection(*input.Enabled, domain, lanEnabled, lanIP) {
			return errCaddyHTTPSIngress
		}
		if err := recordCaddyHTTPSRevisionTx(tx, *input.Revision, oldEnabled, oldDomain,
			oldLANEnabled, oldLANIP, oldOrigin); err != nil {
			return err
		}
		next := *input.Revision + 1
		if exists {
			updated := tx.Model(&meta.AdminCaddyHTTPSSetting{}).
				Where("name = ? AND revision = ?", caddyHTTPSSettingName, previous.Revision).
				Updates(map[string]any{"enabled": *input.Enabled, "domain": domain,
					"lan_enabled": lanEnabled, "lan_ip": lanIP,
					"revision": next, "updated_at": time.Now().UTC()})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errCaddyHTTPSRevision
			}
		} else {
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&meta.AdminCaddyHTTPSSetting{
				Name: caddyHTTPSSettingName, Revision: next, Enabled: *input.Enabled, Domain: domain,
				LANEnabled: lanEnabled, LANIP: lanIP,
			})
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errCaddyHTTPSRevision
			}
		}
		if err := recordCaddyHTTPSRevisionTx(tx, next, *input.Enabled, domain,
			lanEnabled, lanIP, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy_https.desired.configure", "service", "caddy",
			"Caddy HTTPS desired configuration", auditpkg.ResultSuccess,
			map[string]any{"revision": next, "desired_enabled": *input.Enabled,
				"domain_configured": domain != "", "domain_changed": domain != oldDomain,
				"lan_enabled": lanEnabled, "lan_changed": lanEnabled != oldLANEnabled || lanIP != oldLANIP,
				"host_applied": false},
		))
	})
	if errors.Is(err, errCaddyHTTPSIngress) {
		fail(c, http.StatusBadRequest, "at least one valid HTTPS entry must remain enabled")
		return
	}
	if errors.Is(err, errCaddyHTTPSRevision) {
		fail(c, http.StatusConflict, "Caddy HTTPS desired revision changed; refresh")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS desired config not saved or audited")
		return
	}
	s.adminCaddyHTTPSConfig(c)
}

type adminCaddyHTTPSRevisionDTO struct {
	Revision   uint64    `json:"revision"`
	Enabled    bool      `json:"enabled"`
	Domain     string    `json:"domain"`
	LANEnabled bool      `json:"lan_enabled"`
	LANIP      string    `json:"lan_ip"`
	Origin     string    `json:"origin"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Server) adminCaddyHTTPSRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS history unavailable")
		return
	}
	var rows []meta.AdminCaddyHTTPSRevision
	if err := s.DB.WithContext(c.Request.Context()).Where("name = ?", caddyHTTPSSettingName).
		Order("revision DESC").Limit(40).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS history unavailable")
		return
	}
	list := make([]adminCaddyHTTPSRevisionDTO, 0, len(rows))
	for _, row := range rows {
		list = append(list, adminCaddyHTTPSRevisionDTO{
			Revision: row.Revision, Enabled: row.Enabled, Domain: row.Domain,
			LANEnabled: row.LANEnabled, LANIP: row.LANIP,
			Origin: row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

func (s *Server) adminRollbackCaddyHTTPS(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS database unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.TargetRevision == nil ||
		*input.Revision == 0 || *input.Revision > 1<<60 || *input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current and older HTTPS revision required")
		return
	}
	s.caddyHTTPSSaveMu.Lock()
	defer s.caddyHTTPSSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// A stale caller must see 409 before we read a legacy both-off
		// revision, and all writes stay under one PostgreSQL row lock.
		var row meta.AdminCaddyHTTPSSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHTTPSSettingName).Take(&row).Error; err != nil {
			return err
		}
		if row.Revision != *input.Revision {
			return errCaddyHTTPSRevision
		}
		var history meta.AdminCaddyHTTPSRevision
		if err := tx.Where("name = ? AND revision = ?",
			caddyHTTPSSettingName, *input.TargetRevision).Take(&history).Error; err != nil {
			return err
		}
		if !validCaddyIngressSelection(history.Enabled, history.Domain,
			history.LANEnabled, history.LANIP) {
			return errCaddyHTTPSIngress
		}
		if err := recordCaddyHTTPSRevisionTx(tx, row.Revision, row.Enabled, row.Domain,
			row.LANEnabled, row.LANIP, "saved"); err != nil {
			return err
		}
		next := row.Revision + 1
		update := tx.Model(&meta.AdminCaddyHTTPSSetting{}).
			Where("name = ? AND revision = ?", caddyHTTPSSettingName, row.Revision).
			Updates(map[string]any{"enabled": history.Enabled, "domain": history.Domain,
				"lan_enabled": history.LANEnabled, "lan_ip": history.LANIP,
				"revision": next, "updated_at": time.Now().UTC()})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errCaddyHTTPSRevision
		}
		if err := recordCaddyHTTPSRevisionTx(tx, next, history.Enabled, history.Domain,
			history.LANEnabled, history.LANIP, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy_https.desired.rollback", "service", "caddy",
			"Caddy HTTPS desired rollback", auditpkg.ResultSuccess,
			map[string]any{"revision": next, "target_revision": *input.TargetRevision,
				"desired_enabled": history.Enabled, "domain_configured": history.Domain != "",
				"lan_enabled": history.LANEnabled, "host_applied": false},
		))
	})
	if errors.Is(err, errCaddyHTTPSRevision) {
		fail(c, http.StatusConflict, "Caddy HTTPS desired revision changed")
		return
	}
	if errors.Is(err, errCaddyHTTPSIngress) {
		fail(c, http.StatusBadRequest, "historical revision disables both HTTPS entries")
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "requested Caddy HTTPS historical revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy HTTPS rollback not saved or audited")
		return
	}
	s.adminCaddyHTTPSConfig(c)
}
