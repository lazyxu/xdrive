package localbackupipc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

type LocalBackupSource struct {
	ID           uint64  `json:"id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	Direction    string  `json:"direction"`
	SyncMode     string  `json:"sync_mode"`
	Status       string  `json:"status"`
	Revision     uint64  `json:"revision"`
	TargetNodeID *uint64 `json:"target_node_id"`
}

type LocalBackupRootGrant struct {
	SourceID       uint64 `json:"source_id"`
	DeviceID       string `json:"device_id"`
	RootID         string `json:"root_id"`
	Path           string `json:"path"`
	Status         string `json:"status"`
	StrongIdentity bool   `json:"strong_identity"`
}

// One shared request DTO for preflight and authorization over the same
// authenticated owning-Agent IPC. Preflight omits SourceID entirely.
type localBackupRootRequest struct {
	SourceID uint64 `json:"source_id,omitempty"`
	Path     string `json:"path"`
}

type LocalBackupDraft struct {
	SourceID uint64    `json:"source_id"`
	Name     string    `json:"name"`
	Revision uint64    `json:"revision"`
	Created  time.Time `json:"created_at"`
}

type localBackupDraftPage struct {
	Items       []LocalBackupDraft `json:"items"`
	HasMore     bool               `json:"has_more"`
	NextAfterID uint64             `json:"next_after_id"`
}

func ValidLocalBackupPath(path string) bool {
	return len([]byte(path)) > 0 && len([]byte(path)) <= 4096 &&
		filepath.IsAbs(path) && filepath.Clean(path) == path
}

// PreflightLocalRoot runs on the same owning Agent and is read-only: it
// verifies an explicit local user's native path before any Source is created.
func (c *Client) PreflightLocalRoot(ctx context.Context, path string) error {
	if !ValidLocalBackupPath(path) {
		return errors.New("a canonical absolute local backup directory is required")
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if err := c.request(ctx, http.MethodPost, "/v1/device-backups/local-cli-preflight",
		localBackupRootRequest{Path: path}, &result); err != nil {
		return err
	}
	if !result.OK {
		return errors.New("owning Agent did not confirm local backup path preflight")
	}
	return nil
}

// CreateLocalBackupSource uses the EXISTING Agent Source-creation API, which
// registers/reuses its private device and constrains local Sources to paused
// owner-authorized Backup-only. No device token enters this client or response.
func (c *Client) CreateLocalBackupSource(ctx context.Context, name string, targetID uint64) (LocalBackupSource, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]byte(name)) > 128 || !ValidSourceID(targetID) {
		return LocalBackupSource{}, errors.New("valid name and cloud target directory ID required")
	}
	request := client.CreateSourceInput{
		Name: name, Kind: "local_folder", Direction: "push",
		SyncMode: "backup", RunMode: "sync", ScheduleType: "manual",
		TargetNodeID: targetID,
	}
	var source LocalBackupSource
	if err := c.request(ctx, http.MethodPost, "/v1/sources", request, &source); err != nil {
		return LocalBackupSource{}, err
	}
	if !ValidSourceID(source.ID) || source.Revision == 0 ||
		source.Name != name || source.Kind != "local_folder" ||
		source.Direction != "push" || source.SyncMode != "backup" ||
		source.Status != "paused" || source.TargetNodeID == nil ||
		*source.TargetNodeID != targetID {
		return LocalBackupSource{}, errors.New("owning Agent returned an invalid local Backup-only Source")
	}
	return source, nil
}

// AuthorizeLocalRoot reuses the Desktop native Root binding implementation.
// The explicit local --path is never forwarded to an external remote Source
// API and the private Agent performs every native/Owner/Device check.
func (c *Client) AuthorizeLocalRoot(ctx context.Context, sourceID uint64, path string) (LocalBackupRootGrant, error) {
	if !ValidSourceID(sourceID) || !ValidLocalBackupPath(path) {
		return LocalBackupRootGrant{}, errors.New("valid owning Source and explicit absolute local path required")
	}
	var result LocalBackupRootGrant
	request := localBackupRootRequest{SourceID: sourceID, Path: path}
	if err := c.request(ctx, http.MethodPost, "/v1/local-folder/authorize", request, &result); err != nil {
		return LocalBackupRootGrant{}, err
	}
	if result.SourceID != sourceID || result.Path != path ||
		result.Status != "awaiting_executor" {
		return LocalBackupRootGrant{}, errors.New("invalid owning Agent native Root binding result")
	}
	if _, err := uuid.Parse(result.DeviceID); err != nil {
		return LocalBackupRootGrant{}, errors.New("invalid Agent device identity")
	}
	if _, err := uuid.Parse(result.RootID); err != nil {
		return LocalBackupRootGrant{}, errors.New("invalid Agent Root identity")
	}
	return result, nil
}

// LocalDrafts permits explicit recovery of only the current creating
// Agent's unbound Sources; the device token remains Agent-private.
func (c *Client) LocalDrafts(ctx context.Context) ([]LocalBackupDraft, error) {
	const limit = 100
	const maxPages = 64
	out := make([]LocalBackupDraft, 0)
	var after uint64
	for pageNo := 0; pageNo < maxPages; pageNo++ {
		values := url.Values{}
		values.Set("limit", strconv.Itoa(limit))
		values.Set("after_id", strconv.FormatUint(after, 10))
		var page localBackupDraftPage
		if err := c.request(ctx, http.MethodGet,
			"/v1/device-backups/local-drafts?"+values.Encode(), nil, &page); err != nil {
			return nil, err
		}
		if len(page.Items) > limit {
			return nil, errors.New("invalid owning Agent draft page size")
		}
		last := after
		for _, item := range page.Items {
			if !ValidSourceID(item.SourceID) || item.SourceID <= last ||
				item.Revision == 0 || item.Name == "" {
				return nil, errors.New("invalid owning Agent draft ordering or identity")
			}
			out = append(out, item)
			last = item.SourceID
		}
		if !page.HasMore {
			if page.NextAfterID != 0 {
				return nil, errors.New("unexpected terminal draft cursor")
			}
			return out, nil
		}
		if len(page.Items) == 0 || page.NextAfterID != last {
			return nil, fmt.Errorf("invalid next draft cursor after %d", after)
		}
		after = last
	}
	return nil, errors.New("incomplete owning Agent draft enumeration")
}
