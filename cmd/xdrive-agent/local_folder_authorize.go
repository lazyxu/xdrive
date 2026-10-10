package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

// localFolderGrantResult intentionally omits the one-time device credential
// and Root fingerprint. The local path is shown only to the owning Desktop.
type localFolderGrantResult struct {
	SourceID       uint64 `json:"source_id"`
	DeviceID       string `json:"device_id"`
	RootID         string `json:"root_id"`
	Path           string `json:"path"`
	Status         string `json:"status"`
	StrongIdentity bool   `json:"strong_identity"`
}

// insideDirectory is a lexical containment check used to reject importing
// xDrive's own mount or private credential/configuration directories.
func insideDirectory(parent, child string) bool {
	if parent == "" || child == "" {
		return false
	}
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func validateLocalFolderBoundaries(root, mountPath, configDir string) error {
	if !filepath.IsAbs(root) {
		return errors.New("local folder path must be absolute")
	}
	root = filepath.Clean(root)
	// Never grant access to the private credential/Root registry tree or an
	// ancestor of it; this protects even users selecting their home directory.
	if insideDirectory(root, configDir) || insideDirectory(configDir, root) {
		return errors.New("local folder overlaps xDrive private configuration and device credentials")
	}
	if mountPath != "" && (insideDirectory(root, mountPath) || insideDirectory(mountPath, root)) {
		return errors.New("local folder overlaps the managed xDrive mount")
	}
	return nil
}

// AuthorizeLocalFolder can be invoked from the Desktop native-picking IPC path.
// It never starts a scan or lifts the Server's fail-closed execution gate.
func (c *agentController) AuthorizeLocalFolder(ctx context.Context, sourceID uint64, selectedPath string) (localFolderGrantResult, error) {
	var out localFolderGrantResult
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		return out, errors.New("local folder authorization is not yet supported on this platform")
	}
	if sourceID == 0 || !filepath.IsAbs(selectedPath) {
		return out, errors.New("a real native-selected absolute local directory is required")
	}
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()

	cfg, err := userconfig.Load()
	if err != nil {
		return out, err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" || cfg.SessionID == "" {
		return out, errors.New("login is required for local folder authorization")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return out, err
	}
	mountPath, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return out, err
	}
	if err := validateLocalFolderBoundaries(selectedPath, mountPath, configDir); err != nil {
		return out, err
	}
	// Fail before any server registration if a picker path is not an ordinary,
	// accessible, stable local directory.
	if _, err := localpush.PrepareRootGrant(cfg.Server, cfg.Username, sourceID, uuid.NewString(), selectedPath); err != nil {
		return out, err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return out, err
	}
	source, err := cli.Source(ctx, sourceID)
	if err != nil {
		return out, err
	}
	if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush ||
		source.Status != meta.SourceStatusPaused {
		return out, errors.New("source must be a paused local_folder push")
	}
	// Prevent accidental re-binding to a different directory, even on the
	// same device; changing the Root requires an explicit unbind first.
	if current, err := cli.LocalSourceBinding(ctx, sourceID); err == nil {
		return out, fmt.Errorf("source is already bound to device %s root %s (unbind it first)", current.DeviceID, current.RootID)
	} else {
		var apiErr *client.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != http.StatusNotFound {
			return out, err
		}
	}

	deviceID, secret, err := localpush.EnsureDevice(ctx, configDir, cfg.Server, cfg.Username,
		"xDrive "+runtime.GOOS, runtime.GOOS, version.String(), cli)
	if err != nil {
		return out, err
	}
	grant, err := localpush.PrepareRootGrant(cfg.Server, cfg.Username, sourceID, deviceID, selectedPath)
	if err != nil {
		return out, err
	}
	if err := localpush.SaveRootGrant(configDir, grant); err != nil {
		return out, err
	}
	binding, err := cli.BindLocalSource(ctx, sourceID, source.Revision, secret, client.BindLocalSourceInput{
		DeviceID: deviceID, RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	})
	if err != nil {
		// A timed-out bind may already have committed remotely. Only keep
		// this grant when the Server explicitly confirms our exact binding.
		confirmed, checkErr := cli.LocalSourceBindingWithToken(ctx, sourceID, secret)
		if checkErr != nil || confirmed.DeviceID != deviceID || confirmed.RootID != grant.RootID {
			_ = localpush.RemoveRootGrant(configDir, cfg.Server, cfg.Username, grant.RootID)
			return out, err
		}
		binding = confirmed
	}
	if err := localpush.VerifyRootGrant(grant); err != nil {
		return out, err
	}
	latest, err := userconfig.Load()
	if err != nil {
		return out, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return out, errors.New("account changed during local folder authorization; verify binding before continuing")
	}
	return localFolderGrantResult{
		SourceID: sourceID, DeviceID: deviceID, RootID: grant.RootID,
		Path: grant.Path, Status: binding.Status, StrongIdentity: grant.StrongIdentity,
	}, nil
}
