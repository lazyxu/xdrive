package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const caddyHostPlanProtocol = "xdrive.caddy.https.host-plan.v1"

var errCaddyHostPlanIncomplete = errors.New("Caddy host plan requires valid saved configuration")

// buildCaddyHTTPSHostPlan returns a strictly canonical NONSECRET snapshot
// for independent, operator-local DRY-RUN review. This is not a signed Host
// Manager command, an applied revision or a trustworthy rollback receipt.
// encoding/json sorts map keys, matching the host-only Python parser.
func buildCaddyHTTPSHostPlan(snapshot caddyPreflightSnapshot) ([]byte, error) {
	desired := snapshot.Desired
	if desired.Source != "saved" || desired.Revision == 0 || desired.Revision >= 1<<60 ||
		!validCaddyIngressSelection(desired.Enabled, desired.Domain, desired.LANEnabled, desired.LANIP) ||
		strings.ToLower(desired.Domain) != desired.Domain {
		return nil, errCaddyHostPlanIncomplete
	}
	credentials := uint64(0)
	if snapshot.CredentialExists {
		credentials = snapshot.Credential.Revision
		if credentials == 0 || credentials >= 1<<60 {
			return nil, errCaddyHostPlanIncomplete
		}
	}
	if desired.Enabled && (!snapshot.CredentialExists ||
		!snapshot.Credential.Enabled || snapshot.Credential.KeyVersion == 0 ||
		len(snapshot.Credential.Ciphertext) == 0) {
		return nil, errCaddyHostPlanIncomplete
	}
	// These seven fields are a stable versioned protocol. Secrets, access
	// tokens, ciphertext, host file paths, and Docker details never appear.
	body, err := json.Marshal(map[string]any{
		"protocol":            caddyHostPlanProtocol,
		"desired_revision":    desired.Revision,
		"credential_revision": credentials,
		"domain_enabled":      desired.Enabled,
		"domain":              desired.Domain,
		"lan_enabled":         desired.LANEnabled,
		"lan_ip":              desired.LANIP,
	})
	if err != nil {
		return nil, err
	}
	return append(body, '\n'), nil
}

// Admin-only read endpoint for a candidate host-side PREVIEW. Returning a
// canonical JSON plan does not grant Apply/Restart or install AliDNS secrets.
func (s *Server) adminCaddyHTTPSHostPlan(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	snapshot, err := s.readCaddyPreflightSnapshot(ctx)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy plan database snapshot unavailable")
		return
	}
	body, err := buildCaddyHTTPSHostPlan(snapshot)
	if err != nil {
		fail(c, http.StatusConflict, "Save valid HTTPS intent and required domain credentials first")
		return
	}
	// Another admin may save while we construct the plan. This recheck
	// reduces that window; only a future Host Manager CAS can truly apply.
	current, err := s.readCaddyPreflightSnapshot(ctx)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy plan snapshot recheck unavailable")
		return
	}
	if !sameCaddyPreflightSnapshot(snapshot, current) {
		fail(c, http.StatusConflict, "HTTPS or AliDNS revision changed during host plan review")
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", body)
}
