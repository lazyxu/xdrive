package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A successful POST is not sufficient to authorize a local Root. Old Servers
// may accept a generic Source without allocating its exclusive managed target.
// In that case leave any possibly committed Source paused for draft recovery.
func validateCreatedLocalBackupSource(created client.Source, requested client.CreateSourceInput, deviceID string) error {
	if created.ID == 0 || created.Revision == 0 ||
		created.Name != requested.Name ||
		created.Kind != meta.SourceKindLocalFolder ||
		created.Direction != meta.SourceDirectionPush ||
		created.SyncMode != requested.SyncMode ||
		created.RunMode != requested.RunMode ||
		created.Status != meta.SourceStatusPaused ||
		created.DeviceID != deviceID ||
		!created.TargetManaged ||
		created.TargetNodeID == nil || *created.TargetNodeID == 0 ||
		strings.TrimSpace(created.TargetPath) == "" || len([]byte(created.TargetPath)) > 2048 {
		return errors.New("Server did not confirm the owning device and exclusive managed local backup target; do not authorize a Root; a paused draft may already exist and must be inspected before retrying")
	}
	return nil
}

// Preserve every Server error, but explain the legacy error seen when a
// Desktop issues the managed local_folder/push creation request against an
// incompatible Source configuration contract. Never retry with a user-picked
// target or discard a potentially committed draft automatically.
func explainLocalBackupCreateError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "valid source configuration is required") {
		return fmt.Errorf("Server rejected managed local_folder/push Source configuration; check Server/Agent version compatibility and managed-target support (a draft may exist): %w", err)
	}
	return err
}
