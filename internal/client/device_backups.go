package client

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Deliberately narrow owner-scoped read models. Do not embed Source, SyncRun,
// SourceItem, LocalSourceBinding, ClientDevice credentials, or raw failure data.
type DeviceBackupRun struct {
	ID                       string     `json:"id"`
	SourceID                 uint64     `json:"source_id"`
	RunNumber                int64      `json:"run_number"`
	Mode                     string     `json:"mode"`
	Trigger                  string     `json:"trigger"`
	Status                   string     `json:"status"`
	ScannedItems             int64      `json:"scanned_items"`
	ScannedBytes             int64      `json:"scanned_bytes"`
	IgnoredItems             int64      `json:"ignored_items"`
	NewItems                 int64      `json:"new_items"`
	ChangedItems             int64      `json:"changed_items"`
	MovedItems               int64      `json:"moved_items"`
	UnchangedItems           int64      `json:"unchanged_items"`
	PlannedTransferBytes     int64      `json:"planned_transfer_bytes"`
	TransferredItems         int64      `json:"transferred_items"`
	TransferredBytes         int64      `json:"transferred_bytes"`
	FailedItems              int64      `json:"failed_items"`
	ActiveTransferBytes      int64      `json:"active_transfer_bytes"`
	ActiveTransferTotalBytes int64      `json:"active_transfer_total_bytes"`
	CancelRequestedAt        *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt                time.Time  `json:"started_at"`
	FinishedAt               *time.Time `json:"finished_at,omitempty"`
}

type DeviceBackupFolder struct {
	SourceID   uint64           `json:"source_id"`
	Name       string           `json:"name"`
	TargetPath string           `json:"target_path,omitempty"`
	SyncMode   string           `json:"sync_mode"`
	Status     string           `json:"status"`
	LatestRun  *DeviceBackupRun `json:"latest_run,omitempty"`
}

type DeviceBackupDevice struct {
	ID              string               `json:"id"`
	Name            string               `json:"name"`
	Platform        string               `json:"platform"`
	ClientVersion   string               `json:"client_version,omitempty"`
	LastSeenAt      *time.Time           `json:"last_seen_at,omitempty"`
	ConnectionState string               `json:"connection_state"`
	Revoked         bool                 `json:"revoked"`
	Folders         []DeviceBackupFolder `json:"folders"`
}

type DeviceBackupOverview struct {
	Devices        []DeviceBackupDevice `json:"devices"`
	HasMore        bool                 `json:"has_more"`
	HasMoreFolders bool                 `json:"has_more_folders"`
}

type DeviceBackupRunPage struct {
	Items   []DeviceBackupRun `json:"items"`
	HasMore bool              `json:"has_more"`
}

// Both requests inherit the currently authenticated owner's server session.
// Remote Desktop never receives the generic Source or local binding DTO.
func (c *Client) DeviceBackupOverview(ctx context.Context) (DeviceBackupOverview, error) {
	var out DeviceBackupOverview
	err := c.json(ctx, http.MethodGet, "/api/v1/device-backups", nil, &out)
	return out, err
}

func (c *Client) DeviceBackupRunSummaries(ctx context.Context, sourceID uint64, limit, offset int) (DeviceBackupRunPage, error) {
	var out DeviceBackupRunPage
	query := url.Values{
		"limit":  {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
	}
	endpoint := "/api/v1/device-backups/" + strconv.FormatUint(sourceID, 10) + "/runs?" + query.Encode()
	err := c.json(ctx, http.MethodGet, endpoint, nil, &out)
	return out, err
}
