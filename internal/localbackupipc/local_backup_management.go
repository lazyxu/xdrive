package localbackupipc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	clientdto "github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

func requireLocalBackupCapability(c *Client, capability string) error {
	if c == nil {
		return errors.New("owning Agent is unavailable")
	}
	if !hasCapability(c.capabilities, capability) {
		return &AgentHTTPStatusError{Method: "capability " + capability, StatusCode: http.StatusNotImplemented}
	}
	return nil
}

func validLocalBackupName(name string) bool {
	return name != "" && strings.TrimSpace(name) == name &&
		len([]byte(name)) <= 128 && !strings.ContainsAny(name, "\x00\r\n")
}

func validLocalBackupSettings(settings clientdto.LocalBoundBackupSettings, sourceID uint64) bool {
	if !ValidSourceID(sourceID) || settings.SourceID != sourceID || settings.Revision == 0 ||
		!validLocalBackupName(settings.Name) ||
		(settings.SyncMode != "backup" && settings.SyncMode != "mirror") ||
		len([]byte(settings.TargetPath)) > 2048 ||
		strings.ContainsAny(settings.TargetPath, "\x00\r\n") {
		return false
	}
	return settings.TargetNodeID == nil || ValidSourceID(*settings.TargetNodeID)
}

// LocalBackupSettings reads the redacted settings projection from the same
// owning Agent that runs the local Source. Root paths and credentials are not
// returned by this API.
func (c *Client) LocalBackupSettings(ctx context.Context, id uint64) (clientdto.LocalBoundBackupSettings, error) {
	var result clientdto.LocalBoundBackupSettings
	if !ValidSourceID(id) {
		return result, errors.New("invalid owning Backup-only Source ID")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-config"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-source", id)
	if err == nil {
		err = c.request(ctx, http.MethodGet, path, nil, &result)
	}
	if err != nil {
		return clientdto.LocalBoundBackupSettings{}, err
	}
	if !validLocalBackupSettings(result, id) {
		return clientdto.LocalBoundBackupSettings{}, errors.New("invalid owning Agent local backup settings")
	}
	return result, nil
}

// RenameLocalBackupSource uses the revision-fenced, owner-Agent-only route.
// It never falls back to a generic Server Source PATCH.
func (c *Client) RenameLocalBackupSource(ctx context.Context, id, revision uint64, name string) (clientdto.LocalBoundBackupSettings, error) {
	var result clientdto.LocalBoundBackupSettings
	if !ValidSourceID(id) || revision == 0 || !validLocalBackupName(name) {
		return result, errors.New("invalid local backup Source rename")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-config"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-source", id)
	if err != nil {
		return result, err
	}
	body := struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
		Name     string `json:"name"`
	}{SourceID: id, Revision: revision, Name: name}
	if err := c.request(ctx, http.MethodPatch, path, body, &result); err != nil {
		return clientdto.LocalBoundBackupSettings{}, err
	}
	if !validLocalBackupSettings(result, id) || result.Revision <= revision || result.Name != name {
		return clientdto.LocalBoundBackupSettings{}, errors.New("unverified local backup rename acknowledgement")
	}
	return result, nil
}

// RetargetLocalBackupSource changes only the current Owner cloud target Node.
func (c *Client) RetargetLocalBackupSource(ctx context.Context, id, revision, targetNodeID uint64) (clientdto.LocalBoundBackupSettings, error) {
	var result clientdto.LocalBoundBackupSettings
	if !ValidSourceID(id) || revision == 0 || !ValidSourceID(targetNodeID) {
		return result, errors.New("invalid local backup target request")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-target"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-target", id)
	if err != nil {
		return result, err
	}
	body := struct {
		SourceID     uint64 `json:"source_id"`
		Revision     uint64 `json:"revision"`
		TargetNodeID uint64 `json:"target_node_id"`
	}{SourceID: id, Revision: revision, TargetNodeID: targetNodeID}
	if err := c.request(ctx, http.MethodPatch, path, body, &result); err != nil {
		return clientdto.LocalBoundBackupSettings{}, err
	}
	if !validLocalBackupSettings(result, id) || result.Revision <= revision ||
		result.TargetNodeID == nil || *result.TargetNodeID != targetNodeID {
		return clientdto.LocalBoundBackupSettings{}, errors.New("unverified local backup target acknowledgement")
	}
	return result, nil
}

// SetLocalBackupMode changes only the saved Backup/Mirror policy. The
// existing Agent remains authoritative for whether an operation can run.
func (c *Client) SetLocalBackupMode(ctx context.Context, id, revision uint64, mode string) (clientdto.LocalBoundBackupSettings, error) {
	var result clientdto.LocalBoundBackupSettings
	if !ValidSourceID(id) || revision == 0 || (mode != "backup" && mode != "mirror") {
		return result, errors.New("invalid local backup mode request")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-mode"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-mode", id)
	if err != nil {
		return result, err
	}
	body := struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
		SyncMode string `json:"sync_mode"`
	}{SourceID: id, Revision: revision, SyncMode: mode}
	if err := c.request(ctx, http.MethodPatch, path, body, &result); err != nil {
		return clientdto.LocalBoundBackupSettings{}, err
	}
	if !validLocalBackupSettings(result, id) || result.Revision <= revision || result.SyncMode != mode {
		return clientdto.LocalBoundBackupSettings{}, errors.New("unverified local backup mode acknowledgement")
	}
	return result, nil
}

// LocalBackupRules reads the dedicated owner-Agent ignore-rule projection.
func (c *Client) LocalBackupRules(ctx context.Context, id uint64) (clientdto.LocalBoundIgnoreRules, error) {
	var result clientdto.LocalBoundIgnoreRules
	if !ValidSourceID(id) {
		return result, errors.New("invalid owning Backup-only Source ID")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-rules"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-rules", id)
	if err == nil {
		err = c.request(ctx, http.MethodGet, path, nil, &result)
	}
	if err != nil {
		return clientdto.LocalBoundIgnoreRules{}, err
	}
	if result.SourceID != id || result.Revision == 0 {
		return clientdto.LocalBoundIgnoreRules{}, errors.New("invalid owning Agent local backup rules")
	}
	if _, err := sourcepkg.CompileIgnoreRules(result.IgnoreRules); err != nil {
		return clientdto.LocalBoundIgnoreRules{}, errors.New("invalid owning Agent ignore rules")
	}
	return result, nil
}

// SaveLocalBackupRules validates syntax and size before forwarding the
// revision-fenced mutation to the original owning Agent.
func (c *Client) SaveLocalBackupRules(ctx context.Context, id, revision uint64, rules string) (clientdto.LocalBoundIgnoreRules, error) {
	var result clientdto.LocalBoundIgnoreRules
	if !ValidSourceID(id) || revision == 0 {
		return result, errors.New("invalid local backup rules request")
	}
	if _, err := sourcepkg.CompileIgnoreRules(rules); err != nil {
		return result, fmt.Errorf("invalid local backup ignore rules: %w", err)
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-rules"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-rules", id)
	if err != nil {
		return result, err
	}
	body := struct {
		SourceID    uint64 `json:"source_id"`
		Revision    uint64 `json:"revision"`
		IgnoreRules string `json:"ignore_rules"`
	}{SourceID: id, Revision: revision, IgnoreRules: rules}
	if err := c.request(ctx, http.MethodPatch, path, body, &result); err != nil {
		return clientdto.LocalBoundIgnoreRules{}, err
	}
	if result.SourceID != id || result.Revision <= revision || result.IgnoreRules != rules {
		return clientdto.LocalBoundIgnoreRules{}, errors.New("unverified local backup rules acknowledgement")
	}
	if _, err := sourcepkg.CompileIgnoreRules(result.IgnoreRules); err != nil {
		return clientdto.LocalBoundIgnoreRules{}, errors.New("Agent returned invalid local backup rules")
	}
	return result, nil
}

// RemoveLocalBackupSource removes only an eligible native local Source through
// the Agent's dedicated DELETE route; generic Source deletion is not used.
func (c *Client) RemoveLocalBackupSource(ctx context.Context, id, revision uint64) (clientdto.LocalBoundBackupRemoval, error) {
	var result clientdto.LocalBoundBackupRemoval
	if !ValidSourceID(id) || revision == 0 {
		return result, errors.New("invalid local backup removal request")
	}
	if err := requireLocalBackupCapability(c, "device-backup-local-remove"); err != nil {
		return result, err
	}
	path, err := sourcePath("/v1/device-backups/local-bound", id)
	if err != nil {
		return result, err
	}
	body := struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
	}{SourceID: id, Revision: revision}
	if err := c.request(ctx, http.MethodDelete, path, body, &result); err != nil {
		return clientdto.LocalBoundBackupRemoval{}, err
	}
	if result.SourceID != id {
		return clientdto.LocalBoundBackupRemoval{}, errors.New("unverified local backup removal acknowledgement")
	}
	return result, nil
}
