package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestDeviceBackupFolderOwnerKeysetBeyondThousandBindings(t *testing.T) {
	db, server, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("folder-owner-keyset-test-secret", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignJWT, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	makeDevice := func(ownerID uint64, name string) meta.ClientDevice {
		t.Helper()
		device := meta.ClientDevice{
			ID: uuid.NewString(), OwnerID: ownerID, Name: name,
			Platform: "linux", CredentialHash: strings.Repeat("b", 64),
			CreatedAt: now, UpdatedAt: now,
		}
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
		return device
	}
	device := makeDevice(owner.ID, "Owner Desktop")
	sibling := makeDevice(owner.ID, "Owner Other Desktop")
	foreign := makeDevice(other.ID, "Other Owner")
	const total = 1003
	const privatePath = "/home/owner/private/never-leak-to-web"
	const rootFingerprint = "abcd-private-root-fingerprint-never-leak"
	sources := make([]meta.Source, 0, total)
	for i := 0; i < total; i++ {
		sources = append(sources, meta.Source{
			OwnerID: owner.ID, Name: fmt.Sprintf("Local Folder %04d", i),
			Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
			Status: meta.SourceStatusPaused, Revision: 1,
			IgnoreRules: privatePath, LastError: privatePath,
		})
	}
	if err := db.CreateInBatches(&sources, 100).Error; err != nil {
		t.Fatal(err)
	}
	bindings := make([]meta.LocalSourceBinding, 0, total)
	expected := make([]uint64, 0, total)
	for _, source := range sources {
		expected = append(expected, source.ID)
		bindings = append(bindings, meta.LocalSourceBinding{
			SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
			RootID: uuid.NewString(), RootFingerprint: rootFingerprint,
			CreatedAt: now, UpdatedAt: now,
		})
	}
	if err := db.CreateInBatches(&bindings, 100).Error; err != nil {
		t.Fatal(err)
	}
	sort.Slice(expected, func(i, j int) bool { return expected[i] < expected[j] })
	addBound := func(ownerID uint64, dev meta.ClientDevice, name, kind string) uint64 {
		t.Helper()
		source := meta.Source{
			OwnerID: ownerID, Name: name, Kind: kind,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1,
		}
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		binding := meta.LocalSourceBinding{
			SourceID: source.ID, OwnerID: ownerID, DeviceID: dev.ID,
			RootID: uuid.NewString(), RootFingerprint: rootFingerprint,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := db.Create(&binding).Error; err != nil {
			t.Fatal(err)
		}
		return source.ID
	}
	otherDeviceSourceID := addBound(owner.ID, sibling, "Another local machine", meta.SourceKindLocalFolder)
	foreignSourceID := addBound(other.ID, foreign, "Foreign local machine", meta.SourceKindLocalFolder)
	nasID := addBound(owner.ID, device, "Legacy NAS", "synology_photos")
	latest := meta.SyncRun{
		ID: uuid.NewString(), SourceID: expected[0], RunNumber: 1,
		Status: meta.SyncRunStatusRunning, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, TransferredBytes: 2048,
		StartedAt: now, ActiveTransferPath: privatePath, Error: privatePath,
	}
	if err := db.Create(&latest).Error; err != nil {
		t.Fatal(err)
	}
	overview := request(t, router, http.MethodGet, "/api/v1/device-backups", ownerJWT, nil, http.StatusOK)
	if !strings.Contains(overview.Body.String(), `"has_more_folders":true`) {
		t.Fatal("original 1000-binding overview cap unexpectedly hidden")
	}
	read := func(token, deviceID string, limit int, cursor uint64) (struct {
		Folders           []deviceBackupFolderReadDTO `json:"folders"`
		HasMore           bool                        `json:"has_more"`
		NextAfterSourceID uint64                      `json:"next_after_source_id"`
	}, string) {
		t.Helper()
		path := fmt.Sprintf("/api/v1/device-backups/folders?device_id=%s&limit=%d", deviceID, limit)
		if cursor != 0 {
			path += "&after_source_id=" + fmt.Sprintf("%d", cursor)
		}
		response := request(t, router, http.MethodGet, path, token, nil, http.StatusOK)
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("folder pages must never enter shared caches")
		}
		var page struct {
			Folders           []deviceBackupFolderReadDTO `json:"folders"`
			HasMore           bool                        `json:"has_more"`
			NextAfterSourceID uint64                      `json:"next_after_source_id"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page, response.Body.String()
	}
	seen := make(map[uint64]bool, total)
	got := make([]uint64, 0, total)
	var cursor uint64
	for index := 0; index < 12; index++ {
		page, body := read(ownerJWT, device.ID, 100, cursor)
		if strings.Contains(body, privatePath) ||
			strings.Contains(body, rootFingerprint) ||
			strings.Contains(body, "root_id") ||
			strings.Contains(body, "last_error") ||
			strings.Contains(body, "credential_hash") ||
			strings.Contains(body, "active_transfer_path") ||
			strings.Contains(body, "ignore_rules") ||
			strings.Contains(body, "checkpoint") ||
			strings.Contains(body, "Legacy NAS") {
			t.Fatalf("page leaked local Root or NAS data: %s", body)
		}
		for _, folder := range page.Folders {
			if seen[folder.SourceID] || folder.SourceID == nasID || folder.SourceID == foreignSourceID ||
				folder.SourceID == otherDeviceSourceID {
				t.Fatalf("unowned, NAS, other-device or repeated folder on page %d: %d", index, folder.SourceID)
			}
			if folder.SourceID == expected[0] &&
				(folder.LatestRun == nil || folder.LatestRun.TransferredBytes != 2048) {
				t.Fatal("paged latest run lost the allowlisted aggregate bytes")
			}
			seen[folder.SourceID] = true
			got = append(got, folder.SourceID)
		}
		if !page.HasMore {
			if page.NextAfterSourceID != 0 {
				t.Fatal("terminal folder page advertises a cursor")
			}
			break
		}
		if len(page.Folders) != 100 ||
			page.NextAfterSourceID != page.Folders[len(page.Folders)-1].SourceID {
			t.Fatalf("bad bounded keyset continuation on page %d: %+v", index, page)
		}
		cursor = page.NextAfterSourceID
	}
	if len(got) != total {
		t.Fatalf("1000-binding truncation persisted: got %d of %d", len(got), total)
	}
	for i, id := range expected {
		if got[i] != id {
			t.Fatalf("folder order or identity changed at %d: got %d expected %d", i, got[i], id)
		}
	}
	siblingPage, _ := read(ownerJWT, sibling.ID, 100, 0)
	if len(siblingPage.Folders) != 1 || siblingPage.Folders[0].SourceID != otherDeviceSourceID ||
		siblingPage.HasMore {
		t.Fatal("another same-owner device did not get only its own folders")
	}
	foreignPage, _ := read(foreignJWT, foreign.ID, 100, 0)
	if len(foreignPage.Folders) != 1 || foreignPage.Folders[0].SourceID != foreignSourceID {
		t.Fatal("other owner folder read not correctly isolated")
	}
	endpoint := "/api/v1/device-backups/folders?device_id=" + device.ID
	for _, bad := range []string{
		endpoint + "&limit=0", endpoint + "&limit=101", endpoint + "&limit=-1",
		endpoint + "&limit=foo", endpoint + "&limit=010", endpoint + "&limit=1&limit=2",
		endpoint + "&after_source_id=0", endpoint + "&after_source_id=-1",
		endpoint + "&after_source_id=01", endpoint + "&after_source_id=bogus",
		endpoint + "&after_source_id=" + fmt.Sprintf("%d", foreignSourceID),
		endpoint + "&after_source_id=" + fmt.Sprintf("%d", otherDeviceSourceID),
		endpoint + "&after_source_id=" + fmt.Sprintf("%d", nasID),
		endpoint + "&after_source_id=" + fmt.Sprintf("%d", expected[len(expected)-1]+999),
		endpoint + "&debug=true", endpoint + "&device_id=" + device.ID,
		"/api/v1/device-backups/folders?device_id=not-uuid",
	} {
		request(t, router, http.MethodGet, bad, ownerJWT, nil, http.StatusBadRequest)
	}
	request(t, router, http.MethodGet,
		"/api/v1/device-backups/folders?device_id="+foreign.ID, ownerJWT, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		"/api/v1/device-backups/folders?device_id="+uuid.NewString(), ownerJWT, nil, http.StatusNotFound)
	// Construct a valid URL first, then inject the malformed RawQuery: Go's
	// httptest.NewRequest panics if asked to parse a malformed URL directly.
	malformed := httptest.NewRequest(http.MethodGet, endpoint, nil)
	malformed.URL.RawQuery = "device_id=" + device.ID + "&after_source_id=%ZZ"
	malformed.Header.Set("Authorization", "Bearer "+ownerJWT)
	badResponse := httptest.NewRecorder()
	router.ServeHTTP(badResponse, malformed)
	if badResponse.Code != http.StatusBadRequest {
		t.Fatalf("malformed URL encoding accepted: %d", badResponse.Code)
	}
	request(t, router, http.MethodGet, endpoint, "", nil, http.StatusUnauthorized)
}
