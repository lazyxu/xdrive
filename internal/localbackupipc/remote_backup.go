package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

// Alias the existing strictly redacted, Server Owner-scoped projection, not
// generic Source/SyncRun/Device models. The owning Agent retains its Server
// login and all credentials; the DSM CGI receives only these DTOs.
type DeviceBackupOverview = client.DeviceBackupOverview
type DeviceBackupRunPage = client.DeviceBackupRunPage
type DeviceBackupFolderPage = client.DeviceBackupFolderPage

func (c *Client) requireDeviceBackupRead() error {
	if c == nil || !hasCapability(c.capabilities, "device-backup-read") {
		return errors.New("owning Agent has no owner-scoped device backup read capability")
	}
	return nil
}

func (c *Client) DeviceBackupOverview(ctx context.Context) (DeviceBackupOverview, error) {
	if err := c.requireDeviceBackupRead(); err != nil {
		return DeviceBackupOverview{}, err
	}
	var page DeviceBackupOverview
	if err := c.request(ctx, http.MethodGet, "/v1/device-backups", nil, &page); err != nil {
		return DeviceBackupOverview{}, err
	}
	if page.Devices == nil || len(page.Devices) > 100 ||
		(page.HasMore && page.NextAfterDeviceID == "") {
		return DeviceBackupOverview{}, errors.New("invalid owner-scoped device backup overview")
	}
	return page, nil
}

func (c *Client) DeviceBackupRuns(ctx context.Context, sourceID uint64, limit, offset int) (DeviceBackupRunPage, error) {
	if err := c.requireDeviceBackupRead(); err != nil {
		return DeviceBackupRunPage{}, err
	}
	if !ValidSourceID(sourceID) || limit < 1 || limit > 20 || offset < 0 ||
		offset > 100000 || offset > 100000-limit {
		return DeviceBackupRunPage{}, errors.New("invalid owner-scoped backup history selector")
	}
	query := url.Values{
		"source_id": {strconv.FormatUint(sourceID, 10)},
		"limit":     {strconv.Itoa(limit)},
		"offset":    {strconv.Itoa(offset)},
	}
	var page DeviceBackupRunPage
	if err := c.request(ctx, http.MethodGet, "/v1/device-backups/runs?"+query.Encode(), nil, &page); err != nil {
		return DeviceBackupRunPage{}, err
	}
	if page.Items == nil || len(page.Items) > limit || (page.HasMore && len(page.Items) != limit) {
		return DeviceBackupRunPage{}, errors.New("invalid owner-scoped backup history page")
	}
	for _, run := range page.Items {
		if run.SourceID != sourceID {
			return DeviceBackupRunPage{}, errors.New("history Source identity differs from requested Owner projection")
		}
	}
	return page, nil
}

func canonicalOwnerDeviceID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id
}

// Reuses the same original Agent + Server Owner read path as Desktop. No
// caller-provided Root, arbitrary upstream URL or DSM-login impersonation.
func (c *Client) DeviceBackupOverviewPage(ctx context.Context, limit int, afterDeviceID string) (DeviceBackupOverview, error) {
	if err := c.requireDeviceBackupRead(); err != nil {
		return DeviceBackupOverview{}, err
	}
	if limit < 1 || limit > 100 || !canonicalOwnerDeviceID(afterDeviceID) {
		return DeviceBackupOverview{}, errors.New("invalid Owner device page selector")
	}
	query := url.Values{
		"limit":           {strconv.Itoa(limit)},
		"after_device_id": {afterDeviceID},
	}
	var page DeviceBackupOverview
	if err := c.request(ctx, http.MethodGet, "/v1/device-backups?"+query.Encode(), nil, &page); err != nil {
		return DeviceBackupOverview{}, err
	}
	if page.Devices == nil || len(page.Devices) > limit ||
		(page.HasMore && (len(page.Devices) == 0 ||
			page.NextAfterDeviceID != page.Devices[len(page.Devices)-1].ID ||
			page.NextAfterDeviceID == afterDeviceID)) ||
		(!page.HasMore && page.NextAfterDeviceID != "") {
		return DeviceBackupOverview{}, errors.New("invalid Owner device page response")
	}
	return page, nil
}

func (c *Client) DeviceBackupFoldersPage(ctx context.Context, deviceID string, limit int, afterSourceID uint64) (DeviceBackupFolderPage, error) {
	if err := c.requireDeviceBackupRead(); err != nil {
		return DeviceBackupFolderPage{}, err
	}
	if !canonicalOwnerDeviceID(deviceID) || limit < 1 || limit > 100 ||
		(afterSourceID != 0 && !ValidSourceID(afterSourceID)) {
		return DeviceBackupFolderPage{}, errors.New("invalid Owner folder page selector")
	}
	query := url.Values{
		"device_id": {deviceID},
		"limit":     {strconv.Itoa(limit)},
	}
	if afterSourceID != 0 {
		query.Set("after_source_id", strconv.FormatUint(afterSourceID, 10))
	}
	var page DeviceBackupFolderPage
	if err := c.request(ctx, http.MethodGet, "/v1/device-backups/folders?"+query.Encode(), nil, &page); err != nil {
		return DeviceBackupFolderPage{}, err
	}
	if page.Folders == nil || len(page.Folders) > limit ||
		(page.HasMore && (len(page.Folders) == 0 ||
			page.NextAfterSourceID != page.Folders[len(page.Folders)-1].SourceID ||
			page.NextAfterSourceID <= afterSourceID)) ||
		(!page.HasMore && page.NextAfterSourceID != 0) {
		return DeviceBackupFolderPage{}, errors.New("invalid Owner folder page response")
	}
	previous := afterSourceID
	for _, folder := range page.Folders {
		if !ValidSourceID(folder.SourceID) || folder.SourceID <= previous {
			return DeviceBackupFolderPage{}, errors.New("Owner folder continuation not strictly increasing")
		}
		previous = folder.SourceID
	}
	return page, nil
}
