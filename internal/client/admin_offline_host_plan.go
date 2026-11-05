package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// OfflineHostPlanStatus is a read-only preview. Plan is populated only after
// the isolated Host runner has completed publisher verification and probing.
type OfflineHostPlanStatus struct {
	Supported  bool            `json:"supported"`
	State      string          `json:"state"`
	RequestID  string          `json:"request_id,omitempty"`
	OfflineID  string          `json:"offline_id,omitempty"`
	TrustMode              string          `json:"offline_trust_mode,omitempty"`
	TrustedManifestSHA256  string          `json:"trusted_manifest_sha256,omitempty"`
	TrustedInstallerSHA256 string          `json:"trusted_installer_sha256,omitempty"`
	Message                string          `json:"message,omitempty"`
	Error      string          `json:"error,omitempty"`
	StartedAt  string          `json:"started_at,omitempty"`
	UpdatedAt  string          `json:"updated_at,omitempty"`
	FinishedAt string          `json:"finished_at,omitempty"`
	Plan       json.RawMessage `json:"plan,omitempty"`
}

func (c *Client) AdminOfflineHostPlan(ctx context.Context, id string) (OfflineHostPlanStatus, error) {
	var out OfflineHostPlanStatus
	if _, err := offlineImportPath(id); err != nil {
		return out, err
	}
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/update/offline/plan/"+id, nil, &out)
	return out, err
}

func (c *Client) AdminStartOfflineHostPlan(ctx context.Context, id, manifestSHA, installerSHA, trustMode string) (OfflineHostPlanStatus, error) {
	var out OfflineHostPlanStatus
	if _, err := offlineImportPath(id); err != nil {
		return out, err
	}
	switch trustMode {
	case "sigstore":
		if manifestSHA != "" || installerSHA != "" {
			return out, fmt.Errorf("Host signature verification does not accept uploader-supplied digests")
		}
	case "sha256":
		if !offlineImportHashPattern.MatchString(manifestSHA) || !offlineImportHashPattern.MatchString(installerSHA) {
			return out, fmt.Errorf("invalid independent offline release digests")
		}
	default:
		return out, fmt.Errorf("unsupported offline publisher trust mode")
	}
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update/offline/plan", map[string]any{
		"offline_id": id,
		"offline_trust_mode": trustMode,
		"trusted_manifest_sha256": manifestSHA,
		"trusted_installer_sha256": installerSHA,
	}, &out)
	return out, err
}
