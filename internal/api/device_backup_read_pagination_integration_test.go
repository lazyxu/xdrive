package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestDeviceBackupOwnerKeysetPagingBeyondOneHundredDevices(t *testing.T) {
	db, server, owner, foreign, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("backup-read-page-test-secret", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	expected := make([]meta.ClientDevice, 0, 103)
	for i := 0; i < 103; i++ {
		when := base.Add(time.Duration(i/2) * time.Second)
		device := meta.ClientDevice{
			ID: uuid.NewString(), OwnerID: owner.ID,
			Name: fmt.Sprintf("Owned Desktop %03d", i), Platform: "windows",
			CredentialHash: strings.Repeat("a", 64),
			CreatedAt:      when, UpdatedAt: when,
		}
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
		expected = append(expected, device)
	}
	sort.Slice(expected, func(i, j int) bool {
		if expected[i].CreatedAt.Equal(expected[j].CreatedAt) {
			return expected[i].ID > expected[j].ID
		}
		return expected[i].CreatedAt.After(expected[j].CreatedAt)
	})
	foreignDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: foreign.ID, Name: "Foreign Computer",
		Platform: "linux", CredentialHash: strings.Repeat("b", 64),
		CreatedAt: base, UpdatedAt: base,
	}
	if err := db.Create(&foreignDevice).Error; err != nil {
		t.Fatal(err)
	}
	read := func(url string, authToken string) struct {
		Devices           []deviceBackupReadDTO `json:"devices"`
		HasMore           bool                  `json:"has_more"`
		HasMoreFolders    bool                  `json:"has_more_folders"`
		NextAfterDeviceID string                `json:"next_after_device_id"`
	} {
		t.Helper()
		response := request(t, router, http.MethodGet, url, authToken, nil, http.StatusOK)
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("paginated device backups must not enter shared caches")
		}
		var page struct {
			Devices           []deviceBackupReadDTO `json:"devices"`
			HasMore           bool                  `json:"has_more"`
			HasMoreFolders    bool                  `json:"has_more_folders"`
			NextAfterDeviceID string                `json:"next_after_device_id"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	firstDefault := read("/api/v1/device-backups", token)
	if len(firstDefault.Devices) != 100 || !firstDefault.HasMore ||
		firstDefault.NextAfterDeviceID != expected[99].ID {
		t.Fatalf("legacy 100-device page lost truthful continuation: %+v", firstDefault)
	}
	ids := make([]string, 0, len(expected))
	seen := make(map[string]bool, len(expected))
	next := ""
	for step := 0; step < 5; step++ {
		url := "/api/v1/device-backups?limit=40"
		if next != "" {
			url += "&after_device_id=" + next
		}
		page := read(url, token)
		for _, device := range page.Devices {
			if device.ID == foreignDevice.ID || seen[device.ID] {
				t.Fatalf("foreign/duplicate device on page %d: %q", step, device.ID)
			}
			if len(device.Folders) != 0 {
				t.Fatal("device list invented unbound local Root data")
			}
			seen[device.ID] = true
			ids = append(ids, device.ID)
		}
		if !page.HasMore {
			if page.NextAfterDeviceID != "" {
				t.Fatal("terminal page continued to advertise a cursor")
			}
			break
		}
		if len(page.Devices) != 40 || page.NextAfterDeviceID != page.Devices[len(page.Devices)-1].ID {
			t.Fatalf("invalid bounded keyset page %d: %+v", step, page)
		}
		next = page.NextAfterDeviceID
	}
	if len(ids) != len(expected) {
		t.Fatalf("device list truncated: got %d want %d", len(ids), len(expected))
	}
	for i, device := range expected {
		if ids[i] != device.ID {
			t.Fatalf("unstable device order at %d: got %q want %q", i, ids[i], device.ID)
		}
	}
	for _, url := range []string{
		"/api/v1/device-backups?limit=0",
		"/api/v1/device-backups?limit=101",
		"/api/v1/device-backups?limit=-1",
		"/api/v1/device-backups?limit=invalid",
		"/api/v1/device-backups?after_device_id=not-a-uuid",
		"/api/v1/device-backups?after_device_id=" + uuid.NewString(),
		"/api/v1/device-backups?after_device_id=" + foreignDevice.ID,
	} {
		request(t, router, http.MethodGet, url, token, nil, http.StatusBadRequest)
	}
	other := read("/api/v1/device-backups?limit=40", foreignToken)
	if len(other.Devices) != 1 || other.Devices[0].ID != foreignDevice.ID || other.HasMore {
		t.Fatalf("foreign owner cursor scope leaked devices: %+v", other)
	}
}
